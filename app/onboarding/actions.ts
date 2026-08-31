'use server'

import { createClient } from '@/supabase/server'
import supabaseAdmin from '@/supabase/admin'
import { requireAuth, requireProjectAccess } from '@/lib/auth-guard'
import { generateText } from '@/instagram/gemini-client'
import { getModel } from '@/instagram/models'
import type { ClientConfig } from '@/instagram/configs/types'
import { isSuperAdminEmail } from '@/lib/super-admins'
import { humanizeError } from './types'
import type { WebsiteAnalysis, ReviewSection, ManualBusinessInfo } from './types'

// POZOR: tenhle soubor NESMÍ re-exportovat typy (`export type { … } from`).
// V modulu s 'use server' z toho Turbopack udělá BĚHOVÝ re-export na binding,
// který po smazání typů neexistuje — modul spadne při vyhodnocení a s ním celá
// stránka. `npm run build` to nechytí, typy mizí až za ním. Viz aserce 0.1.
// Typy berou UI i worker přímo z ./types.

// ============================================
// DURABLE ONBOARDING: ZAŘAĎ → SLEDUJ
// ============================================
// Analýza webu i skládání configu trvají minuty. Když visely na jednom blokujícím
// requestu, rozpadlé spojení zahodilo hotovou a zaplacenou práci — server doběhl,
// odpověď neměla kam dorazit, a UI vyhodilo „Failed to fetch". Práce teď běží jako
// agent_task; prohlížeč ji jen zařadí, šťouchne a pak se ptá na stav.
//
// Tyhle akce jsou schválně KRÁTKÉ. Ať se s nimi stane cokoli, zapsaný task doběhne
// a výsledek počká v DB.

/** Zařadí onboardingový task a vrátí jeho id. */
async function enqueueOnboarding(
    type: "onboarding_analyze" | "onboarding_config_preview",
    payload: Record<string, unknown>,
): Promise<{ success: boolean; taskId?: string; error?: string }> {
    try {
        const { userId } = await requireAuth()
        const { enqueueTask } = await import('@/lib/agent-runner')
        const taskId = await enqueueTask({
            type,
            payload,
            requestedBy: userId,
            priority: 10, // člověk čeká u obrazovky — má přednost před nočními agenty
            // Jediný pokus: opakovat víceminutovou práci s Pro modely by tiše utratilo
            // rozpočet znovu. Když to spadne, ať to člověk vidí a rozhodne sám.
            maxAttempts: 1,
        })
        return { success: true, taskId }
    } catch (error) {
        return { success: false, error: humanizeError(error) }
    }
}

export async function startWebsiteAnalysis(url: string, igHandle: string) {
    return enqueueOnboarding("onboarding_analyze", { mode: "website", url, igHandle })
}

export async function startManualAnalysis(info: ManualBusinessInfo) {
    return enqueueOnboarding("onboarding_analyze", { mode: "manual", info })
}

export async function startConfigPreview(
    analyzeTaskId: string,
    answers: Record<string, string | string[]>,
    websiteUrl: string,
    igHandle: string,
) {
    return enqueueOnboarding("onboarding_config_preview", { analyzeTaskId, answers, websiteUrl, igHandle })
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

        // Ukládání má JEDNO tělo — v core.ts. Tenhle dvojník se roky mirroroval ručně
        // a rozcházel se (viz aserce 31.3): bucket, RBAC link, produkty, trial i seed
        // paměti musí být všude stejné, jinak se onboarding z UI a onboarding z workera
        // chovají jinak. Tady zůstává jen session — core ji vidět nesmí.
        const { saveConfigCore } = await import('@/app/onboarding/core')
        const savedSlug = await saveConfigCore(config, analysis, { userId: user.id, existingClientSlug })
        return { success: true, clientSlug: savedSlug }
    } catch (error) {
        console.error('Save config error:', error)
        return { success: false, error: humanizeError(error) }
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
        //
        //    Ale až po fotkách: sken webu (`product_scrape`, zařazený v saveConfigCore)
        //    teprve plní katalog a stahuje fotky produktů. Renderer bere
        //    `ig_products.image_urls[0]` jako „EXACT product photo" — kdyby první tři
        //    příspěvky vznikly během skenu, ukázaly by vymyšlený produkt místo toho
        //    skutečného. Brána visí na tasku a vyhodnocuje ji worker proti jeho živému
        //    stavu; když sken doběhne dřív (nebo klient nemá web), nezdrží nic.
        const { data: scrapeTask } = await supabaseAdmin
            .from('agent_tasks')
            .select('id')
            .eq('client_id', clientId)
            .eq('type', 'product_scrape')
            .in('status', ['pending', 'running'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        const { data: campaign, error } = await supabaseAdmin
            .from('ig_campaigns')
            .insert({
                client_id: clientId,
                status: 'pending',
                plan: [{}, {}, {}],
                options: {
                    configName: clientSlug,
                    adminBypass: true,
                    showcase: true,
                    ...(scrapeTask ? { gate: { taskId: scrapeTask.id, reason: 'product_scrape' } } : {}),
                },
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
    if (isSuperAdminEmail(user.email)) {
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


// ============================================
// BRAND ASSET FUNCTIONS
// ============================================


