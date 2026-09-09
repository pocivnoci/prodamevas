/**
 * Oborové ukázkové karusely na účtu `chrlit`
 * ==========================================
 * Účet `chrlit` má 41 příspěvků a všechny v jedné paletě (#050505 + #c0392b).
 * Zvenčí to čte jako „umí jenom červený feed". Tenhle skript proti tomu staví
 * sérii karuselů, kde KAŽDÝ jede v barevnosti a typografii jiného oboru:
 *
 *   Slide 1  — obálka: plocha v barvách oboru, dole černý pruh Chrlitu s logem
 *   Slide 2-4 — tři ukázkové příspěvky vymyšlené značky z toho oboru
 *
 * V mřížce profilu je z karuselu vidět jen obálka, takže série vyrobí devět
 * různobarevných dlaždic se stejným podpisem — přesně ten důkaz, o který jde.
 *
 *   npx tsx scripts/seed-chrlit-showcase.ts --list
 *   npx tsx scripts/seed-chrlit-showcase.ts --dry-run
 *   npx tsx scripts/seed-chrlit-showcase.ts --format-only     # jen srovnat formát v configu
 *   npx tsx scripts/seed-chrlit-showcase.ts --only=agropuda
 *   npx tsx scripts/seed-chrlit-showcase.ts                    # celá série
 *
 * Paleta se čte ŽIVĚ z portfoliového klienta (`sourceSlug`), typografie a
 * `feel` jsou autorské: naučené configy mají skoro všechny `font: "Inter"`
 * a `feel: "Moderní a čistý design"`, takže by rozmanitost fontů nedodaly.
 *
 * ⚠️ ZNAČKY NA SLIDECH JSOU VYMYŠLENÉ. Portfoliové firmy nejsou zákazníci a
 * nevědí o sobě; na Instagramu není místo na disclaimer, takže jmenovitá
 * ukázka by tvrdila obchodní vztah, který neexistuje. Ze zdrojového klienta
 * se bere JEN paleta — nikdy jméno, web ani logo.
 */

import supabaseAdmin from "../supabase/admin"
import { loadConfig, invalidateConfigCache } from "../instagram/configs"
import { generateOnePost } from "../instagram/autopilot"
import { buildShowcaseTopic, isRegulatedShowcase, type ShowcaseKit } from "../instagram/showcase-kit"
import { KITS, SHOWCASE_TYPE, SHOWCASE_TYPE_DEF } from "../instagram/showcase-kits"
import type { ClientConfig } from "../instagram/configs/types"

const OWN_SLUG = "chrlit"

// ─── Hydratace palety ze zdrojového klienta ──────────────────────────

/**
 * Doplní kitu ŽIVOU paletu z portfoliového klienta.
 *
 * Bere výhradně barvy (`colorPalette`, `accentColor`, `overlayGradient`).
 * Jméno, web ani logo se nepřebírají nikdy — anonymita série na tom stojí.
 */
async function hydrate(kit: ShowcaseKit): Promise<ShowcaseKit> {
    const src = await loadConfig(kit.sourceSlug)
    const fa = src.feedAesthetic
    if (!fa?.colorPalette) throw new Error(`${kit.sourceSlug}: chybí feedAesthetic.colorPalette — z čeho brát barvy?`)
    return {
        ...kit,
        feedAesthetic: {
            ...kit.feedAesthetic,
            colorPalette: fa.colorPalette,
            accentColor: fa.accentColor,
        },
        overlayGradient: src.overlayGradient ?? kit.overlayGradient,
    }
}

// ─── Formát na klientovi `chrlit` ────────────────────────────────────

/**
 * Doplní formát do `clients.config`, když tam ještě není. Idempotentní.
 *
 * Formát musí být ve VŠECH třech seznamech naráz — `postTypes`, `postFormats`
 * i `postTypeDefs` — a navíc v nějakém pilíři, jinak ho `reconcileFormats`
 * na příštím loadu odstřihne jako sirotka. `ig_post_types` se dosynchronizuje
 * samo přes `ensurePostTypes` při dalším načtení configu.
 */
async function ensureShowcaseFormat(dryRun: boolean): Promise<void> {
    const { data, error } = await supabaseAdmin
        .from("clients").select("id, config").eq("slug", OWN_SLUG).maybeSingle()
    if (error || !data) throw new Error(`Klient "${OWN_SLUG}" nenalezen: ${error?.message ?? "žádný řádek"}`)

    const config = data.config as ClientConfig
    const defs = config.postTypeDefs ?? []
    const existing = defs.find(d => d.name === SHOWCASE_TYPE)
    const hasType = (config.postTypes ?? []).includes(SHOWCASE_TYPE)
    const hasFormat = Boolean(config.postFormats?.[SHOWCASE_TYPE])
    const pillar = config.contentPillars?.[SHOWCASE_TYPE_DEF.pillar]
    const hasPillar = Boolean(pillar?.postTypes?.includes(SHOWCASE_TYPE))
    // Registr je zdroj pravdy: def se SROVNÁVÁ, ne jen zakládá. Jinak by úprava
    // briefu v kódu nikdy nedorazila ke klientovi, který formát už má.
    const defCurrent = existing ? JSON.stringify(existing) === JSON.stringify(SHOWCASE_TYPE_DEF) : false

    if (defCurrent && hasType && hasFormat && hasPillar) {
        console.log(`✓ Formát "${SHOWCASE_TYPE}" už na klientovi ${OWN_SLUG} je a odpovídá registru.`)
        return
    }
    if (existing && !defCurrent) console.log(`   ↻ Brief formátu se liší od registru — srovnávám.`)
    if (!pillar) throw new Error(`Pilíř "${SHOWCASE_TYPE_DEF.pillar}" na klientovi ${OWN_SLUG} neexistuje — formát by byl sirotek.`)

    console.log(`➕ Doplňuji formát "${SHOWCASE_TYPE}" do configu ${OWN_SLUG}…`)
    if (dryRun) { console.log("   (dry-run, nic se nezapisuje)"); return }

    const next: ClientConfig = {
        ...config,
        postTypes: hasType ? config.postTypes : [...(config.postTypes ?? []), SHOWCASE_TYPE],
        postTypeDefs: existing
            ? defs.map(d => d.name === SHOWCASE_TYPE ? SHOWCASE_TYPE_DEF : d)
            : [...defs, SHOWCASE_TYPE_DEF],
        postFormats: {
            ...(config.postFormats ?? {}),
            [SHOWCASE_TYPE]: { medium: "carousel", aspectRatio: "4:5", overlayStyle: "cover" },
        },
        contentPillars: {
            ...config.contentPillars,
            [SHOWCASE_TYPE_DEF.pillar]: {
                ...pillar,
                postTypes: hasPillar ? pillar.postTypes : [...(pillar.postTypes ?? []), SHOWCASE_TYPE],
            },
        },
    }
    const { error: upErr } = await supabaseAdmin.from("clients").update({ config: next }).eq("id", data.id)
    if (upErr) throw new Error(`Uložení configu selhalo: ${upErr.message}`)
    invalidateConfigCache(OWN_SLUG)
    console.log("   ✓ Uloženo.")
}

// ─── Běh ─────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2)
    const dryRun = args.includes("--dry-run")
    const onlyArg = args.find(a => a.startsWith("--only="))?.split("=")[1]
    const only = onlyArg ? onlyArg.split(",").map(s => s.trim()).filter(Boolean) : null

    if (args.includes("--list")) {
        console.log("\n🎨 Showcase kity:\n")
        for (const k of KITS) {
            console.log(`   ${k.key.padEnd(12)} ${k.industryLabel.padEnd(32)} „${k.brandName}"  ← paleta z ${k.sourceSlug}`)
            console.log(`   ${"".padEnd(12)} ${k.feedAesthetic.typographyStyle}`)
        }
        console.log()
        return
    }

    const selected = only ? KITS.filter(k => only.includes(k.key)) : KITS
    if (selected.length === 0) throw new Error(`Žádný kit neodpovídá --only=${onlyArg}. Známé: ${KITS.map(k => k.key).join(", ")}`)

    console.log("\n" + "═".repeat(64))
    console.log(`🎨 OBOROVÉ UKÁZKOVÉ KARUSELY → účet ${OWN_SLUG}`)
    console.log(`   Kitů: ${selected.length}${dryRun ? "   🔍 DRY-RUN" : ""}`)
    console.log("═".repeat(64) + "\n")

    await ensureShowcaseFormat(dryRun)
    if (args.includes("--format-only")) {
        console.log("\n✓ Jen formát — nic se negenerovalo.\n")
        return
    }

    let ok = 0
    for (const raw of selected) {
        const kit = await hydrate(raw)
        const topic = buildShowcaseTopic(kit)

        console.log(`\n── ${kit.key} — ${kit.industryLabel} ─────────────────────`)
        console.log(`   značka:   „${kit.brandName}" (vymyšlená)`)
        console.log(`   paleta:   ${kit.feedAesthetic.colorPalette}  ← živě z ${kit.sourceSlug}`)
        console.log(`   akcent:   ${kit.feedAesthetic.accentColor ?? "—"}`)
        console.log(`   typo:     ${kit.feedAesthetic.typographyStyle}`)
        if (isRegulatedShowcase(kit)) {
            if (!kit.guardrails) throw new Error(`${kit.key}: regulovaný obor bez guardrails — viz commit 2ba162e6.`)
            console.log(`   ⚖️  zákazy: ${kit.guardrails}`)
        }

        if (dryRun) {
            console.log(`\n   TOPIC pro copywritera:\n${topic.split("\n").map(l => "   │ " + l).join("\n")}`)
            continue
        }

        try {
            const res = await generateOnePost({
                configName: OWN_SLUG,
                type: SHOWCASE_TYPE,
                medium: "carousel",
                aspectRatio: "4:5",
                topic,
                showcaseKit: kit,
            })
            const slides = res.imageUrl?.split("|").length ?? 0
            console.log(`   ✅ Hotovo: ${slides} slidů, $${res.cost.toFixed(2)}`)
            console.log(`      ${res.imageUrl?.split("|")[0] ?? "(bez obrázku)"}`)
            ok++
        } catch (err: any) {
            console.error(`   ❌ ${kit.key} selhal: ${err?.message}`)
        }
    }

    console.log("\n" + "═".repeat(64))
    console.log(dryRun ? "🔍 Dry-run hotov — nic se nevygenerovalo." : `✅ Vygenerováno ${ok}/${selected.length} karuselů. Drafty čekají ve studiu.`)
    console.log("═".repeat(64) + "\n")
}

main().catch(err => { console.error("\n💥", err?.message ?? err); process.exit(1) })
