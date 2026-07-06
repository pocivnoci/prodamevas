import { generateText } from "./gemini-client"
import { type ClientConfig } from "./configs/types"
import { resolveClientId } from "./configs"
import supabaseAdmin from "../supabase/admin"

export async function generateAIIdeas(config: ClientConfig, pillarId: string, count: number = 10, categoryId?: string) {
    // 1. Validate pillar
    const pillar = config.contentPillars?.[pillarId]
    if (!pillar) throw new Error(`Pillar ${pillarId} not found in config.`)

    // Resolve category if specified
    const category = categoryId ? pillar.categories?.find(c => c.id === categoryId) : undefined

    // 2. Build prompt
    const productsSection = config.products?.length
        ? `\n## PRODUKTY ZNAČKY\n${config.products.slice(0, 8).map(p => `- ${p.name} (${p.type})${p.price ? ` — ${p.price}` : ""}`).join("\n")}\nNápady mohou být propojené s konkrétními produkty.\n`
        : ""

    const personaSection = config.audiencePersonas?.length
        ? `\n## CÍLOVÁ SKUPINA\n${config.audiencePersonas.map(p => `- ${p.label} (${p.ageRange} let): ${p.painPoints.slice(0, 2).join(", ")}`).join("\n")}\n`
        : ""

    // Inject brand memories so new ideas build on what historically worked
    let memorySection = ""
    try {
        const { getBrandMemories, formatMemoriesForPrompt } = await import("./memory-agent")
        const memories = await getBrandMemories(5)
        if (memories.length > 0) {
            memorySection = formatMemoriesForPrompt(memories)
            console.log(`   🧠 Brand memory: ${memories.length} vzorců injected into idea generation`)
        }
    } catch {
        // Non-fatal — continue without memories
    }

    // Inject seasonal/industry context so ideas are grounded in current reality
    let contextSection = ""
    try {
        const { gatherContext, formatContextForPrompt } = await import("./context-agent")
        const context = await gatherContext(config, "plan")
        contextSection = formatContextForPrompt(context)
        console.log(`   🌍 Context: ${context.season} | ${context.pulse.length} signálů pro nápady`)
    } catch {
        // Non-fatal
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

## SPECIFIKACE PILÍŘE
${pillar.ideaPrompt || pillar.description || ""}
Typy postů: ${pillar.postTypes?.join(", ") || ""}
${categorySection}${productsSection}${personaSection}${memorySection}${contextSection}
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

    // 4. Client resolution
    const clientId = await resolveClientId(config.id)

    // 5. Map to DB rows — subcategory is always a real category id or null
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
        cooldown_days: 30
    }))

    // 6. DB Insert
    console.log(`📥 Ukládám ${rows.length} nových nápadů do DB...`)
    const { data, error } = await supabaseAdmin.from("ig_post_ideas").insert(rows).select("*")
    if (error) {
        throw new Error(`DB Error inserting ideas: ${error.message}`)
    }

    console.log("✅ Nápady uloženy.")
    return data
}
