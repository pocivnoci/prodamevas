import { generateText } from "./gemini-client"
import { type ClientConfig } from "./configs/types"
import { resolveClientId } from "./configs"
import supabaseAdmin from "../supabase/admin"

export async function generateAIIdeas(config: ClientConfig, pillarId: string, count: number = 10) {
    // 1. Validate pillar
    const pillar = config.contentPillars?.[pillarId]
    if (!pillar) throw new Error(`Pillar ${pillarId} not found in config.`)

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
${productsSection}${personaSection}${memorySection}
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
                    },
                    required: ["title", "content", "keywords"],
                },
            },
        },
        required: ["ideas"],
    }

    // 3. Call Gemini
    console.log(`💡 Generuji AI Nápady (${count}x) pro kategorii: ${pillarId}...`)
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

    const { getActiveProject, setActiveProject } = await import("./service")

    // 4. Client resolution
    const clientId = await resolveClientId(config.id)

    // 5. Map to DB rows
    const rows = ideasPayload.slice(0, count).map(idea => ({
        client_id: clientId,
        category: pillarId,
        subcategory: "AI Generated",
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
