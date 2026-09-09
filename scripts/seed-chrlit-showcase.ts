/**
 * Oborové ukázky práce na účtu `chrlit`
 * ======================================
 * Účet `chrlit` má 41 příspěvků a všechny v jedné paletě (#050505 + #c0392b).
 * Zvenčí to čte jako „umí jenom červený feed". Tenhle skript proti tomu staví
 * devět SAMOSTATNÝCH příspěvků — každý je hotová práce pro značku z jiného
 * oboru, v její barevnosti, typografii, hlase i rodině layoutů.
 *
 * Samostatný post = samostatná dlaždice, takže rozmanitost je vidět rovnou
 * v mřížce. První verze byly karusely s jednotnou obálkou; z mřížky pak
 * koukalo devět stejných titulek a vypadalo to jako složka prezentací.
 *
 *   npx tsx scripts/seed-chrlit-showcase.ts --list
 *   npx tsx scripts/seed-chrlit-showcase.ts --dry-run
 *   npx tsx scripts/seed-chrlit-showcase.ts --format-only     # jen srovnat formát v configu
 *   npx tsx scripts/seed-chrlit-showcase.ts --only=agropuda
 *   npx tsx scripts/seed-chrlit-showcase.ts --only=vinarstvi --mode=tema      # vynutit režim
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
import { buildSegmentTopic, buildShowcaseTopic, isRegulatedShowcase, SHOWCASE_BENEFITS, type ShowcaseKit } from "../instagram/showcase-kit"
import { KITS, SHOWCASE_TYPE, SHOWCASE_TYPE_DEF } from "../instagram/showcase-kits"
import type { ClientConfig } from "../instagram/configs/types"

const OWN_SLUG = "chrlit"

/**
 * Srovnávací kolo: tentýž obor ve třech směrech vedle sebe.
 *
 * Vizuální směr se špatně popisuje slovy — tohle převádí otázku „jak to má
 * vypadat" na ukázání prstem. Všechny tři jsou fotograficko-redakční, liší se
 * tím, JAK fotka nese barvu a kde bydlí text.
 */
const VARIANTS: Record<string, string> = {
    celoplosna: "Single full-bleed photograph edge to edge, no borders, no panels. The colour floods the "
        + "whole frame straight out of the scene. Type sits directly on the photograph in its calmest area, "
        + "large and confident. Think a magazine's opening spread.",
    obalka: "One strong photograph occupying roughly two thirds, the remaining third a clean field lifted "
        + "from a colour inside that same photograph (not a foreign brand colour). Type lives in that field "
        + "with generous air. Think a fashion magazine cover.",
    makro: "Extreme close-up: a single detail filling the frame — texture, droplets, grain, skin, surface. "
        + "Shallow depth of field, tactile, almost edible. The colour comes from the subject itself. Type is "
        + "small and set into the negative space the macro leaves.",
}

// ─── Hydratace palety ze zdrojového klienta ──────────────────────────

/**
 * Doplní kitu ŽIVOU paletu z portfoliového klienta.
 *
 * Bere výhradně barvy (`colorPalette`, `accentColor`, `overlayGradient`).
 * Jméno, web ani logo se nepřebírají nikdy — anonymita série na tom stojí.
 */
async function hydrate(kit: ShowcaseKit): Promise<ShowcaseKit> {
    // Kit bez předlohy si nese vlastní paletu — oborů je víc než portfoliových značek.
    if (!kit.sourceSlug) {
        if (!kit.feedAesthetic.colorPalette) {
            throw new Error(`${kit.key}: kit bez sourceSlug musí mít vlastní feedAesthetic.colorPalette`)
        }
        return kit
    }
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
    const variantArg = args.find(a => a.startsWith("--variant="))?.split("=")[1]
    const modeArg = args.find(a => a.startsWith("--mode="))?.split("=")[1] as "ukazka" | "tema" | undefined
    if (modeArg && modeArg !== "ukazka" && modeArg !== "tema") {
        throw new Error(`Neznámý --mode=${modeArg}. Známé: ukazka, tema`)
    }
    if (variantArg && !VARIANTS[variantArg]) {
        throw new Error(`Neznámý --variant=${variantArg}. Známé: ${Object.keys(VARIANTS).join(", ")}`)
    }
    const only = onlyArg ? onlyArg.split(",").map(s => s.trim()).filter(Boolean) : null

    if (args.includes("--list")) {
        console.log("\n🎨 Showcase kity:\n")
        for (const k of KITS) {
            console.log(`   ${k.key.padEnd(12)} ${k.industryLabel.padEnd(32)} „${k.brandName}"  ${k.dominantColor}  [${k.visualMode}]`)
            console.log(`   ${"".padEnd(12)} ${k.feedAesthetic.typographyStyle}`)
        }
        console.log()
        return
    }

    const selected = only ? KITS.filter(k => only.includes(k.key)) : KITS
    if (selected.length === 0) throw new Error(`Žádný kit neodpovídá --only=${onlyArg}. Známé: ${KITS.map(k => k.key).join(", ")}`)

    console.log("\n" + "═".repeat(64))
    console.log(`🎨 OBOROVÉ UKÁZKY PRÁCE → účet ${OWN_SLUG}`)
    console.log(`   Kitů: ${selected.length}${dryRun ? "   🔍 DRY-RUN" : ""}`)
    console.log("═".repeat(64) + "\n")

    await ensureShowcaseFormat(dryRun)
    if (args.includes("--format-only")) {
        console.log("\n✓ Jen formát — nic se negenerovalo.\n")
        return
    }

    let ok = 0
    for (const raw of selected) {
        const hydrated = await hydrate(raw)
        const kit: ShowcaseKit = variantArg
            ? { ...hydrated, directionOverride: VARIANTS[variantArg] }
            : hydrated

        console.log(`\n── ${kit.key} — ${kit.industryLabel} ─────────────────────`)
        console.log(`   značka:   „${kit.brandName}" (vymyšlená)`)
        console.log(`   paleta:   ${kit.feedAesthetic.colorPalette}${kit.sourceSlug ? `  ← živě z ${kit.sourceSlug}` : "  (vlastní)"}`)
        console.log(`   vládne:   ${kit.dominantColor}`)
        console.log(`   akcent:   ${kit.feedAesthetic.accentColor ?? "—"}`)
        console.log(`   typo:     ${kit.feedAesthetic.typographyStyle}`)
        console.log(`   layout:   ${kit.visualMode}${variantArg ? `  |  směr: ${variantArg}` : ""}`)
        if (isRegulatedShowcase(kit)) {
            if (!kit.guardrails) throw new Error(`${kit.key}: regulovaný obor bez guardrails — viz commit 2ba162e6.`)
            console.log(`   ⚖️  zákazy: ${kit.guardrails}`)
        }

        // Každý třetí obor je ukázka (hlas značky + naše výhoda), zbylé dva jsou
        // naše běžné formáty mířené na tenhle segment. Feed tak zůstane profilem
        // pro lidi, ne katalogem odvětví — a barevný je pořád, protože kit platí
        // na všechno.
        //
        // Role plyne z pozice v REGISTRU, ne z pořadí v běhu: jinak by `--only=`
        // na jeden obor vždycky vyrobilo ukázku a doplnit chybějící kus by
        // změnilo, čím ten obor ve feedu je.
        const isShowcase = modeArg
            ? modeArg === "ukazka"
            : KITS.findIndex(k => k.key === kit.key) % 3 === 0
        const mode: "ukazka" | "tema" = isShowcase ? "ukazka" : "tema"
        const topic = isShowcase ? buildShowcaseTopic(kit) : buildSegmentTopic(kit)
        console.log(`   režim:    ${isShowcase ? "UKÁZKA (mluví značka + naše výhoda)" : "TÉMA (mluvíme my, mířeně)"}`)
        console.log(`   výhoda:   ${kit.benefit} — ${SHOWCASE_BENEFITS[kit.benefit]}`)

        if (dryRun) {
            console.log(`\n   TOPIC pro copywritera:\n${topic.split("\n").map(l => "   │ " + l).join("\n")}`)
            continue
        }

        try {
            const res = await generateOnePost({
                configName: OWN_SLUG,
                // Ukázka má vlastní formát; u tématu vybírá formát běžná rotace
                // Chrlitu (mýtus, srovnání, před/po…), ať profil žije jako profil.
                ...(isShowcase ? { type: SHOWCASE_TYPE } : {}),
                medium: "image",
                aspectRatio: "4:5",
                topic,
                showcaseKit: kit,
                showcaseMode: mode,
                slotIntent: { patternId: "none", seqIndex: 0, visualMode: kit.visualMode },
            })
            console.log(`   ✅ Hotovo: $${res.cost.toFixed(2)}`)
            console.log(`      ${res.imageUrl ?? "(bez obrázku)"}`)
            ok++
        } catch (err: any) {
            console.error(`   ❌ ${kit.key} selhal: ${err?.message}`)
        }
    }

    console.log("\n" + "═".repeat(64))
    console.log(dryRun ? "🔍 Dry-run hotov — nic se nevygenerovalo." : `✅ Vygenerováno ${ok}/${selected.length} ukázek. Drafty čekají ve studiu.`)
    console.log("═".repeat(64) + "\n")
}

main().catch(err => { console.error("\n💥", err?.message ?? err); process.exit(1) })
