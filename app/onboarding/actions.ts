'use server'

import { createClient } from '@/supabase/server'
import supabaseAdmin from '@/supabase/admin'
import { requireAuth, requireProjectAccess } from '@/lib/auth-guard'
import { withRetry } from '@/utils/retry'
import { generateText } from '@/instagram/gemini-client'
import { getModel } from '@/instagram/models'
import { ensurePostTypes } from '@/instagram/service'
import { generateCustomFormats, seedVoiceExamplesFromIG } from '@/app/onboarding/core'
import type { ClientConfig } from '@/instagram/configs/types'
import { fetchInstagramProfile, estimatePostsPerWeek, type IgProfileData } from '@/lib/ig-scraper'

// ============================================
// TYPES
// ============================================
// IgProfileData lives in lib/ig-scraper.ts ("use server" re-exports break the actions compiler)

export interface IgInsights {
    topHashtags: string[]
    avgEngagementRate: number
    contentMix: Record<string, number>
    brandToneHint: string
    visualStyleHint: string
    bestPostingTimes?: string[]
    /** Structured brand-voice observations from the real captions — basis for config brandVoice */
    voiceProfile?: {
        voiceTraits: string[]
        hookExamples: string[]
        captionStyle: string
        ctaHabits: string
    }
    /** 2–4 Czech observations of what demonstrably works — seeds 'pattern' brand memories */
    provenPatterns?: string[]
}

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
    /** Scraped Instagram profile data (via HikerAPI) */
    igProfile?: IgProfileData
    /** AI-analyzed insights from IG feed */
    igInsights?: IgInsights
    /** Gemini vision analysis of the actual feed images (typography, colors, archetypes) */
    feedVisuals?: import('@/instagram/feed-vision').FeedVisualProfile
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
    // Node.js wraps network errors: TypeError("fetch failed") with error.cause
    const cause = (error as any)?.cause
    const causeMsg = cause?.message || cause?.code || ''
    const msg = (error as Error)?.message || String(error)
    const full = `${msg} ${causeMsg}`.toLowerCase()

    if (full.includes('fetch failed') && (causeMsg.includes('ENOTFOUND') || causeMsg.includes('getaddrinfo') || causeMsg.includes('dns'))) {
        return 'Web nebyl nalezen. Zkontroluj, jestli je URL správná.'
    }
    if (full.includes('fetch failed') && causeMsg.includes('ECONNREFUSED')) {
        return 'Web odmítl připojení. Zkontroluj URL.'
    }
    if (full.includes('fetch failed')) {
        return `Nepodařilo se načíst web${causeMsg ? ': ' + causeMsg : ''}. Zkontroluj URL a zkus to znovu.`
    }
    if (full.includes('503') || full.includes('overloaded') || full.includes('unavailable') || full.includes('high demand')) {
        return 'AI server je momentálně přetížený. Zkus to za chvíli znovu.'
    }
    if (full.includes('429') || full.includes('rate limit') || full.includes('quota')) {
        return 'Překročen limit API požadavků. Zkus to za minutu.'
    }
    if (full.includes('timeout') || full.includes('abort') || full.includes('etimedout')) {
        return 'Připojení k webu vypršelo. Zkontroluj URL a zkus to znovu.'
    }
    if (full.includes('enotfound') || full.includes('dns') || full.includes('getaddrinfo')) {
        return 'Web nebyl nalezen. Zkontroluj, jestli je URL správná.'
    }
    if (full.includes('json')) {
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
async function insertClient(slug: string, config: ClientConfig): Promise<{ id: string; slug: string }> {
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
            // Slug collision — retry with suffix. MUST return the suffixed slug
            // so callers generate against the right client, not the colliding one.
            const newSlug = `${slug}-${Date.now().toString(36).slice(-4)}`
            config.id = newSlug
            const { data: retryData, error: retryError } = await supabaseAdmin
                .from('clients')
                .insert({ ...payload, slug: newSlug })
                .select('id')
                .single()
            if (retryError) throw retryError
            return { id: retryData!.id, slug: newSlug }
        }
        throw error
    }
    return { id: data!.id, slug }
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
        await requireAuth()
        // Normalize URL
        const baseUrl = url.startsWith('http') ? url : `https://${url}`

        // Scrape homepage
        console.log(`🔍 Scraping ${baseUrl}...`)
        const homepageHtml = await fetchPage(baseUrl)

        // Discover subpages: sitemap.xml first, then <a href> fallback
        const sitemapUrls = await fetchSitemapUrls(baseUrl)
        const linkUrls = extractSubpageUrls(homepageHtml, baseUrl)
        const allSubUrls = [...new Set([...sitemapUrls, ...linkUrls])].slice(0, 15)
        console.log(`   📄 Found ${sitemapUrls.length} sitemap + ${linkUrls.length} link URLs → ${allSubUrls.length} to crawl`)

        // Fetch subpages in parallel
        const subpageTextsArray = await Promise.all(allSubUrls.map(async (subUrl) => {
            try {
                const html = await fetchPage(subUrl)
                return extractStructuredText(html).substring(0, 1500)
            } catch { return "" }
        }))

        const subpageTexts = subpageTextsArray.filter(Boolean)

        // Extract metadata, structured text, and CSS colors from homepage
        const metadata = extractMetadata(homepageHtml)
        const mainText = extractStructuredText(homepageHtml)
        const cssColors = extractCSSColors(homepageHtml)

        // Send everything to AI for analysis — including VISUAL identity
        const analysisPrompt = `Analyzuj tuto webovou stránku a extrahuj klíčové informace pro Instagram marketing.

## HOMEPAGE METADATA
Title: ${metadata.title}
Description: ${metadata.description}
OG Image: ${metadata.ogImage || 'N/A'}
Theme Color: ${metadata.themeColor || 'N/A'}

## CSS BARVY DETEKOVANÉ Z WEBU
${cssColors.length > 0 ? cssColors.map(c => `- ${c}`).join('\n') : 'Žádné nalezeny'}

## HOMEPAGE TEXT (strukturovaný)
${mainText.substring(0, 5000)}

## DALŠÍ STRÁNKY (${allSubUrls.length})
${subpageTexts.map((t, i) => `### ${allSubUrls[i]}\n${t}`).join('\n\n')}

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
        analysis.logoUrl = metadata.ogImage || undefined

        // Enrich colors: if AI missed them but we have CSS colors, override
        if (cssColors.length > 0 && analysis.colors.primary === '#000000') {
            analysis.colors.primary = cssColors[0]
            if (cssColors[1]) analysis.colors.secondary = cssColors[1]
            if (cssColors[2]) analysis.colors.accent = cssColors[2]
        }

        // Extract dominant color from og:image as fallback
        if (metadata.ogImage && analysis.colors.primary === '#000000') {
            try {
                const dominantColor = await extractDominantColor(metadata.ogImage)
                if (dominantColor) analysis.colors.primary = dominantColor
            } catch { /* non-critical */ }
        }

        // Extract brand images from ALL scraped pages (homepage + subpages)
        const allImages = new Set<string>()
        for (const imgUrl of extractBrandImages(homepageHtml, baseUrl)) {
            allImages.add(imgUrl)
        }
        // Also extract from subpage HTML — fetch them for images too
        for (const subUrl of allSubUrls) {
            try {
                const subHtml = await fetchPage(subUrl)
                const subBase = new URL(subUrl).origin
                for (const imgUrl of extractBrandImages(subHtml, subBase)) {
                    allImages.add(imgUrl)
                }
            } catch { /* subpage fetch failed, skip */ }
        }
        analysis.brandImageUrls = Array.from(allImages).slice(0, 50)

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

        // Enrich with Instagram profile data if handle provided
        if (igHandle) {
            await enrichWithInstagram(analysis, igHandle)
        }

        return { success: true, analysis }
    } catch (error) {
        console.error('Website analysis error:', error)
        return { success: false, error: humanizeError(error) }
    }
}

/**
 * Shared IG enrichment: scrape profile, then in parallel analyze captions
 * (text insights + voice profile) and the actual feed images (vision).
 * Non-blocking — any failure leaves the analysis as-is.
 */
async function enrichWithInstagram(analysis: WebsiteAnalysis, igHandle: string): Promise<void> {
    try {
        const igData = await fetchInstagramProfile(igHandle)
        if (!igData) return
        analysis.igProfile = igData
        analysis.instagramBio = igData.biography

        const { analyzeFeedVisuals } = await import('@/instagram/feed-vision')
        const [igInsights, feedVisuals] = await Promise.all([
            analyzeInstagramFeed(igData),
            analyzeFeedVisuals(igData.recentPosts, analysis.companyName),
        ])
        if (igInsights) analysis.igInsights = igInsights
        if (feedVisuals) analysis.feedVisuals = feedVisuals
        console.log(`📸 IG enrichment: ${igData.followerCount} followers, ${igData.recentPosts.length} posts${feedVisuals ? ', vision ✓' : ''}`)
    } catch (igErr) {
        console.warn('⚠️ IG enrichment failed (non-blocking):', (igErr as Error).message)
    }
}

// ============================================
// STEP 1B: MANUAL ANALYSIS (no website)
// ============================================

export interface ManualBusinessInfo {
    businessName: string
    category: string
    description: string
    products: string
    tone: string
    igHandle: string
    // Enhanced fields (all optional)
    targetAudience?: string
    competitors?: string
    visualStyle?: string
    followerCount?: number
    topLocations?: string
    audienceGender?: 'mostly_female' | 'mostly_male' | 'mixed' | 'unknown'
}

const CATEGORY_DEFAULTS: Record<string, { industry: string; postTypes: string[]; audience: string }> = {
    'kavarna': { industry: 'Gastronomie / Kavárna', postTypes: ['tip', 'behind_scenes', 'product_drop', 'meme'], audience: 'Milovníci kávy, lidé hledající příjemné místo k práci nebo relaxaci, 20-45 let' },
    'restaurace': { industry: 'Gastronomie / Restaurace', postTypes: ['product_drop', 'behind_scenes', 'tip', 'recenze'], audience: 'Foodie komunita, páry na rande, rodiny, 25-55 let' },
    'salon': { industry: 'Krása / Salon', postTypes: ['before_after', 'tip', 'product_drop', 'behind_scenes'], audience: 'Ženy 18-50, muži 20-40, lidé dbající na svůj vzhled' },
    'fitness': { industry: 'Fitness / Wellness', postTypes: ['tip', 'challenge', 'behind_scenes', 'meme'], audience: 'Aktivní lidé 18-45, začátečníci i pokročilí sportovci' },
    'eshop': { industry: 'E-commerce', postTypes: ['product_drop', 'recenze', 'tip', 'carousel'], audience: 'Online nakupující, fanoušci značky, 20-45 let' },
    'remeslnik': { industry: 'Řemeslo / Služby', postTypes: ['before_after', 'tip', 'behind_scenes', 'recenze'], audience: 'Majitelé domů a bytů, lidé plánující rekonstrukci, 30-60 let' },
    'poradce': { industry: 'Poradenství / Koučink', postTypes: ['tip', 'carousel', 'meme', 'behind_scenes'], audience: 'Podnikatelé, manažeři, lidé hledající osobní rozvoj, 25-50 let' },
    'fotograf': { industry: 'Fotografie / Kreativa', postTypes: ['behind_scenes', 'tip', 'product_drop', 'carousel'], audience: 'Páry, rodiny, firmy hledající profesionální foto, 25-45 let' },
    'jine': { industry: 'Služby', postTypes: ['tip', 'behind_scenes', 'product_drop', 'meme'], audience: 'Lokální komunita, potenciální zákazníci v okolí' },
}

export async function buildManualAnalysis(info: ManualBusinessInfo): Promise<{
    success: boolean
    analysis?: WebsiteAnalysis
    error?: string
}> {
    try {
        await requireAuth()
        const categoryDefaults = CATEGORY_DEFAULTS[info.category] || CATEGORY_DEFAULTS['jine']

        // Parse products from free text (comma or newline separated)
        const productNames = info.products
            .split(/[,\n]+/)
            .map(p => p.trim())
            .filter(Boolean)
            .slice(0, 10)

        const products = productNames.map(name => ({
            name,
            type: 'product',
            slug: name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').substring(0, 30),
        }))

        // Build analysis from manual input + AI enrichment
        const extraContext = [
            info.targetAudience ? `CÍLOVÁ SKUPINA: ${info.targetAudience}` : '',
            info.competitors ? `INSPIRACE / KONKURENCE (IG účty): ${info.competitors}` : '',
            info.visualStyle ? `PREFEROVANÝ VIZUÁLNÍ STYL: ${info.visualStyle}` : '',
            info.followerCount ? `POČET FOLLOWERŮ: ${info.followerCount}` : '',
            info.topLocations ? `TOP LOKACE FOLLOWERŮ: ${info.topLocations}` : '',
            info.audienceGender ? `PUBLIKUM: ${({ mostly_female: 'Převážně ženy', mostly_male: 'Převážně muži', mixed: 'Mix', unknown: 'Neznámé' })[info.audienceGender]}` : '',
        ].filter(Boolean).join('\n')

        const enrichPrompt = `Na základě těchto informací o firmě vygeneruj doplňující data pro Instagram marketing.

FIRMA: ${info.businessName}
KATEGORIE: ${info.category}
POPIS: ${info.description}
PRODUKTY/SLUŽBY: ${info.products}
TÓN KOMUNIKACE: ${info.tone}
${extraContext ? `\n${extraContext}\n` : ''}
## PŘÍKLADY BAREV PODLE ODVĚTVÍ (inspiruj se, ale přizpůsob):
- Restaurace/café: teplé tóny (burgundy #722F37, golden #C9A96E, olive #5C6B3C)
- Tech/SaaS: moderní (deep blue #1A237E, electric #00BCD4, slate #334155)
- Fashion/lifestyle: luxusní (nude #D4A574, rose #C77A8B, charcoal #2D2D2D)
- Wellness/beauty: jemné (sage #9CAF88, lavender #B39DDB, soft pink #F5C6D0)
- Sport/fitness: energické (crimson #DC2626, neon green #22C55E, midnight #0F172A)
- Služby/B2B: profesionální (navy #1E3A5F, steel #6B7280, amber #F59E0B)

## INSTRUKCE:
- USP: musí být SPECIFICKÉ a AKCIONOVATELNÉ — ne "kvalitní služby", ale "24h dodání do celé ČR" nebo "ruční výroba z českého dřeva"
- Barvy: SYTÉ, VÝRAZNÉ — musí vyniknout v Instagram feedu. Gradient: topColor=nejtmavší, bottomColor=nejsvětlejší
- Font: "BebasNeue" pro drzé/bold brandy, "Inter" pro elegantní/profesionální
- VisualFeel: konkrétní (ne "moderní a čistý", ale "tmavý industriální s neon akcenty")
- BrandTone: přesný popis (ne "přátelský", ale "drzý, hravý s dávkou sarkasmu")
${info.visualStyle ? `- VIZUÁLNÍ STYL: klient preferuje "${info.visualStyle}" — přizpůsob barvy, gradient i visualFeel tomuto stylu` : ''}
${info.competitors ? `- INSPIRACE: podívej se na styl účtů ${info.competitors} a přizpůsob brandTone a visualFeel` : ''}

Vrať JSON:
{
  "uniqueSellingPoints": ["... (3-5 USP — specifické, ne generické)"],
  "recommendedFont": "Inter" nebo "BebasNeue",
  "overlayGradient": {"topColor": "#hex tmavý", "midColor": "#hex střední", "bottomColor": "#hex světlejší"},
  "visualFeel": "1 věta popisující vizuální styl feed — buď konkrétní",
  "colors": {"primary": "#hex", "secondary": "#hex", "accent": "#hex"},
  "brandTone": "2-3 slova přesně popisující tón"
}

Vrať POUZE platný JSON.`

        const enrichSchema = {
            type: "object",
            properties: {
                uniqueSellingPoints: { type: "array", items: { type: "string" } },
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
                colors: {
                    type: "object",
                    properties: {
                        primary: { type: "string" },
                        secondary: { type: "string" },
                        accent: { type: "string" },
                    },
                    required: ["primary", "secondary", "accent"],
                },
                brandTone: { type: "string" },
            },
            required: ["uniqueSellingPoints", "recommendedFont", "overlayGradient", "visualFeel", "colors", "brandTone"],
        }

        const rawEnrich = await generateText(enrichPrompt, { responseSchema: enrichSchema })
        const jsonMatch = rawEnrich.match(/\{[\s\S]*\}/)
        const enriched = JSON.parse(jsonMatch?.[0] || rawEnrich)

        const analysis: WebsiteAnalysis = {
            companyName: info.businessName,
            description: info.description,
            industry: categoryDefaults.industry,
            products,
            brandTone: enriched.brandTone || info.tone,
            colors: enriched.colors,
            targetAudience: info.targetAudience || categoryDefaults.audience,
            uniqueSellingPoints: enriched.uniqueSellingPoints,
            existingContent: [],
            recommendedFont: enriched.recommendedFont,
            overlayGradient: enriched.overlayGradient,
            visualFeel: enriched.visualFeel,
        }

        // Enrich with Instagram profile data if handle provided
        if (info.igHandle) {
            await enrichWithInstagram(analysis, info.igHandle)
            // Enrich brand tone if IG analysis gives a hint
            if (analysis.igInsights?.brandToneHint && analysis.brandTone === info.tone) {
                analysis.brandTone = analysis.igInsights.brandToneHint
            }
        }

        return { success: true, analysis }
    } catch (error) {
        console.error('Manual analysis error:', error)
        return { success: false, error: humanizeError(error) }
    }
}

// ============================================
// INSTAGRAM PROFILE SCRAPING (HikerAPI)
// ============================================
// fetchInstagramProfile moved to lib/ig-scraper.ts (shared with growth cron)

async function analyzeInstagramFeed(igData: IgProfileData): Promise<IgInsights | null> {
    if (igData.recentPosts.length === 0) return null

    const postsContext = igData.recentPosts.map((p, i) => {
        const caption = p.caption.slice(0, 300)
        return `Post ${i + 1}: [${p.mediaType}] ❤️${p.likeCount} 💬${p.commentCount} | "${caption}"`
    }).join('\n')

    const prompt = `Analyzuj Instagram profil a jeho posty. Extrahuj insights pro nastavení autopilota.

## PROFIL
Username: @${igData.username}
Bio: ${igData.biography}
Followers: ${igData.followerCount} | Following: ${igData.followingCount} | Posts: ${igData.mediaCount}
Business: ${igData.isBusinessAccount ? `Ano (${igData.businessCategory || 'bez kategorie'})` : 'Ne'}

## POSLEDNÍCH ${igData.recentPosts.length} PŘÍSPĚVKŮ
${postsContext}

## ÚKOL
Vrať JSON s těmito poli:
- topHashtags: pole 10-15 nejpoužívanějších hashtagů z captionů (bez #)
- avgEngagementRate: průměrný engagement rate (likes+comments / followers), číslo 0-1
- contentMix: objekt s poměrem typů obsahu, např. {"produkt": 0.4, "behind_scenes": 0.2, "edukace": 0.3, "lifestyle": 0.1}
- brandToneHint: 1-2 slova popisující detekovaný tón komunikace (česky)
- visualStyleHint: 1 věta popisující vizuální styl feedu (česky)
- bestPostingTimes: pole 2-3 optimálních časů pro posting (odhad z timestamps), formát "Po 18:00"
- voiceProfile: objekt popisující, JAK značka v captionech skutečně mluví:
  - voiceTraits: 3-5 pozorovaných charakteristik hlasu (česky, např. "hravý", "tyká followerům")
  - hookExamples: 2-4 skutečné první věty z postů s NEJVYŠŠÍM engagementem (zkrať na max 60 znaků)
  - captionStyle: 1-2 věty o stylu captionů — délka, emoji, formátování, oslovení (česky)
  - ctaHabits: 1 věta o tom, jaké CTA reálně používají (česky)
- provenPatterns: 2-4 pozorování co PROKAZATELNĚ funguje (z porovnání engagement vysoký vs. nízký), česky, každé max 1 věta

Vrať POUZE platný JSON.`

    try {
        const raw = await generateText(prompt)
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) return null
        return JSON.parse(jsonMatch[0]) as IgInsights
    } catch (err) {
        console.warn('⚠️ analyzeInstagramFeed error:', (err as Error).message)
        return null
    }
}

// ============================================
// IMAGE BRIEF (SHOT LIST) GENERATOR
// ============================================

import type { ImageBriefItem } from '@/instagram/configs/types'

export async function generateImageBrief(
    config: ClientConfig
): Promise<{ success: boolean; brief?: ImageBriefItem[]; error?: string }> {
    try {
        await requireAuth()
        const productNames = (config.products || []).map(p => p.name).join(', ')
        const pillarKeys = Object.keys(config.contentPillars || {})
        const hasBehindScenes = pillarKeys.includes('behind_scenes') || pillarKeys.includes('backstage')
        const hasProducts = (config.products?.length || 0) > 0

        const prompt = `Jsi expert na Instagram marketing. Na základě konfigurace značky vygeneruj SHOT LIST — konkrétní seznam fotek, které by klient měl dodat pro nejlepší výsledky.

## ZNAČKA
Název: ${config.name}
Odvětví: ${config.industry || 'neznámé'}
Web: ${config.website}
${hasProducts ? `Produkty: ${productNames}` : ''}
Content pillars: ${pillarKeys.join(', ')}
Vizuální styl: ${config.feedAesthetic?.feel || 'moderní'}

## PRAVIDLA
- Každá kategorie má 2-5 konkrétních položek
- Položky musí být SPECIFICKÉ pro tuto značku (ne generické "fotka produktu")
- Pokud má produkty, pojmenuj je konkrétně
- Přidej tip na světlo/kompozici kde to dává smysl
- Priority: "must" pro essentials, "nice" pro bonus
- Max 4-5 kategorií

Vrať JSON pole:
[
  {
    "category": "Produkty",
    "emoji": "☕",
    "count": "3-5 fotek",
    "priority": "must",
    "items": ["Espresso v šálku na dřevěném stole, přirozené světlo", "..."]
  }
]

Vrať POUZE platný JSON pole.`

        const briefSchema = {
            type: "array",
            items: {
                type: "object",
                properties: {
                    category: { type: "string" },
                    emoji: { type: "string" },
                    count: { type: "string" },
                    priority: { type: "string", enum: ["must", "nice"] },
                    items: { type: "array", items: { type: "string" } },
                },
                required: ["category", "emoji", "count", "priority", "items"],
            },
        }

        const raw = await generateText(prompt, { responseSchema: briefSchema })
        const jsonMatch = raw.match(/\[[\s\S]*\]/)
        const brief: ImageBriefItem[] = JSON.parse(jsonMatch?.[0] || raw)

        return { success: true, brief }
    } catch (error) {
        console.error('generateImageBrief error:', error)
        return { success: false, error: (error as Error).message }
    }
}

export async function generateQuestions(_analysis: WebsiteAnalysis): Promise<{
    success: boolean
    questions?: OnboardingQuestion[]
    error?: string
}> {
    await requireAuth()
    // Fixed questions — each maps directly to a ClientConfig field.
    // No AI call needed, instant response.
    const questions: OnboardingQuestion[] = [
        {
            id: 'ig_goal',
            question: 'Co je tvůj hlavní cíl na Instagramu?',
            type: 'select',
            options: [
                'Získat nové zákazníky',
                'Budovat komunitu a důvěru',
                'Prodávat produkty / služby',
                'Zvýšit povědomí o značce',
            ],
            required: true,
        },
        {
            id: 'ig_tone',
            question: 'Jakým tónem chceš na Instagramu komunikovat?',
            type: 'select',
            options: [
                'Přátelský a hravý',
                'Profesionální a expertní',
                'Drzý a vtipný',
                'Inspirativní a motivační',
                'Luxusní a minimalistický',
            ],
            required: true,
        },
        {
            id: 'ig_taboo',
            question: 'Jsou témata, kterým se chceš vyhnout?',
            type: 'text',
            placeholder: 'např. politika, konkurence, slevy, vulgarita...',
            required: false,
        },
        {
            id: 'ig_cta',
            question: 'Co chceš, aby lidé udělali po přečtení postu?',
            type: 'multiselect',
            options: [
                'Navštívit web / e-shop',
                'Napsat DM nebo komentář',
                'Uložit si post na později',
                'Sdílet s přáteli',
                'Koupit produkt / objednat službu',
            ],
            required: true,
        },
        {
            id: 'ig_visual',
            question: 'Jaký vizuální styl feedu ti sedí?',
            type: 'select',
            options: [
                'Čistý a minimalistický',
                'Barevný a energický',
                'Tmavý a dramatický',
                'Teplý a útulný',
                'Luxusní a elegantní',
            ],
            required: false,
        },
    ]

    return { success: true, questions }
}


// ============================================
// STEP 3A: GENERATE CONFIG PREVIEW (no save)
// ============================================

export type ReviewSection = 'brand_voice' | 'pillars' | 'products' | 'visual' | 'hooks_cta'

export async function generateConfigPreview(
    analysis: WebsiteAnalysis,
    answers: Record<string, string | string[]>,
    websiteUrl: string,
    igHandle: string
): Promise<{ success: boolean; config?: ClientConfig; error?: string }> {
    try {
        await requireAuth()
        // Build the config via AI
        const igContext = analysis.igProfile ? `
## INSTAGRAM DATA (${analysis.igProfile.followerCount} followers)
Bio: ${analysis.igProfile.biography}
Business category: ${analysis.igProfile.businessCategory || 'N/A'}
Median posts: ${analysis.igProfile.mediaCount}
${analysis.igInsights ? `
### AI ANALÝZA IG FEEDU
Top hashtags: ${analysis.igInsights.topHashtags.slice(0, 15).join(', ')}
Engagement rate: ${(analysis.igInsights.avgEngagementRate * 100).toFixed(2)}%
Content mix: ${JSON.stringify(analysis.igInsights.contentMix)}
Brand tone hint: ${analysis.igInsights.brandToneHint}
Visual style hint: ${analysis.igInsights.visualStyleHint}
${analysis.igInsights.bestPostingTimes ? `Best times: ${analysis.igInsights.bestPostingTimes.join(', ')}` : ''}
${analysis.igInsights.voiceProfile ? `
### HLAS ZNAČKY POZOROVANÝ NA REÁLNÉM FEEDU — brandVoice na něm MUSÍ stavět!
Pozorované charakteristiky hlasu: ${analysis.igInsights.voiceProfile.voiceTraits.join(', ')}
Skutečné hooky z nejvýkonnějších postů (inspirace pro hookTemplates): ${analysis.igInsights.voiceProfile.hookExamples.map(h => `"${h}"`).join(' | ')}
Styl captionů: ${analysis.igInsights.voiceProfile.captionStyle}
CTA návyky: ${analysis.igInsights.voiceProfile.ctaHabits}
Web dodává oficiální tón značky; toto je, jak značka na IG SKUTEČNĚ mluví — voiceTraits, persona a ctaVariations z toho musí vycházet.` : ''}
${analysis.igInsights.provenPatterns?.length ? `Prokazatelně funguje: ${analysis.igInsights.provenPatterns.join(' | ')}` : ''}
` : ''}
${analysis.feedVisuals ? `
### VIZUÁLNÍ ANALÝZA REÁLNÉHO FEEDU (Gemini vision nad skutečnými obrázky postů)
Vizuální styl: ${analysis.feedVisuals.visualStyleSummary}
Typografie na feedu: ${analysis.feedVisuals.typographyStyle}
${analysis.feedVisuals.accentColorHex ? `Pozorovaná akcentová barva: ${analysis.feedVisuals.accentColorHex}` : ''}
${analysis.feedVisuals.dominantArchetypes.length ? `Používané layout archetypy: ${analysis.feedVisuals.dominantArchetypes.join(', ')}` : ''}
Co vizuálně funguje: ${analysis.feedVisuals.visualStrengths.join(' | ')}
Doporučení: ${analysis.feedVisuals.visualRecommendations.join(' | ')}` : ''}
` : ''

        const configPrompt = `Vytvořme kompletní Instagram autopilot konfiguraci pro firmu "${analysis.companyName}".

## ANALÝZA WEBU
${JSON.stringify(analysis, null, 2)}

## ODPOVĚDI Z DOTAZNÍKU
${JSON.stringify(answers, null, 2)}

## WEBSITE & IG
Web: ${websiteUrl}
Instagram: ${igHandle}
${igContext}

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
    "reach": {"emoji": "🎯", "label": "Dosah", "description": "...", "postTypes": [...], "ratio": 0.3, "ctaStrategy": "soft", "kpi": ["reach", "impressions"], "categories": [
      {"id": "slug_id", "emoji": "🎭", "label": "Lidský název", "prompt": "1 věta AI hint co generovat"}
    ]},
    "engagement": {"emoji": "💬", "label": "Engagement", "description": "...", "postTypes": [...], "ratio": 0.35, "ctaStrategy": "medium", "kpi": ["likes", "comments"], "categories": [...]},
    "sales": {"emoji": "🛒", "label": "Prodej", "description": "...", "postTypes": [...], "ratio": 0.20, "ctaStrategy": "hard", "kpi": ["clicks", "conversions"], "categories": [...]},
    "community": {"emoji": "🤝", "label": "Komunita", "description": "...", "postTypes": [...], "ratio": 0.15, "ctaStrategy": "none", "kpi": ["saves", "shares"], "categories": [...]}
  },

### PRAVIDLA PRO CATEGORIES:
- Každý pilíř MUSÍ mít 3-5 kategorií (sub-categories = tematické úhly v rámci pilíře)
- Kategorie id MUSÍ být URL-safe slug (lowercase, jen a-z0-9_-)
- Příklady kategorií podle industry:
  - E-shop: tip, recenze, soutez, behind_scenes, unboxing, styling, trending
  - Hotel/penzion: tipy_na_vylet, recenze_hostu, sezona, gastronomie, behind_scenes, zajimavosti
  - Restaurace/kavárna: menu_highlight, recept, behind_scenes, sezona, event
  - Fitness: cviceni, motivace, vyziva, challenge, vysledky
  - Služby/řemeslo: pred_po, tip, faq, proces, reference
  - Poradenství: tip, case_study, myt_vs_realita, statistika, qa
- prompt field = 1 věta co AI generuje pro tuto kategorii (česky)
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
     "feel": "... (popis vizuálního pocitu)",
     "accentColor": "... (#hex akcentová barva značky)",
     "typographyStyle": "... (typografický styl pro nativní design engine, anglicky, např. 'bold condensed grotesque, uppercase')",
     "logoPlacement": "auto"
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

        // Brand DNA (voice + pillars) is the foundation every post inherits — generate it on the
        // Pro tier (fallback is a second Pro, never flash). Onboarding is one-time, so the latency
        // is acceptable. The cheap/structural calls (analysis, formats, style) stay on flash.
        const rawConfig = await generateText(configPrompt, { temperature: 0.7, model: getModel("textPro"), fallbackModel: getModel("textPro", "fallback") })
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
        // Native-engine fields: scraped accent color + feed vision results beat AI guesses
        if (config.feedAesthetic) {
            const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
            const webAccent = analysis.colors?.accent?.trim()
            const accentColor = (webAccent && HEX_RE.test(webAccent) ? webAccent : undefined)
                ?? analysis.feedVisuals?.accentColorHex
            if (accentColor) config.feedAesthetic.accentColor = accentColor

            if (analysis.feedVisuals) {
                config.feedAesthetic.typographyStyle = analysis.feedVisuals.typographyStyle
                config.feedAesthetic.logoPlacement = analysis.feedVisuals.logoPlacementHabit ?? 'auto'
                const visualNotes = [
                    analysis.feedVisuals.visualStyleSummary,
                    analysis.feedVisuals.visualRecommendations.length
                        ? `Vizuální doporučení z analýzy původního feedu: ${analysis.feedVisuals.visualRecommendations.join('; ')}`
                        : '',
                ].filter(Boolean).join('\n')
                config.feedAesthetic.customInstructions = [config.feedAesthetic.customInstructions, visualNotes]
                    .filter(Boolean).join('\n')
            }
        }
        // Grid rhythm, derived from what the brand's real feed already does. Deterministic —
        // a photography-led feed gets "none" rather than having typography posts forced on it.
        // NOTE: intentionally NOT mirrored in core.ts's generateConfigCore, unlike the rest of
        // the config-gen twin: feedVisuals only exists on this (UI) path, which scrapes the
        // client's Instagram. The scripts path has no feed to read, and validateConfig's
        // "none" default covers it. The user can pick a pattern in Settings either way.
        if (analysis.feedVisuals) {
            const { recommendPattern } = await import('@/lib/feed-pattern')
            config.feedPattern = recommendPattern(analysis.feedVisuals)
            console.log(`🔲 Feed pattern doporučen: ${config.feedPattern}`)
        }
        // Persist the scrape snapshot — cold-start baseline for planWeek & performance context
        if (analysis.igProfile && analysis.igInsights) {
            config.igBaseline = {
                followerCount: analysis.igProfile.followerCount,
                avgEngagementRate: analysis.igInsights.avgEngagementRate,
                topHashtags: analysis.igInsights.topHashtags.slice(0, 15),
                contentMix: analysis.igInsights.contentMix,
                bestPostingTimes: analysis.igInsights.bestPostingTimes,
                scrapedAt: new Date().toISOString(),
            }
            // Seed real posting cadence from the scrape so the content plan matches how often the
            // brand actually posts (a "week" = this many posts, not 7). Falls back to 4 when the
            // recent posts don't carry enough dated signal. validateConfig clamps it 1–7.
            const perWeek = estimatePostsPerWeek(analysis.igProfile.recentPosts.map(p => p.timestamp))
            if (perWeek) config.postsPerWeek = perWeek
        }
        // Voice anchor: seed few-shot "this is how we sound" examples from the brand's own
        // top posts — the cold-start source for post-to-post voice consistency.
        if (analysis.igProfile?.recentPosts?.length) {
            seedVoiceExamplesFromIG(config, analysis.igProfile.recentPosts)
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
            try {
                const { tagBrandImages } = await import('@/instagram/brand-tagger')
                const imagesToTag: { url: string; buffer: Buffer; mimeType?: string }[] = []
                for (const url of imageUrls) {
                    try {
                        const resp = await fetch(url)
                        if (resp.ok) {
                            const buf = Buffer.from(await resp.arrayBuffer())
                            const ct = resp.headers.get('content-type') || 'image/jpeg'
                            imagesToTag.push({ url, buffer: buf, mimeType: ct })
                        }
                    } catch { /* skip failed fetches */ }
                }
                if (imagesToTag.length > 0) {
                    const tagged = await tagBrandImages(imagesToTag, analysis.companyName)
                    config.brandReferenceImages = tagged
                } else {
                    config.brandReferenceImages = imageUrls
                }
            } catch (tagErr) {
                console.warn(`⚠️ Tagging failed: ${(tagErr as Error).message}`)
                config.brandReferenceImages = imageUrls
            }
        }

        // Generate audience personas
        try {
            const personaPrompt = `Pro firmu "${analysis.companyName}" (${analysis.industry}) vygeneruj 3 audience persony.

Popis firmy: ${analysis.description}
Cílová skupina: ${analysis.targetAudience || 'obecná'}

Vrať JSON pole s 3 objekty:
[
  {
    "label": "krátký název persony (česky, 1-2 slova)",
    "ageRange": "XX-XX",
    "painPoints": ["3 konkrétní problémy/potřeby"],
    "triggers": ["3 typy obsahu co na ně fungují"],
    "ctaStyle": "soft" | "medium" | "hard"
  }
]

Pravidla:
- Persona 1: Nový zákazník (soft CTA — budování důvěry)
- Persona 2: Zvažující zákazník (medium CTA — motivace k akci)
- Persona 3: Připravený kupovat (hard CTA — přímý prodej)
- Pain points a triggers MUSÍ být specifické pro ${analysis.industry}
- Vrať POUZE platný JSON pole.`

            const rawPersonas = await generateText(personaPrompt, { temperature: 0.8, model: getModel("textPro"), fallbackModel: getModel("textPro", "fallback") })
            const personaMatch = rawPersonas.match(/\[[\s\S]*\]/)
            if (personaMatch) {
                config.audiencePersonas = JSON.parse(personaMatch[0])
            }
        } catch (personaErr) {
            console.warn(`⚠️ Persona generation failed: ${(personaErr as Error).message}`)
        }

        // Recommend a communication style tailored to THIS specific client (best-effort,
        // optional). Shown at the end of onboarding (review step) and saved into the config.
        // NOTE: kept in sync with the twin in app/onboarding/core.ts (generateConfigCore).
        try {
            const stylePrompt = `Jsi stratég značky. Pro tuhle KONKRÉTNÍ firmu navrhni doporučený styl komunikace na Instagramu — ne obecné rady, ale to, co dává smysl právě pro tenhle případ.

Firma: ${analysis.companyName} (${analysis.industry})
Popis: ${analysis.description}
Cílová skupina: ${analysis.targetAudience || 'obecná'}
Hlas značky (persona): ${config.brandVoice?.persona || '—'}
Tón: ${(config.brandVoice?.voiceTraits || []).join(', ') || '—'}

Vrať POUZE platný JSON objekt:
{
  "headline": "krátký název stylu, 3-6 slov česky (např. 'Přátelský expert s lidským tónem')",
  "rationale": "2-3 věty PROČ tenhle styl sedí právě téhle firmě a jejím zákazníkům",
  "dos": ["3-4 konkrétní věci, které dělat (specifické pro tenhle obor a publikum)"],
  "donts": ["3-4 konkrétní věci, kterým se vyhnout"]
}

Pravidla: buď konkrétní, ne generický. Žádné prázdné fráze typu 'buďte autentičtí'. Mluv přímo k téhle firmě.`

            const rawStyle = await generateText(stylePrompt, { temperature: 0.7 })
            const styleMatch = rawStyle.match(/\{[\s\S]*\}/)
            if (styleMatch) {
                config.communicationStyle = JSON.parse(styleMatch[0])
            }
        } catch (styleErr) {
            console.warn(`⚠️ Communication style generation failed: ${(styleErr as Error).message}`)
        }

        // Brand-specific post formats (best-effort) — shared with the core twin.
        await generateCustomFormats(analysis, config)

        return { success: true, config }
    } catch (error) {
        console.error('Config preview error:', error)
        return { success: false, error: humanizeError(error) }
    }
}

// ============================================
// STEP 3B: REFINE ONE SECTION (based on user feedback)
// ============================================

const SECTION_LABELS: Record<ReviewSection, string> = {
    brand_voice: 'Brand Voice (persona, traits, anti-patterns)',
    pillars: 'Content Pilíře a Kategorie',
    products: 'Produkty a služby',
    visual: 'Vizuální identita (gradient, font, feed aesthetic)',
    hooks_cta: 'Hook templates a CTA strategie',
}

export async function refineConfigSection(
    config: ClientConfig,
    section: ReviewSection,
    feedback: string,
    analysis: WebsiteAnalysis
): Promise<{ success: boolean; config?: ClientConfig; error?: string }> {
    try {
        await requireAuth()
        const sectionData = extractSectionData(config, section)
        const prompt = `Uživatel kontroluje konfiguraci Instagram autopilota pro "${config.name}" (${analysis.industry}).

## SEKCE K PŘEPRACOVÁNÍ: ${SECTION_LABELS[section]}

## AKTUÁLNÍ DATA
${JSON.stringify(sectionData, null, 2)}

## FEEDBACK OD UŽIVATELE
"${feedback}"

## KONTEXT FIRMY
Název: ${config.name}
Web: ${config.website}
Obor: ${analysis.industry}
Popis: ${analysis.description}
Brand tón: ${analysis.brandTone}

## ÚKOL
Na základě feedbacku PŘEPRACUJ tuto sekci. Zachovej JSON strukturu, jen změň obsah podle feedbacku.
${section === 'brand_voice' ? `Vrať JSON objekt s klíči: persona, values, voiceTraits, antiPatterns, ctaVariations, toneByPostType.` : ''}
${section === 'pillars' ? `Vrať JSON objekt kde klíče jsou pillar IDs a hodnoty mají: emoji, label, description, postTypes, ratio, ctaStrategy, kpi, categories[]. Ratia musí dávat ~1.0. Každý pilíř MUSÍ mít 3-5 kategorií.` : ''}
${section === 'products' ? `Vrať JSON pole produktů s: name, type, slug, price, description.` : ''}
${section === 'visual' ? `Vrať JSON objekt s: feedAesthetic (colorPalette, overlayOpacity, textPosition, font, fontOverride, feel, accentColor), overlayGradient (topColor, midColor, bottomColor).` : ''}
${section === 'hooks_cta' ? `Vrať JSON objekt s: hookTemplates (pole s pattern, example, bestFor, trigger) a ctaStrategies (soft, medium, hard, none — každý pole stringů).` : ''}

Piš česky. Vrať POUZE platný JSON.`

        // User-triggered section refine — Pro tier (latency-tolerant, one section at a time).
        const raw = await generateText(prompt, { temperature: 0.7, model: getModel("textPro"), fallbackModel: getModel("textPro", "fallback") })
        const jsonMatch = raw.match(/[\[{][\s\S]*[\]}]/)
        if (!jsonMatch) throw new Error('AI nevrátilo platný JSON')

        const refined = JSON.parse(jsonMatch[0])
        const updated = applySectionData(config, section, refined)

        return { success: true, config: updated }
    } catch (error) {
        console.error(`Refine section ${section} error:`, error)
        return { success: false, error: humanizeError(error) }
    }
}

function extractSectionData(config: ClientConfig, section: ReviewSection): any {
    switch (section) {
        case 'brand_voice':
            return config.brandVoice || {}
        case 'pillars':
            return config.contentPillars || {}
        case 'products':
            return config.products || []
        case 'visual':
            return { feedAesthetic: config.feedAesthetic, overlayGradient: config.overlayGradient }
        case 'hooks_cta':
            return {
                hookTemplates: config.brandVoice?.hookTemplates || [],
                ctaStrategies: config.ctaStrategies || {},
            }
    }
}

function applySectionData(config: ClientConfig, section: ReviewSection, data: any): ClientConfig {
    const updated = { ...config }
    switch (section) {
        case 'brand_voice':
            updated.brandVoice = { ...(updated.brandVoice || {} as any), ...data }
            break
        case 'pillars':
            updated.contentPillars = data
            break
        case 'products':
            updated.products = Array.isArray(data) ? data : config.products
            break
        case 'visual':
            if (data.feedAesthetic) updated.feedAesthetic = { ...(updated.feedAesthetic || {} as any), ...data.feedAesthetic }
            if (data.overlayGradient) updated.overlayGradient = data.overlayGradient
            break
        case 'hooks_cta':
            if (data.hookTemplates && updated.brandVoice) {
                updated.brandVoice = { ...updated.brandVoice, hookTemplates: data.hookTemplates }
            }
            if (data.ctaStrategies) updated.ctaStrategies = data.ctaStrategies
            break
    }
    return updated
}

// ============================================
// STEP 3C: SAVE REVIEWED CONFIG
// ============================================

export async function saveReviewedConfig(
    config: ClientConfig,
    analysis: WebsiteAnalysis,
    existingClientSlug?: string,
): Promise<{ success: boolean; clientSlug?: string; error?: string }> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return { success: false, error: 'Nepřihlášený uživatel' }

        const clientSlug = existingClientSlug || config.id

        // ── RE-ONBOARDING: preserve slug-bound assets BEFORE anything derives from the
        // fresh config. generateConfigPreview recomputes id/storageBucket/logoFile from the
        // freshly re-scraped company name — a failed logo re-download or a name drift would
        // otherwise clobber the working logo pointer (logo gone from every future post) or
        // fork post uploads into a brand-new empty bucket while history stays in the old one.
        // Rule: prefer fresh data, never replace a real value with nothing.
        let existingClientId: string | null = null
        if (existingClientSlug) {
            const { resolveClientId } = await import('@/instagram/configs')
            existingClientId = await resolveClientId(existingClientSlug)
            const { data: existingRow } = await supabaseAdmin
                .from('clients')
                .select('config')
                .eq('id', existingClientId)
                .single()
            const prev = (existingRow?.config || {}) as Partial<ClientConfig>
            config.id = existingClientSlug
            config.storageBucket = prev.storageBucket || `ig-posts-${existingClientSlug}`
            if (!config.logoFile && prev.logoFile) config.logoFile = prev.logoFile
            if (config.postsPerWeek == null && prev.postsPerWeek != null) config.postsPerWeek = prev.postsPerWeek
            if (!config.igBaseline && prev.igBaseline) config.igBaseline = prev.igBaseline
            if (!(config.brandVoiceExamples?.length) && prev.brandVoiceExamples?.length) {
                config.brandVoiceExamples = prev.brandVoiceExamples
            }
            if (!(config.brandReferenceImages?.length) && prev.brandReferenceImages?.length) {
                config.brandReferenceImages = prev.brandReferenceImages
            }
        }

        // Ensure Storage Bucket
        const bucketName = config.storageBucket || `ig-posts-${config.id}`
        const { error: bucketError } = await supabaseAdmin.storage.createBucket(bucketName, {
            public: true,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
            fileSizeLimit: 10485760
        })
        if (bucketError && !bucketError.message.includes('already exists') && !bucketError.message.includes('Duplicate')) {
            console.warn(`⚠️ Failed to create bucket ${bucketName}:`, bucketError.message)
        }

        if (existingClientSlug) {
            // ── RE-ONBOARDING: Update existing client ──
            // (clientId already resolved by the asset-preservation block above)
            const clientId = existingClientId!

            const { error: updateError } = await supabaseAdmin
                .from('clients')
                .update({
                    config: config,
                    name: config.name,
                    website: config.website,
                })
                .eq('id', clientId)

            if (updateError) throw updateError

            // Sync products → ig_products (upsert — keep existing, add new)
            if (config.products && config.products.length > 0) {
                try {
                    for (const p of config.products) {
                        const { error: prodError } = await supabaseAdmin
                            .from('ig_products')
                            .upsert({
                                client_id: clientId,
                                name: p.name,
                                type: p.type || 'product',
                                slug: p.slug,
                                price: p.price || null,
                                description: p.description || null,
                            }, { onConflict: 'client_id,slug' })
                        if (prodError) console.warn(`⚠️ Product upsert failed for ${p.name}:`, prodError.message)
                    }
                } catch (prodErr) {
                    console.warn('⚠️ Product sync exception:', (prodErr as Error).message)
                }
            }

            await seedMemoriesFromAnalysis(clientId, analysis)
            await ensurePostTypes(config, clientId)

            console.log(`✅ Re-onboarding complete: ${existingClientSlug} (${clientId})`)
            // Invalidate config cache so Settings tab picks up new data
            const { invalidateConfigCache } = await import('@/instagram/configs')
            invalidateConfigCache(existingClientSlug)
            return { success: true, clientSlug: existingClientSlug }
        }

        // ── NEW CLIENT: Insert ──
        const { id: insertedClientId, slug: insertedSlug } = await insertClient(clientSlug, config)

        // RBAC link FIRST and FATALLY — user_clients membership is the ONLY ownership
        // signal. A client without it is unreachable forever: checkOnboardingStatus keeps
        // reporting "needs onboarding", and the user's retry then creates a DUPLICATE
        // tenant while the first stays an invisible orphan (bucket + trial leaked).
        // Retry once, then compensate by deleting the just-created bare client row
        // (ig_* FKs cascade; nothing else references it yet) so a clean retry can't collide.
        try {
            await withRetry(async () => {
                const { error: linkError } = await supabaseAdmin
                    .from('user_clients')
                    .insert({ user_id: user.id, client_id: insertedClientId, role: 'owner' })
                if (linkError) throw new Error(linkError.message)
            }, 1, 'user_clients link')
        } catch (linkErr) {
            console.error('🚨 user_clients link failed — rolling back client insert:', (linkErr as Error).message)
            await supabaseAdmin.from('clients').delete().eq('id', insertedClientId)
            return { success: false, error: 'Nepodařilo se propojit tvůj účet s novým profilem. Zkus uložení prosím znovu.' }
        }

        // Warm-start brand memory from the scraped feed (guarded — only when empty)
        await seedMemoriesFromAnalysis(insertedClientId, analysis)
        await ensurePostTypes(config, insertedClientId)

        // Sync products → ig_products. Slugs are AI-generated with NO cross-item
        // uniqueness guarantee and ig_products has UNIQUE(client_id, slug) — a single
        // collision in a bulk INSERT rolled back the WHOLE statement, leaving the client
        // with a full config.products but an EMPTY catalog (and only a console.warn).
        // Dedup within the batch, then upsert (resilient to pre-existing rows too).
        if (config.products && config.products.length > 0) {
            try {
                const seenSlugs = new Set<string>()
                const productRows = config.products.map((p: any) => {
                    const base = String(p.slug || 'produkt').substring(0, 36) || 'produkt'
                    let slug = base
                    for (let n = 2; seenSlugs.has(slug); n++) slug = `${base}-${n}`
                    seenSlugs.add(slug)
                    return {
                        client_id: insertedClientId,
                        name: p.name,
                        type: p.type || 'product',
                        slug,
                        price: p.price || null,
                        description: p.description || null,
                        image_urls: [],
                    }
                })
                const { error: prodError } = await supabaseAdmin
                    .from('ig_products')
                    .upsert(productRows, { onConflict: 'client_id,slug' })
                if (prodError) console.warn('⚠️ Product sync failed:', prodError.message)
            } catch (prodErr) {
                console.warn('⚠️ Product sync exception:', (prodErr as Error).message)
            }
        }

        // Create content-gated trial subscription (v2 — no time limit). Retried; a
        // persistent failure is NOT fatal — access fails safe to "no subscription"
        // (canPerformAction denies) and the user can activate a plan from billing.
        try {
            const { createTrialSubscription } = await import('@/lib/subscription')
            await withRetry(() => createTrialSubscription(insertedClientId), 1, 'trial subscription')
        } catch (trialErr) {
            console.error(`🚨 Trial creation failed for client ${insertedClientId} — user will see "no subscription" until a plan is activated:`, (trialErr as Error).message)
        }

        return { success: true, clientSlug: insertedSlug }
    } catch (error) {
        console.error('Save config error:', error)
        return { success: false, error: humanizeError(error) }
    }
}

/** Seed ig_brand_memory from onboarding observations — fire & forget, non-fatal */
async function seedMemoriesFromAnalysis(clientId: string, analysis: WebsiteAnalysis): Promise<void> {
    try {
        const seeds = [
            ...(analysis.feedVisuals?.visualStrengths || []).map(c => ({ type: 'visual' as const, content: c })),
            ...(analysis.igInsights?.provenPatterns || []).map(c => ({ type: 'pattern' as const, content: c })),
        ]
        if (seeds.length === 0) return
        const { seedOnboardingMemories } = await import('@/instagram/memory-agent')
        await seedOnboardingMemories(clientId, seeds)
    } catch (err) {
        console.warn('⚠️ Memory seeding failed (non-fatal):', (err as Error).message)
    }
}

// ============================================
// POST-SAVE BOOTSTRAP (durable showcase content)
// ============================================

/**
 * One-shot bootstrap after a NEW client is saved: the teaser plan + idea-bank seed run
 * inline (both fast), and the 3 showcase posts become a durable ig_campaigns row drained
 * by the server-side campaign worker (app/api/cron/campaign-worker). Previously all of
 * this ran sequentially in the BROWSER for ~3-5 minutes — closing the tab stranded the
 * client with an active trial and an empty dashboard, with no retry path anywhere. Now
 * the only browser-dependent window is this single short call; the heavy Pro generation
 * survives the tab, and the worker's "obsah je připraven" e-mail pulls the user back
 * even if they closed the tab. adminBypass mirrors the old generateShowcasePost
 * behaviour: showcase posts were never charged.
 */
export async function startOnboardingBootstrap(clientSlug: string): Promise<{
    success: boolean
    campaignId?: string
    error?: string
}> {
    try {
        const { clientId } = await requireProjectAccess(clientSlug)

        // 1) Teaser plan — 27 locked template rows, zero AI cost. Non-fatal.
        try {
            const { generateMonthlyPlan } = await import('@/app/actions/ig-generate-action')
            await generateMonthlyPlan({ configName: clientSlug, projectId: clientSlug })
        } catch (e) {
            console.warn('⚠️ Bootstrap: monthly teaser plan failed (non-fatal):', (e as Error).message)
        }

        // 2) Idea bank seed — BEFORE the showcase campaign so posts can draw from it. Non-fatal.
        try {
            const { seedIdeaBank } = await import('@/app/actions/ig-generate-action')
            await seedIdeaBank(clientSlug)
        } catch (e) {
            console.warn('⚠️ Bootstrap: idea bank seed failed (non-fatal):', (e as Error).message)
        }

        // 3) Durable showcase campaign — 3 auto posts. Empty plan items = the engine picks
        //    type/topic itself, exactly like the old generateOnePost({ configName }) loop.
        const { data: campaign, error } = await supabaseAdmin
            .from('ig_campaigns')
            .insert({
                client_id: clientId,
                status: 'pending',
                plan: [{}, {}, {}],
                options: { configName: clientSlug, adminBypass: true, showcase: true },
                total: 3,
            })
            .select('id')
            .single()
        if (error || !campaign) throw new Error(error?.message || 'Showcase campaign insert failed')

        console.log(`🚀 Onboarding bootstrap: showcase campaign ${campaign.id} queued for ${clientSlug}`)
        return { success: true, campaignId: campaign.id }
    } catch (error) {
        console.error('startOnboardingBootstrap error:', error)
        return { success: false, error: humanizeError(error) }
    }
}

// ============================================
// STEP 3 (LEGACY WRAPPER): BUILD AND SAVE CONFIG
// ============================================

export async function buildAndSaveConfig(
    analysis: WebsiteAnalysis,
    answers: Record<string, string | string[]>,
    websiteUrl: string,
    igHandle: string
): Promise<{ success: boolean; clientSlug?: string; error?: string }> {
    await requireAuth()
    const preview = await generateConfigPreview(analysis, answers, websiteUrl, igHandle)
    if (!preview.success || !preview.config) {
        return { success: false, error: preview.error || 'Config generation failed' }
    }
    return saveReviewedConfig(preview.config, analysis)
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

    // Membership is the ONLY ownership signal — `clients.user_id` is never
    // populated (onboarding links exclusively through user_clients, role owner).
    const { data: link } = await supabaseAdmin
        .from('user_clients')
        .select('client_id, clients!inner(slug)')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()

    if (link) {
        return { needsOnboarding: false, clientSlug: (link.clients as any).slug }
    }

    // No membership → brand-new user → onboarding.
    //
    // ⚠️ Do NOT "fall back" to the first active client here. That auto-linked
    // every new account to another tenant's brand (cross-tenant leak) and
    // skipped onboarding entirely. A missing link means onboarding, never a
    // default tenant — see CLAUDE.md "Never default a missing identifier to a
    // real tenant".
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

/**
 * Structured text extraction — preserves semantic meaning.
 * Returns text with headings marked, prices highlighted, lists preserved.
 */
function extractStructuredText(html: string): string {
    let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '') // skip navigation
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '') // skip footer

    // Preserve headings as markers
    text = text.replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, level, content) => {
        const clean = content.replace(/<[^>]+>/g, '').trim()
        return clean ? `\n[H${level}] ${clean}\n` : ''
    })

    // Preserve list items
    text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, (_, content) => {
        const clean = content.replace(/<[^>]+>/g, '').trim()
        return clean ? `• ${clean}\n` : ''
    })

    // Preserve prices (common Czech patterns)
    text = text.replace(/(\d[\d\s]*(?:Kč|CZK|,-|€|\$))/gi, ' [CENA: $1] ')

    // Strip remaining tags
    text = text
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim()

    return text
}

/**
 * Fetch sitemap.xml and extract page URLs.
 * Tries /sitemap.xml, /sitemap_index.xml, robots.txt Sitemap: directive.
 */
async function fetchSitemapUrls(baseUrl: string): Promise<string[]> {
    const urls = new Set<string>()
    const sitemapCandidates = [
        `${baseUrl}/sitemap.xml`,
        `${baseUrl}/sitemap_index.xml`,
    ]

    // Check robots.txt for Sitemap: directive
    try {
        const robotsTxt = await fetchPage(`${baseUrl}/robots.txt`)
        const sitemapMatches = robotsTxt.match(/Sitemap:\s*(\S+)/gi)
        if (sitemapMatches) {
            for (const m of sitemapMatches) {
                const url = m.replace(/Sitemap:\s*/i, '').trim()
                if (url.startsWith('http')) sitemapCandidates.unshift(url)
            }
        }
    } catch { /* no robots.txt */ }

    for (const sitemapUrl of sitemapCandidates) {
        try {
            const xml = await fetchPage(sitemapUrl)
            // Extract <loc> URLs
            const locRegex = /<loc>([^<]+)<\/loc>/gi
            let match
            while ((match = locRegex.exec(xml)) !== null) {
                const loc = match[1].trim()
                // Skip assets and non-page URLs
                if (!loc.match(/\.(jpg|png|gif|svg|pdf|xml|css|js)/i)) {
                    urls.add(loc)
                }
                // If it's a sub-sitemap, fetch it too
                if (loc.endsWith('.xml')) {
                    try {
                        const subXml = await fetchPage(loc)
                        const subLocRegex = /<loc>([^<]+)<\/loc>/gi
                        let subMatch
                        while ((subMatch = subLocRegex.exec(subXml)) !== null) {
                            const subLoc = subMatch[1].trim()
                            if (!subLoc.match(/\.(jpg|png|gif|svg|pdf|xml|css|js)/i)) {
                                urls.add(subLoc)
                            }
                        }
                    } catch { /* sub-sitemap fetch failed */ }
                }
            }
            if (urls.size > 0) break // found a working sitemap
        } catch { /* sitemap not found, try next */ }
    }

    // Prioritize content-rich pages
    const priorityKeywords = /galeri|pokoje|apart|rooms|suite|product|nabid|sluzb|služb|photo|foto|ubytov|akce|cenik|ceník|menu|about|o-nas|kontakt|blog/i
    return Array.from(urls)
        .sort((a, b) => {
            const aPriority = priorityKeywords.test(a) ? 0 : 1
            const bPriority = priorityKeywords.test(b) ? 0 : 1
            return aPriority - bPriority
        })
        .slice(0, 30)
}

function extractSubpageUrls(html: string, baseUrl: string): string[] {
    const urls = new Set<string>()
    const linkRegex = /href="([^"]+)"/gi
    let match
    while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1]
        if (href.startsWith('/') && !href.startsWith('//') && href.length > 1) {
            const full = `${baseUrl}${href}`
            if (!href.match(/\.(js|css|png|jpg|svg|ico|webp|gif|pdf|xml|json)/i)
                && !href.includes('#')
                && !href.includes('?')
            ) {
                urls.add(full)
            }
        }
    }
    const priorityKeywords = /galeri|pokoje|apart|rooms|suite|product|nabid|sluzb|služb|photo|foto|ubytov|akce|cenik|ceník|menu/i
    const sorted = Array.from(urls).sort((a, b) => {
        const aPriority = priorityKeywords.test(a) ? 0 : 1
        const bPriority = priorityKeywords.test(b) ? 0 : 1
        return aPriority - bPriority
    })
    return sorted
}

/**
 * Extract colors from CSS: theme-color meta, CSS custom properties, inline styles.
 * Returns array of unique hex colors found.
 */
function extractCSSColors(html: string): string[] {
    const colors = new Set<string>()

    // 1) theme-color meta tag
    const themeColorMatch = html.match(/<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/i)
    if (themeColorMatch) colors.add(themeColorMatch[1])

    // 2) CSS custom properties (--primary-color, --brand-color, etc.)
    const cssVarRegex = /--(?:primary|secondary|accent|brand|main|theme|color)[^:]*:\s*(#[0-9a-fA-F]{3,8})/gi
    let match2
    while ((match2 = cssVarRegex.exec(html)) !== null) {
        colors.add(match2[1])
    }

    // 3) Inline style colors (background-color, color, border-color)
    const inlineColorRegex = /(?:background-color|(?<!-)color|border-color):\s*(#[0-9a-fA-F]{3,8})/gi
    while ((match2 = inlineColorRegex.exec(html)) !== null) {
        const hex = match2[1]
        // Skip black, white, near-black, near-white (too generic)
        if (!['#000', '#000000', '#fff', '#ffffff', '#333', '#333333', '#666', '#999', '#ccc', '#eee', '#111', '#222'].includes(hex.toLowerCase())) {
            colors.add(hex)
        }
    }

    // 4) CSS gradient colors
    const gradientRegex = /linear-gradient\([^)]*?(#[0-9a-fA-F]{3,8})/gi
    while ((match2 = gradientRegex.exec(html)) !== null) {
        colors.add(match2[1])
    }

    return Array.from(colors).slice(0, 10)
}

/**
 * Extract dominant color from an image URL using sharp.
 * Returns hex color string or null.
 */
async function extractDominantColor(imageUrl: string): Promise<string | null> {
    try {
        const sharp = (await import('sharp')).default
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const resp = await fetch(imageUrl, { signal: controller.signal })
        clearTimeout(timeout)
        if (!resp.ok) return null

        const buffer = Buffer.from(await resp.arrayBuffer())
        const { dominant } = await sharp(buffer).resize(50, 50, { fit: 'cover' }).stats()
        const hex = `#${dominant.r.toString(16).padStart(2, '0')}${dominant.g.toString(16).padStart(2, '0')}${dominant.b.toString(16).padStart(2, '0')}`
        console.log(`   🎨 Dominant color from og:image: ${hex}`)
        return hex
    } catch {
        return null
    }
}

/**
 * Download brand/product images from website URLs → upload to Supabase storage.
 * Validates real image dimensions via sharp (skips icons < 300x300).
 * Returns array of public URLs stored as brand reference images.
 */
async function downloadProductImages(
    imageUrls: string[],
    clientSlug: string
): Promise<string[]> {
    if (!imageUrls.length) return []

    // Dynamic import sharp only when needed (avoids bundling issues)
    const sharp = (await import('sharp')).default

    const uploadedUrls: string[] = []
    const bucketName = 'audit-screenshots'
    const MAX_IMAGES = 30
    const candidates = imageUrls.slice(0, 50) // try 50, keep 30

    console.log(`   📷 Downloading brand images: ${candidates.length} candidates → max ${MAX_IMAGES}`)

    let uploadIndex = 0
    for (let i = 0; i < candidates.length && uploadedUrls.length < MAX_IMAGES; i++) {
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

            // Skip tiny (< 5KB) and huge (> 10MB)
            if (buffer.length < 5000 || buffer.length > 10_000_000) continue

            // Check real dimensions — skip icons, spacers, social badges
            try {
                const metadata = await sharp(buffer).metadata()
                const w = metadata.width || 0
                const h = metadata.height || 0
                if (w < 300 || h < 300) {
                    continue // too small — likely icon/badge
                }
            } catch {
                continue // can't parse = not a valid image
            }

            const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
            const filename = `client-assets/${clientSlug}/brand-${String(uploadIndex).padStart(2, '0')}.${ext}`

            const { error: uploadError } = await supabaseAdmin.storage
                .from(bucketName)
                .upload(filename, buffer, {
                    contentType,
                    cacheControl: '31536000',
                    upsert: true,
                })

            if (uploadError) {
                console.warn(`   ⚠️ Upload failed: ${uploadError.message}`)
                continue
            }

            const { data: publicUrlData } = supabaseAdmin.storage
                .from(bucketName)
                .getPublicUrl(filename)

            uploadedUrls.push(publicUrlData.publicUrl)
            uploadIndex++
            console.log(`   📸 Brand image ${uploadedUrls.length}/${MAX_IMAGES}: ${(buffer.length / 1024).toFixed(0)}KB`)
        } catch {
            continue
        }
    }

    console.log(`   ✅ ${uploadedUrls.length} brand images uploaded`)
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
 * Extract brand/product images from HTML (product photos, hero images, galleries).
 * Scrapes: <img src>, <img srcset>, <source srcset>, background-image CSS, og:image.
 */
function extractBrandImages(html: string, baseUrl: string): string[] {
    const images = new Set<string>()

    function addUrl(raw: string) {
        let url = raw.trim()
        if (!url || url.length > 500) return
        // Skip noise
        if (url.endsWith('.svg') || url.endsWith('.ico') || url.includes('data:image')
            || url.includes('pixel') || url.includes('tracking') || url.includes('placeholder')
            || url.includes('facebook.com') || url.includes('twitter.com') || url.includes('google')
            || url.includes('analytics') || url.includes('widget') || url.includes('gravatar')
            || url.includes('emoji') || url.includes('spinner') || url.includes('loading')
            || url.includes('avatar') || /\b(1x1|2x2|spacer)\b/i.test(url)
        ) return

        if (url.startsWith('//')) url = `https:${url}`
        else if (url.startsWith('/')) url = `${baseUrl}${url}`
        else if (!url.startsWith('http')) return

        images.add(url)
    }

    // 1) <img src="...">
    const imgSrcRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi
    let match
    while ((match = imgSrcRegex.exec(html)) !== null) {
        addUrl(match[1])
    }

    // 2) <img srcset="..."> and <source srcset="..."> — pick the largest
    const srcsetRegex = /(?:srcset|data-srcset)="([^"]+)"/gi
    while ((match = srcsetRegex.exec(html)) !== null) {
        const parts = match[1].split(',')
        // Pick the last (usually largest) descriptor
        const largest = parts[parts.length - 1]?.trim().split(/\s+/)[0]
        if (largest) addUrl(largest)
    }

    // 3) background-image: url(...)
    const bgRegex = /background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/gi
    while ((match = bgRegex.exec(html)) !== null) {
        addUrl(match[1])
    }

    // 4) <meta property="og:image"> and similar
    const metaImgRegex = /<meta[^>]+(?:property|name)="(?:og:image|twitter:image)"[^>]+content="([^"]+)"/gi
    while ((match = metaImgRegex.exec(html)) !== null) {
        addUrl(match[1])
    }

    // 5) data-src (lazy loaded images)
    const dataSrcRegex = /data-src="([^"]+)"/gi
    while ((match = dataSrcRegex.exec(html)) !== null) {
        addUrl(match[1])
    }

    return Array.from(images)
}

