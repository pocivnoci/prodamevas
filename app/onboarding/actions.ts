'use server'

import { createClient } from '@/supabase/server'
import supabaseAdmin from '@/supabase/admin'
import { generateText } from '@/instagram/gemini-client'
import type { ClientConfig } from '@/instagram/configs/types'

// ============================================
// TYPES
// ============================================

export interface WebsiteAnalysis {
    companyName: string
    description: string
    industry: string
    products: { name: string; type: string; slug: string; price?: string; description?: string }[]
    brandTone: string
    colors: { primary: string; secondary: string; accent: string }
    targetAudience: string
    uniqueSellingPoints: string[]
    existingContent: string[]
    instagramBio?: string
    logoUrl?: string
    /** Whether logo was successfully downloaded */
    logoDownloaded?: boolean
    /** Recommended font: Inter (modern/clean) or BebasNeue (bold/impact) */
    recommendedFont?: string
    /** AI-recommended overlay gradient based on brand colors */
    overlayGradient?: { topColor: string; midColor: string; bottomColor: string }
    /** Unique visual feel description */
    visualFeel?: string
    /** Brand image URLs scraped from the website */
    brandImageUrls?: string[]
}

export interface OnboardingQuestion {
    id: string
    question: string
    type: 'select' | 'multiselect' | 'text' | 'scale'
    options?: string[]
    placeholder?: string
    required: boolean
}

// ============================================
// ERROR HELPERS
// ============================================

function humanizeError(error: unknown): string {
    const msg = (error as Error)?.message || String(error)
    if (msg.includes('503') || msg.includes('overloaded') || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
        return 'AI server je momentálně přetížený. Zkus to za chvíli znovu.'
    }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
        return 'Překročen limit API požadavků. Zkus to za minutu.'
    }
    if (msg.includes('timeout') || msg.includes('abort') || msg.includes('ETIMEDOUT')) {
        return 'Připojení k webu vypršelo. Zkontroluj URL a zkus to znovu.'
    }
    if (msg.includes('ENOTFOUND') || msg.includes('DNS')) {
        return 'Web nebyl nalezen. Zkontroluj, jestli je URL správná.'
    }
    if (msg.includes('JSON')) {
        return 'AI vygenerovalo neplatnou odpověď. Zkus to znovu.'
    }
    return msg
}

// ============================================
// DB HELPERS
// ============================================

/**
 * Insert a new client record and return its UUID.
 * Handles slug duplicates by appending a short suffix.
 */
async function insertClient(slug: string, config: ClientConfig): Promise<string> {
    const payload = {
        slug,
        name: config.name,
        website: config.website,
        config: config,
        is_active: true,
    }

    const { data, error } = await supabaseAdmin
        .from('clients')
        .insert(payload)
        .select('id')
        .single()

    if (error) {
        if (error.message.includes('duplicate') || error.message.includes('unique')) {
            // Slug collision — retry with suffix
            const newSlug = `${slug}-${Date.now().toString(36).slice(-4)}`
            config.id = newSlug
            const { data: retryData, error: retryError } = await supabaseAdmin
                .from('clients')
                .insert({ ...payload, slug: newSlug })
                .select('id')
                .single()
            if (retryError) throw retryError
            return retryData!.id
        }
        throw error
    }
    return data!.id
}

// ============================================
// STEP 1: ANALYZE WEBSITE
// ============================================

export async function analyzeWebsite(url: string, igHandle: string): Promise<{
    success: boolean
    analysis?: WebsiteAnalysis
    error?: string
}> {
    try {
        // Normalize URL
        const baseUrl = url.startsWith('http') ? url : `https://${url}`

        // Scrape homepage
        console.log(`🔍 Scraping ${baseUrl}...`)
        const homepageHtml = await fetchPage(baseUrl)

        // Fetch subpages and Instagram in parallel to save time (avoids 15s Vercel timeouts)
        const subpageUrls = extractSubpageUrls(homepageHtml, baseUrl).slice(0, 3)
        const [subpageTextsArray, instagramBioObj] = await Promise.all([
            Promise.all(subpageUrls.map(async (subUrl) => {
                try {
                    const html = await fetchPage(subUrl)
                    return extractText(html).substring(0, 1000)
                } catch { return "" }
            })),
            (async () => {
                if (!igHandle) return undefined
                const handle = igHandle.replace('@', '').replace('https://instagram.com/', '')
                try {
                    const igHtml = await fetchPage(`https://www.instagram.com/${handle}/`)
                    const bioMatch = igHtml.match(/"biography":"([^"]+)"/)
                    return bioMatch?.[1]?.replace(/\\n/g, '\n')
                } catch { return undefined }
            })()
        ])

        const subpageTexts = subpageTextsArray.filter(Boolean)
        const instagramBio = instagramBioObj

        // Extract metadata and main text from homepage
        const metadata = extractMetadata(homepageHtml)
        const mainText = extractText(homepageHtml)

        // Send everything to AI for analysis — including VISUAL identity
        const analysisPrompt = `Analyzuj tuto webovou stránku a extrahuj klíčové informace pro Instagram marketing.

## HOMEPAGE METADATA
Title: ${metadata.title}
Description: ${metadata.description}
OG Image: ${metadata.ogImage || 'N/A'}
Theme Color: ${metadata.themeColor || 'N/A'}

## HOMEPAGE TEXT (zkráceno)
${mainText.substring(0, 3000)}

## DALŠÍ STRÁNKY
${subpageTexts.map((t, i) => `### ${subpageUrls[i]}\n${t}`).join('\n\n')}

${instagramBio ? `## INSTAGRAM BIO\n${instagramBio}` : ''}

## ÚKOL
Analyzuj brand a vrať JSON s těmito poli:
- companyName: název firmy/značky
- description: co firma dělá (1-2 věty)
- industry: odvětví (e-commerce, SaaS, služby, edukace, atd.)
- products: pole produktů/služeb [{name, type, slug, price, description}] (max 10)
- brandTone: detekovaný tón komunikace (formální, neformální, drzý, expertní, atd.)
- colors: {primary, secondary, accent} — HEX barvy detekované z webu (theme-color, CSS, vizuální styl)
- targetAudience: odhadovaná cílová skupina
- uniqueSellingPoints: co firmu odlišuje (pole stringů)
- existingContent: typy existujícího obsahu na webu (blog, recenze, galerie, atd.)
- recommendedFont: vhodný font pro Instagram overlay — vždy JEDNO z: "Inter" (pro moderní/clean/tech/professional branding) nebo "BebasNeue" (pro bold/dramatic/street/fashion/sport). Vyber podle tónu a brandu.
- overlayGradient: {topColor, midColor, bottomColor} — 3 HEX barvy pro gradient overlay na Instagramových obrázcích. Barvy MUSÍ být odvozeny z brand palette ale tmavší/syté, aby text (bílý) byl čitelný. Nesmí být neutrálně šedé/černé — musí odrážet brand!
- visualFeel: 1 věta popisující unikátní vizuální styl feed (např. "Luxusní minimalizmus s deep blue a zlatým akcentem" nebo "Energický street vibe s neonovými barvami")
- overlayOpacity: doporučená opacity text overlay procenta (např. "35-45%" pro světlé brandy, "50-65%" pro tmavé/kontrastní)

Vrať POUZE platný JSON, bez dalšího textu.`

        const analysisSchema = {
            type: "object",
            properties: {
                companyName: { type: "string" },
                description: { type: "string" },
                industry: { type: "string" },
                products: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            type: { type: "string" },
                            slug: { type: "string" },
                            price: { type: "string" },
                            description: { type: "string" },
                        },
                        required: ["name", "type", "slug"],
                    },
                },
                brandTone: { type: "string" },
                colors: {
                    type: "object",
                    properties: {
                        primary: { type: "string" },
                        secondary: { type: "string" },
                        accent: { type: "string" },
                    },
                    required: ["primary", "secondary", "accent"],
                },
                targetAudience: { type: "string" },
                uniqueSellingPoints: { type: "array", items: { type: "string" } },
                existingContent: { type: "array", items: { type: "string" } },
                recommendedFont: { type: "string", enum: ["Inter", "BebasNeue"] },
                overlayGradient: {
                    type: "object",
                    properties: {
                        topColor: { type: "string" },
                        midColor: { type: "string" },
                        bottomColor: { type: "string" },
                    },
                    required: ["topColor", "midColor", "bottomColor"],
                },
                visualFeel: { type: "string" },
                overlayOpacity: { type: "string" },
            },
            required: ["companyName", "description", "industry", "products", "brandTone", "colors", "targetAudience", "uniqueSellingPoints", "existingContent", "recommendedFont", "overlayGradient", "visualFeel", "overlayOpacity"],
        }

        const rawAnalysis = await generateText(analysisPrompt, { responseSchema: analysisSchema })
        const jsonMatch = rawAnalysis.match(/\{[\s\S]*\}/)
        const analysis: WebsiteAnalysis = JSON.parse(jsonMatch?.[0] || rawAnalysis)
        analysis.instagramBio = instagramBio
        analysis.logoUrl = metadata.ogImage || undefined

        // Extract brand images from HTML (product photos, hero images)
        analysis.brandImageUrls = extractBrandImages(homepageHtml, baseUrl).slice(0, 5)

        // Try to download logo
        const slug = slugify(analysis.companyName)
        const logoUrl = extractLogoUrl(homepageHtml, baseUrl)
        if (logoUrl) {
            const logoSaved = await downloadLogo(logoUrl, slug)
            analysis.logoDownloaded = logoSaved
            if (logoSaved) {
                console.log(`✅ Logo saved as logo-${slug}.png`)
            }
        }

        return { success: true, analysis }
    } catch (error) {
        console.error('Website analysis error:', error)
        return { success: false, error: humanizeError(error) }
    }
}

// ============================================
// STEP 2: GENERATE QUESTIONS
// ============================================

export async function generateQuestions(analysis: WebsiteAnalysis): Promise<{
    success: boolean
    questions?: OnboardingQuestion[]
    error?: string
}> {
    try {
        const prompt = `Na základě analýzy webové stránky vygeneruj personalizovaný dotazník pro nastavení Instagram autopilota.

## ANALYZOVANÁ FIRMA
Název: ${analysis.companyName}
Obor: ${analysis.industry}
Popis: ${analysis.description}
Produkty: ${analysis.products.map(p => p.name).join(', ')}
Detekovaný tón: ${analysis.brandTone}
Cílová skupina: ${analysis.targetAudience}
${analysis.instagramBio ? `IG Bio: ${analysis.instagramBio}` : ''}

## PRAVIDLA
1. Generuj 5-7 otázek, které AI NEZVLÁDNE zodpovědět samo z webu
2. Neptej se na věci, které už víme z analýzy (název firmy, web, produkty)
3. Zaměř se na: tón, frekvenci, cíle, tabu témata, vizuální preference
4. Každá otázka má ID, text, typ (select/multiselect/text/scale) a options
5. Piš česky

## TYPY OTÁZEK
- select: výběr jedné možnosti (vyžaduje options)
- multiselect: výběr více možností (vyžaduje options)
- text: volný text (vyžaduje placeholder)
- scale: škála 1-5 (automaticky)

Vrať POUZE platný JSON pole otázek.`

        const questionsSchema = {
            type: "object",
            properties: {
                questions: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            question: { type: "string" },
                            type: { type: "string", enum: ["select", "multiselect", "text", "scale"] },
                            options: { type: "array", items: { type: "string" } },
                            placeholder: { type: "string" },
                            required: { type: "boolean" },
                        },
                        required: ["id", "question", "type", "required"],
                    },
                },
            },
            required: ["questions"],
        }

        const rawQuestions = await generateText(prompt, { responseSchema: questionsSchema })
        const jsonMatch = rawQuestions.match(/\{[\s\S]*\}/)
        const parsed = JSON.parse(jsonMatch?.[0] || rawQuestions)

        return { success: true, questions: parsed.questions }
    } catch (error) {
        console.error('Question generation error:', error)
        return { success: false, error: humanizeError(error) }
    }
}

// ============================================
// STEP 3: BUILD AND SAVE CONFIG
// ============================================

export async function buildAndSaveConfig(
    analysis: WebsiteAnalysis,
    answers: Record<string, string | string[]>,
    websiteUrl: string,
    igHandle: string
): Promise<{ success: boolean; clientSlug?: string; error?: string }> {
    try {
        // Get current user
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return { success: false, error: 'Nepřihlášený uživatel' }

        // Build the config via AI
        const configPrompt = `Vytvořme kompletní Instagram autopilot konfiguraci pro firmu "${analysis.companyName}".

## ANALÝZA WEBU
${JSON.stringify(analysis, null, 2)}

## ODPOVĚDI Z DOTAZNÍKU
${JSON.stringify(answers, null, 2)}

## WEBSITE & IG
Web: ${websiteUrl}
Instagram: ${igHandle}

## ÚKOL
Vygeneruj kompletní ClientConfig JSON. Buď kreativní ale přesný.

### Struktura:
{
  "id": "${slugify(analysis.companyName)}",
  "name": "${analysis.companyName}",
  "website": "${websiteUrl}",
  "instagram": "${igHandle}",
  "brandVoice": {
    "persona": "... (2-3 věty popisující personu značky na Instagramu, česky)",
    "values": ["... (3-5 hodnot značky)"],
    "voiceTraits": ["... (4-6 charakteristik hlasu, např. 'drzý ale přátelský')"],
    "antiPatterns": ["... (5-8 věcí, které značka NIKDY nepoužívá)"],
    "hookTemplates": [
      {"pattern": "{{šablona}}", "example": "Konkrétní příklad", "bestFor": ["tip", "meme"], "trigger": "curiosity"},
      ... (6-8 šablon)
    ],
    "ctaVariations": ["... (8-12 CTA textů odkazujících na ${websiteUrl})"],
    "toneByPostType": {
      "tip": {"humorLevel": 2, "urgencyLevel": 2, "intimacyLevel": 4, "educationalLevel": 4},
      "meme": {"humorLevel": 5, "urgencyLevel": 1, "intimacyLevel": 5, "educationalLevel": 1},
      ... (pro každý post type)
    }
  },
  "contentPillars": {
    "reach": {"emoji": "🎯", "label": "Dosah", "description": "...", "postTypes": [...], "ratio": 0.3, "ctaStrategy": "soft", "kpi": ["reach", "impressions"]},
    "engagement": {"emoji": "💬", "label": "Engagement", "description": "...", "postTypes": [...], "ratio": 0.35, "ctaStrategy": "medium", "kpi": ["likes", "comments"]},
    "sales": {"emoji": "🛒", "label": "Prodej", "description": "...", "postTypes": [...], "ratio": 0.20, "ctaStrategy": "hard", "kpi": ["clicks", "conversions"]},
    "community": {"emoji": "🤝", "label": "Komunita", "description": "...", "postTypes": [...], "ratio": 0.15, "ctaStrategy": "none", "kpi": ["saves", "shares"]}
  },
  "ctaStrategies": {
    "soft": ["... (3-4 jemné CTA)"],
    "medium": ["... (3-4 střední CTA)"],
    "hard": ["... (3-4 agresivní CTA)"],
    "none": [""]
  },
   "feedAesthetic": {
     "colorPalette": "... (popis barev z analýzy: ${analysis.colors.primary}, ${analysis.colors.secondary})",
     "overlayOpacity": "35-45%",
     "textPosition": "BOTTOM",
     "font": "Inter, Helvetica Neue",
     "feel": "... (popis vizuálního pocitu)"
   },
  "weekPlan": ["tip", "meme", "carousel", "product", "behind_scenes", "tip", "meme"],
  "hashtagPools": {
    "core": ["#${slugify(analysis.companyName)}", "... (3-4 branded hashtags)"],
    "niche": ["... (5-8 niche hashtagů pro ${analysis.industry})"],
    "broad": ["... (4-6 širokých hashtagů)"],
    "trending": ["... (2-3 trending hashtagy)"],
    "czech": ["... (3-5 českých hashtagů)"]
  },
  "contentFocus": "... (O čem značka je, 1 věta)",
  "postTypes": ["tip", "meme", "carousel", "behind_scenes", "product_drop", "recenze", "challenge"],
  "overlayGradient": ${JSON.stringify(analysis.overlayGradient || { topColor: analysis.colors.primary, midColor: analysis.colors.secondary, bottomColor: analysis.colors.primary })}${analysis.products.length > 0 ? `,
  "products": ${JSON.stringify(analysis.products.map(p => ({ name: p.name, type: p.type, slug: p.slug, price: p.price, description: p.description })))}` : ''}
}

DŮLEŽITÉ:
- Všechny texty psány česky, moderní hovorovou češtinou
- Obsah musí odpovídat analýze webu a odpovědím
- Post types přizpůsobené oboru (${analysis.industry})
- Hook templates kreativní a specificke pro tuto značku
- CTA vždy odkazuje na ${websiteUrl}
- feedAesthetic.font MUSÍ být "${analysis.recommendedFont || 'Inter'}" (to odpovídá brand analýze)
- feedAesthetic.feel MUSÍ být: "${analysis.visualFeel || 'Moderní a čistý design'}"
- feedAesthetic.overlayOpacity MUSÍ být: "${(analysis as any).overlayOpacity || '40-50%'}"
- overlayGradient MUSÍ přesně odpovídat: ${JSON.stringify(analysis.overlayGradient || { topColor: analysis.colors.primary, midColor: analysis.colors.secondary, bottomColor: analysis.colors.primary })}
- Vrať POUZE platný JSON, bez obalujícího textu`

        const rawConfig = await generateText(configPrompt, { temperature: 0.7 })
        const jsonMatch = rawConfig.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('AI nevygenerovalo platný JSON config')

        const config: ClientConfig = JSON.parse(jsonMatch[0])

        // Ensure critical fields
        const slug = slugify(analysis.companyName)
        config.id = slug
        config.website = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
        config.instagram = igHandle.startsWith('@') ? igHandle : `@${igHandle}`

        // Force visual identity from analysis (AI may hallucinate different values)
        if (analysis.overlayGradient) {
            config.overlayGradient = analysis.overlayGradient
        }
        if (analysis.recommendedFont && config.feedAesthetic) {
            config.feedAesthetic.font = analysis.recommendedFont
            config.feedAesthetic.fontOverride = analysis.recommendedFont
        }
        if (analysis.visualFeel && config.feedAesthetic) {
            config.feedAesthetic.feel = analysis.visualFeel
        }
        // Set logo file if it was downloaded
        if (analysis.logoDownloaded) {
            config.logoFile = `logo-${slug}.png`
        }
        // Set storage bucket
        config.storageBucket = `ig-posts-${slug}`

        // Download brand/product images from website → Supabase storage
        const imageUrls = await downloadProductImages(
            analysis.brandImageUrls || [],
            slug
        )
        if (imageUrls.length > 0) {
            config.characterReferenceImages = imageUrls
            console.log(`✅ ${imageUrls.length} brand images uploaded to storage`)
        }

        // Save to database
        const clientSlug = config.id

        // Ensure Storage Bucket exists for this client
        const { error: bucketError } = await supabaseAdmin.storage.createBucket(config.storageBucket, {
            public: true,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
            fileSizeLimit: 10485760 // 10MB
        })
        if (bucketError && !bucketError.message.includes('already exists') && !bucketError.message.includes('Duplicate')) {
            console.warn(`⚠️ Failed to create bucket ${config.storageBucket}:`, bucketError.message)
        } else {
            console.log(`✅ Storage bucket ${config.storageBucket} is ready`)
        }

        // Insert client record (no user_id column — RBAC is via user_clients)
        const insertedClientId = await insertClient(clientSlug, config)

        // ── RBAC: Link user → client as owner ──
        const { error: linkError } = await supabaseAdmin
            .from('user_clients')
            .insert({
                user_id: user.id,
                client_id: insertedClientId,
                role: 'owner',
            })
        if (linkError) {
            console.error('⚠️ Failed to create user_clients link:', linkError.message)
            // Non-fatal — admin can fix manually
        } else {
            console.log(`✅ User ${user.id} linked to client ${insertedClientId} as owner`)
        }

        return { success: true, clientSlug }
    } catch (error) {
        console.error('Config build error:', error)
        return { success: false, error: humanizeError(error) }
    }
}

// ============================================
// HELPER: Check if user needs onboarding
// ============================================

export async function checkOnboardingStatus(): Promise<{
    needsOnboarding: boolean
    clientSlug?: string
}> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { needsOnboarding: false }

    // Super-admins never need onboarding — they see all clients
    const admins = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
    if (admins.includes(user.email || "")) {
        return { needsOnboarding: false }
    }

    // Check via user_clients join (RBAC-consistent)
    const { data: link } = await supabaseAdmin
        .from('user_clients')
        .select('client_id, clients!inner(slug)')
        .eq('user_id', user.id)
        .limit(1)
        .single()

    if (link) {
        return { needsOnboarding: false, clientSlug: (link.clients as any).slug }
    }

    // Fallback: check if any client exists at all (legacy data without user_clients link)
    const { data: anyClient } = await supabaseAdmin
        .from('clients')
        .select('slug')
        .eq('is_active', true)
        .limit(1)
        .single()

    if (anyClient) {
        // Legacy client exists but no user_clients link — auto-link as member
        const { data: clientRecord } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('slug', anyClient.slug)
            .single()

        if (clientRecord) {
            await supabaseAdmin
                .from('user_clients')
                .upsert({
                    user_id: user.id,
                    client_id: clientRecord.id,
                    role: 'member',
                }, { onConflict: 'user_id,client_id' })
            console.log(`✅ Auto-linked user ${user.email} to legacy client ${anyClient.slug}`)
        }

        return { needsOnboarding: false, clientSlug: anyClient.slug }
    }

    return { needsOnboarding: true }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

async function fetchPage(url: string): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
        const resp = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return await resp.text()
    } finally {
        clearTimeout(timeout)
    }
}

function extractMetadata(html: string): {
    title: string
    description: string
    ogImage: string | null
    themeColor: string | null
} {
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || ''
    const description = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1]
        || html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)?.[1]
        || ''
    const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] || null
    const themeColor = html.match(/<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/i)?.[1] || null
    return { title, description, ogImage, themeColor }
}

function extractText(html: string): string {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function extractSubpageUrls(html: string, baseUrl: string): string[] {
    const urls = new Set<string>()
    const linkRegex = /href="([^"]+)"/gi
    let match
    while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1]
        if (href.startsWith('/') && !href.startsWith('//') && href.length > 1) {
            const full = `${baseUrl}${href}`
            // Skip assets, anchors, etc.
            if (!href.match(/\.(js|css|png|jpg|svg|ico|webp|gif|pdf|xml|json)/i)
                && !href.includes('#')
                && !href.includes('?')
            ) {
                urls.add(full)
            }
        }
    }
    return Array.from(urls)
}

/**
 * Download brand/product images from website URLs → upload to Supabase storage.
 * Returns array of public URLs that can be used as characterReferenceImages.
 */
async function downloadProductImages(
    imageUrls: string[],
    clientSlug: string
): Promise<string[]> {
    if (!imageUrls.length) return []

    const uploadedUrls: string[] = []
    const bucketName = 'audit-screenshots' // shared bucket

    // Download up to 5 best images
    const candidates = imageUrls.slice(0, 8) // try 8, keep 5 max

    for (let i = 0; i < candidates.length && uploadedUrls.length < 5; i++) {
        const url = candidates[i]
        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 8000)

            const resp = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                },
            })
            clearTimeout(timeout)

            if (!resp.ok) continue

            const contentType = resp.headers.get('content-type') || 'image/jpeg'
            if (!contentType.startsWith('image/')) continue

            const buffer = Buffer.from(await resp.arrayBuffer())

            // Skip tiny images (icons, spacers) and huge images
            if (buffer.length < 5000 || buffer.length > 10_000_000) continue

            const ext = contentType.includes('png') ? 'png' : 'jpg'
            const filename = `client-assets/${clientSlug}/brand-${i}.${ext}`

            const { error: uploadError } = await supabaseAdmin.storage
                .from(bucketName)
                .upload(filename, buffer, {
                    contentType,
                    cacheControl: '31536000',
                    upsert: true,
                })

            if (uploadError) {
                console.warn(`   ⚠️ Upload failed for ${url.substring(0, 60)}:`, uploadError.message)
                continue
            }

            const { data: publicUrlData } = supabaseAdmin.storage
                .from(bucketName)
                .getPublicUrl(filename)

            uploadedUrls.push(publicUrlData.publicUrl)
            console.log(`   📸 Brand image ${uploadedUrls.length}: uploaded`)
        } catch (err) {
            // Skip failed downloads silently
            continue
        }
    }

    return uploadedUrls
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .substring(0, 30)
}

// ============================================
// BRAND ASSET FUNCTIONS
// ============================================

/**
 * Find the best logo URL from HTML.
 * Priority: apple-touch-icon > large favicon > <img> with "logo" > og:image
 */
function extractLogoUrl(html: string, baseUrl: string): string | null {
    const candidates: string[] = []

    // Apple touch icon (usually high-res)
    const appleTouchMatch = html.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/i)
    if (appleTouchMatch) candidates.push(appleTouchMatch[1])

    // Standard favicon PNG (not .ico)
    const faviconPngMatch = html.match(/<link[^>]+rel="icon"[^>]+type="image\/png"[^>]+href="([^"]+)"/i)
        || html.match(/<link[^>]+href="([^"]+)"[^>]+rel="icon"[^>]+type="image\/png"/i)
    if (faviconPngMatch) candidates.push(faviconPngMatch[1])

    // Any <img> tag with "logo" in src, alt, or class
    const logoImgRegex = /<img[^>]+(src="([^"]+)")[^>]*(logo|brand)[^>]*>/gi
    const logoImgRegex2 = /<img[^>]*(logo|brand)[^>]+(src="([^"]+)")[^>]*>/gi
    let logoMatch
    while ((logoMatch = logoImgRegex.exec(html)) !== null) {
        candidates.push(logoMatch[2])
    }
    while ((logoMatch = logoImgRegex2.exec(html)) !== null) {
        candidates.push(logoMatch[3])
    }

    // og:image as fallback
    const ogImageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
    if (ogImageMatch) candidates.push(ogImageMatch[1])

    // Normalize URLs
    for (const candidate of candidates) {
        if (!candidate || candidate.endsWith('.ico')) continue
        if (candidate.startsWith('http')) return candidate
        if (candidate.startsWith('//')) return `https:${candidate}`
        if (candidate.startsWith('/')) return `${baseUrl}${candidate}`
    }

    return null
}

/**
 * Download logo from URL and upload to Supabase storage.
 * Saved as client-assets/{slug}/logo.png in 'audit-screenshots' bucket.
 * Returns true if successful.
 */
async function downloadLogo(logoUrl: string, slug: string): Promise<boolean> {
    try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)

        const resp = await fetch(logoUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
        })
        clearTimeout(timeout)

        if (!resp.ok) return false

        const buffer = Buffer.from(await resp.arrayBuffer())
        if (buffer.length < 100) return false // Too small, probably not a real image

        // Upload to Supabase storage (filesystem is ephemeral on Vercel)
        const filename = `client-assets/${slug}/logo.png`
        const { error: uploadError } = await supabaseAdmin.storage
            .from('audit-screenshots')
            .upload(filename, buffer, {
                contentType: 'image/png',
                cacheControl: '31536000',
                upsert: true,
            })

        if (uploadError) {
            console.warn(`   ⚠️ Logo upload failed: ${uploadError.message}`)
            return false
        }

        console.log(`   ✅ Logo uploaded: ${buffer.length} bytes → ${filename}`)
        return true
    } catch (err) {
        console.warn('   ⚠️ Logo download failed:', (err as Error).message)
        return false
    }
}


/**
 * Extract brand/product images from HTML (hero images, product photos etc.)
 */
function extractBrandImages(html: string, baseUrl: string): string[] {
    const images = new Set<string>()

    // Find all img tags
    const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi
    let match
    while ((match = imgRegex.exec(html)) !== null) {
        const src = match[1]
        // Skip tiny icons, tracking pixels, etc.
        if (src.endsWith('.svg') || src.endsWith('.ico') || src.includes('pixel')
            || src.includes('tracking') || src.includes('data:image')
            || src.includes('placeholder') || src.length > 500
        ) continue

        let fullUrl = src
        if (src.startsWith('//')) fullUrl = `https:${src}`
        else if (src.startsWith('/')) fullUrl = `${baseUrl}${src}`
        else if (!src.startsWith('http')) continue

        images.add(fullUrl)
    }

    // Also grab background-image URLs from inline styles
    const bgRegex = /background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/gi
    while ((match = bgRegex.exec(html)) !== null) {
        const url = match[1]
        if (url.startsWith('http')) images.add(url)
        else if (url.startsWith('/')) images.add(`${baseUrl}${url}`)
    }

    return Array.from(images)
}

