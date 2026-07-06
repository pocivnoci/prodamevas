/**
 * Audit (and optionally heal) the per-client formats↔pillars wiring across ALL
 * tenants. Born from the cross-tenant leak where clients with no per-client
 * `ig_post_types` rows fell back to a shared global pool ("every client shows the
 * same formats").
 *
 *   npx tsx scripts/audit-formats-pillars.ts          # read-only report
 *   npx tsx scripts/audit-formats-pillars.ts --fix    # deterministic, config-derived heals only
 *
 * The four per-client sources that must agree:
 *   config.postTypes[]                — active type names
 *   config.postTypeDefs[]             — per-brand definitions (name/display/emoji/desc)
 *   config.contentPillars[*].postTypes[] — pillar membership (drives pillarId + category)
 *   ig_post_types rows (client_id)    — derived/persisted; read by engine AND the UI
 *
 * --fix performs ONLY safe, deterministic heals (NO AI):
 *   - ensurePostTypes(config, clientId): backfill missing per-client rows from config
 *   - deactivate stale ig_post_types rows whose name isn't in config.postTypes
 *   - drop dead contentPillars[*].postTypes entries that aren't in config.postTypes
 * Clients with an EMPTY config (no postTypes/postTypeDefs) are REPORTED ONLY — they
 * need a deliberate `npx tsx scripts/backfill-post-types.ts <slug>` (which runs AI).
 */

import supabaseAdmin from "../supabase/admin"
import { loadConfig, getPillarForPostType, invalidateConfigCache } from "../instagram/configs"
import { reconcileFormats } from "../instagram/configs/reconcile"
import { ensurePostTypes } from "../instagram/service"
import type { ClientConfig } from "../instagram/configs/types"

const FIX = process.argv.includes("--fix")

interface ClientRow { id: string; slug: string; config: ClientConfig | null }

interface Finding {
    slug: string
    leakProne: boolean          // had postTypes but 0 per-client ig_post_types rows
    emptyConfig: boolean        // no postTypes/postTypeDefs — can't self-heal (report only)
    genericFormats: boolean     // has postTypes but postTypeDefs EMPTY → not brand-specific
    typesNoDef: string[]        // in postTypes, missing a postTypeDefs entry
    typesNoPillar: string[]     // in postTypes, not a member of any pillar → pillarId null
    deadPillarRefs: string[]    // pillar.postTypes referencing a name not in postTypes
    staleRows: string[]         // active ig_post_types rows whose name isn't in postTypes
    healed: string[]            // what --fix actually changed
}

async function audit(): Promise<void> {
    const { data: clients, error } = await supabaseAdmin
        .from("clients")
        .select("id, slug, config")
        .order("slug")
    if (error) { console.error("❌ Failed to list clients:", error.message); process.exit(1) }

    const findings: Finding[] = []

    for (const client of (clients || []) as ClientRow[]) {
        const { id: clientId, slug } = client
        // Load through the normal path so defaults/validateConfig apply.
        let config: ClientConfig
        try { config = await loadConfig(slug) } catch (e) {
            console.warn(`⚠️  ${slug}: loadConfig failed (${(e as Error).message}) — skipping`)
            continue
        }

        const postTypes = config.postTypes ?? []
        const defNames = new Set((config.postTypeDefs ?? []).map(d => d.name))
        // loadConfig() now self-heals (validateConfig → reconcileFormats), which hides
        // pillar-membership drift. Detect it against the RAW persisted config instead.
        const raw = (client.config || {}) as ClientConfig
        const rawPostTypes = raw.postTypes ?? []

        const f: Finding = {
            slug, leakProne: false, emptyConfig: false, genericFormats: false,
            typesNoDef: [], typesNoPillar: [], deadPillarRefs: [], staleRows: [], healed: [],
        }

        // Empty config → report only.
        if (postTypes.length === 0 && defNames.size === 0) {
            f.emptyConfig = true
            findings.push(f)
            continue
        }

        // Per-client rows in the table.
        const { data: rowData } = await supabaseAdmin
            .from("ig_post_types").select("name, is_active").eq("client_id", clientId)
        const rows = rowData || []
        const activeRowNames = new Set(rows.filter(r => r.is_active).map(r => r.name))

        if (postTypes.length > 0 && rows.length === 0) f.leakProne = true
        // Generic = has active types but NO brand-specific defs → generateCustomFormats
        // never persisted (the "same formats for every client" symptom). Needs a
        // deliberate AI backfill — NOT auto-run here (report only).
        if (postTypes.length > 0 && defNames.size === 0) f.genericFormats = true

        // Drift checks.
        f.typesNoDef = postTypes.filter(n => !defNames.has(n))
        f.typesNoPillar = rawPostTypes.filter(n => !getPillarForPostType(raw, n))
        const allPillarMembers = new Set<string>()
        for (const p of Object.values(raw.contentPillars ?? {})) for (const n of (p.postTypes || [])) allPillarMembers.add(n)
        f.deadPillarRefs = [...allPillarMembers].filter(n => !rawPostTypes.includes(n))
        f.staleRows = [...activeRowNames].filter(n => !postTypes.includes(n))

        // ── Heal (deterministic only) ──────────────────────────────────────────
        if (FIX) {
            // 1) Backfill missing per-client rows from config (same as the engine).
            if (f.leakProne || rows.length < postTypes.length) {
                await ensurePostTypes(config, clientId)
                f.healed.push("ensurePostTypes")
            }
            // 2) Deactivate stale rows.
            if (f.staleRows.length > 0) {
                await supabaseAdmin.from("ig_post_types")
                    .update({ is_active: false })
                    .eq("client_id", clientId)
                    .in("name", f.staleRows)
                f.healed.push(`deactivate(${f.staleRows.length})`)
            }
            // 3) Reconcile config projections on the RAW config (re-home orphaned
            //    formats, drop dead pillar refs, backfill postFormats) and persist so
            //    non-patched lambdas / direct DB consumers see consistent data.
            const reconciled = reconcileFormats(raw)
            const changed =
                JSON.stringify(reconciled.contentPillars ?? {}) !== JSON.stringify(raw.contentPillars ?? {}) ||
                JSON.stringify(reconciled.postTypes ?? []) !== JSON.stringify(raw.postTypes ?? []) ||
                JSON.stringify(reconciled.postFormats ?? {}) !== JSON.stringify(raw.postFormats ?? {})
            if (changed) {
                const { error: upErr } = await supabaseAdmin.from("clients").update({ config: reconciled }).eq("id", clientId)
                if (upErr) console.error(`   ⚠️ ${slug}: config update failed: ${upErr.message}`)
                else { invalidateConfigCache(slug); f.healed.push("reconcileFormats") }
            }
        }

        findings.push(f)
    }

    report(findings)
}

function report(findings: Finding[]): void {
    const leak = findings.filter(f => f.leakProne)
    const generic = findings.filter(f => f.genericFormats)
    const empty = findings.filter(f => f.emptyConfig)
    // Don't double-report generic clients under "drift" — their typesNoDef is just "all".
    const drift = findings.filter(f => !f.emptyConfig && !f.genericFormats &&
        (f.typesNoDef.length || f.typesNoPillar.length || f.deadPillarRefs.length || f.staleRows.length))

    console.log(`\n${"═".repeat(64)}`)
    console.log(`  FORMATS↔PILLARS AUDIT  ${FIX ? "(--fix applied)" : "(read-only)"}`)
    console.log(`  clients: ${findings.length} | leak-prone: ${leak.length} | generic: ${generic.length} | empty: ${empty.length} | drift: ${drift.length}`)
    console.log("═".repeat(64))

    if (leak.length) {
        console.log(`\n🔴 LEAK-PRONE (had postTypes, 0 per-client rows → hit the global fallback):`)
        for (const f of leak) console.log(`   • ${f.slug}${f.healed.length ? `  → healed: ${f.healed.join(", ")}` : "  (run --fix)"}`)
    }
    if (generic.length) {
        console.log(`\n🟠 GENERIC FORMATS (postTypeDefs EMPTY → not brand-specific; THIS is "same formats for every client").`)
        console.log(`   Fix per client (runs AI — deliberate, not auto): npx tsx scripts/backfill-post-types.ts <slug>`)
        for (const f of generic) console.log(`   • ${f.slug}`)
    }
    if (empty.length) {
        console.log(`\n🟠 EMPTY CONFIG (no postTypes at all — report only): npx tsx scripts/backfill-post-types.ts <slug>`)
        for (const f of empty) console.log(`   • ${f.slug}`)
    }
    if (drift.length) {
        console.log(`\n🟡 DRIFT (partial):`)
        for (const f of drift) {
            const bits: string[] = []
            if (f.typesNoDef.length) bits.push(`no-def: ${f.typesNoDef.join(",")}`)
            if (f.typesNoPillar.length) bits.push(`no-pillar: ${f.typesNoPillar.join(",")}`)
            if (f.deadPillarRefs.length) bits.push(`dead-pillar-ref: ${f.deadPillarRefs.join(",")}`)
            if (f.staleRows.length) bits.push(`stale-rows: ${f.staleRows.join(",")}`)
            console.log(`   • ${f.slug}: ${bits.join(" | ")}${f.healed.length ? `  → healed: ${f.healed.join(", ")}` : ""}`)
        }
    }
    if (!leak.length && !generic.length && !empty.length && !drift.length) console.log(`\n✅ All clients consistent.`)
    console.log()
}

audit().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
