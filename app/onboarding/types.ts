/**
 * Onboarding TYPES — sdílený tvar dat, žádné chování
 * ==================================================
 * Typy a čisté helpery, které potřebuje UI (`page.tsx`, `OnboardTab.tsx`),
 * auth-gated actions (`actions.ts`), headless jádro (`core.ts`) i durable worker
 * (`lib/agents/handlers.ts`).
 *
 * PROČ SAMOSTATNÝ SOUBOR: `core.ts` si dřív bral `WebsiteAnalysis` z `actions.ts`
 * a `actions.ts` bral hodnoty z `core.ts`. Type-only import se při kompilaci maže,
 * takže cyklus zatím nevznikl — ale první hodnotová hrana core→actions by ho
 * vyrobila. Tenhle soubor tu hranu rozpojuje: závisí na něm oba a on na nikom.
 *
 * NIKDY sem nedávej `'use server'` ani nic, co sáhne na `next/headers` — importuje
 * to i worker, který běží bez requestu.
 */

import type { IgProfileData } from '@/lib/ig-scraper'

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
    /** Město z kontaktu/adresy. Prázdné = web ho neuvádí (čistě online firma).
     *  Propisuje se do `ClientConfig.city` — čte ho kontextový agent a počasí. */
    city?: string
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

/**
 * Osa configu, kterou otázka sytí.
 *
 * Otázky píše AI, takže bez tohohle můžou vyjít krásné a přesto minout pole, které
 * se z webu vyčíst NEDÁ — a to pole pak model při skládání configu jen hádá.
 * Čtyři osy jsou povinné, pátá (`volna`) patří modelu: tam se ptá na to, co u téhle
 * konkrétní značky považuje za nejcennější (sezónnost, námitka, kdo doopravdy platí).
 */
export type QuestionAxis =
    | 'cil'     // → contentPillars (poměry pilířů, ctaStrategy)
    | 'tabu'    // → brandVoice.antiPatterns
    | 'cta'     // → brandVoice.ctaVariations
    | 'vizual'  // → feedAesthetic
    | 'volna'   // → cokoli, co model u téhle značky považuje za nejcennější

/** Osy, bez kterých se config neobejde — vždycky musí zaznít. */
export const REQUIRED_AXES: QuestionAxis[] = ['cil', 'tabu', 'cta', 'vizual']

export interface OnboardingQuestion {
    id: string
    question: string
    type: 'select' | 'multiselect' | 'text' | 'scale'
    options?: string[]
    placeholder?: string
    required: boolean
    /** Které pole configu tahle otázka sytí. Viz QuestionAxis. */
    covers?: QuestionAxis
}

export type ReviewSection = 'brand_voice' | 'pillars' | 'products' | 'visual' | 'hooks_cta'

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

// ============================================
// ERROR HELPERS
// ============================================

/** Přeloží technické selhání do věty, které zákazník rozumí. Sdílené: stejnou chybu
 *  musí umět ukázat synchronní action i poll route, která ji čte z `agent_tasks.error`. */
export function humanizeError(error: unknown): string {
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
