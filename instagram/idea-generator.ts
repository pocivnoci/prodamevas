import { generateText } from "./gemini-client"
import { type ClientConfig } from "./configs/types"
import { resolveClientId } from "./configs"
import { DEFAULT_IDEA_COOLDOWN_DAYS } from "./service"
import supabaseAdmin from "../supabase/admin"
import { buildFactsSection } from "./caption-generator"

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
            ? `\n## DOSTUPNÉ KATEGORIE V TOMTO PILÍŘI:\n${pillar.categories!.map(c => `- ${c.id}: ${c.emoji} ${c.label}${c.prompt ? ` — ${c.prompt}` : ""}`).join("\n")}\nRozděl nápady rovnoměrně mezi tyto kategorie a ke každému nápadu přiřaď 'categoryId' z: ${pillarCategoryIds.join(", ")}.\n`
            : ""

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
Typy postů: ${pillar.postTypes?.join(", ") || ""}
${categorySection}${productsSection}${personaSection}${memorySection}${contextSection}${existingSection}
## POŽADAVKY:
- Vygeneruj přesně ${count} odlišných, atraktivních nápadů
- Každý nápad musí mít chytlavý 'title', detailní 'content' (o čem to přesně bude) a pole 'keywords'
- Nápady musí být specifické pro "${config.name}" — ne generické "tipy pro podnikání"
- Střídej formáty: edukativní, zábavné, prodejní, behind-the-scenes
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

    // 4. Map to DB rows — subcategory is always a real category id or null
    const validCatIds = new Set(pillarCategoryIds)
    const rows = ideasPayload.slice(0, count).map(idea => ({
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

    // 5. DB Insert
    console.log(`📥 Ukládám ${rows.length} nových nápadů do DB...`)
    const { data, error } = await supabaseAdmin.from("ig_post_ideas").insert(rows).select("*")
    if (error) {
        throw new Error(`DB Error inserting ideas: ${error.message}`)
    }

    console.log("✅ Nápady uloženy.")
    return data
}
