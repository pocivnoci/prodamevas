/**
 * Převede formáty z STORYBOARDŮ na INVARIANTY — a nic přitom nezahodí.
 *
 *   npx tsx scripts/degeneralize-formats.ts                  # read-only report všech klientů
 *   npx tsx scripts/degeneralize-formats.ts --slug=<slug>    # jen jeden klient
 *   npx tsx scripts/degeneralize-formats.ts --fix            # zapíše změny
 *   npx tsx scripts/degeneralize-formats.ts --fix --slug=x   # obojí
 *
 * PROČ
 * ────
 * `generateCustomFormats()` historicky generovala formáty jako scénář JEDNOHO postu:
 * „Scéna 1: odemčení dveří → Scéna 2: markýza → text 'Klidné ráno na Vinohradech'".
 * Takový text se vkládá do promptu u KAŽDÉHO postu daného formátu, takže se stejný
 * příspěvek vrací donekonečna — u `chrlit` vyšlo 170 postů z 8 formátů (~21× každý).
 *
 * Ty texty ale nejsou k zahození — jsou to výborné NÁPADY. Jen sedí na místě, kde se
 * musí opakovat. Skript je proto rozloží na dvě části:
 *
 *   storyboard  →  invariantní formát  (mechanismus, rytmus beatů, produkční kvality)
 *               +  2-3 konkrétní nápady do `ig_post_ideas` (scéna, rekvizity, příležitost)
 *
 * Nápad se spotřebuje jednou a jde do cooldownu; formát zůstane použitelný donekonečna.
 *
 * CO SE NIKDY NEMĚNÍ
 * ──────────────────
 * `PostTypeDef.name` je klíč celé pipeline — visí na něm řádky `ig_post_types`,
 * `config.postTypes`, `contentPillars[].postTypes`, `weekPlan` i `post_type_id` už
 * vygenerovaných příspěvků. Mění se výhradně `description` / `structure` / `visualStyle`
 * (+ kosmetické `display_name` / `emoji`). Pilíř, médium a poměr stran zůstávají.
 *
 * Původní definice se zálohují do `config._postTypeDefsBackup`, takže návrat je možný.
 */

import supabaseAdmin from "../supabase/admin"
import { loadConfig, invalidateConfigCache } from "../instagram/configs"
import { reconcileFormats } from "../instagram/configs/reconcile"
import { ensurePostTypes } from "../instagram/service"
import { generateText } from "../instagram/gemini-client"
import { getModel } from "../instagram/models"
import { FORMAT_BRIEF_LIMITS } from "../instagram/configs/types"
import type { ClientConfig, PostTypeDef, PillarCategory } from "../instagram/configs/types"

const FIX = process.argv.includes("--fix")
const ONLY_SLUG = process.argv.find(a => a.startsWith("--slug="))?.split("=")[1]

interface ClientRow { id: string; slug: string; config: ClientConfig | null }

interface SeedIdea {
    title: string
    content: string
    pillar: string
    subcategory?: string | null
    fromFormat: string
}

interface Conversion {
    defs: PostTypeDef[]
    ideas: SeedIdea[]
    categories: Record<string, PillarCategory[]>
}

// ── AI: storyboard → invariant + nápady ────────────────────────────────────

function buildConversionPrompt(config: ClientConfig, defs: PostTypeDef[], pillarKeys: string[], needCategories: string[]): string {
    const catalogue = defs.map(d => `- ${d.name} (pilíř ${d.pillar}, ${d.medium})
  display_name: ${d.display_name}
  description: ${d.description}
  structure: ${d.structure || "—"}
  visual_style: ${d.visualStyle || "—"}`).join("\n\n")

    // Zdravé kategorie klienta jsou nejlepší vzor toho, jak má invariant znít —
    // jsou to jednověté mechanismy, které se nikdy neopotřebují.
    const healthyExamples = Object.values(config.contentPillars || {})
        .flatMap(p => p.categories || [])
        .filter(c => c.prompt)
        .slice(0, 4)
        .map(c => `  ✓ "${c.prompt}"`)
        .join("\n")

    return `Jsi Instagram stratég. Dostáváš formáty příspěvků jedné značky, které jsou špatně
napsané: místo ŠABLONY popisují jeden konkrétní hotový příspěvek (storyboard). Takový
formát vyrobí pořád tentýž post.

Tvůj úkol má DVĚ části:
  A) přepsat každý formát na INVARIANT — mechanismus použitelný na desítky různých témat
  B) zachránit tu konkrétnost: z každého storyboardu vytáhnout 2-3 konkrétní NÁPADY

Nic se nesmí ztratit. Scéna, rekvizita, příležitost, jméno — to všechno patří do NÁPADU.
Formátu zůstane jen mechanismus, rytmus a produkční styl.

ZNAČKA
Firma: ${config.name}${config.industry ? ` (${config.industry})` : ""}
O čem značka je: ${config.contentFocus}
Pilíře (povolené klíče): ${pillarKeys.join(", ")}
${healthyExamples ? `\nTAKHLE ZNÍ SPRÁVNĚ NAPSANÝ MECHANISMUS (vzor z kategorií téhle značky):\n${healthyExamples}` : ""}

TEST INVARIANTU — každý přepsaný formát ho musí projít:
"Vyrobím podle tohohle 30 RŮZNÝCH příspěvků, které nebudou vypadat stejně?"

ZAKÁZÁNO ve formátu: konkrétní scéna, vlastní jméno, místo, příležitost, datum, cena,
hotová replika v uvozovkách, konkrétní rekvizita.

FORMÁTY K PŘEPSÁNÍ:
${catalogue}
${needCategories.length > 0 ? `
NAVÍC: pilíře ${needCategories.join(", ")} nemají žádné kategorie (rubriky). Bez nich
nemá generátor nápadů z čeho brát úhly a zásobník zůstane prázdný. Navrhni pro každý
z nich 3 kategorie — jedna věta na kategorii, mechanismus, žádná scéna.` : ""}

Vrať POUZE JSON (bez markdownu):
{
  "formats": [{
    "name": "PŘESNĚ stejný name jako ve vstupu — NIKDY neměň",
    "display_name": "krátký název formátu, česky, bez vazby na jednu scénu",
    "emoji": "1 emoji",
    "description": "1 věta: JAK formát funguje a proč zabírá. MAX ${FORMAT_BRIEF_LIMITS.description} znaků.",
    "structure": "sled beatů, ABSTRAKTNĚ, se zástupnými sloty. MAX ${FORMAT_BRIEF_LIMITS.structure} znaků.",
    "visual_style": "1 věta: produkční kvality (kompozice, světlo, tempo, odstup). MAX ${FORMAT_BRIEF_LIMITS.visualStyle} znaků."
  }],
  "ideas": [{
    "fromFormat": "name formátu, ze kterého nápad pochází",
    "pillar": "jeden z povolených klíčů pilířů",
    "title": "krátký název námětu, česky (např. Ranní otevírání podniku)",
    "content": "2-3 věty: co konkrétně ukázat — scéna, rekvizity, příležitost. TADY konkrétnost PATŘÍ."
  }]${needCategories.length > 0 ? `,
  "categories": { "<klíč pilíře>": [{ "id": "snake_case", "label": "název česky", "emoji": "1 emoji", "prompt": "1 věta: jaký úhel tahle rubrika pokrývá" }] }` : ""}
}

Pro KAŽDÝ vstupní formát vrať právě jeden objekt ve "formats" a 2-3 nápady v "ideas".`
}

async function convert(config: ClientConfig, defs: PostTypeDef[]): Promise<Conversion | null> {
    const pillarKeys = Object.keys(config.contentPillars || {})
    if (pillarKeys.length === 0) return null

    const needCategories = pillarKeys.filter(k => (config.contentPillars[k]?.categories || []).length === 0)
    const prompt = buildConversionPrompt(config, defs, pillarKeys, needCategories)

    // Jednorázová migrace, která přepisuje celou obsahovou definici značky — kvalita
    // se tu nedegraduje. Pro tier, fallback na druhé Pro (viz models.ts), nikdy flash.
    let parsed: any = null
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
        try {
            const raw = await generateText(prompt, {
                temperature: 0.7,
                model: getModel("textPro"),
                fallbackModel: getModel("textPro", "fallback"),
            })
            const match = raw.match(/\{[\s\S]*\}/)
            if (match) parsed = JSON.parse(match[0])
            else console.warn(`   ⚠️ pokus ${attempt}/2: v odpovědi není JSON`)
        } catch (e) {
            console.warn(`   ⚠️ pokus ${attempt}/2 selhal: ${(e as Error).message}`)
        }
    }
    if (!Array.isArray(parsed?.formats)) return null

    // Přepisujeme VÝHRADNĚ brief. Vše ostatní (name, pillar, medium, aspectRatio,
    // uses_product, manualOnly) drží pipeline pohromadě a zůstává beze změny.
    const byName = new Map(defs.map(d => [d.name, d]))
    const newDefs: PostTypeDef[] = []
    for (const f of parsed.formats) {
        const original = byName.get(String(f?.name || ""))
        if (!original) continue
        newDefs.push({
            ...original,
            display_name: f.display_name ? String(f.display_name).slice(0, 60) : original.display_name,
            emoji: f.emoji || original.emoji,
            description: String(f.description || original.description).slice(0, FORMAT_BRIEF_LIMITS.description),
            structure: f.structure ? String(f.structure).slice(0, FORMAT_BRIEF_LIMITS.structure) : undefined,
            visualStyle: f.visual_style ? String(f.visual_style).slice(0, FORMAT_BRIEF_LIMITS.visualStyle) : undefined,
        })
    }
    // Formát, který AI vynechala, si ponechá původní brief — radši starý storyboard
    // než chybějící formát (weekPlan a pilíře na něj odkazují).
    for (const d of defs) if (!newDefs.some(n => n.name === d.name)) newDefs.push(d)

    const validPillars = new Set(pillarKeys)
    const ideas: SeedIdea[] = (Array.isArray(parsed.ideas) ? parsed.ideas : [])
        .filter((i: any) => i?.title && i?.content)
        .map((i: any) => ({
            title: String(i.title).slice(0, 200),
            content: String(i.content).slice(0, 1000),
            pillar: validPillars.has(i.pillar) ? i.pillar : (byName.get(i.fromFormat)?.pillar || pillarKeys[0]),
            fromFormat: String(i.fromFormat || "—"),
        }))

    const categories: Record<string, PillarCategory[]> = {}
    for (const [key, list] of Object.entries<any>(parsed.categories || {})) {
        if (!validPillars.has(key) || !Array.isArray(list)) continue
        categories[key] = list
            .filter((c: any) => c?.id && c?.label)
            .map((c: any) => ({
                id: String(c.id).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_]/g, "_"),
                label: String(c.label).slice(0, 60),
                emoji: c.emoji || "📌",
                prompt: c.prompt ? String(c.prompt).slice(0, 240) : undefined,
            }))
    }

    return { defs: newDefs, ideas, categories }
}

// ── Zápis ──────────────────────────────────────────────────────────────────

async function applyConversion(client: ClientRow, raw: ClientConfig, conv: Conversion): Promise<string[]> {
    const done: string[] = []

    const next: ClientConfig = {
        ...raw,
        postTypeDefs: conv.defs,
        // Záloha jen poprvé — opakované spuštění nesmí přepsat původní storyboardy
        // už jednou převedenou verzí.
        ...((raw as any)._postTypeDefsBackup ? {} : { _postTypeDefsBackup: raw.postTypeDefs } as any),
    }
    for (const [key, cats] of Object.entries(conv.categories)) {
        if (!next.contentPillars?.[key]) continue
        if ((next.contentPillars[key].categories || []).length > 0) continue
        next.contentPillars[key] = { ...next.contentPillars[key], categories: cats }
        done.push(`kategorie:${key}(${cats.length})`)
    }

    const reconciled = reconcileFormats(next)
    const { error } = await supabaseAdmin.from("clients").update({ config: reconciled }).eq("id", client.id)
    if (error) throw new Error(`config update selhal: ${error.message}`)
    invalidateConfigCache(client.slug)
    done.push(`formáty(${conv.defs.length})`)

    // Řádky ig_post_types nesou kopii pro picker v UI — po změně display_name/emoji
    // je nutné je srovnat, jinak uživatel v Nastavení vidí staré názvy.
    await ensurePostTypes(reconciled, client.id)
    done.push("ensurePostTypes")

    if (conv.ideas.length > 0) {
        // Dedup podle title proti existující bance — skript smí běžet opakovaně.
        const { data: existing } = await supabaseAdmin
            .from("ig_post_ideas").select("title").eq("client_id", client.id)
        const seen = new Set((existing || []).map(r => String(r.title).toLowerCase().trim()))
        const rows = conv.ideas
            .filter(i => !seen.has(i.title.toLowerCase().trim()))
            .map(i => ({
                client_id: client.id,
                category: i.pillar,
                subcategory: null,
                title: i.title,
                content: i.content,
                keywords: [],
                used_count: 0,
                is_active: true,
                cooldown_days: 30,
            }))
        if (rows.length > 0) {
            const { error: ideaErr } = await supabaseAdmin.from("ig_post_ideas").insert(rows)
            if (ideaErr) throw new Error(`insert nápadů selhal: ${ideaErr.message}`)
            done.push(`nápady(+${rows.length})`)
        }
    }

    return done
}

// ── Běh ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    let query = supabaseAdmin.from("clients").select("id, slug, config").order("slug")
    if (ONLY_SLUG) query = query.eq("slug", ONLY_SLUG)
    const { data: clients, error } = await query
    if (error) { console.error("❌ Nepodařilo se načíst klienty:", error.message); process.exit(1) }
    if (!clients?.length) { console.error(`❌ Žádný klient${ONLY_SLUG ? ` se slugem ${ONLY_SLUG}` : ""}.`); process.exit(1) }

    console.log(`\n${"═".repeat(70)}`)
    console.log(`  FORMÁT → INVARIANT   ${FIX ? "(--fix: ZAPISUJE)" : "(read-only report)"}`)
    console.log(`  klientů: ${clients.length}`)
    console.log("═".repeat(70))

    for (const client of clients as ClientRow[]) {
        const raw = (client.config || {}) as ClientConfig
        const defs = raw.postTypeDefs || []
        if (defs.length === 0) {
            console.log(`\n⏭️  ${client.slug}: žádné postTypeDefs — přeskakuji (backfill-post-types.ts)`)
            continue
        }
        if ((raw as any)._postTypeDefsBackup) {
            console.log(`\n✅ ${client.slug}: už převedeno (existuje _postTypeDefsBackup) — přeskakuji`)
            continue
        }

        console.log(`\n${"─".repeat(70)}\n### ${client.slug} — ${defs.length} formátů`)
        // loadConfig kvůli defaultům (contentFocus, pilíře) — zápis jde vždy na raw.
        let config: ClientConfig
        try { config = await loadConfig(client.slug) } catch (e) {
            console.warn(`   ⚠️ loadConfig selhal: ${(e as Error).message} — přeskakuji`); continue
        }

        const conv = await convert(config, defs)
        if (!conv) { console.warn(`   ⚠️ převod se nepovedl — přeskakuji`); continue }

        for (const next of conv.defs) {
            const prev = defs.find(d => d.name === next.name)
            if (!prev || prev.description === next.description) continue
            console.log(`\n  ${next.emoji} ${next.name}`)
            console.log(`    PŘED: ${prev.description}`)
            console.log(`     PO : ${next.description}`)
            if (next.structure) console.log(`    rytmus: ${next.structure}`)
        }
        console.log(`\n  → ${conv.ideas.length} nápadů k záchraně: ${conv.ideas.map(i => i.title).slice(0, 6).join(" · ")}`)
        const catCount = Object.values(conv.categories).flat().length
        if (catCount > 0) console.log(`  → ${catCount} nových kategorií pro pilíře bez rubrik`)

        if (FIX) {
            try {
                const done = await applyConversion(client, raw, conv)
                console.log(`  ✅ zapsáno: ${done.join(", ")}`)
            } catch (e) {
                console.error(`  ❌ ${(e as Error).message}`)
            }
        }
    }

    if (!FIX) console.log(`\n${"═".repeat(70)}\nRead-only. Zápis: přidej --fix (doporučeně nejdřív s --slug=<jeden klient>).\n`)
    else console.log(`\n${"═".repeat(70)}\nHotovo.\n`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
