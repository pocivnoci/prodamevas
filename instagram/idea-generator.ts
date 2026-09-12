import { generateText } from "./gemini-client"
import { type ClientConfig } from "./configs/types"
import { resolveClientId } from "./configs"
import { DEFAULT_IDEA_COOLDOWN_DAYS } from "./service"
import supabaseAdmin from "../supabase/admin"
import { buildFactsSection } from "./caption-generator"
import { prescribesFormat, formatWordsList, findMiscategorized, categoryLine } from "./idea-rules"
import { contentLanguage } from "./language"

/**
 * Generování nápadů — měřená obálka.
 *
 * Měří se UVNITŘ, ne u volajících: nápady se pouštějí z CLI, z UI i z nočního
 * doplňování a každé z těch míst by na účtování mohlo zapomenout. Právě tahle cesta
 * byla 18. 8. 2026 největší položkou týdne (400 nápadů jedním hromadným během,
 * ~250 Kč) a v účetnictví o ní nebylo ani slovo.
 */
export async function generateAIIdeas(config: ClientConfig, pillarId: string, count: number = 10, categoryId?: string) {
    const clientId = await resolveClientId(config.id)
    const { trackSpend } = await import("./spend-tracker")
    return trackSpend(
        "ideas",
        { clientId, refId: categoryId ? `${pillarId}:${categoryId}` : pillarId },
        () => generateAIIdeasInner(config, pillarId, count, categoryId, clientId),
    )
}

/**
 * Nápad je TÉMA, ne FORMÁT — společná instrukce pro generátor i přepisovač.
 * Formát (obrázek / karusel / reel) vybírá plán podle slotu; nápad, který ho
 * předepisuje, skončí v obrázkovém slotu se slibem videa. Viz idea-rules.ts.
 */
const TOPIC_NOT_FORMAT_RULE = `## NÁPAD JE TÉMA, NE FORMÁT
Formát (obrázek, karusel, reel, story) vybírá až plán podle každého slotu — nápad ho NESMÍ předepisovat.
- NEPIŠ „video", „reel", „natočíme", „záběry z natáčení", „karusel", „slide", „story". Popiš, CO se ukáže a řekne a PROČ to zastaví palec.
- Špatně: „Zábavné reels video, jak trenér ukazuje chyby u dřepu." · Správně: „Trenér ukazuje tři nejčastější chyby u dřepu — každou s tím, co za ni tělo zaplatí."
- Stejný nápad musí fungovat jako jeden obrázek, jako karusel i jako reel.
- Výjimka: když je video/reel/karusel TÉMATEM nápadu (značka o něm mluví, prodává ho nebo ho učí — „Jak zničit nudu v Reels"), slovo zůstává. Nápad je pak O videu, ne natočený JAKO video.`

async function generateAIIdeasInner(config: ClientConfig, pillarId: string, count: number, categoryId: string | undefined, clientId: string) {
    // 1. Validate pillar
    const pillar = config.contentPillars?.[pillarId]
    if (!pillar) throw new Error(`Pillar ${pillarId} not found in config.`)

    // Resolve category if specified
    const category = categoryId ? pillar.categories?.find(c => c.id === categoryId) : undefined

    // 2. Build prompt — products from the LIVE catalog (ig_products), not the frozen
    // config.products onboarding snapshot: ideas naming deleted products would flow
    // into the bank → plan → posts.
    const { getCatalogProducts } = await import("./service")
    const catalogProducts = await getCatalogProducts(clientId, config.products)
        .catch(() => config.products || [])
    const productsSection = catalogProducts.length
        ? `\n## PRODUKTY ZNAČKY\n${catalogProducts.slice(0, 8).map(p => `- ${p.name} (${p.type})${p.price ? ` — ${p.price}` : ""}`).join("\n")}\nNápady mohou být propojené s konkrétními produkty.\n`
        : ""

    const personaSection = config.audiencePersonas?.length
        ? `\n## CÍLOVÁ SKUPINA\n${config.audiencePersonas.map(p => `- ${p.label} (${p.ageRange} let): ${p.painPoints.slice(0, 2).join(", ")}`).join("\n")}\n`
        : ""

    // Inject brand memories so new ideas build on what historically worked.
    // clientId je EXPLICITNÍ: bez něj padal getBrandMemories na getActiveProject(),
    // který mimo withActiveProject scope vyhodí výjimku — a `catch {}` níž ji spolkl.
    // Onboarding (seedIdeaBank) volání obaloval, hlavní cesta z UI a denní
    // idea_replenish ne, takže se paměť do nápadů reálně nikdy nedostala.
    let memorySection = ""
    try {
        const { getBrandMemories, formatMemoriesForPrompt } = await import("./memory-agent")
        const memories = await getBrandMemories(5, clientId, undefined, undefined, ["pattern", "preference", "avoid"])
        if (memories.length > 0) {
            memorySection = formatMemoriesForPrompt(memories)
            console.log(`   🧠 Brand memory: ${memories.length} vzorců injected into idea generation`)
        }
    } catch (err: any) {
        // Non-fatal — ale nikdy potichu: tohle selhání bylo roky neviditelné.
        console.warn(`   ⚠️ Brand memory pro nápady přeskočena: ${String(err?.message || err).substring(0, 100)}`)
    }

    // Existing bank titles as negative context — the prompt alone says "dosud
    // nepoužité", but the model can't know what's already in the bank. Without
    // this, repeated generation (especially the daily idea-replenish agent)
    // converges on near-duplicates of the existing pool.
    let existingSection = ""
    {
        const { data: existingRows } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("title")
            .eq("client_id", clientId)
            .eq("is_active", true)
            .eq("category", pillarId)
            .order("created_at", { ascending: false })
            .limit(40)
        if (existingRows?.length) {
            existingSection = `\n## UŽ V ZÁSOBNÍKU (vymysli něco JINÉHO — žádná podobná témata)\n${existingRows.map(r => `- ${r.title}`).join("\n")}\n`
        }
    }

    // Inject seasonal/industry context so ideas are grounded in current reality
    let contextSection = ""
    try {
        const { gatherContext, formatContextForPrompt } = await import("./context-agent")
        const context = await gatherContext(config, "plan")
        // Nápady vznikají v dávce, ne v kampani — celý pulse je tu na místě (offset 0).
        contextSection = formatContextForPrompt(context)
        console.log(`   🌍 Context: ${context.season} | ${context.pulse.length} signálů pro nápady`)
    } catch (err: any) {
        // Non-fatal — ale nahlas, ať se nedělí o osud brand memory výše.
        console.warn(`   ⚠️ Sezónní kontext pro nápady přeskočen: ${String(err?.message || err).substring(0, 100)}`)
    }

    // Pillar-level generation asks the model to assign each idea a real category id,
    // so ideas always match a filter chip in the UI (never a literal "AI Generated").
    const pillarCategoryIds = !category && pillar.categories?.length
        ? pillar.categories.map(c => c.id)
        : []

    const categorySection = category
        ? `\n## 🎯 KATEGORIE: ${category.emoji} ${category.label}\n${category.prompt || ""}\nVšechny nápady MUSÍ spadat do této kategorie.\n`
        : pillarCategoryIds.length
            ? `\n## DOSTUPNÉ KATEGORIE V TOMTO PILÍŘI:\n${pillar.categories!.map(categoryLine).join("\n")}\nRozděl nápady mezi tyto kategorie podle vah (bez vah rovnoměrně) a ke každému nápadu přiřaď 'categoryId' z: ${pillarCategoryIds.join(", ")}.\n`
            : ""

    // Názvy typů postů (reel_…, carousel_…) do promptu schválně NEJDOU: model z nich
    // četl formát a psal „zábavné reels video" — nápad je téma, formát přidá plán.
    const prompt = `
Jsi hlavní kreativec a stratég pro značku "${config.name}".
Tvým úkolem je vymyslet nové, dosud nepoužité nápady na příspěvky (Ideas) pro obsahový pilíř "${pillar.label}" (${pillar.emoji}).

## BRAND VOICE
${config.brandVoice?.persona || ""}
Hodnoty: ${config.brandVoice?.values?.join(", ") || ""}
Tón: ${config.brandVoice?.voiceTraits?.slice(0, 4).join(", ") || ""}

## ZAKÁZÁNO
${config.brandVoice?.antiPatterns?.slice(0, 5).join("\n") || ""}
${buildFactsSection(config)}

## SPECIFIKACE PILÍŘE
${pillar.ideaPrompt || pillar.description || ""}
${categorySection}${productsSection}${personaSection}${memorySection}${contextSection}${existingSection}
${TOPIC_NOT_FORMAT_RULE}

## POŽADAVKY:
- Vygeneruj přesně ${count} odlišných, atraktivních nápadů
- Každý nápad musí mít chytlavý 'title', detailní 'content' (o čem to přesně bude) a pole 'keywords'
- Nápady musí být specifické pro "${config.name}" — ne generické "tipy pro podnikání"
- Střídej úhly: edukativní, zábavný, prodejní, ze zákulisí
`

    const ideasSchema = {
        type: "object",
        properties: {
            ideas: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        title: { type: "string" },
                        content: { type: "string" },
                        keywords: { type: "array", items: { type: "string" } },
                        ...(pillarCategoryIds.length
                            ? { categoryId: { type: "string", enum: pillarCategoryIds } }
                            : {}),
                    },
                    required: ["title", "content", "keywords"],
                },
            },
        },
        required: ["ideas"],
    }

    // 3. Call Gemini
    const catLabel = category ? ` → ${category.label}` : ""
    console.log(`💡 Generuji AI Nápady (${count}x) pro: ${pillarId}${catLabel}...`)
    const resultJson = await generateText(prompt, { responseSchema: ideasSchema })

    let ideasPayload: any[]
    try {
        const parsed = JSON.parse(resultJson)
        ideasPayload = parsed.ideas || parsed
    } catch {
        const cleaned = resultJson.replace(/```json/gi, "").replace(/```/g, "").trim()
        try {
            const parsed = JSON.parse(cleaned)
            ideasPayload = parsed.ideas || parsed
        } catch (err: any) {
            throw new Error(`Failed to parse AI output as JSON: ${err.message}`)
        }
    }

    if (!Array.isArray(ideasPayload) || ideasPayload.length === 0) {
        throw new Error("AI vrátila neplatná data (prázdné pole).")
    }

    // 3b. Nápad nesmí předepisovat formát. Instrukce v promptu nestačí (model
    // „video" propašuje i přes zákaz), takže se to kontroluje v kódu: co formát
    // předepisuje, jde na jeden přepis; co ho předepisuje i po přepisu, se ZAHODÍ —
    // nahlas. Míň nápadů je lepší než nápad, který v obrázkovém slotu slibuje video.
    const accepted = ideasPayload.slice(0, count)
    const flaggedIdx = accepted
        .map((idea, i) => (prescribesFormat(`${idea.title} ${idea.content}`) ? i : -1))
        .filter(i => i >= 0)
    if (flaggedIdx.length > 0) {
        const words = [...new Set(flaggedIdx.flatMap(i => formatWordsList(`${accepted[i].title} ${accepted[i].content}`)))]
        console.warn(`   ⚠️ ${flaggedIdx.length}/${accepted.length} nápadů předepisuje formát (${words.join(", ")}) — přepisuji na téma`)
        const rewritten = await neutralizeIdeaFormats(config, flaggedIdx.map(i => accepted[i]))
        flaggedIdx.forEach((i, k) => { accepted[i] = { ...accepted[i], ...rewritten[k] } })
        // Co formátové slovo nese i po přepisu, model nechal schválně: je to TÉMA
        // (značka, která o videích mluví nebo je prodává). Regex téma od formátu
        // nerozezná, model ano — proto se tady nemaže, jen se to řekne nahlas.
        const kept = accepted.filter(idea => prescribesFormat(`${idea.title} ${idea.content}`))
        if (kept.length > 0) {
            console.warn(`   ℹ️ ${kept.length} nápadů nese formátové slovo i po přepisu — nechávám jako téma: ${kept.map(i => `"${String(i.title).slice(0, 50)}"`).join(", ")}`)
        }
    }

    // 4. Map to DB rows — subcategory is always a real category id or null
    const validCatIds = new Set(pillarCategoryIds)
    const rows = accepted.map(idea => ({
        client_id: clientId,
        category: pillarId,
        subcategory: categoryId || (validCatIds.has(idea.categoryId) ? idea.categoryId : null),
        title: idea.title,
        content: idea.content,
        keywords: idea.keywords || [],
        used_count: 0,
        is_active: true,
        cooldown_days: DEFAULT_IDEA_COOLDOWN_DAYS
    }))
    const uncategorized = rows.filter(r => !r.subcategory).length
    if (pillarCategoryIds.length > 0 && uncategorized > 0) {
        console.warn(`   ⚠️ ${uncategorized}/${rows.length} nápadů bez platné kategorie pilíře ${pillarId} — zařadí je classifyUncategorizedIdeas`)
    }

    // 5. DB Insert
    console.log(`📥 Ukládám ${rows.length} nových nápadů do DB...`)
    const { data, error } = await supabaseAdmin.from("ig_post_ideas").insert(rows).select("*")
    if (error) {
        throw new Error(`DB Error inserting ideas: ${error.message}`)
    }

    console.log("✅ Nápady uloženy.")
    return data
}

// ============================================
// PŘEPIS NÁPADŮ, KTERÉ PŘEDEPISUJÍ FORMÁT
// ============================================

export interface IdeaText {
    title: string
    content: string
}

/**
 * Přepíše nápady, které předepisují formát, na čisté téma. Vrací pole STEJNÉ délky
 * a pořadí; nápad, který model vynechal, se vrací beze změny (volající ho pak
 * kontrolou `prescribesFormat` chytí znovu). Jediné volání pro celou dávku.
 * Používá generátor (nové nápady) i úklid zásobníku (scripts/fix-idea-bank.ts).
 */
export async function neutralizeIdeaFormats(config: ClientConfig, ideas: IdeaText[]): Promise<IdeaText[]> {
    if (ideas.length === 0) return []
    const prompt = `Jsi editor obsahu značky "${config.name}". Dostaneš nápady na instagramové příspěvky, které místo tématu předepisují FORMÁT (video, reel, natáčení, karusel, slidy, story).

${TOPIC_NOT_FORMAT_RULE}

## ÚKOL
Ke každému nápadu vrať nový 'title' a 'content':
- zachovej téma, úhel, humor, konkrétní produkty, čísla a jména,
- odstraň formátová slova, která říkají JAK se nápad natočí či poskládá (video, reel, natočíme, záběry, klip, karusel, slide, story…) — nenahrazuj je „příspěvek", prostě popiš, co se ukáže a řekne,
- když je video/reel/karusel TÉMATEM nápadu (značka o něm mluví, prodává ho nebo ho učí), slovo NECH a vrať nápad beze změny,
- ${contentLanguage(config).adverbCs}, 'title' max 70 znaků bez uvozovek, 'content' 1–3 věty.

## NÁPADY
${ideas.map((idea, i) => `${i + 1}. ${idea.title}\n   ${idea.content}`).join("\n")}

Vrať POUZE validní JSON: { "ideas": [{ "index": 1, "title": "...", "content": "..." }, ...] } — přesně ${ideas.length} položek.`

    const schema = {
        type: "object",
        properties: {
            ideas: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        index: { type: "integer" },
                        title: { type: "string" },
                        content: { type: "string" },
                    },
                    required: ["index", "title", "content"],
                },
            },
        },
        required: ["ideas"],
    }

    const raw = await generateText(prompt, { responseSchema: schema, temperature: 0.4 })
    let items: { index?: number; title?: string; content?: string }[] = []
    try {
        const parsed = JSON.parse(raw)
        items = Array.isArray(parsed?.ideas) ? parsed.ideas : Array.isArray(parsed) ? parsed : []
    } catch (err: any) {
        console.warn(`   ⚠️ Přepis formátů: neplatný JSON (${String(err?.message).slice(0, 80)}) — nápady zůstávají beze změny`)
        return ideas.map(i => ({ title: i.title, content: i.content }))
    }

    const out = ideas.map(i => ({ title: i.title, content: i.content }))
    for (const item of items) {
        const ix = Number(item.index)
        if (!Number.isInteger(ix) || ix < 1 || ix > ideas.length) continue
        const title = String(item.title || "").trim()
        const content = String(item.content || "").trim()
        if (!title || !content) continue
        out[ix - 1] = { title, content }
    }
    return out
}

// ============================================
// ZAŘAZENÍ NÁPADŮ BEZ (PLATNÉ) KATEGORIE
// ============================================

export interface ClassifyResult {
    /** Kolik nápadů kategorii postrádalo nebo mělo neplatnou. */
    checked: number
    /** Kolik z nich dostalo platnou kategorii. */
    assigned: number
}

/** Kolik nápadů jde modelu naráz — víc = dlouhé přemýšlení a `fetch failed`. */
const CLASSIFY_BATCH = 40
/** Strop na jeden běh — úklid je údržba, ne hromadný přepis banky. */
const CLASSIFY_MAX = 120

/**
 * Zařadí nápady, které kategorii nemají nebo mají kategorii, kterou konfigurace už
 * nezná (pilíře se přegenerovaly a id se změnila). Volá se z denního doplňování
 * zásobníku, po uložení konfigurace se změněnými kategoriemi a z úklidového skriptu.
 *
 * clientId je EXPLICITNÍ — běží i mimo withActiveProject (cron, skript). Neplatné
 * přiřazení (kategorie cizího pilíře, vymyšlené id) se zahazuje v kódu; nápad pak
 * zůstane bez kategorie a příští běh to zkusí znovu.
 */
export async function classifyUncategorizedIdeas(config: ClientConfig, clientId: string): Promise<ClassifyResult> {
    const { trackSpend } = await import("./spend-tracker")
    return trackSpend(
        "ideas",
        { clientId, refId: "classify" },
        () => classifyUncategorizedIdeasInner(config, clientId),
    )
}

async function classifyUncategorizedIdeasInner(config: ClientConfig, clientId: string): Promise<ClassifyResult> {
    const { data: rows, error } = await supabaseAdmin
        .from("ig_post_ideas")
        .select("id, category, subcategory, title, content")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(400)
    if (error) throw new Error(`classify: čtení zásobníku selhalo: ${error.message}`)

    const pillars = config.contentPillars || {}
    const todo = findMiscategorized(rows || [], pillars).slice(0, CLASSIFY_MAX)
    if (todo.length === 0) return { checked: 0, assigned: 0 }

    console.log(`🗂️ Zařazuji ${todo.length} nápadů bez platné kategorie (${config.id})…`)
    let assigned = 0

    for (let start = 0; start < todo.length; start += CLASSIFY_BATCH) {
        const batch = todo.slice(start, start + CLASSIFY_BATCH)
        const pillarKeys = [...new Set(batch.map(i => i.category))]
        const catalog = pillarKeys.map(key => {
            const p = pillars[key]
            return `### ${p?.emoji || "📌"} ${p?.label || key} (pilíř "${key}")\n${(p?.categories || []).map(categoryLine).join("\n")}`
        }).join("\n\n")

        const prompt = `Jsi editor obsahu značky "${config.name}". Zařaď každý nápad do JEDNÉ kategorie jeho pilíře.

## KATEGORIE PODLE PILÍŘŮ
${catalog}

## NÁPADY (u každého je uvedený pilíř — vybírej JEN z jeho kategorií)
${batch.map((idea, i) => `${i + 1}. [pilíř "${idea.category}"] ${idea.title}\n   ${String(idea.content || "").slice(0, 220)}`).join("\n")}

Vrať POUZE validní JSON: { "assignments": [{ "index": 1, "categoryId": "..." }, ...] } — přesně ${batch.length} položek, categoryId je id z katalogu.`

        const schema = {
            type: "object",
            properties: {
                assignments: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            index: { type: "integer" },
                            categoryId: { type: "string" },
                        },
                        required: ["index", "categoryId"],
                    },
                },
            },
            required: ["assignments"],
        }

        let assignments: { index?: number; categoryId?: string }[] = []
        try {
            const raw = await generateText(prompt, { responseSchema: schema, temperature: 0.2 })
            const parsed = JSON.parse(raw)
            assignments = Array.isArray(parsed?.assignments) ? parsed.assignments : []
        } catch (err: any) {
            console.warn(`   ⚠️ Zařazení nápadů: model nevrátil použitelný JSON (${String(err?.message).slice(0, 80)})`)
            continue
        }

        for (const a of assignments) {
            const ix = Number(a.index)
            if (!Number.isInteger(ix) || ix < 1 || ix > batch.length) continue
            const idea = batch[ix - 1]
            const valid = (pillars[idea.category]?.categories || []).some(c => c.id === a.categoryId)
            if (!valid) {
                console.warn(`   ↩️ "${String(idea.title).slice(0, 50)}": kategorie "${a.categoryId}" nepatří pilíři ${idea.category} — zůstává nezařazený`)
                continue
            }
            const { error: upErr } = await supabaseAdmin
                .from("ig_post_ideas")
                .update({ subcategory: a.categoryId })
                .eq("id", idea.id)
                .eq("client_id", clientId)
            if (upErr) {
                console.warn(`   ⚠️ Zápis kategorie u ${idea.id} selhal: ${upErr.message}`)
                continue
            }
            assigned++
        }
    }

    console.log(`   ✅ Zařazeno ${assigned}/${todo.length} nápadů`)
    return { checked: todo.length, assigned }
}
