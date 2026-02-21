import { generateText } from "./gemini-client"
import { type ClientConfig } from "./configs/types"
import { resolveClientId } from "./configs"
import supabaseAdmin from "../supabase/admin"

export async function generateAIReviews(config: ClientConfig, count: number = 5) {
    // 1. Build prompt
    const prompt = `
Jsi copywriter pro značku "${config.name}".
Tvým úkolem je vymyslet vysoce uvěřitelné a autenticky znějící zákaznické recenze, které přesně odrážejí styl, slang a komunitu této značky.

ZDE JE BRAND VOICE NAŠÍ ZNAČKY:
${config.brandVoice?.persona || ""}
Hodnoty: ${config.brandVoice?.values?.join(", ") || ""}

TYPICKÁ CÍLOVÁ SKUPINA A PRODUKTY:
- Zaměř se na recenze ohledně typických produktů, které tato značka prodává.
- Pokud je to např. drsný HanzFans streetwear, recenze musí znít jako od skutečných "bros" nebo fanoušků aut (např. "Drip jak prase", "Materiál top").
- Pokud je to korporátní značka, recenze bude formálnější.

POŽADAVKY:
- Vygeneruj přesně ${count} odlišných, autentických recenzí.
- Každá recenze musí obsahovat:
  - 'customer_name' (Jméno nebo přezdívka, např. "Tomáš D.", "Kiki99")
  - 'customer_initials' (iniciály, např. "TD")
  - 'quote' (samotný text recenze)
  - 'rating' (číslo 4 nebo 5)
  - 'source' (kde recenzi napsali - "instagram", "web", "email", nebo "dm")
- Vrať striktně čisté JSON pole s těmito objekty. Žádný text okolo, žádné markdown \`\`\`json.
`
    // 2. Call Gemini
    console.log(`⭐ Generuji AI Recenze (${count}x) pro klienta ${config.id}...`)
    const resultJson = await generateText(prompt)

    let reviewsPayload: any[] = []
    try {
        reviewsPayload = JSON.parse(resultJson)
    } catch {
        const cleaned = resultJson.replace(/```json/gi, "").replace(/```/g, "").trim()
        try {
            reviewsPayload = JSON.parse(cleaned)
        } catch (err: any) {
            throw new Error(`Failed to parse AI output as JSON: ${err.message}`)
        }
    }

    if (!Array.isArray(reviewsPayload) || reviewsPayload.length === 0) {
        throw new Error("AI vrátila neplatná data (prázdné pole).")
    }

    // 3. Client resolution
    const clientId = await resolveClientId(config.id)

    // 4. Map to DB rows (is_approved je false by default)
    const rows = reviewsPayload.slice(0, count).map(review => ({
        client_id: clientId,
        customer_name: review.customer_name || "Anonym",
        customer_initials: review.customer_initials || "AN",
        quote: review.quote,
        rating: review.rating || 5,
        source: review.source || "instagram",
        is_approved: false // User must review these first!
    }))

    // 5. DB Insert
    console.log(`📥 Ukládám ${rows.length} AI recenzí do DB (čekají na schválení)...`)
    const { data, error } = await supabaseAdmin.from("ig_reviews").insert(rows).select("*")
    if (error) {
        throw new Error(`DB Error inserting reviews: ${error.message}`)
    }

    console.log("✅ Recenze uloženy.")
    return data
}
