import { generateText } from "./gemini-client"
import { type ClientConfig } from "./configs/types"
import { resolveClientId } from "./configs"
import supabaseAdmin from "../supabase/admin"

export async function generateAIReviews(config: ClientConfig, count: number = 5) {
    // 1. Build prompt
    const productsSection = config.products?.length
        ? `\n## PRODUKTY/SLUŽBY (recenze MUSÍ zmiňovat KONKRÉTNÍ produkty)\n${config.products.slice(0, 8).map(p => `- ${p.name} (${p.type})${p.price ? ` — ${p.price}` : ""}`).join("\n")}\n`
        : ""

    const personaSection = config.audiencePersonas?.length
        ? `\n## TYPY ZÁKAZNÍKŮ (každá recenze by měla být od jiného segmentu)\n${config.audiencePersonas.map(p => `- ${p.label} (${p.ageRange} let) — ${p.ctaStyle === "hard" ? "kupuje hned" : p.ctaStyle === "medium" ? "porovnává" : "jen se dívá"}`).join("\n")}\n`
        : ""

    const prompt = `
Jsi copywriter pro značku "${config.name}" (${config.website || ""}).
Tvým úkolem je vymyslet vysoce uvěřitelné a autenticky znějící zákaznické recenze, které přesně odrážejí styl, slang a komunitu této značky.

## BRAND VOICE
${config.brandVoice?.persona || ""}
Hodnoty: ${config.brandVoice?.values?.join(", ") || ""}
Tón: ${config.brandVoice?.voiceTraits?.slice(0, 3).join(", ") || ""}
${productsSection}${personaSection}
## TYPICKÁ CÍLOVÁ SKUPINA A PRODUKTY:
- Zaměř se na recenze ohledně KONKRÉTNÍCH produktů/služeb z katalogu výše
- Tón a slang recenzí MUSÍ odpovídat brand voice — pokud je značka neformální, recenze budou hovorové
- Recenze musí znít jako od REÁLNÝCH zákazníků — s drobnými nedokonalostmi, zkratkami, emocemi
- Každá recenze by měla být od JINÉHO typu zákazníka (věk, styl, motivace)

## POŽADAVKY:
- Vygeneruj přesně ${count} odlišných, autentických recenzí
- Každá recenze musí obsahovat:
  - 'customer_name' (Jméno nebo přezdívka, např. "Tomáš D.", "Kiki99")
  - 'customer_initials' (iniciály, např. "TD")
  - 'quote' (samotný text recenze — zmíň KONKRÉTNÍ produkt/službu)
  - 'rating' (číslo 4 nebo 5)
  - 'source' (kde recenzi napsali - "instagram", "web", "email", nebo "dm")
`

    const reviewsSchema = {
        type: "object",
        properties: {
            reviews: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        customer_name: { type: "string" },
                        customer_initials: { type: "string" },
                        quote: { type: "string" },
                        rating: { type: "number" },
                        source: { type: "string" },
                    },
                    required: ["customer_name", "customer_initials", "quote", "rating", "source"],
                },
            },
        },
        required: ["reviews"],
    }

    // 2. Call Gemini
    console.log(`⭐ Generuji AI Recenze (${count}x) pro klienta ${config.id}...`)
    const resultJson = await generateText(prompt, { responseSchema: reviewsSchema })

    let reviewsPayload: any[]
    try {
        const parsed = JSON.parse(resultJson)
        reviewsPayload = parsed.reviews || parsed
    } catch {
        const cleaned = resultJson.replace(/```json/gi, "").replace(/```/g, "").trim()
        try {
            const parsed = JSON.parse(cleaned)
            reviewsPayload = parsed.reviews || parsed
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
