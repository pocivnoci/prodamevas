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
import { generateText, generateImage } from "./gemini-client"
import { Type } from "@google/genai"
import supabase from "../supabase/client"

// ============================================
// INTERFACES
// ============================================

export interface ProductIdea {
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

    const { error: uploadError } = await supabase.storage
        .from("audit-screenshots")
        .upload(filename, imageBuffer, {
            contentType,
            cacheControl: "31536000",
        })

    if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`)
    }

    const { data: publicUrlData } = supabase.storage
        .from("audit-screenshots")
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

    const prompt = `Jsi kreativní product designer a vynálezce pro brand "${config.name}".
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
Navrhni ${count} NOVÝCH, ORIGINÁLNÍCH produktů pro brand "${config.name}".

## KLÍČOVÉ PRAVIDLO — BUDTE KREATIVNÍ!
Nemysli jen na trička a mikiny. Mysli jako vynálezce:
- **EDC gadgets**: ocelová škrabka na čelní sklo velikosti kreditní karty (jako MRDKE CARD), mini váha ve tvaru klíče, branded zapalovač, otvírák na lahve ve tvaru pistole
- **Home & Lifestyle**: rolling tray s logem, popelník z betonu, branded sklenice na whisky, neon nástěnný sign
- **Accessories**: kožený keychain, branded peněženka, ocelový prsten s logem, řetízek s přívěskem
- **Novelty/Fun**: custom hrací karty, branded kostky na pití, stírací los "MRDKE LOTTO", branded ponožky s hidden messages
- **Tech**: branded phone case, custom USB lighter, mini bluetooth speaker
- **Seasonal**: limitované vánoční edice, letní kolekce, valentýnské balíčky

## PRAVIDLA:
1. Každý produkt MUSÍ sedět k brand identity "${config.name}" — název, design, humor, vibe
2. Produkty musí být REÁLNĚ vyrobitelné — specifikuj přesnou výrobní metodu
3. MINIMÁLNĚ 3 z ${count} produktů musí být NON-CLOTHING (gadgets, accessories, lifestyle)
4. Dvojsmysly a wordplay v názvech = VELKÝ BONUS
5. Cenový rozsah: 149-1999 Kč (většina pod 699 Kč)
6. Každý produkt musí mít virální potenciál na IG — popsal scénář jak to bude vypadat na feedu
7. NEDUPLIKUJ stávající produkty!
8. Piš česky, on-brand humor
9. U každého produktu specifikuj materiál, rozměry a výrobní metodu
10. Ke KAŽDÉMU produktu uveď 3-5 ALTERNATIVNÍCH NÁZVŮ (brandingNames) — různé styly:
    - Wordplay/dvojsmysl (např. "MRDKE CARD" = škrabka + brand)
    - CZ/EN mix (např. "Zero Fucks Given")
    - Drzý/provokativní
    - Elegantní/minimal
    - Slangový/streetwear
11. Ke KAŽDÉMU produktu napiš anglický designPrompt — detailní popis jak produkt vypadá pro AI image generator

Generuj PŘESNĚ ${count} nápadů.`

    try {
        const result = await generateText(prompt, {
            responseSchema: PRODUCT_IDEAS_SCHEMA,
            temperature: 1.0,
        })

        const parsed = JSON.parse(result)
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

        const concept = JSON.parse(conceptText) as DesignConcept

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
    idea: ProductIdea
): Promise<{ designUrl: string } | null> {
    console.log(`🎨 Generuji vizualizaci produktu: ${idea.name}...`)

    // Use the idea's own design prompt if available, otherwise build one
    const basePrompt = idea.designPrompt || `Product concept: ${idea.name}. ${idea.description}. Material: ${idea.material}. Dimensions: ${idea.dimensions}. Brand: ${config.name}.`

    const imagePrompt = `${basePrompt} Product photography, studio lighting, clean dark background, photorealistic render, premium quality, detailed materials and textures, professional product visualization. Brand aesthetic: urban streetwear, bold, premium.`

    try {
        const imageBuffer = await generateImage(imagePrompt, { aspectRatio: "1:1" })

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
    console.log(`📸 Generuji mockup: ${productType}${designDescription ? ` — "${designDescription}"` : ""}...`)

    // Clothing types: the design is a PRINT on the garment
    const clothingPrompts: Record<string, string> = {
        triko: "Photorealistic product photography of a premium black t-shirt laid flat on a dark surface. The t-shirt has a bold graphic print on the front chest area. Studio lighting, clean minimal background, e-commerce product shot, high quality fashion photography.",
        mikina: "Photorealistic product photography of a premium black hoodie laid flat on a dark surface. The hoodie has a bold graphic print on the front chest area. Studio lighting, clean minimal background, e-commerce product shot, high quality fashion photography.",
        čepice: "Photorealistic product photography of a black snapback cap on a dark surface. The cap has a bold embroidered graphic on the front panel. Studio lighting, clean minimal background, e-commerce product shot, fashion photography.",
    }

    let promptWithDesign: string

    if (clothingPrompts[productType]) {
        // Clothing: designDescription is the GRAPHIC PRINT on the garment
        const basePrompt = clothingPrompts[productType]
        promptWithDesign = designDescription
            ? `${basePrompt} The graphic design features: ${designDescription}. Brand: ${config.name}. Urban streetwear aesthetic.`
            : `${basePrompt} Brand: ${config.name}. Urban streetwear aesthetic, bold graphic design.`
    } else {
        // Non-clothing (doplněk, combo, etc.): designDescription IS the product itself
        if (designDescription) {
            promptWithDesign = `Photorealistic product photography of: ${designDescription}. Branded product for ${config.name}. Premium quality, studio lighting on a dark surface, clean minimal background, e-commerce product shot, luxury feel. The product should look exactly as described — this is NOT a t-shirt or clothing item, it is the actual product described above.`
        } else {
            promptWithDesign = `Photorealistic product photography of a premium branded ${productType} accessory for ${config.name}. Studio lighting on a dark surface, clean minimal background, e-commerce product shot, luxury feel.`
        }
    }

    try {
        const imageBuffer = await generateImage(promptWithDesign, { aspectRatio: "1:1" })

        const mockupUrl = await uploadToStorage(
            imageBuffer,
            "product-mockups",
            `${config.id}_${productType}`
        )

        console.log(`   ✓ Mockup nahrán: ${mockupUrl}`)

        return { mockupUrl }
    } catch (err) {
        console.error("❌ Mockup generation failed:", err)
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
