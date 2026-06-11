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
import { getProductCategories, getProductCategoryBySlug, type ProductCategory } from "./service"

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

export async function generateProductIdeas(
    config: ClientConfig,
    count: number = 5,
    theme?: string
): Promise<ProductIdea[]> {
    const bv = config.brandVoice
    const existingProducts = config.products
        ? config.products.map(p => `- ${p.name} (${p.type}): ${p.price || "?"} — ${p.description || ""}`).join("\n")
        : "Žádné existující produkty"

    // Detect what kind of business this is from config signals
    const hasEshop = (config.products && config.products.length > 0)
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
// PIPELINE 2: PRINT-READY DESIGN
// ============================================

export async function generateDesignConcept(
    config: ClientConfig,
    theme: string,
    productType: string = "triko",
    options: { includeLogo?: boolean; overlayText?: string } = {}
): Promise<{ concept: DesignConcept; designUrl: string } | null> {
    const bv = config.brandVoice
    const { includeLogo = false, overlayText } = options

    // Dynamic design guide from DB categories
    const category = await getProductCategoryBySlug(productType)
    const designGuide = category?.design_guide || `Design/vizualizace produktu typu ${productType}. Zobraz celý produkt, studio lighting, dark background.`
    const materialContext = category?.material_hint ? `\nMateriál: ${category.material_hint}` : ""
    const isMockupReady = ["triko", "mikina", "ponožky", "taška", "taska", "čepice", "cepice"].includes(productType)

    // Step 1: Generate design concept via AI text
    console.log("🧠 Generuji design koncept...")
    const conceptPrompt = `Jsi grafický designér a product designer pro brand "${config.name}".

## BRAND PERSONA
${bv.persona}

## BRAND VIZUÁL
- Styl: ${config.feedAesthetic?.feel || 'Moderní a kvalitní'}
- Barvy: ${config.feedAesthetic?.colorPalette || 'Preferuj barvy brandu, ale buď kreativní'}

## STÁVAJÍCÍ PRODUKTY
${config.products?.map(p => `- ${p.name}: ${p.description || ""}`).join("\n") || "Žádné"}

## ZADÁNÍ
Navrhni design pro: **${productType}**
Téma / inspirace: **${theme}**

## SPECIFIKA PRO TENTO TYP:
${designGuide}

## PRAVIDLA:
1. Design MUSÍ sedět k "${config.name}" brand identity
2. **Nezobrazuj jen plochý obrázek**, zobraz vždy REÁLNÝ PRODUKT v prostoru (S výjimkou plakátu, který může být i v rámu).
3. Prompt MUSÍ obsahovat: "Product photography, studio lighting, photorealistic, clean dark background, professional quality"
4. Design musí být vizuálně atraktivní a vypadat jako hotový prémiový kousek.
5. Vytvoř detailní ANGLICKÝ prompt pro AI image generator
6. V poli "suggestedTexts" navrhni 5 krátkých vtipných textů/sloganů k tomuto tématu:
   - Max 5 slov každý
   - On-brand humor, mix česky/anglicky
   - Musí sedět k tématu "${theme}"

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
        console.log(`   ✍️ Texty: ${(concept.suggestedTexts || []).join(" | ")}`)

        // Step 2: Generate image
        console.log("\n🎨 Generuji design...")

        const imageSuffix = "Product photography, studio lighting, clean dark background, photorealistic, premium quality, detailed materials and textures visible, professional product shot."

        // Build text overlay instruction for the prompt
        const textInstruction = overlayText
            ? ` Include the text "${overlayText}" as a bold, stylized typographic element integrated into the design composition — the text should feel like a natural part of the artwork, not a separate label.`
            : ""

        let imageBuffer: Buffer

        if (includeLogo && config.logoFile) {
            // Load logo via shared loader (filesystem + Supabase fallback)
            const { loadLogo } = await import('./logo-loader')
            const logoBuffer = await loadLogo(config.logoFile)

            if (logoBuffer) {
                const imagePrompt = `${concept.designPrompt}.${textInstruction} ${imageSuffix}
DESIGN RULES:
- An image of the brand logo is provided as a reference. Naturally integrate this EXACT logo into the design composition.
- The logo should feel like an organic part of the artwork — embossed, stamped, spray-painted, or stylized to match the design aesthetic.
- Keep the logo clearly recognizable but creatively integrated.
- Do NOT just slap it on top — make it part of the art.`

                try {
                    imageBuffer = await generateImageWithReferences(
                        imagePrompt,
                        [{ buffer: logoBuffer, mimeType: "image/png" }],
                        { aspectRatio: "1:1" }
                    )
                    console.log(`   ✓ Design s logem vygenerován (Nano Banana Pro)`)
                } catch (refErr: any) {
                    console.warn(`   ⚠️ Reference gen selhalo (${refErr.message}), fallback na Imagen...`)
                    const fallbackPrompt = `${concept.designPrompt}.${textInstruction} ${imageSuffix}`
                    imageBuffer = await generateImage(fallbackPrompt, { aspectRatio: "1:1" })
                }
            } else {
                // Logo file not found — proceed without it
                const imagePrompt = `${concept.designPrompt}.${textInstruction} ${imageSuffix}`
                const { generateImage } = await import("./gemini-client")
                imageBuffer = await generateImage(imagePrompt, { aspectRatio: "1:1" })
            }
        } else {
            // Standard Nano Banana Pro generation (no logo)
            const { generateImage } = await import("./gemini-client")
            const imagePrompt = `${concept.designPrompt}.${textInstruction} ${imageSuffix}`
            console.log(`   🖼️ Nano Banana Pro...`)
            imageBuffer = await generateImage(imagePrompt, { aspectRatio: "1:1" })
        }

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

    // Dynamic mockup prompt from DB categories
    const category = await getProductCategoryBySlug(productType)

    // Template mapping (physical files override AI generation)
    const templateMap: Record<string, string> = {
        triko: "tshirt_black_flat.png",
        mikina: "hoodie_black_flat.png",
    }

    const templateFile = templateMap[productType]
    const templatePath = templateFile
        ? path.join(process.cwd(), "instagram", "templates", templateFile)
        : null
    let templateBuffer: Buffer

    // Try physical template first, then AI-generate from category prompt
    if (templatePath && fs.existsSync(templatePath)) {
        templateBuffer = fs.readFileSync(templatePath)
    } else {
        console.warn(`⚠️ Šablona pro "${productType}" — generuji AI šablonu...`)
        try {
            const { generateImage } = await import("./gemini-client")
            // Use category mockup_prompt if available, otherwise generic
            const templatePrompt = category?.mockup_prompt
                || `blank plain black ${productType} laid flat on simple studio background, photorealistic product photography, studio lighting, high resolution, no text, no logo`
            templateBuffer = await generateImage(templatePrompt, { aspectRatio: "1:1" })
            console.log(`   ✅ AI Šablona "${productType}" úspěšně vygenerována`)
        } catch (err) {
            console.error("❌ AI selhalo při tvorbě šablony, vracím tvrdý fallback:", err)
            templateBuffer = await sharp({
                create: {
                    width: 1024, height: 1024, channels: 4,
                    background: { r: 15, g: 15, b: 15, alpha: 1 }
                }
            }).png().toBuffer()
        }
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
        const templateMeta = await sharp(templateBuffer).metadata()
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

        const composited = await sharp(templateBuffer)
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
        console.log(`   🎨 Varianty: ${idea.variants?.join(", ") || "Nenastaveno"}`)
        console.log(`\n   📧 Zpráva pro dodavatele:\n   ${idea.supplierMessage || "Nenastaveno"}\n`)
    })

    console.log(`\n${"═".repeat(60)}`)
    console.log(`✅ Celkem: ${ideas.length} produktových nápadů`)
    console.log("═".repeat(60) + "\n")
}

export async function runDesignConcept(config: ClientConfig) {
    const args = process.argv.slice(2)
    const themeArg = args.find(a => a.startsWith("--theme="))
    const theme = themeArg?.split("=")[1] || "premium product design"
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
