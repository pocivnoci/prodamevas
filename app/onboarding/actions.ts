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

        // Try to scrape a few more pages for more context
        const subpageUrls = extractSubpageUrls(homepageHtml, baseUrl).slice(0, 3)
        const subpageTexts: string[] = []
        for (const subUrl of subpageUrls) {
            try {
                const html = await fetchPage(subUrl)
                subpageTexts.push(extractText(html).substring(0, 1000))
            } catch { /* skip failed subpages */ }
        }

        // Extract metadata
        const metadata = extractMetadata(homepageHtml)
        const mainText = extractText(homepageHtml)

        // Try to get Instagram bio
        let instagramBio: string | undefined
        if (igHandle) {
            const handle = igHandle.replace('@', '').replace('https://instagram.com/', '')
            try {
                const igHtml = await fetchPage(`https://www.instagram.com/${handle}/`)
                const bioMatch = igHtml.match(/"biography":"([^"]+)"/)
                instagramBio = bioMatch?.[1]?.replace(/\\n/g, '\n')
            } catch { /* IG scraping may fail, that's ok */ }
        }

        // Send everything to AI for analysis
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
- products: pole produktů/služeb [{name, type, slug (URL slug pokud je), price, description}] (max 10)
- brandTone: detekovaný tón komunikace (formální, neformální, drzý, expertní, atd.)
- colors: {primary, secondary, accent} — HEX barvy z webu
- targetAudience: odhadovaná cílová skupina
- uniqueSellingPoints: co firmu odlišuje (pole stringů)
- existingContent: typy existujícího obsahu na webu (blog, recenze, galerie, atd.)

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
            },
            required: ["companyName", "description", "industry", "products", "brandTone", "colors", "targetAudience", "uniqueSellingPoints", "existingContent"],
        }

        const rawAnalysis = await generateText(analysisPrompt, { responseSchema: analysisSchema })
        const jsonMatch = rawAnalysis.match(/\{[\s\S]*\}/)
        const analysis: WebsiteAnalysis = JSON.parse(jsonMatch?.[0] || rawAnalysis)
        analysis.instagramBio = instagramBio
        analysis.logoUrl = metadata.ogImage || undefined

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
    "feel": "... (popis vizuálního pocitu)",
    "phoneModel": "iPhone 16 Pro"
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
  "overlayGradient": {
    "topColor": "${analysis.colors.primary}",
    "midColor": "${analysis.colors.secondary}",
    "bottomColor": "${analysis.colors.primary}"
  }${analysis.products.length > 0 ? `,
  "products": ${JSON.stringify(analysis.products.map(p => ({ name: p.name, type: p.type, slug: p.slug, price: p.price, description: p.description })))}` : ''}
}

DŮLEŽITÉ:
- Všechny texty psány česky, moderní hovorovou češtinou
- Obsah musí odpovídat analýze webu a odpovědím
- Post types přizpůsobené oboru (${analysis.industry})
- Hook templates kreativní a specificke pro tuto značku
- CTA vždy odkazuje na ${websiteUrl}
- Vrať POUZE platný JSON, bez obalujícího textu`

        const rawConfig = await generateText(configPrompt, { temperature: 0.7 })
        const jsonMatch = rawConfig.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('AI nevygenerovalo platný JSON config')

        const config: ClientConfig = JSON.parse(jsonMatch[0])

        // Ensure critical fields
        config.id = slugify(analysis.companyName)
        config.website = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
        config.instagram = igHandle.startsWith('@') ? igHandle : `@${igHandle}`

        // Save to database
        const clientSlug = config.id
        const { error: insertError } = await supabaseAdmin
            .from('clients')
            .insert({
                slug: clientSlug,
                name: config.name,
                website: config.website,
                config: config,
                user_id: user.id,
                onboarding_status: 'complete',
                is_active: true,
            })

        if (insertError) {
            // If slug exists, try with number suffix
            if (insertError.message.includes('duplicate') || insertError.message.includes('unique')) {
                const newSlug = `${clientSlug}-${Date.now().toString(36).slice(-4)}`
                config.id = newSlug
                const { error: retryError } = await supabaseAdmin
                    .from('clients')
                    .insert({
                        slug: newSlug,
                        name: config.name,
                        website: config.website,
                        config: config,
                        user_id: user.id,
                        onboarding_status: 'complete',
                        is_active: true,
                    })
                if (retryError) throw retryError
                return { success: true, clientSlug: newSlug }
            }
            throw insertError
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

    const { data: client } = await supabaseAdmin
        .from('clients')
        .select('slug, onboarding_status')
        .eq('user_id', user.id)
        .eq('onboarding_status', 'complete')
        .limit(1)
        .single()

    if (client) {
        return { needsOnboarding: false, clientSlug: client.slug }
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

function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .substring(0, 30)
}
