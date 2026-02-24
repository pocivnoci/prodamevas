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
                },
                required: ["name", "brandingNames", "type", "tagline", "description", "material", "dimensions", "manufacturingMethod", "priceRange", "viralAngle", "whyItWorks", "productionNotes", "designPrompt"],
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
        designPrompt: { type: Type.STRING, description: "Anglický prompt pro Imagen 4 Ultra — popis vizuálu, barev, stylu. MUSÍ být v angličtině! Optimalizovaný pro print/potisk. NO TEXT in the design unless it's part of the brand." },
        placement: { type: Type.STRING, description: "Kde bude design: front, back, chest pocket, full-print, all-over" },
        colors: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Hlavní barvy designu" },
        style: { type: Type.STRING, description: "Styl: minimalist, bold graphic, vintage, neon, line art, atd." },
    },
    required: ["name", "description", "designPrompt", "placement", "colors", "style"],
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

export async function generateProductIdeas(
    config: ClientConfig,
    count: number = 5,
    theme?: string
): Promise<ProductIdea[]> {
    const bv = config.brandVoice
    const existingProducts = config.products
        ? config.products.map(p => `- ${p.name} (${p.type}): ${p.price || "?"} — ${p.description || ""}`).join("\n")
        : "Žádné existující produkty"

    const prompt = `Jsi product designer pro streetwear/lifestyle brand "${config.name}".
Web: ${config.website} | IG: ${config.instagram}

## BRAND PERSONA
${bv.persona}

## BRAND VALUES
${bv.values.join("\n")}

## STÁVAJÍCÍ PRODUKTY
${existingProducts}

${theme ? `## TÉMA / INSPIRACE
${theme}
` : ""}

## ÚKOL
Navrhni ${count} NOVÝCH produktů pro brand "${config.name}".

## KATEGORIE PRODUKTŮ (vyber z těchto — jde objednat z Číny za pár korun):
- **Drinkware**: keramický hrnek, termohrnek, sklenice na whisky/pivo, lahev na vodu, shot glass
- **Accessories**: snapback/dad hat čepice, beanie, klíčenka (kov/kůže/guma), náramek, pásek, peněženka
- **Smoking**: Zippo-style zapalovač, popelník (kov/beton/keramika), rolling tray, cigaretové pouzdro
- **Phone**: silikonový/hard phone case, PopSocket grip, stojánek na telefon
- **Home**: polštář, podtácek, plakát/poster, nástěnné hodiny, svíčka, magnetka na lednici
- **Clothing basics**: tričko, mikina, ponožky, boxerky, bucket hat, šátek/bandana
- **EDC/Tools**: otvírák na lahve, multitool karta, karabina, mini baterka
- **Stationery**: notes/zápisník, samolepky (sticker pack), odznak/pin
- **Fun/Novelty**: hrací karty, kostky, stírací los, puzzle

## PRAVIDLA:
1. Každý produkt MUSÍ jít REÁLNĚ objednat z Alibaba/1688 jako hotový polotovar a jen potisknout/gravírovat logem
2. ŽÁDNÉ vymyšlené předměty! Žádné brzdové kotouče, fidget spinnery, zbraně nebo sci-fi přístroje
3. Cenový rozsah pro zákazníka: 149-699 Kč (nákupka pod 50 Kč z Číny)
4. Vtipné názvy s wordplay/dvojsmysly = BONUS
5. Piš česky, on-brand humor
6. MINIMÁLNĚ 3 z ${count} produktů musí být NON-CLOTHING
7. NEDUPLIKUJ stávající produkty!
8. Ke KAŽDÉMU produktu napiš anglický designPrompt — popis pro AI generátor obrázků:
   - VŽDY: "single [product] centered on dark background, product photography, studio lighting, photorealistic"
   - NIKDY: žádné rozměry, kóty, text, labely, schémata, technické výkresy
   - Produkt musí vypadat jako FOTKA z e-shopu, ne jako technický výkres
9. U každého produktu specifikuj reálný materiál a metodu potisku (sítotisk, gravírování, sublimace, tampoprint)

Generuj PŘESNĚ ${count} nápadů.`

    try {
        const result = await generateText(prompt, {
            responseSchema: PRODUCT_IDEAS_SCHEMA,
            temperature: 1.0,
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
// PIPELINE 2: PRINT-READY DESIGN
// ============================================

export async function generateDesignConcept(
    config: ClientConfig,
    theme: string,
    productType: string = "triko"
): Promise<{ concept: DesignConcept; designUrl: string } | null> {
    const bv = config.brandVoice

    // Product-type specific design instructions
    const productDesignGuides: Record<string, string> = {
        triko: "Design pro potisk trička — izolovaná grafika na černém pozadí, optimalizované pro DTG tisk. Placement: front chest nebo full-front.",
        mikina: "Design pro potisk mikiny — izolovaná grafika na černém pozadí, optimalizované pro DTG tisk. Placement: front chest, back, nebo chest pocket area.",
        čepice: "Design pro vyšití/potisk na kšiltovku — jednoduchý, bold, funguje v malém měřítku. Placement: front panel.",
        gadget: "Design/vizualizace fyzického gadgetu — produkt samotný, ne potisk. ZOBRAZ CELÝ PRODUKT: tvar, materiál, logo placement, jak drží v ruce.",
        accessory: "Design/vizualizace doplňku — produkt samotný. ZOBRAZ CELÝ PRODUKT: materiál, gravírování/potisk loga, lifestyle kontext.",
        card: "Design vizitko-velikosti produktu (jako MRDKE CARD) — zobraz z obou stran, materiál, gravírování, texturu kovu.",
        doplněk: "Design/vizualizace fyzického produktu — ZOBRAZ CELÝ PRODUKT, ne jen grafiku. Materiál, barvy, logo, kontext použití.",
    }

    const designGuide = productDesignGuides[productType] || productDesignGuides.triko
    const isClothing = ["triko", "mikina", "čepice"].includes(productType)

    // Step 1: Generate design concept via AI text
    console.log("🧠 Generuji design koncept...")
    const conceptPrompt = `Jsi grafický designér a product designer pro brand "${config.name}".

## BRAND PERSONA
${bv.persona}

## BRAND VIZUÁL
- Barvy: černá, bílá, zlatá, neon green, neon purple
- Styl: Streetwear, urban, drzý, provokativní
- Fonty: Bold sans-serif, graffiti-inspired
- Inspirace: Supreme, Off-White, Palace, BAPE (ale ČESKÁ verze)

## STÁVAJÍCÍ PRODUKTY
${config.products?.map(p => `- ${p.name}: ${p.description || ""}`).join("\n") || "Žádné"}

## ZADÁNÍ
Navrhni design pro: **${productType}**
Téma / inspirace: **${theme}**

## SPECIFIKA PRO TENTO TYP:
${designGuide}

## PRAVIDLA:
1. Design MUSÍ sedět k "${config.name}" brand identity
${isClothing ? `2. Promysli placement (front/back/chest/all-over)
3. Prompt MUSÍ obsahovat: "Isolated design on solid black background, print-ready, high contrast, clean edges"
4. Design musí být TISKNUTELNÝ — čisté kontury, žádné rozmazání` : `2. Prompt musí popisovat CELÝ FYZICKÝ PRODUKT — jak vypadá, materiál, tvar, branding
3. Prompt MUSÍ obsahovat: "Product photography, studio lighting, dark background, professional quality"
4. Produkt musí vypadat jako REÁLNÝ, vyrobitelný item`}
5. Vytvoř detailní ANGLICKÝ prompt pro AI image generator
6. Think like a product designer — premium, innovative, iconic

Vrať POUZE validní JSON.`

    try {
        const conceptText = await generateText(conceptPrompt, {
            responseSchema: DESIGN_CONCEPT_SCHEMA,
            temperature: 0.9,
        })

        // Clean markdown backticks if Gemini includes them
        const cleanText = conceptText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()

        const concept = JSON.parse(cleanText) as DesignConcept

        console.log(`   ✓ Koncept: "${concept.name}"`)
        console.log(`   📐 Style: ${concept.style}`)
        console.log(`   🎨 Colors: ${concept.colors.join(", ")}`)
        console.log(`   📍 Placement: ${concept.placement}`)

        // Step 2: Generate image with Imagen 4 Ultra
        console.log("\n🎨 Generuji design (Imagen 4 Ultra)...")

        const imageSuffix = isClothing
            ? "Isolated design on solid black background. Print-ready vector art style, high contrast, clean sharp edges, no text, streetwear graphic design, professional DTG print quality. Single centered composition."
            : "Product photography, studio lighting, clean dark background, photorealistic, premium quality, detailed materials and textures visible, professional product shot."

        const imagePrompt = `${concept.designPrompt}. ${imageSuffix}`

        const imageBuffer = await generateImage(imagePrompt, { aspectRatio: "1:1" })

        // Upload to Supabase Storage
        const safeName = concept.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 30)
        const designUrl = await uploadToStorage(
            imageBuffer,
            "product-designs",
            `${config.id}_${safeName}`
        )

        console.log(`   ✓ Design nahrán: ${designUrl}`)

        return { concept, designUrl }
    } catch (err) {
        console.error("❌ Design generation failed:", err)
        return null
    }
}

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

    // 1. Zjistit zda existuje nahrané logo v configu a načíst ho
    let logoBuffer: Buffer | null = null
    const { join } = await import('path')
    const { readFile } = await import('fs/promises')

    if (config.logoFile) {
        try {
            const fontsDir = join(process.cwd(), 'instagram', 'fonts')
            const logoPath = join(fontsDir, config.logoFile)
            logoBuffer = await readFile(logoPath)
            console.log(`   🏷️ Logo načteno pro integraci (${config.logoFile})`)
        } catch (err: any) {
            console.warn(`   ⚠️ Nepodařilo se načíst logo (${config.logoFile}), generuji bez něj. Error: ${err.message}`)
        }
    }

    try {
        let imageBuffer: Buffer

        if (logoBuffer) {
            // Generování přes Nano Banana Pro (gemini-3-pro-image-preview) 
            // Model vloží referenční logo přímo do 3D prostoru fotky!
            const imagePrompt = `${basePrompt}
DESIGN RULES:
- IMPORTANT: An image of a brand logo is provided as a reference. You MUST naturally integrate this EXACT logo onto the central, front-facing surface of the generated product.
- The logo can be embroidered, printed, embossed, debossed, or engraved, but it MUST FEEL NATURAL to the product's material and lighting context.
- Keep the logo clearly visible and recognizable.
- Create a visually interesting, premium streetwear-inspired product with cool design details (textures, patterns).
- NO fake brand names like "Supreme" and NO textual labels or dimensions.
- Style: single product centered, clean dark background, professional product photography.`

            console.log(`🎨 Generuji kreativní produkt s integrovaným logem (Nano Banana Pro)...`)

            try {
                // Posíláme logo jako jedinou referenci
                imageBuffer = await generateImageWithReferences(
                    imagePrompt,
                    [{ buffer: logoBuffer, mimeType: "image/png" }],
                    { aspectRatio: "1:1" }
                )
            } catch (err: any) {
                console.warn(`   ⚠️ Nano Banana Pro selhalo (${err.message}). Fallback na Imagen 4 Ultra...`)
                // Fallback prompt pokusí nakreslit alespoň něco textově
                imageBuffer = await generateImage(basePrompt + ` Add a small central emblem to the product.`, { aspectRatio: "1:1" })
            }
        } else {
            // Není logo - čistý Imagen 4 bez loga
            const imagePrompt = `${basePrompt}
DESIGN RULES:
- Create a visually interesting, premium product with cool design details.
- NO labels, NO measurements, NO "Supreme", NO existing trademarks.
- Style: single product centered, clean dark background, professional product photography.`

            console.log(`🎨 Generuji kreativní produkt (Imagen 4 Ultra)...`)
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
// PIPELINE 3: PRODUCT MOCKUP
// ============================================

export async function generateProductMockup(
    config: ClientConfig,
    designUrl: string,
    productType: string = "triko",
    designDescription?: string
): Promise<{ mockupUrl: string } | null> {
    console.log(`📸 Generuji mockup: ${productType}...`)

    const sharp = (await import("sharp")).default
    const path = await import("path")
    const fs = await import("fs")

    // Template mapping
    const templateMap: Record<string, string> = {
        triko: "tshirt_black_flat.png",
        mikina: "hoodie_black_flat.png",
    }

    const templateFile = templateMap[productType]
    if (!templateFile) {
        console.error(`❌ Neexistuje šablona pro typ: ${productType}`)
        return null
    }

    const templatePath = path.join(process.cwd(), "instagram", "templates", templateFile)
    if (!fs.existsSync(templatePath)) {
        console.error(`❌ Šablona nenalezena: ${templatePath}`)
        return null
    }

    // Step 1: Download the actual design image
    console.log(`   📥 Stahuji design...`)
    let designBuffer: Buffer
    try {
        const response = await fetch(designUrl)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        designBuffer = Buffer.from(await response.arrayBuffer())
        console.log(`   ✅ Design stažen (${(designBuffer.length / 1024).toFixed(0)} KB)`)
    } catch (err) {
        console.error("❌ Nelze stáhnout design:", err)
        return null
    }

    // Step 2: Get template dimensions and calculate placement
    try {
        const templateMeta = await sharp(templatePath).metadata()
        const templateWidth = templateMeta.width || 1024
        const templateHeight = templateMeta.height || 1024

        // Design print area: centered on chest, ~40% of template width
        const printWidth = Math.round(templateWidth * 0.40)
        const printHeight = Math.round(printWidth * 1.0) // square-ish design

        // Center horizontally, place at ~25% from top (chest area)
        const left = Math.round((templateWidth - printWidth) / 2)
        const top = Math.round(templateHeight * 0.25)

        console.log(`   📐 Šablona: ${templateWidth}x${templateHeight}, design: ${printWidth}x${printHeight} @ (${left}, ${top})`)

        // Step 3: Resize design and composite onto template
        const resizedDesign = await sharp(designBuffer)
            .resize(printWidth, printHeight, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer()

        const composited = await sharp(templatePath)
            .composite([{
                input: resizedDesign,
                left,
                top,
                blend: "over" as const,
            }])
            .png()
            .toBuffer()

        console.log(`   ✅ Kompozice hotová (${(composited.length / 1024).toFixed(0)} KB)`)

        // Step 4: Upload to Supabase
        const mockupUrl = await uploadToStorage(
            composited,
            "product-mockups",
            `${config.id}_${productType}`
        )

        console.log(`   ✓ Mockup nahrán: ${mockupUrl}`)
        return { mockupUrl }
    } catch (err) {
        console.error("❌ Mockup composition failed:", err)
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
    })

    console.log(`\n${"═".repeat(60)}`)
    console.log(`✅ Celkem: ${ideas.length} produktových nápadů`)
    console.log("═".repeat(60) + "\n")
}

export async function runDesignConcept(config: ClientConfig) {
    const args = process.argv.slice(2)
    const themeArg = args.find(a => a.startsWith("--theme="))
    const theme = themeArg?.split("=")[1] || "iconic streetwear"
    const productArg = args.find(a => a.startsWith("--product="))
    const productType = productArg?.split("=")[1] || "triko"

    console.log("\n" + "═".repeat(60))
    console.log(`🎨 DESIGN GENERATOR — ${config.name}`)
    console.log("═".repeat(60))
    console.log(`📦 Produkt: ${productType}`)
    console.log(`🎨 Téma: ${theme}\n`)

    const result = await generateDesignConcept(config, theme, productType)

    if (result) {
        console.log(`\n${"═".repeat(60)}`)
        console.log(`✅ Design "${result.concept.name}" vygenerován`)
        console.log(`🔗 URL: ${result.designUrl}`)
        console.log("═".repeat(60) + "\n")

        // Generate mockup
        console.log("📸 Generuji mockup...")
        const mockup = await generateProductMockup(config, result.designUrl, productType, result.concept.description)
        if (mockup) {
            console.log(`✅ Mockup URL: ${mockup.mockupUrl}`)
        }
    }
}
