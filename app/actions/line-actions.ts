"use server"

/**
 * Product Line server actions
 *
 * Lifecycle: generate → (revise / edit) → approve → catalog.
 *
 * The draft doctrine is copied deliberately from plan drafts (campaign-actions.ts):
 * a generated line is persisted at status='draft', nothing downstream may act on a
 * draft, and approval is a single-use CONDITIONAL CLAIM
 * (UPDATE … WHERE id=? AND client_id=? AND status='draft'). There is no insert
 * fallback when the claim returns no row — falling back is precisely how a
 * double-click writes the catalog twice.
 *
 * Credits are charged once, at generation, because that is where the cost is (one
 * Pro-ladder run). Approval writes rows and costs nothing.
 */

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"
import { creditGuard } from "./credit-guard"
import { loadConfig } from "@/instagram/configs"
import {
    generateProductLine,
    reviseSku,
    slugifyLine,
    type ProductLineBrief,
    type GeneratedLine,
    type LineSku,
    type LineValidationIssue,
} from "@/instagram/line-generator"

export interface LineRow {
    id: string
    name: string
    slug: string
    positioning: string | null
    target_audience: string | null
    price_tier: string | null
    naming_convention: string | null
    system_logic: string | null
    skus: LineSku[]
    brief: Record<string, any>
    status: string
    created_at: string
    updated_at: string
}

// ============================================
// GENERATE
// ============================================

export async function generateLine(
    projectSlug: string,
    brief: ProductLineBrief & { runId?: string },
): Promise<{ success: boolean; lineId?: string; line?: GeneratedLine; issues?: LineValidationIssue[]; error?: string }> {
    const guard = await creditGuard(projectSlug, "product_line")
    if (!guard.ok) return { success: false, error: guard.error }
    const clientId = guard.clientId

    // The row is created BEFORE generation so getLineProgress has something to poll
    // (the UI can't read a value from an action that hasn't returned yet). 'generating'
    // is outside the worker/approval vocabulary, so a crashed run leaves an inert row.
    const { data: row, error: insertErr } = await supabaseAdmin
        .from("ig_product_lines")
        .insert({
            client_id: clientId,
            name: `${brief.category} (generuje se…)`,
            slug: `draft-${Date.now()}`,
            price_tier: brief.priceTier,
            brief: { ...brief, runId: brief.runId || null },
            status: "generating",
            progress: "Startuji…",
        })
        .select("id")
        .single()

    if (insertErr || !row) {
        return { success: false, error: `Nepodařilo se založit řadu: ${insertErr?.message}` }
    }

    const setProgress = async (message: string) => {
        await supabaseAdmin
            .from("ig_product_lines")
            .update({ progress: message, updated_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("client_id", clientId)
    }

    try {
        const config = await loadConfig(projectSlug)
        const { line, issues } = await generateProductLine(config, clientId, brief, (m) => { void setProgress(m) })

        const { error: updateErr } = await supabaseAdmin
            .from("ig_product_lines")
            .update({
                name: line.line.name,
                slug: line.line.slug || slugifyLine(line.line.name),
                positioning: line.line.positioning,
                target_audience: line.line.targetAudience,
                price_tier: line.line.priceTier,
                naming_convention: line.line.namingConvention,
                system_logic: line.line.systemLogic,
                skus: line.skus,
                status: "draft",
                progress: null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", row.id)
            .eq("client_id", clientId)

        if (updateErr) throw new Error(updateErr.message)

        await guard.commit(`Produktová řada: ${line.line.name}`, row.id)
        return { success: true, lineId: row.id, line, issues }
    } catch (err: any) {
        console.error("generateLine error:", err)
        // Not charged — commit() only runs on the success path above.
        await supabaseAdmin
            .from("ig_product_lines")
            .update({ status: "failed", progress: err?.message?.slice(0, 300) || "Generování selhalo" })
            .eq("id", row.id)
            .eq("client_id", clientId)
        return { success: false, error: err?.message || "Generování řady selhalo" }
    }
}

export async function getLineProgress(
    projectSlug: string,
    runId: string,
): Promise<{ status: string; progress: string; lineId: string } | null> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { data } = await supabaseAdmin
            .from("ig_product_lines")
            .select("id, status, progress")
            .eq("client_id", clientId)
            .eq("brief->>runId", runId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (!data) return null
        return { status: data.status, progress: data.progress || "", lineId: data.id }
    } catch {
        return null
    }
}

// ============================================
// READ
// ============================================

export async function getLines(projectSlug: string): Promise<LineRow[]> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { data } = await supabaseAdmin
            .from("ig_product_lines")
            .select("*")
            .eq("client_id", clientId)
            .neq("status", "generating")
            .order("updated_at", { ascending: false })
        return (data || []) as LineRow[]
    } catch {
        return []
    }
}

export async function getLine(projectSlug: string, lineId: string): Promise<LineRow | null> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { data } = await supabaseAdmin
            .from("ig_product_lines")
            .select("*")
            .eq("id", lineId)
            .eq("client_id", clientId)
            .maybeSingle()
        return (data as LineRow) || null
    } catch {
        return null
    }
}

// ============================================
// REVISE
// ============================================

/**
 * AI-revise one SKU. Scoped to drafts: once a line is approved its SKUs live in
 * ig_products and editing the frozen jsonb would silently diverge from the catalog.
 */
export async function reviseLineSku(
    projectSlug: string,
    lineId: string,
    skuIndex: number,
    feedback: string,
): Promise<{ success: boolean; sku?: LineSku; error?: string }> {
    const guard = await creditGuard(projectSlug, "idea_generate")
    if (!guard.ok) return { success: false, error: guard.error }
    const clientId = guard.clientId

    try {
        const { data: row } = await supabaseAdmin
            .from("ig_product_lines")
            .select("*")
            .eq("id", lineId)
            .eq("client_id", clientId)
            .eq("status", "draft")
            .maybeSingle()
        if (!row) return { success: false, error: "Řada nenalezena nebo už byla schválena." }

        const config = await loadConfig(projectSlug)
        const generated: GeneratedLine = {
            line: {
                name: row.name,
                slug: row.slug,
                positioning: row.positioning || "",
                targetAudience: row.target_audience || "",
                priceTier: row.price_tier || "mid",
                namingConvention: row.naming_convention || "",
                systemLogic: row.system_logic || "",
            },
            skus: (row.skus || []) as LineSku[],
        }

        const revised = await reviseSku(config, generated, skuIndex, feedback)
        const nextSkus = [...generated.skus]
        nextSkus[skuIndex] = revised

        await supabaseAdmin
            .from("ig_product_lines")
            .update({ skus: nextSkus, updated_at: new Date().toISOString() })
            .eq("id", lineId)
            .eq("client_id", clientId)
            .eq("status", "draft")

        await guard.commit(`Úprava produktu v řadě: ${revised.name}`, lineId)
        return { success: true, sku: revised }
    } catch (err: any) {
        console.error("reviseLineSku error:", err)
        return { success: false, error: err?.message || "Úprava selhala" }
    }
}

/** Manual (non-AI, uncharged) edit of a draft SKU. */
export async function updateLineSku(
    projectSlug: string,
    lineId: string,
    skuIndex: number,
    patch: Partial<LineSku>,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { data: row } = await supabaseAdmin
            .from("ig_product_lines")
            .select("skus")
            .eq("id", lineId)
            .eq("client_id", clientId)
            .eq("status", "draft")
            .maybeSingle()
        if (!row) return { success: false, error: "Řada nenalezena nebo už byla schválena." }

        const skus = (row.skus || []) as LineSku[]
        if (!skus[skuIndex]) return { success: false, error: "Produkt v řadě neexistuje." }
        // step is structural — a patch must not be able to reorder the line
        const safePatch = { ...patch }
        delete safePatch.step
        skus[skuIndex] = { ...skus[skuIndex], ...safePatch }

        await supabaseAdmin
            .from("ig_product_lines")
            .update({ skus, updated_at: new Date().toISOString() })
            .eq("id", lineId)
            .eq("client_id", clientId)
            .eq("status", "draft")

        return { success: true }
    } catch (err: any) {
        return { success: false, error: err?.message || "Uložení selhalo" }
    }
}

// ============================================
// APPROVE
// ============================================

/**
 * Approve a draft line: SKUs become real catalog rows and launch topics are
 * deposited into the idea bank.
 *
 * The status='draft' claim is the whole safety story — it runs FIRST, so any
 * concurrent second call is refused before a single product row is written.
 */
export async function approveLine(
    projectSlug: string,
    lineId: string,
    selectedSteps?: number[],
): Promise<{ success: boolean; created?: number; ideas?: number; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data: row } = await supabaseAdmin
            .from("ig_product_lines")
            .select("*")
            .eq("id", lineId)
            .eq("client_id", clientId)
            .eq("status", "draft")
            .maybeSingle()
        if (!row) return { success: false, error: "Tato řada už byla schválena nebo neexistuje." }

        const allSkus = (row.skus || []) as LineSku[]
        const skus = selectedSteps?.length
            ? allSkus.filter(s => selectedSteps.includes(s.step))
            : allSkus
        if (skus.length === 0) return { success: false, error: "Nevybral jsi žádný produkt." }

        // Slug must be unique per client and the draft slug was never checked
        // (the unique index deliberately excludes drafts).
        const finalSlug = await uniqueLineSlug(clientId, row.slug || slugifyLine(row.name), lineId)

        // 1) Single-use claim. Nothing below this line may run twice.
        const { data: claimed } = await supabaseAdmin
            .from("ig_product_lines")
            .update({ status: "active", slug: finalSlug, updated_at: new Date().toISOString() })
            .eq("id", lineId)
            .eq("client_id", clientId)
            .eq("status", "draft")
            .select("id")
            .maybeSingle()
        if (!claimed) return { success: false, error: "Tato řada už byla schválena." }

        // 2) Catalog rows. Product slugs are unique per client, so collisions with an
        //    existing catalog entry are resolved rather than aborting the whole approval.
        const existingSlugs = await takenProductSlugs(clientId)
        const rows = skus.map(sku => {
            const slug = nextFreeSlug(slugifyLine(sku.name), existingSlugs)
            existingSlugs.add(slug)
            return {
                client_id: clientId,
                line_id: lineId,
                line_step: sku.step,
                line_role: sku.role,
                name: sku.name,
                type: row.brief?.category || "product",
                slug,
                price: formatPrice(sku.priceCzk),
                description: sku.description,
                specs: sku.specs || null,
                image_urls: [],
            }
        })

        const { data: created, error: prodErr } = await supabaseAdmin
            .from("ig_products")
            .insert(rows)
            .select("id")
        if (prodErr) {
            // The line stays 'active' with fewer products rather than rolling back to
            // 'draft': re-approving would re-run this insert and duplicate whatever
            // did land. Surfacing the failure lets the user add the rest by hand.
            console.error("approveLine: product insert failed", prodErr)
            return { success: false, error: `Řada schválena, ale produkty se nepodařilo uložit: ${prodErr.message}` }
        }

        // 3) Launch topics into the idea bank — same deposit-once rule as startCampaign:
        //    this is the only place it happens, and it is idempotent by title.
        const ideas = await depositLaunchIdeas(clientId, projectSlug, row, skus)

        return { success: true, created: created?.length || 0, ideas }
    } catch (err: any) {
        console.error("approveLine error:", err)
        return { success: false, error: err?.message || "Schválení selhalo" }
    }
}

export async function discardLine(
    projectSlug: string,
    lineId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        // Status-scoped for the same reason as the approval claim: an approved line
        // owns catalog rows and must not vanish from under them.
        const { data } = await supabaseAdmin
            .from("ig_product_lines")
            .delete()
            .eq("id", lineId)
            .eq("client_id", clientId)
            .in("status", ["draft", "failed"])
            .select("id")
            .maybeSingle()
        if (!data) return { success: false, error: "Řadu už nelze zahodit (je schválená)." }
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err?.message || "Zahození selhalo" }
    }
}

export async function archiveLine(
    projectSlug: string,
    lineId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        await supabaseAdmin
            .from("ig_product_lines")
            .update({ status: "archived", updated_at: new Date().toISOString() })
            .eq("id", lineId)
            .eq("client_id", clientId)
            .eq("status", "active")
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err?.message || "Archivace selhala" }
    }
}

// ============================================
// HELPERS
// ============================================

function formatPrice(czk: number): string {
    return `${Math.round(czk).toLocaleString("cs-CZ")} Kč`
}

async function uniqueLineSlug(clientId: string, base: string, selfId: string): Promise<string> {
    const seed = base || "rada"
    const { data } = await supabaseAdmin
        .from("ig_product_lines")
        .select("slug")
        .eq("client_id", clientId)
        .neq("id", selfId)
        .neq("status", "draft")
    const taken = new Set((data || []).map(r => r.slug))
    return nextFreeSlug(seed, taken)
}

async function takenProductSlugs(clientId: string): Promise<Set<string>> {
    const { data } = await supabaseAdmin
        .from("ig_products")
        .select("slug")
        .eq("client_id", clientId)
    return new Set((data || []).map(r => r.slug))
}

function nextFreeSlug(base: string, taken: Set<string>): string {
    const seed = base || "produkt"
    if (!taken.has(seed)) return seed
    let n = 2
    while (taken.has(`${seed}-${n}`)) n++
    return `${seed}-${n}`
}

/**
 * Deposit one launch topic per approved SKU plus one for the line as a whole.
 *
 * Idempotent by title (same rule as the campaign deposit): a re-run reuses the
 * existing row instead of creating a twin, which would double that topic's odds
 * in weighted selection and split its performance score across two rows.
 */
async function depositLaunchIdeas(
    clientId: string,
    projectSlug: string,
    line: any,
    skus: LineSku[],
): Promise<number> {
    try {
        const config = await loadConfig(projectSlug).catch(() => null)
        const pillar = pickProductPillar(config)

        const candidates = [
            {
                title: `Představení řady ${line.name}`,
                content: `${line.positioning || ""} ${line.system_logic || ""}`.trim()
                    || `Launch produktové řady ${line.name}.`,
                keywords: [line.name],
            },
            ...skus.map(sku => ({
                title: `${sku.name} — ${sku.role}`,
                content: `Krok ${sku.step} v řadě ${line.name}. ${sku.description}`
                    + (sku.specs?.claims?.length ? ` Klíčové vlastnosti: ${sku.specs.claims.join(", ")}.` : "")
                    + (sku.pairsWith ? ` Navazuje na: ${sku.pairsWith}.` : ""),
                keywords: [sku.name, sku.role].filter(Boolean),
            })),
        ]

        const { data: existing } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("title")
            .eq("client_id", clientId)
            .in("title", candidates.map(c => c.title))
        const taken = new Set((existing || []).map(r => r.title))

        const toInsert = candidates
            .filter(c => !taken.has(c.title))
            .map(c => ({
                client_id: clientId,
                category: pillar,
                subcategory: null,
                title: c.title,
                content: c.content,
                keywords: c.keywords,
                used_count: 0,
                is_active: true,
            }))

        if (toInsert.length === 0) return 0
        const { data: inserted } = await supabaseAdmin
            .from("ig_post_ideas")
            .insert(toInsert)
            .select("id")
        return inserted?.length || 0
    } catch (err: any) {
        // A failed deposit must not undo an approved line — the catalog is the
        // valuable part and topics can be regenerated at any time.
        console.warn(`approveLine: idea deposit failed — ${err?.message}`)
        return 0
    }
}

/** Pick the pillar a product launch belongs to; falls back to the first configured one. */
function pickProductPillar(config: any): string | null {
    const pillars = config?.contentPillars as Record<string, any> | undefined
    if (!pillars) return null
    const keys = Object.keys(pillars)
    if (keys.length === 0) return null
    const productish = keys.find(k =>
        /produkt|product|prodej|sales|nabidka|konverz/i.test(k) ||
        /produkt|product|prodej|nabídka/i.test(pillars[k]?.label || ""))
    return productish || keys[0]
}
