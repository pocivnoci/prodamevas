/**
 * Onboarding CORE — auth-free building blocks
 * ===========================================
 * The pure logic behind the onboarding wizard, with NO auth/cookie/next-headers
 * dependencies, so it can run in a plain `tsx` process (seed scripts) as well as
 * inside the server actions.
 *
 * HARD RULE: never import `@/supabase/server`, `requireAuth`, or anything that
 * touches `next/headers` here — that would break headless execution. Only
 * `supabaseAdmin` (service role) + `generateText` + dynamic imports are allowed.
 *
 * This module MIRRORS the config-generation logic in the auth-gated server
 * actions (`./actions.ts`: buildManualAnalysis / generateConfigPreview /
 * saveReviewedConfig). The actions stay the single source of truth for the
 * onboarding UI; this is the headless twin used by seed scripts. If you change
 * a prompt or the config shape in one place, mirror it here. The `WebsiteAnalysis`
 * type is imported type-only from there (erased at runtime, so no `next/headers`
 * is pulled in).
 */

import supabaseAdmin from '@/supabase/admin'
import { generateText } from '@/instagram/gemini-client'
import { getModel } from '@/instagram/models'
import { ensurePostTypes } from '@/instagram/service'
import { withRetry } from '@/utils/retry'
import type { ClientConfig, PostTypeDef } from '@/instagram/configs/types'
import type { WebsiteAnalysis } from './actions'

// ============================================
// TYPES
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

export const CATEGORY_DEFAULTS: Record<string, { industry: string; postTypes: string[]; audience: string }> = {
    'kavarna': { industry: 'Gastronomie / Kavárna', postTypes: ['tip', 'behind_scenes', 'product_drop', 'meme'], audience: 'Milovníci kávy, lidé hledající příjemné místo k práci nebo relaxaci, 20-45 let' },
    'restaurace': { industry: 'Gastronomie / Restaurace', postTypes: ['product_drop', 'behind_scenes', 'tip', 'recenze'], audience: 'Foodie komunita, páry na rande, rodiny, 25-55 let' },
    'vinarstvi': { industry: 'Gastronomie / Vinařství', postTypes: ['product_drop', 'behind_scenes', 'tip', 'recenze'], audience: 'Milovníci vína, páry, dárci, gastro nadšenci, 28-60 let' },
    'salon': { industry: 'Krása / Salon', postTypes: ['before_after', 'tip', 'product_drop', 'behind_scenes'], audience: 'Ženy 18-50, muži 20-40, lidé dbající na svůj vzhled' },
    'fitness': { industry: 'Fitness / Wellness', postTypes: ['tip', 'challenge', 'behind_scenes', 'meme'], audience: 'Aktivní lidé 18-45, začátečníci i pokročilí sportovci' },
    'eshop': { industry: 'E-commerce', postTypes: ['product_drop', 'recenze', 'tip', 'carousel'], audience: 'Online nakupující, fanoušci značky, 20-45 let' },
    'remeslnik': { industry: 'Řemeslo / Služby', postTypes: ['before_after', 'tip', 'behind_scenes', 'recenze'], audience: 'Majitelé domů a bytů, lidé plánující rekonstrukci, 30-60 let' },
    'poradce': { industry: 'Poradenství / Koučink', postTypes: ['tip', 'carousel', 'meme', 'behind_scenes'], audience: 'Podnikatelé, manažeři, lidé hledající osobní rozvoj, 25-50 let' },
    'fotograf': { industry: 'Fotografie / Kreativa', postTypes: ['behind_scenes', 'tip', 'product_drop', 'carousel'], audience: 'Páry, rodiny, firmy hledající profesionální foto, 25-45 let' },
    'app': { industry: 'Aplikace / SaaS', postTypes: ['product_drop', 'tip', 'carousel', 'behind_scenes'], audience: 'Tech-savvy uživatelé, freelanceři, startupy a malé týmy, 22-45 let' },
    'jine': { industry: 'Služby', postTypes: ['tip', 'behind_scenes', 'product_drop', 'meme'], audience: 'Lokální komunita, potenciální zákazníci v okolí' },
}

// ============================================
// SMALL HELPERS
// ============================================

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .substring(0, 30)
}

/**
 * Insert a new client record and return its UUID.
 * Handles slug duplicates by appending a short suffix.
 */
export async function insertClient(slug: string, config: ClientConfig): Promise<{ id: string; slug: string }> {
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

/**
 * Download brand/product images from website URLs → upload to Supabase storage.
 * Validates real image dimensions via sharp (skips icons < 300x300).
 * Returns array of public URLs stored as brand reference images.
 */
export async function downloadProductImages(
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

/** Seed ig_brand_memory from onboarding observations — fire & forget, non-fatal */
export async function seedMemoriesFromAnalysis(clientId: string, analysis: WebsiteAnalysis): Promise<void> {
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

/**
 * Seed the brand-voice few-shot anchor (config.brandVoiceExamples) from the account's OWN
 * best posts scraped at onboarding. Real high-engagement captions are the truest "this is
 * how we sound" signal — the cold-start source for the voice-consistency anchor injected by
 * caption-generator's buildGoldExamplesSection. Top-N by engagement (comments weighted),
 * skipping trivially short captions. No-op if examples were already curated.
 */
export function seedVoiceExamplesFromIG(
    config: ClientConfig,
    recentPosts: { caption: string; likeCount: number; commentCount: number }[],
    max = 4,
): void {
    if (config.brandVoiceExamples && config.brandVoiceExamples.length > 0) return
    const ranked = (recentPosts || [])
        .filter(p => (p.caption?.trim().length || 0) >= 40)
        .map(p => ({ caption: p.caption.trim(), score: (p.likeCount || 0) + (p.commentCount || 0) * 3 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, max)
    if (ranked.length === 0) return
    config.brandVoiceExamples = ranked.map(r => ({
        caption: r.caption,
        note: 'reálný top-post značky (vysoký engagement)',
    }))
}

// ============================================
// STEP 1B: MANUAL ANALYSIS CORE (no website, no IG)
// ============================================

/**
 * Build a WebsiteAnalysis from a manual business brief + one AI enrichment call.
 * IG enrichment is intentionally NOT done here — the auth-gated wrapper in
 * actions.ts adds it when an IG handle is present.
 * Throws on failure (caller wraps in try/catch).
 */
export async function buildManualAnalysisCore(info: ManualBusinessInfo): Promise<WebsiteAnalysis> {
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
        slug: name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').substring(0, 30),
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

    return analysis
}

// ============================================
// STEP 3: GENERATE CONFIG CORE
// ============================================

/**
 * AI-generate a complete ClientConfig from an analysis. Auth-free.
 * Throws on failure (caller wraps in try/catch).
 */
export async function generateConfigCore(
    analysis: WebsiteAnalysis,
    answers: Record<string, string | string[]>,
    websiteUrl: string,
    igHandle: string
): Promise<ClientConfig> {
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

    // Voice anchor: seed few-shot examples from the brand's own best posts (few-shot beats
    // abstract trait lists for voice consistency). Non-fatal, skipped if no IG scrape.
    if (analysis.igProfile?.recentPosts?.length) {
        seedVoiceExamplesFromIG(config, analysis.igProfile.recentPosts)
    }

    // Generate brand-specific post formats (best-effort) — replaces the generic
    // "tip/meme/carousel" set with formats tailored to this brand, each described.
    await generateCustomFormats(analysis, config)

    return config
}

/**
 * Generate brand-specific post formats and apply them to the config in place.
 * Best-effort (never throws). Shared by both onboarding twins (core.ts UI-free
 * path AND actions.ts). Sets postTypeDefs/postTypes/postFormats/weekPlan and
 * re-maps contentPillars; ensurePostTypes() later persists them to ig_post_types.
 */
export async function generateCustomFormats(analysis: WebsiteAnalysis, config: ClientConfig): Promise<void> {
    try {
        const pillarKeys = Object.keys(config.contentPillars || {})
        if (pillarKeys.length === 0) {
            console.warn(`⚠️ generateCustomFormats: ${analysis.companyName} nemá contentPillars — generický fallback`)
            return
        }

        const productNames = (config.products || []).map(p => p.name).filter(Boolean).slice(0, 8).join(", ")
        const prompt = `Jsi Instagram stratég. Pro tuhle KONKRÉTNÍ firmu navrhni 7 jedinečných formátů příspěvků — ne obecné "tip/meme/carousel", ale formáty šité na míru téhle značce, jejím produktům a publiku.

Firma: ${analysis.companyName} (${analysis.industry})
Popis: ${analysis.description}
Publikum: ${analysis.targetAudience || 'obecné'}
Produkty/služby: ${productNames || '—'}
Pilíře obsahu (povolené klíče): ${pillarKeys.join(', ')}

Vrať POUZE JSON pole 7 objektů:
[{
  "name": "snake_case slug bez diakritiky (např. sezonni_kytice)",
  "display_name": "krátký název formátu, česky (např. Sezónní kytice)",
  "emoji": "1 emoji",
  "description": "1-2 věty česky: CO příspěvek ukazuje a PROČ funguje právě pro tuhle značku",
  "structure": "kostra obsahu, česky. Pro carousel: osnova slide po slidu (Slide 1 COVER: ..., poslední: CTA). Pro reel: osnova scén. Pro obrázek: stavba caption (hook → ... → CTA).",
  "visual_style": "1-2 věty česky: jak mají posty tohohle formátu VYPADAT (kompozice, nálada, rekvizity) — řídí se tím AI designer",
  "pillar": "jeden z povolených klíčů pilířů výše",
  "medium": "image | carousel | reel",
  "aspectRatio": "1:1 | 4:5 | 9:16",
  "uses_product": true/false
}]

Pravidla: konkrétní pro tenhle obor (ne generické). Mix mediumů. Pokud firma má produkty, aspoň 2 formáty s uses_product=true. name unikátní, snake_case, bez diakritiky.`

        // Retry twice — a transient AI/JSON failure here used to silently leave the
        // client on the GENERIC fallback formats (the "every client looks the same" bug).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let parsed: any[] | null = null
        for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
            try {
                const raw = await generateText(prompt, { temperature: 0.8 })
                const match = raw.match(/\[[\s\S]*\]/)
                const arr = match ? JSON.parse(match[0]) : null
                if (Array.isArray(arr) && arr.length > 0) parsed = arr
                else console.warn(`⚠️ generateCustomFormats: prázdný/nevalidní výstup (pokus ${attempt}/2)`)
            } catch (e) {
                console.warn(`⚠️ generateCustomFormats parse selhal (pokus ${attempt}/2): ${(e as Error).message}`)
            }
        }
        if (!parsed) {
            console.warn(`⚠️ generateCustomFormats: GENERICKÝ fallback pro ${analysis.companyName} — formáty NEJSOU brand-specific!`)
            return
        }

        const MEDIA = ["image", "carousel", "reel"]
        const RATIOS = ["1:1", "4:5", "3:4", "4:3", "9:16", "16:9"]
        // Feed carousels/images only support 1:1 / 4:5 / 3:4; 9:16 is reels-only and
        // 16:9 / 4:3 get cropped. Force a feed-legal pairing of medium ↔ aspectRatio.
        const normalizeRatio = (medium: string, ratio: string): PostTypeDef["aspectRatio"] => {
            if (medium === "reel") return "9:16"
            return (["1:1", "4:5", "3:4"].includes(ratio) ? ratio : "4:5") as PostTypeDef["aspectRatio"]
        }
        const seen = new Set<string>()
        const defs: PostTypeDef[] = []
        for (const d of parsed) {
            const name = String(d?.name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
                .replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
            if (!name || seen.has(name) || !d?.display_name || !d?.description) continue
            seen.add(name)
            const medium = (MEDIA.includes(d.medium) ? d.medium : "image") as PostTypeDef["medium"]
            defs.push({
                name,
                display_name: String(d.display_name).slice(0, 60),
                emoji: d.emoji || "📝",
                description: String(d.description).slice(0, 400),
                structure: d.structure ? String(d.structure).slice(0, 600) : undefined,
                visualStyle: d.visual_style ? String(d.visual_style).slice(0, 400) : undefined,
                pillar: pillarKeys.includes(d.pillar) ? d.pillar : pillarKeys[0],
                medium,
                aspectRatio: normalizeRatio(medium, (RATIOS.includes(d.aspectRatio) ? d.aspectRatio : "4:5")),
                uses_product: Boolean(d.uses_product),
            })
        }
        if (defs.length === 0) return

        config.postTypeDefs = defs
        config.postTypes = defs.map(d => d.name)
        config.postFormats = config.postFormats || {}
        for (const d of defs) {
            config.postFormats[d.name] = {
                aspectRatio: d.aspectRatio,
                medium: d.medium,
                overlayStyle: d.medium === "carousel" ? "cover" : d.medium === "reel" ? "none" : "default",
            }
        }
        // Re-map each pillar to the custom formats assigned to it
        for (const key of pillarKeys) {
            if (config.contentPillars[key]) {
                config.contentPillars[key].postTypes = defs.filter(d => d.pillar === key).map(d => d.name)
            }
        }
        // Keep weekPlan consistent with the new format names (7-day cycle)
        config.weekPlan = Array.from({ length: 7 }, (_, i) => defs[i % defs.length].name)

        console.log(`   ✅ Generated ${defs.length} brand-specific post formats: ${defs.map(d => d.name).join(", ")}`)
    } catch (err) {
        console.warn(`⚠️ Custom format generation failed: ${(err as Error).message}`)
    }
}

// ============================================
// SAVE CONFIG CORE (bucket + insert + products + link + trial)
// ============================================

/**
 * Persist a reviewed config. Auth-free — the caller supplies `userId` (for the
 * RBAC link) instead of reading the session. Handles both new clients and
 * re-onboarding (when `existingClientSlug` is given). Returns the client slug.
 * Throws on hard failures (caller wraps in try/catch).
 */
export async function saveConfigCore(
    config: ClientConfig,
    analysis: WebsiteAnalysis,
    opts: { userId?: string; existingClientSlug?: string } = {}
): Promise<string> {
    const { userId, existingClientSlug } = opts
    const clientSlug = existingClientSlug || config.id

    // ── RE-ONBOARDING: preserve slug-bound assets BEFORE anything derives from the
    // fresh config (mirrors actions.ts saveReviewedConfig). generateConfigCore recomputes
    // id/storageBucket/logoFile from the freshly re-scraped company name — a failed logo
    // re-download or a name drift would otherwise clobber the working logo pointer or
    // fork post uploads into a new empty bucket. Prefer fresh data, never replace a real
    // value with nothing.
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
        return existingClientSlug
    }

    // ── NEW CLIENT: Insert ──
    const { id: insertedClientId, slug: insertedSlug } = await insertClient(clientSlug, config)

    // RBAC link FIRST and FATALLY (when a user is supplied) — user_clients membership is
    // the ONLY ownership signal; a client without it is an unreachable orphan and the
    // user's onboarding retry then creates a duplicate tenant. Retry once, then compensate
    // by deleting the just-created bare client row (ig_* FKs cascade) and throw.
    if (userId) {
        try {
            await withRetry(async () => {
                const { error: linkError } = await supabaseAdmin
                    .from('user_clients')
                    .insert({ user_id: userId, client_id: insertedClientId, role: 'owner' })
                if (linkError) throw new Error(linkError.message)
            }, 1, 'user_clients link')
        } catch (linkErr) {
            console.error('🚨 user_clients link failed — rolling back client insert:', (linkErr as Error).message)
            await supabaseAdmin.from('clients').delete().eq('id', insertedClientId)
            throw new Error(`user_clients link failed: ${(linkErr as Error).message}`)
        }
    }

    // Warm-start brand memory from the scraped feed (guarded — only when empty)
    await seedMemoriesFromAnalysis(insertedClientId, analysis)

    // Persist brand-specific post formats so the Generate tab shows them
    // immediately (before the first generation also calls ensurePostTypes).
    await ensurePostTypes(config, insertedClientId)

    // Sync products → ig_products. Slugs are AI-generated with NO cross-item uniqueness
    // guarantee and ig_products has UNIQUE(client_id, slug) — a single collision in a bulk
    // INSERT rolled back the WHOLE statement (empty catalog, only a console.warn). Dedup
    // within the batch, then upsert (mirrors actions.ts saveReviewedConfig).
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
    // (canPerformAction denies) and a plan can be activated from billing.
    try {
        const { createTrialSubscription } = await import('@/lib/subscription')
        await withRetry(() => createTrialSubscription(insertedClientId), 1, 'trial subscription')
    } catch (trialErr) {
        console.error(`🚨 Trial creation failed for client ${insertedClientId}:`, (trialErr as Error).message)
    }

    return insertedSlug
}
