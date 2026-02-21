import { generateText } from "./gemini-client"
import { type ClientConfig } from "./configs/types"
import { resolveClientId } from "./configs"
import supabaseAdmin from "../supabase/admin"

export async function generateAIIdeas(config: ClientConfig, pillarId: string, count: number = 10) {
    // 1. Validate pillar
    const pillar = config.contentPillars?.[pillarId]
    if (!pillar) throw new Error(`Pillar ${pillarId} not found in config.`)

    // 2. Build prompt
    const prompt = `
Jsi hlavní kreativec a stratég pro značku "${config.name}".
Tvým úkolem je vymyslet nové, dosud nepoužité nápady na příspěvky (Ideas) pro obsahový pilíř "${pillar.label}" (${pillar.emoji}).

ZDE JE BRAND VOICE NAŠÍ ZNAČKY:
${config.brandVoice?.persona || ""}
Hodnoty: ${config.brandVoice?.values?.join(", ") || ""}

SPECIFIKACE PILÍŘE (CO MÁ BÝT OBSAHEM):
${pillar.ideaPrompt || pillar.description || ""}

POŽADAVKY:
- Vygeneruj přesně ${count} odlišných, atraktivních nápadů.
- Každý nápad by měl mít chytlavý 'title', detailní 'content' (o čem to přesně bude) a pole 'keywords'.
- Vrať striktně čisté JSON pole s objekty typu: {"title": string, "content": string, "keywords": string[]}.
- Žádný markdown text attorno (bez \`\`\`json).
`
    // 3. Call Gemini
    console.log(`💡 Generuji AI Nápady (${count}x) pro kategorii: ${pillarId}...`)
    const resultJson = await generateText(prompt)

    let ideasPayload: any[] = []
    try {
        ideasPayload = JSON.parse(resultJson)
    } catch {
        const cleaned = resultJson.replace(/```json/gi, "").replace(/```/g, "").trim()
        try {
            ideasPayload = JSON.parse(cleaned)
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
