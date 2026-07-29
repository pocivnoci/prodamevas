/**
 * Product & Design Generator
 * ==========================
 * AI-powered product brainstorming + design concept visualization + mockups.
 * Works with any ClientConfig that has products defined.
 *
 * Three pipelines:
 * 1. Product Ideas     — brainstorm inventive physical merch (not just shirts)
 * 2. Design Generator  — print-ready isolated graphic on black background
 * 3. Product Mockup    — place design ON the product (photorealistic)
 */

import type { ClientConfig } from "./configs/types"
import { generateText, generateImage, generateImageWithReferences } from "./gemini-client"
import { Type } from "@google/genai"
import supabaseAdmin from "../supabase/admin"
import { getProductCategories, getProductCategoryBySlug, getCatalogProducts, type ProductCategory } from "./service"

// ============================================
// INTERFACES
// ============================================

export interface ProductIdea {
    id?: string
    client_id?: string
    name: string
    brandingNames: string[]
    type: string
    tagline: string
    description: string
    material: string
    dimensions: string
    manufacturingMethod: string
    priceRange: string
    viralAngle: string
    whyItWorks: string
    productionNotes: string
    designPrompt: string
    variants: string[]
    supplierMessage: string
    status?: "review" | "saved" | "rejected"
    created_at?: string
}

export interface DesignConcept {
    name: string
    description: string
    designPrompt: string
    placement: string
    colors: string[]
    style: string
    suggestedTexts: string[]
}

// ============================================
// SCHEMAS
// ============================================

const PRODUCT_IDEAS_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        ideas: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "Hlavní doporučený název produktu — kreativní, brandový, se slovní hříčkou" },
                    brandingNames: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3-5 alternativních názvů/brandingů produktu — různé styly: wordplay, dvojsmysl, anglicko-český mix, drzý, elegantní" },
                    type: { type: Type.STRING, description: "Typ: gadget, accessory, tool, clothing, home, EDC, novelty, drinkware, atd." },
                    tagline: { type: Type.STRING, description: "Krátký tagline max 8 slov" },
                    description: { type: Type.STRING, description: "Popis produktu 2-3 věty — co to je, jak se to používá" },
                    material: { type: Type.STRING, description: "Materiál: nerez ocel, ABS plast, silikon, bavlna 240gsm, hliník, zinek, atd." },
                    dimensions: { type: Type.STRING, description: "Přibližné rozměry nebo velikost produktu" },
                    manufacturingMethod: { type: Type.STRING, description: "Výrobní metoda: CNC frézování, laser cut, 3D tisk, injection mold, DTG potisk, vyšívání, AliExpress custom, atd." },
                    priceRange: { type: Type.STRING, description: "Cenový rozsah, např. '299-499 Kč'" },
                    viralAngle: { type: Type.STRING, description: "Proč to bude virální na IG — konkrétní scénář" },
                    whyItWorks: { type: Type.STRING, description: "Proč to bude fungovat obchodně" },
                    productionNotes: { type: Type.STRING, description: "Konkrétní výrobní postup a kde sourcing" },
                    designPrompt: { type: Type.STRING, description: "Anglický prompt pro AI image generator — detailní popis jak produkt vypadá, materiály, barvy, logo placement. V ANGLIČTINĚ!" },
                    variants: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3-5 barevných / materiálových variant nebo verzí produktu." },
                    supplierMessage: { type: Type.STRING, description: "Hotová anglická zpráva pro dodavatele na Alibabě. Obsahuje reálnou a profesionální poptávku ohledně nacenění, dodacích podmínek, MOQ a možností customizace. Buď konkrétní." },
                },
                required: ["name", "brandingNames", "type", "tagline", "description", "material", "dimensions", "manufacturingMethod", "priceRange", "viralAngle", "whyItWorks", "productionNotes", "designPrompt", "variants", "supplierMessage"],
            },
        },
    },
    required: ["ideas"],
}

const DESIGN_CONCEPT_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        name: { type: Type.STRING, description: "Název designu" },
        description: { type: Type.STRING, description: "Popis konceptu designu" },
        designPrompt: { type: Type.STRING, description: "Anglický prompt pro Nano Banana Pro — popis vizuálu, barev, stylu. MUSÍ být v angličtině! Optimalizovaný pro print/potisk. NO TEXT in the design unless it's part of the brand." },
        placement: { type: Type.STRING, description: "Kde bude design: front, back, chest pocket, full-print, all-over" },
        colors: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Hlavní barvy designu" },
        style: { type: Type.STRING, description: "Styl: minimalist, bold graphic, vintage, neon, line art, atd." },
        suggestedTexts: { type: Type.ARRAY, items: { type: Type.STRING }, description: "5 krátkých vtipných textů/sloganů ke zvolenému tématu — on-brand humor, wordplay, max 5 slov každý. Česky nebo anglicky podle brandu." },
    },
    required: ["name", "description", "designPrompt", "placement", "colors", "style", "suggestedTexts"],
}

// ============================================
// STORAGE HELPER — upload to Supabase
// ============================================

async function uploadToStorage(
    imageBuffer: Buffer,
    folder: string,
    prefix: string,
    contentType = "image/png"
): Promise<string> {
    const timestamp = Date.now()
    const filename = `${folder}/${prefix}_${timestamp}.png`

    const { error: uploadError } = await supabaseAdmin.storage
        .from(folder)
        .upload(filename, imageBuffer, {
            contentType,
            cacheControl: "31536000",
        })

    if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`)
    }

    const { data: publicUrlData } = supabaseAdmin.storage
        .from(folder)
        .getPublicUrl(filename)

    return publicUrlData.publicUrl
}

// ============================================
// PIPELINE 1: PRODUCT IDEAS
// ============================================

/**
 * Format the user's 👍/👎 history for prompt injection.
 *
 * Rejected ideas matter as much as liked ones — a negative signal is the cheapest
 * way to stop the model circling the same dead end. Best-effort: a failure here
 * degrades idea quality, it must never block generation.
 */
async function buildIdeaFeedbackSection(clientId: string): Promise<string> {
    try {
        const { data } = await supabaseAdmin
            .from("ig_product_ideas")
            .select("name, tagline, rating, status")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(40)

        const liked = (data || []).filter(i => i.rating === 1).slice(0, 8)
        const disliked = (data || []).filter(i => i.rating === -1 || i.status === "rejected").slice(0, 8)
        if (liked.length === 0 && disliked.length === 0) return ""

        return `
## ZPĚTNÁ VAZBA UŽIVATELE (řiď se jí)
${liked.length ? `### Tohle se líbilo — trefuj stejný typ myšlení:\n${liked.map(i => `- ${i.name}${i.tagline ? ` — ${i.tagline}` : ""}`).join("\n")}` : ""}
${disliked.length ? `### Tohle bylo ODMÍTNUTO — nenabízej to znovu ani v jiné podobě:\n${disliked.map(i => `- ${i.name}${i.tagline ? ` — ${i.tagline}` : ""}`).join("\n")}` : ""}
`
    } catch (err: any) {
        console.warn(`   ⚠️ Idea feedback nedostupná: ${err?.message}`)
        return ""
    }
}

export async function generateProductIdeas(
    config: ClientConfig,
    count: number = 5,
    theme?: string,
    /** Explicit tenant — enables the live catalog + the 👍/👎 feedback loop */
    clientId?: string,
): Promise<ProductIdea[]> {
    const bv = config.brandVoice

    // Live catalog, not the frozen config.products snapshot: proposing a "new"
    // product that was deleted months ago is exactly what the snapshot causes.
    const catalog = clientId
        ? await getCatalogProducts(clientId, config.products, 30).catch(() => config.products || [])
        : (config.products || [])

    const existingProducts = catalog.length > 0
        ? catalog.map(p => `- ${p.name} (${p.type}): ${p.price || "?"} — ${p.description || ""}`).join("\n")
        : "Žádné existující produkty"

    // What the user already liked / rejected. Without this the model happily
    // re-proposes variations of ideas that were thrown away last week.
    const feedbackSection = clientId ? await buildIdeaFeedbackSection(clientId) : ""

    // Detect what kind of business this is from config signals
    const hasEshop = catalog.length > 0
    const contentFocus = config.contentFocus || ""
    const persona = bv.persona || ""
    const values = bv.values || []

    // Build business-aware context
    const businessContext = `
## CO JE TO ZA ZNAČKU (POCHOP TOHLE NEŽ ZAČNEŠ!)
Název: "${config.name}"
Web: ${config.website} | IG: ${config.instagram}
Zaměření obsahu: ${contentFocus || "Nespecifikováno"}

### Brand persona:
${persona}

### Brand values:
${values.join("\n")}

### Stávající produkty/služby:
${existingProducts}
${hasEshop ? "\n→ Tato značka MÁ e-shop s fyzickými produkty." : "\n→ Tato značka NEMÁ e-shop — zaměř se na služby, balíčky, zážitky, nebo merch, který dává smysl pro TENTO byznys."}
`

    // Load dynamic categories from DB (optional — may be empty for non-merch brands)
    const categories = await getProductCategories()
    const categorySection = categories.length > 0
        ? `\n## DOSTUPNÉ KATEGORIE PRODUKTŮ (volitelné):\n${categories.map(c => `- **${c.label}** (${c.icon}): ${c.material_hint || ""} — ${c.manufacturing_hint || ""}`).join("\n")}`
        : ""

    const randomSeed = Math.floor(Math.random() * 10000)
    const prompt = `Jsi kreativní product/service designer. Tvůj úkol je navrhnout nové produkty, služby, nebo nabídky pro KONKRÉTNÍ značku.

${businessContext}
${feedbackSection}
${theme ? `## TÉMA / INSPIRACE\n${theme}\n` : ""}
${categorySection}

## ÚKOL
Navrhni ${count} NOVÝCH, KREATIVNÍCH produktů nebo nabídek pro "${config.name}".

## CO "PRODUKT" ZNAMENÁ PRO TENTO BRAND:
Podle typu byznysu navrhuj RELEVANTNÍ věci:

${hasEshop ? `Tato značka prodává fyzické produkty → navrhuj NOVÉ produkty, limitované edice, bundly, kolekce, seasonal items.
- Každý produkt MUSÍ jít reálně vyrobit/objednat
- Buď kreativní — ne jen "další triko", ale unikátní kusy co zaujmou
- Cenový rozsah konzistentní se stávajícími produkty` : `Tato značka NEPRODÁVÁ fyzické produkty → navrhuj:
- Speciální balíčky, limitované nabídky, seasonal menu/akce
- Up-sell a cross-sell příležitosti
- Zážitkové produkty (workshopy, events, gift cards)
- Merch POUZE pokud dává smysl pro značku (ne každý potřebuje tričko)
- Spolupráce s lokálními dodavateli
- Digitální produkty (e-books, kurzy, membership)`}

## KRITICKÁ PRAVIDLA:
1. **RELEVANCE:** Každý nápad MUSÍ dávat smysl pro "${config.name}" a její zákazníky. Hotelu nenavrhuj streetwear tričko. Restauraci nenavrhuj klíčenku.
2. **KREATIVITA:** Překvap — ne očekávatelné nápady. Ale musí to být realistické a realizovatelné.
3. **SEED:** ${randomSeed} — každé spuštění musí generovat JINÉ nápady.
4. **NEDUPLIKUJ** stávající produkty/služby!
5. **NÁZVY:** Kreativní, brandové, zapamatovatelné. Můžou být vtipné pokud to sedí k tónu značky.
6. **JAZYK:** Piš česky, v tónu odpovídajícím brand voice (viz persona výše).
7. **designPrompt** = anglický prompt pro AI image generator. Popiš jak produkt/nabídka VYPADÁ vizuálně. Vždy: "product photography, studio lighting, photorealistic, clean background."
8. **supplierMessage** = anglická zpráva pro dodavatele/partnera — profesionální poptávka. U služeb/zážitků popiš co by dodavatel měl zajistit.

Generuj PŘESNĚ ${count} nápadů.`

    try {
        const result = await generateText(prompt, {
            responseSchema: PRODUCT_IDEAS_SCHEMA,
            temperature: 1.3,
        })

        // Clean markdown backticks if Gemini includes them
        const cleanText = result.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()

        const parsed = JSON.parse(cleanText)
        return parsed.ideas as ProductIdea[]
    } catch (err) {
        console.error("❌ Product idea generation failed:", err)
        return []
    }
}

// ============================================
// PIPELINE 2 (REMOVED): PRINT-READY DESIGN
// ============================================
//
// generateDesignConcept / generateProductMockup / runDesignConcept lived here and
// produced the wrong artefact by construction: the concept prompt forbade flat
// graphics ("Nezobrazuj jen plochý obrázek, zobraz vždy REÁLNÝ PRODUKT v prostoru")
// and appended a "Product photography, studio lighting, photorealistic" suffix, so
// the "print-ready design" was always a studio photo of a finished product — which
// the mockup step then composited onto ANOTHER product.
//
// Replaced by instagram/print-pipeline.ts: flat artwork → vision QA → alpha +
// 300 DPI + die-line + printer spec, with the mockup as a separate step.

// ============================================
// PIPELINE 2B: PRODUCT CONCEPT VISUALIZATION
// ============================================

export async function generateProductDesign(
    config: ClientConfig,
    idea: ProductIdea,
    referenceImageUrl?: string
): Promise<{ designUrl: string } | null> {
    console.log(`🎨 Generuji vizualizaci produktu: ${idea.name}...`)

    // Use the idea's own design prompt if available, otherwise build one
    let basePrompt = idea.designPrompt || `Single ${idea.name} on dark background. Product photography, studio lighting, photorealistic.`

    // Strip ANY mention of logos, brands, text, dimensions, artwork from the prompt
    // so Imagen generates a CLEAN, BLANK product
    basePrompt = basePrompt
        .replace(/(?:brand|logo|emblem|mark|monogram|symbol|artwork|text|label|engrav|print|decal)\s*(?:of|with|featuring|showing)?[^.]*\./gi, '')
        .replace(/\d+\s*(?:cm|mm|inch|oz|ml)\b/gi, '')
        .replace(/(?:dimension|rozměr|kóta|measurement)[^.]*\./gi, '')

    let logoBuffer: Buffer | null = null

    if (config.logoFile) {
        const { loadLogo } = await import('./logo-loader')
        logoBuffer = await loadLogo(config.logoFile)
    }

    try {
        let imageBuffer: Buffer

        if (logoBuffer) {
            // Generování přes Nano Banana 2 (gemini-3.1-flash-image)
            // Model vloží referenční logo přímo do 3D prostoru fotky!
            const imagePrompt = `${basePrompt}
DESIGN RULES:
- IMPORTANT: An image of a brand logo is provided as a reference. You MUST naturally integrate this EXACT logo onto the central, front-facing surface of the generated product.
- The logo can be embroidered, printed, embossed, debossed, or engraved, but it MUST FEEL NATURAL to the product's material and lighting context.
- Keep the logo clearly visible and recognizable.
- Create a visually interesting, premium product with cool design details (textures, patterns).
- NO fake brand names and NO textual labels or dimensions.
- Style: single product centered, clean dark background, professional product photography.`

            console.log(`🎨 Generuji kreativní produkt s integrovaným logem (Nano Banana 2)...`)

            try {
                // Posíláme logo jako jedinou referenci
                imageBuffer = await generateImageWithReferences(
                    imagePrompt,
                    [{ buffer: logoBuffer, mimeType: "image/png" }],
                    { aspectRatio: "1:1" }
                )
            } catch (err: any) {
                console.warn(`   ⚠️ Nano Banana Pro selhalo (${err.message}). Fallback na Nano Banana 2...`)
                // Fallback prompt pokusí nakreslit alespoň něco textově
                imageBuffer = await generateImage(basePrompt + ` Add a small central emblem to the product.`, { aspectRatio: "1:1" })
            }
        } else {
            // Není logo - čistý Nano Banana bez loga
            const imagePrompt = `${basePrompt}
DESIGN RULES:
- Create a visually interesting, premium product with cool design details.
- NO labels, NO measurements, NO "Supreme", NO existing trademarks.
- Style: single product centered, clean dark background, professional product photography.`

            console.log(`🎨 Generuji kreativní produkt (Nano Banana Pro)...`)
            imageBuffer = await generateImage(imagePrompt, { aspectRatio: "1:1" })
        }

        const safeName = idea.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 20)
        const designUrl = await uploadToStorage(
            imageBuffer,
            "product-concepts",
            `${config.id}_${safeName}`
        )

        console.log(`   ✓ Vizualizace nahrána: ${designUrl}`)
        return { designUrl }
    } catch (err) {
        console.error("❌ Product design generation failed:", err)
        return null
    }
}

// ============================================
// CLI HANDLERS (for development testing)
// ============================================

export async function runProductIdeas(config: ClientConfig) {
    const args = process.argv.slice(2)
    const countArg = args.find(a => a.startsWith("--count="))
    const count = countArg ? parseInt(countArg.split("=")[1]) : 5
    const themeArg = args.find(a => a.startsWith("--theme="))
    const theme = themeArg?.split("=")[1]

    console.log("\n" + "═".repeat(60))
    console.log(`💡 PRODUCT IDEAS — ${config.name}`)
    console.log("═".repeat(60))
    if (theme) console.log(`🎨 Téma: ${theme}`)
    console.log(`📦 Generuji ${count} nápadů...\n`)

    const ideas = await generateProductIdeas(config, count, theme)

    if (ideas.length === 0) {
        console.log("❌ Žádné nápady vygenerovány")
        return
    }

    ideas.forEach((idea, i) => {
        console.log(`\n${"─".repeat(60)}`)
        console.log(`${i + 1}. 🎯 ${idea.name}`)
        console.log(`   💬 "${idea.tagline}"`)
        console.log(`   📦 Typ: ${idea.type} | 💰 ${idea.priceRange}`)
        console.log(`   🔧 Materiál: ${idea.material} | 📐 ${idea.dimensions}`)
        console.log(`   🏭 Výroba: ${idea.manufacturingMethod}`)
        console.log(`   📝 ${idea.description}`)
        console.log(`   🔥 Virální angle: ${idea.viralAngle}`)
        console.log(`   ✅ Proč to bude fungovat: ${idea.whyItWorks}`)
        console.log(`   📋 Produkce: ${idea.productionNotes}`)
        console.log(`   🎨 Varianty: ${idea.variants?.join(", ") || "Nenastaveno"}`)
        console.log(`\n   📧 Zpráva pro dodavatele:\n   ${idea.supplierMessage || "Nenastaveno"}\n`)
    })

    console.log(`\n${"═".repeat(60)}`)
    console.log(`✅ Celkem: ${ideas.length} produktových nápadů`)
    console.log("═".repeat(60) + "\n")
}
