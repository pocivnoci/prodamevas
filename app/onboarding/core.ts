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
 * TENHLE SOUBOR JE ZDROJ PRAVDY pro onboarding pipeline. `./actions.ts` je jen
 * auth-gated obálka (requireAuth + zařazení tasku) a durable worker
 * (`lib/agents/handlers.ts`) volá rovnou sem — právě proto, že tu není auth vrstva.
 * Dřív tu žil dvojník a mirrorovalo se ručně; nemirroruj ho zpátky.
 *
 * Typy jsou v `./types.ts`, aby mezi tímhle souborem a `actions.ts` nevznikl cyklus.
 */

import supabaseAdmin from '@/supabase/admin'
import { generateText } from '@/instagram/gemini-client'
import { getModel } from '@/instagram/models'
import { ensurePostTypes } from '@/instagram/service'
import { CAROUSEL_MAX_TOTAL_SLIDES } from '@/instagram/caption-generator'
import { withRetry } from '@/utils/retry'
import type { ClientConfig, PostTypeDef } from '@/instagram/configs/types'
import { FORMAT_BRIEF_LIMITS } from '@/instagram/configs/types'
import { stripFinishedCopy } from '@/instagram/configs/format-brief'
import { fetchInstagramProfile, estimatePostsPerWeek, type IgProfileData } from '@/lib/ig-scraper'
import { Type } from '@google/genai'
import type { WebsiteAnalysis, ManualBusinessInfo, IgInsights, OnboardingQuestion, QuestionAxis } from './types'
import { REQUIRED_AXES } from './types'

// ============================================
// TYPES
// ============================================

export type { ManualBusinessInfo }

/** Hlášení průběhu dlouhé práce. Durable worker sem zapisuje do agent_tasks,
 *  synchronní volání (skripty, sales preview) ho prostě nepředají. */
export type ProgressFn = (progress: number, message: string) => void | Promise<void>

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
    'ubytovani': { industry: 'Ubytování / Penzion', postTypes: ['tip', 'behind_scenes', 'recenze', 'product_drop'], audience: 'Páry na prodloužený víkend, rodiny s dětmi, turisté hledající klid mimo město, 28-60 let' },
    'zdravi': { industry: 'Zdraví / Estetika', postTypes: ['before_after', 'tip', 'faq', 'behind_scenes'], audience: 'Lidé pečující o zdraví a vzhled, 25-60 let, rozhodují se podle důvěry a referencí' },
    'reality': { industry: 'Reality / Realitní služby', postTypes: ['tip', 'carousel', 'recenze', 'behind_scenes'], audience: 'Lidé prodávající či kupující nemovitost, investoři, 28-55 let' },
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

    // Enrich with Instagram profile data if handle provided.
    // Dřív tenhle blok žil jen v actions.ts, takže ruční onboarding přes UI značku
    // z Instagramu přečetl a headless cesta ne. enrichWithInstagram je non-blocking
    // (chybu spolkne a analýzu nechá být), takže i neexistující handle je bezpečný.
    if (info.igHandle) {
        await enrichWithInstagram(analysis, info.igHandle)
        // Enrich brand tone if IG analysis gives a hint
        if (analysis.igInsights?.brandToneHint && analysis.brandTone === info.tone) {
            analysis.brandTone = analysis.igInsights.brandToneHint
        }
    }

    return analysis
}

// ============================================
// STEP 2: DOTAZNÍK NA MÍRU ZNAČCE
// ============================================

/** Záchranná síť: pět pevných otázek, které tu byly, než je začala psát AI.
 *  Onboarding nesmí umřít na nice-to-have — když model selže, ptáme se takhle. */
const FALLBACK_QUESTIONS: OnboardingQuestion[] = [
    {
        id: 'ig_goal',
        covers: 'cil',
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
        covers: 'volna',
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
        covers: 'tabu',
        question: 'Jsou témata, kterým se chceš vyhnout?',
        type: 'text',
        placeholder: 'např. politika, konkurence, slevy, vulgarita...',
        required: false,
    },
    {
        id: 'ig_cta',
        covers: 'cta',
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
        covers: 'vizual',
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

/**
 * Vygeneruje doplňující otázky na míru TÉHLE značce. Auth-free.
 *
 * Nikdy nehází: každé selhání (model, JSON, nesmyslný tvar) končí pevným
 * dotazníkem. Ptát se hůř je pořád nekonečně lepší než se nezeptat vůbec.
 */
export async function generateQuestionsCore(analysis: WebsiteAnalysis): Promise<OnboardingQuestion[]> {
    const prompt = `Jsi stratég značky. Pro TUHLE konkrétní firmu napiš 5 doplňujících otázek, které se zeptají na to, co z webu nejde vyčíst, a co potřebuješ vědět, než jí začneš psát Instagram.

FIRMA: ${analysis.companyName}
OBOR: ${analysis.industry}
POPIS: ${analysis.description}
PRODUKTY: ${(analysis.products || []).map(p => p.name).slice(0, 12).join(', ') || '—'}
CÍLOVÁ SKUPINA: ${analysis.targetAudience || '—'}
TÓN: ${analysis.brandTone || '—'}
${analysis.igInsights ? `UŽ POSTUJE NA IG: engagement ${(analysis.igInsights.avgEngagementRate * 100).toFixed(2)} %, tón „${analysis.igInsights.brandToneHint}"` : 'NA INSTAGRAMU ZATÍM NENÍ.'}

## PRAVIDLA
- Ptej se KONKRÉTNĚ na tuhle firmu. „Jaký je tvůj cíl?" umí položit kdokoli — zeptej se tak, aby bylo poznat, že jsi četl, co dělají.
- Každá otázka musí měnit, jak budou vypadat příspěvky. Na co neumíš navázat obsah, se neptej.
- Ptej se na to, co z webu NEJDE zjistit: sezónnost, tabu, kdo doopravdy nakupuje, čím se liší od konkurence, co v minulosti nefungovalo.
- Přesně 5 otázek, česky, tykáním.

## CO MUSÍ ZAZNÍT
Každá odpověď sytí konkrétní pole konfigurace, takže se musí ptát právě jedna otázka na každou z těchto os. Formulaci si ale vymysli pro TUHLE firmu — osa říká, NA CO se ptáš, ne JAK.
- "cil" — čeho má Instagram dosáhnout (řídí poměr prodejních a budovacích příspěvků)
- "tabu" — čemu se v komunikaci vyhnout (stane se z toho seznam zakázaných věcí)
- "cta" — co má člověk po přečtení udělat a kam ho poslat (řídí výzvy k akci)
- "vizual" — jak má feed vypadat
- "volna" — jedna otázka navíc podle tvého uvážení: zeptej se na to, co je u téhle konkrétní značky nejcennější a z webu to nejde vyčíst (sezónnost, kdo doopravdy platí, nejčastější námitka, co v minulosti nefungovalo)

Osu zapiš do pole "covers".

- Nejvýš jedna otázka typu "text" — psaní dá práci. Zbytek dej jako výběr z možností.
- U "select" a "multiselect" vždy 3–5 konkrétních možností napsaných pro TENHLE obor, plus ať jedna možnost pokrývá „nic z toho".
- `+"`id`"+` je krátký slug bez diakritiky (např. "sezonnost", "kdo_nakupuje").
- Aspoň 3 otázky povinné (required: true).`

    try {
        const raw = await generateText(prompt, {
            temperature: 0.8,
            model: getModel("textPro"),
            fallbackModel: getModel("textPro", "fallback"),
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING },
                        question: { type: Type.STRING },
                        type: { type: Type.STRING, enum: ["select", "multiselect", "text", "scale"] },
                        options: { type: Type.ARRAY, items: { type: Type.STRING } },
                        placeholder: { type: Type.STRING },
                        required: { type: Type.BOOLEAN },
                        covers: { type: Type.STRING, enum: ["cil", "tabu", "cta", "vizual", "volna"] },
                    },
                    required: ["id", "question", "type", "required", "covers"],
                },
            },
        })

        const parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || raw) as OnboardingQuestion[]

        // Schéma zaručí tvar, ne smysl. Otázka typu select bez možností vykreslí
        // prázdný ovládací prvek, do kterého se nedá odpovědět — takovou zahoď.
        const usable = (Array.isArray(parsed) ? parsed : []).filter(q =>
            q && typeof q.question === "string" && q.question.trim().length > 5 &&
            ["select", "multiselect", "text", "scale"].includes(q.type) &&
            (q.type === "text" || q.type === "scale" || (Array.isArray(q.options) && q.options.length >= 2))
        )

        if (usable.length < 3) {
            console.warn(`⚠️ Dotazník na míru vrátil jen ${usable.length} použitelných otázek → pevný dotazník`)
            return FALLBACK_QUESTIONS
        }

        // id musí být jedinečné, jinak si dvě otázky přepíšou odpověď.
        const seen = new Set<string>()
        const questions = usable.slice(0, 6).map((q, i) => {
            let id = (q.id || `q${i + 1}`).trim()
            if (!id || seen.has(id)) id = `q${i + 1}`
            seen.add(id)
            return { ...q, id, required: Boolean(q.required) }
        })

        // Pokrytí os, ne jen počet. Model umí vymyslet pět skvělých otázek, které
        // shodou okolností všechny míří na publikum — a pak si config pole jako
        // antiPatterns nebo ctaVariations jen vymyslí, protože se na ně nikdo nezeptal.
        // Chybějící osu zalep pevnou otázkou: obecná otázka je pořád lepší než žádná.
        const covered = new Set(questions.map(q => q.covers).filter(Boolean) as QuestionAxis[])
        const missing = REQUIRED_AXES.filter(a => !covered.has(a))
        if (missing.length) {
            console.warn(`⚠️ Dotazníku chybí osa: ${missing.join(", ")} → doplňuju pevnou otázkou`)
            for (const axis of missing) {
                const fixed = FALLBACK_QUESTIONS.find(q => q.covers === axis)
                if (fixed && !seen.has(fixed.id)) { questions.push(fixed); seen.add(fixed.id) }
            }
        }

        console.log(`✅ Dotazník na míru: ${questions.length} otázek pro ${analysis.companyName} (osy: ${questions.map(q => q.covers ?? "?").join(", ")})`)
        return questions
    } catch (err) {
        console.warn(`⚠️ Generování dotazníku selhalo, jedu na pevný: ${(err as Error).message}`)
        return FALLBACK_QUESTIONS
    }
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
    igHandle: string,
    /** Dotazník, na který `answers` odpovídají. Nepovinný: seed skripty a sales
     *  preview žádný nemají. Když je po ruce, do promptu jde otázka i s odpovědí. */
    questions?: OnboardingQuestion[],
    onProgress?: ProgressFn
): Promise<ClientConfig> {
    const say = async (p: number, m: string) => { await onProgress?.(p, m) }
    // Otázky píše AI, takže `id` je neprůhledné („q3") a modelu při skládání configu
    // samo o sobě neřekne nic. Spáruj ho zpátky s textem otázky — jinak jsou odpovědi
    // jen hodnoty bez kontextu.
    const answersBlock = questions?.length
        ? JSON.stringify(
            questions.map(q => ({ otazka: q.question, odpoved: answers[q.id] ?? '—' })),
            null, 2
        )
        : JSON.stringify(answers, null, 2)
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
${answersBlock}

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

## JAK NALOŽIT S ODPOVĚĎMI Z DOTAZNÍKU
Odpovědi výše nejsou kontext na okrasu — jsou to jediné věci, které se z webu vyčíst NEDAJÍ, protože je ví jenom majitel. Kde si analýza webu a odpověď protiřečí, **platí odpověď**.
- Co klient označil za tabu, MUSÍ skončit v \`brandVoice.antiPatterns\` — konkrétně, jeho slovy, ne obecně.
- Kam chce klient lidi posílat, MUSÍ řídit \`brandVoice.ctaVariations\` a \`ctaStrategy\` u pilířů.
- Cíl, který klient zvolil, MUSÍ posunout poměry v \`contentPillars\` (prodejní cíl = vyšší ratio u "sales", budování značky = vyšší u "reach" a "community").
- Vizuální styl z odpovědi MUSÍ být znát ve \`feedAesthetic\`.
- Volnou odpověď (sezónnost, kdo doopravdy platí, námitka, co nefungovalo) promítni do \`contentPillars.categories\` a \`hookTemplates\` — tam je z ní největší užitek.
- Když klient na něco neodpověděl nebo zvolil „nic z toho", nic si nevymýšlej a řiď se analýzou webu.

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
    await say(15, 'Skládám konfiguraci značky…')
    const rawConfig = await generateText(configPrompt, { temperature: 0.7, model: getModel("textPro"), fallbackModel: getModel("textPro", "fallback") })
    const jsonMatch = rawConfig.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('AI nevygenerovalo platný JSON config')

    const config: ClientConfig = JSON.parse(jsonMatch[0])

    // Ensure critical fields
    const slug = slugify(analysis.companyName)
    config.id = slug
    config.website = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
    // industry/city se doteď nikdy nepropsaly do configu — žily jen jako řetězec
    // v onboardingových promptech. Kontextový agent (svátky, sezóna) i počasí je
    // ale čtou z configu, takže všem tenantům běžely na "business" + Praha.
    if (analysis.industry) config.industry = analysis.industry
    if (analysis.city?.trim()) config.city = analysis.city.trim()
    // Prázdný handle nesmí skončit jako samotné „@" — tak vznikl reálný stav tří
    // klientů, kterým v promptu svítí „IG: @". Prázdno je pravdivější.
    const handle = (igHandle || '').trim().replace(/^@+/, '')
    config.instagram = handle ? `@${handle}` : ''

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
    // Ověřená fakta ze skenu webu. Zapisují se DETERMINISTICKY, ne přes konfigurační
    // prompt: kdyby si je model skládal sám, přeformuloval by je — a fakt, který
    // prošel přeformulováním, už není citace webu, ale tvrzení modelu.
    if (analysis.brandFacts?.length) {
        config.brandFacts = analysis.brandFacts
        console.log(`🧾 Seed ověřených faktů: ${analysis.brandFacts.length}`)
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
    // Grid rhythm, derived from what the brand's real feed already does. Deterministic —
    // a photography-led feed gets "none" rather than having typography posts forced on it.
    // Guard na feedVisuals: cesty bez scrapu IG (seed skripty, sales preview) sem nikdy
    // nevlezou a validateConfig jim nechá default "none".
    if (analysis.feedVisuals) {
        const { recommendPattern } = await import('@/lib/feed-pattern')
        config.feedPattern = recommendPattern(analysis.feedVisuals)
        console.log(`🔲 Feed pattern doporučen: ${config.feedPattern}`)
    }

    // Seed real posting cadence from the scrape so the content plan matches how often the
    // brand actually posts (a "week" = this many posts, not 7). Falls back to 4 when the
    // recent posts don't carry enough dated signal. validateConfig clamps it 1–7.
    if (analysis.igProfile && analysis.igInsights) {
        const perWeek = estimatePostsPerWeek(analysis.igProfile.recentPosts.map(p => p.timestamp))
        if (perWeek) config.postsPerWeek = perWeek
    }

    // Set logo file if it was downloaded
    if (analysis.logoDownloaded) {
        config.logoFile = `logo-${slug}.png`
    }
    // Set storage bucket
    config.storageBucket = `ig-posts-${slug}`

    // Download brand/product images from website → Supabase storage
    await say(40, 'Stahuju obrázky z webu…')
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
                    // Timeout jako všude jinde na téhle cestě: bez něj jediné visící
                    // storage URL zablokuje celou pipeline na neurčito. Sousední
                    // downloadProductImages má stejných 8 s.
                    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
                    if (resp.ok) {
                        const buf = Buffer.from(await resp.arrayBuffer())
                        const ct = resp.headers.get('content-type') || 'image/jpeg'
                        imagesToTag.push({ url, buffer: buf, mimeType: ct })
                    }
                } catch { /* skip failed fetches */ }
            }
            if (imagesToTag.length > 0) {
                await say(55, 'Popisuju, co je na obrázcích…')
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

        await say(70, 'Kreslím persony publika…')
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

        await say(82, 'Ladím styl komunikace…')
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
    await say(90, 'Vymýšlím formáty příspěvků na míru…')
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
        const prompt = `Jsi Instagram stratég. Pro tuhle firmu navrhni 7 formátů příspěvků.

⚠️ FORMÁT NENÍ PŘÍSPĚVEK. Formát je ŠABLONA, kterou značka použije na DESÍTKY různých
témat — každý týden znovu, rok co rok. Popisuješ MECHANISMUS, ne jeden konkrétní post.

Test, který musí každý formát projít:
"Vyrobím podle tohohle 30 RŮZNÝCH příspěvků, které nebudou vypadat stejně?"
Když ne, je to nápad na jeden post — ne formát. Zahoď ho a vymysli mechanismus.

ŠPATNĚ — tohle jsou hotové posty, ne formáty:
✗ "Scéna 1: odemčení dveří, cinknutí zvonku. Scéna 2: roztáčení markýzy. Scéna 3:
   rosení květin. Text: 'Klidné ráno na Vinohradech.'"
   → jde natočit JEDNOU; podruhé je to totéž video
✗ "Hook: 'Dnes vážeme pro paní Janu z vedlejší ulice, která slaví 30 let od svatby.'"
   → jméno a příležitost patří do NÁMĚTU, ne do formátu
✗ "CTA: 'Ušetříme vám místo i peníze. Rezervujte si termín.'"
   → hotová copy; tu píše copywriter pokaždé znovu

SPRÁVNĚ — mechanismus, použitelný donekonečna:
✓ description: "Postaví dvě možnosti proti sobě a nechá publikum hlasovat. Rozhodování
   vtahuje lidi do komentářů."
✓ structure: "Cover: obě možnosti proti sobě → beat 2-3: co mluví pro každou → závěr:
   výzva k hlasování"
✓ visual_style: "Dělená kompozice, symetrie, obě strany stejně nasvícené"

Firma: ${analysis.companyName} (${analysis.industry})
Popis: ${analysis.description}
Publikum: ${analysis.targetAudience || 'obecné'}
Produkty/služby: ${productNames || '—'}
Pilíře obsahu (povolené klíče): ${pillarKeys.join(', ')}

Vrať POUZE JSON pole 7 objektů:
[{
  "name": "snake_case slug bez diakritiky (např. dva_proti_sobe)",
  "display_name": "krátký název formátu, česky (např. Souboj dvou)",
  "emoji": "1 emoji",
  "description": "1 věta česky: JAK formát funguje a proč zabírá. Mechanismus, ne obsah. MAX 160 znaků.",
  "structure": "sled beatů, česky, ABSTRAKTNĚ. Pro carousel nejvýš ${CAROUSEL_MAX_TOTAL_SLIDES} beatů včetně coveru. NIKDY konkrétní scéna, jméno, místo ani znění věty. MAX 220 znaků.",
  "visual_style": "1 věta česky: produkční kvality — kompozice, světlo, tempo, odstup kamery. NIKDY konkrétní rekvizita ani lokace. MAX 160 znaků.",
  "pillar": "jeden z povolených klíčů pilířů výše",
  "medium": "image | carousel | reel",
  "aspectRatio": "1:1 | 4:5 | 9:16",
  "uses_product": true/false
}]

Pravidla: mechanismus ať je pro obor RELEVANTNÍ, ale znovupoužitelný na desítky témat —
nesmí být svázaný s jednou scénou, jedním místem, jednou příležitostí ani jednou replikou.
ŽÁDNÁ vlastní jména, konkrétní data, ceny ani hotové repliky v uvozovkách.
Mix mediumů. Pokud firma má produkty, aspoň 2 formáty s uses_product=true.
name unikátní, snake_case, bez diakritiky.`

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

        // Deliberately NOT ALL_MEDIA: the onboarding AI invents a brand's starting formats,
        // and a brand-new tenant shouldn't be handed story formats before the owner has
        // seen what a story looks like. Stories are added later, by hand, in Settings.
        const MEDIA = ["image", "carousel", "reel"]
        const RATIOS = ["1:1", "4:5", "3:4", "4:3", "9:16", "16:9"]
        // Feed carousels/images only support 1:1 / 4:5 / 3:4; 9:16 is for the vertical
        // media (reel, story) and 16:9 / 4:3 get cropped. Force a legal medium ↔ ratio pair.
        const normalizeRatio = (medium: string, ratio: string): PostTypeDef["aspectRatio"] => {
            if (medium === "reel" || medium === "story") return "9:16"
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
                // Stropy drží formát invariantem (FORMAT_BRIEF_LIMITS), stripFinishedCopy
                // z něj vyhazuje konkrétní znění vět — zákaz v promptu na to nestačí.
                description: stripFinishedCopy(String(d.description)).slice(0, FORMAT_BRIEF_LIMITS.description),
                structure: d.structure ? stripFinishedCopy(String(d.structure)).slice(0, FORMAT_BRIEF_LIMITS.structure) : undefined,
                visualStyle: d.visual_style ? stripFinishedCopy(String(d.visual_style)).slice(0, FORMAT_BRIEF_LIMITS.visualStyle) : undefined,
                pillar: pillarKeys.includes(d.pillar) ? d.pillar : pillarKeys[0],
                medium,
                aspectRatio: normalizeRatio(medium, (RATIOS.includes(d.aspectRatio) ? d.aspectRatio : "4:5")),
                uses_product: Boolean(d.uses_product),
            })
        }
        if (defs.length === 0) return

        // Snímek PŘED přepisem: contentPillars ještě drží zástupné názvy typů
        // („tip", „meme"…) — tytéž, kterými model o pár set řádků výš oklíčoval
        // hookTemplates.bestFor a toneByPostType. Je to jediný most mezi starým
        // a novým názvoslovím; po přepisu níž už neexistuje.
        const pillarOfOldSlug = new Map<string, string>()
        for (const key of pillarKeys) {
            for (const oldSlug of config.contentPillars?.[key]?.postTypes || []) {
                pillarOfOldSlug.set(oldSlug, key)
            }
        }

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

        // ── Překlíčovat, co ještě odkazuje na staré názvy ─────────────────────
        // Bez tohohle zůstaly hookTemplates.bestFor a toneByPostType viset na
        // zástupných názvech, které právě přestaly existovat. Naměřeno na produkci:
        // u všech 6 klientů sedělo 0 z ~7 — copywriter tedy nedostal ani jeden vzor
        // hooku značky a v promptu měl místo tónu prázdno.
        //
        // Jméno na jméno přeložit nejde („tip" → který ze tří formátů?), takže se jede
        // přes pilíř. Když z toho nevyjde nic, pole se VYČISTÍ — mrtvý název je horší
        // než prázdno, protože prázdno znamená „platí univerzálně" a mrtvý název
        // znamená „neplatí nikde".
        const newNamesForOldSlug = (oldSlug: string): string[] => {
            const pillar = pillarOfOldSlug.get(oldSlug)
            return pillar ? defs.filter(d => d.pillar === pillar).map(d => d.name) : []
        }

        for (const t of config.brandVoice?.hookTemplates || []) {
            const mapped = new Set((t.bestFor || []).flatMap(newNamesForOldSlug))
            t.bestFor = [...mapped]
        }

        if (config.brandVoice?.toneByPostType) {
            const remapped: typeof config.brandVoice.toneByPostType = {}
            for (const [oldSlug, tone] of Object.entries(config.brandVoice.toneByPostType)) {
                for (const name of newNamesForOldSlug(oldSlug)) remapped[name] = tone
            }
            // Prázdná mapa je v pořádku — getToneDescription si dopočítá průměr.
            if (Object.keys(remapped).length > 0) config.brandVoice.toneByPostType = remapped
        }

        console.log(`   ✅ Generated ${defs.length} brand-specific post formats: ${defs.map(d => d.name).join(", ")}`)
    } catch (err) {
        console.warn(`⚠️ Custom format generation failed: ${(err as Error).message}`)
    }
}

// ============================================
// SAVE CONFIG CORE (bucket + insert + products + link + trial)
// ============================================

/**
 * Zařadí sken webu do katalogu produktů — ten samý, co v Katalogu dělá tlačítko
 * „Načíst z webu" (`lib/product-scrape.ts`).
 *
 * Proč vedle produktů z brand analýzy: mega prompt analýzy řeší celou značku a
 * produkty jsou v něm jen jedno pole ze čtrnácti — vejde se jich deset a fotku
 * nemají žádnou. Sken je oproti tomu jeden úkol: projde podstránky, vytáhne až
 * třicet položek a ke každé stáhne fotku. Klient tak nezačíná s prázdným katalogem.
 *
 * Durable task, ne inline volání: sken je minuty práce a onboarding se od prohlížeče
 * schválně utrhl. Selhání nesmí shodit uložení configu — bez katalogu klient funguje,
 * bez configu ne.
 */
async function queueProductScrape(clientId: string, website?: string): Promise<void> {
    if (!website) return
    try {
        const { enqueueTask } = await import('@/lib/agent-runner')
        await enqueueTask({
            type: 'product_scrape',
            payload: { website },
            clientId,
            // Člověk čeká na svůj katalog — před nočními agenty, za onboardingovými tasky.
            priority: 8,
            // Opakovat sken znamená zaplatit model za totéž podruhé; když se nepovede,
            // je v Katalogu tlačítko „Načíst z webu".
            maxAttempts: 1,
        })
    } catch (scrapeErr) {
        console.warn('⚠️ Product scrape enqueue failed (non-fatal):', (scrapeErr as Error).message)
    }
}

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

        // Web se právě četl znovu — ať se z něj doplní i katalog (dvojčata sken pozná).
        await queueProductScrape(clientId, config.website)

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

    // …a hned za tím plný sken webu: doplní produkty, na které se do analýzy nevešlo
    // místo, a k těm už uloženým dotáhne fotky.
    await queueProductScrape(insertedClientId, config.website)

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

// ============================================
// STEP 1: ANALÝZA WEBU (scraping + AI + IG)
// ============================================
// Přesunuto sem z actions.ts, aby to mohl volat durable worker: `lib/agents/handlers.ts`
// se nesmí dotknout auth vrstvy (HARD RULE nahoře), takže dokud tohle žilo za
// `requireAuth()`, nešlo analýzu utrhnout od otevřeného spojení s prohlížečem.
export async function analyzeWebsiteCore(url: string, igHandle: string, onProgress?: ProgressFn): Promise<WebsiteAnalysis> {
    const say = async (p: number, m: string) => { await onProgress?.(p, m) }
    try {
        // Normalize URL
        const baseUrl = url.startsWith('http') ? url : `https://${url}`

        // Scrape homepage
        await say(10, 'Čtu web…')
        console.log(`🔍 Scraping ${baseUrl}...`)
        const homepageHtml = await fetchPage(baseUrl)

        // Discover subpages: sitemap.xml first, then <a href> fallback
        await say(20, 'Hledám podstránky…')
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
- city: město, kde firma sídlí nebo působí (z kontaktu/adresy/patičky). Když web žádné neuvádí nebo firma působí čistě online, vrať prázdný řetězec — NEHÁDEJ.
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
                city: { type: "string" },
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

        await say(45, 'Učím se značku z toho, co jsem přečetl…')
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

        // Ověřitelná fakta z webu — seed pro config.brandFacts. Bez nich má faktická
        // brána (instagram/fact-check.ts) prázdný seznam povolených tvrzení a engine
        // nesmí napsat ani to, co má značka černé na bílém na vlastním webu.
        // Nekritické: onboarding kvůli faktům nepadá, jen pak startuje s prázdným seznamem.
        try {
            await say(48, 'Sbírám ověřitelná fakta o značce…')
            const { extractFactsFromPages } = await import('@/lib/brand-facts')
            analysis.brandFacts = await extractFactsFromPages(analysis.companyName || baseUrl, [
                { url: baseUrl, text: mainText },
                ...subpageTexts.map((t, i) => ({ url: allSubUrls[i], text: t })),
            ])
            console.log(`   🧾 Fakta z webu: ${analysis.brandFacts.length}`)
        } catch (e) {
            console.warn('⚠️ Extrakce faktů z webu selhala (nekritické):', (e as Error).message)
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
            await say(75, 'Stahuju logo…')
            const logoSaved = await downloadLogo(logoUrl, slug)
            analysis.logoDownloaded = logoSaved
            if (logoSaved) {
                console.log(`✅ Logo saved as logo-${slug}.png`)
            }
        }

        // Enrich with Instagram profile data if handle provided
        if (igHandle) {
            await say(85, 'Koukám na váš Instagram…')
            await enrichWithInstagram(analysis, igHandle)
        }

        return analysis
    } catch (error) {
        console.error('Website analysis error:', error)
        throw error
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

// Exportované kvůli lib/brand-facts.ts: skenování webu kvůli faktům musí číst stránky
// PŘESNĚ tak, jak je čte onboarding — druhý čtenář HTML by se rozešel v tom, co je text.
export async function fetchPage(url: string): Promise<string> {
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
export function extractStructuredText(html: string): string {
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
export async function fetchSitemapUrls(baseUrl: string): Promise<string[]> {
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

export function extractSubpageUrls(html: string, baseUrl: string): string[] {
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
