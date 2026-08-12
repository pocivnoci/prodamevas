"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { trackEvent } from "@/lib/analytics"
import { ALL_MEDIA } from "@/lib/credits"

export type StudioSection =
    | "dashboard"
    | "posts"
    | "calendar"
    | "feed"
    | "plan"
    | "generate"
    | "ideas"
    | "reviews"
    | "inspiration"
    | "brand"
    | "products"
    | "performance"
    | "settings"
    | "onboard"
    | "waitlist"
    | "brain"
    | "faq"
    | "approvals"
    | "mailing"
    | "company"

const VALID_SECTIONS: StudioSection[] = [
    "dashboard", "posts", "calendar", "feed", "plan", "generate",
    "ideas", "reviews", "inspiration", "brand", "products",
    "performance", "settings", "onboard", "waitlist", "brain", "faq", "approvals", "mailing", "company",
]

/** One-shot intent handed from a CTA (dashboard hero / sidebar) to GenerateTab so it
 *  opens pre-configured — e.g. "Obsah na měsíc" opens plan mode with month preset.
 *  GenerateTab applies it once on arrival, then clears it. */
export interface GenerateIntent {
    mode: "plan" | "single"
    duration?: "1w" | "2w" | "month"
}

function getInitialSection(): StudioSection {
    if (typeof window === "undefined") return "dashboard"
    const hash = window.location.hash.slice(1)
    return VALID_SECTIONS.includes(hash as StudioSection)
        ? (hash as StudioSection)
        : "dashboard"
}

export interface SubscriptionState {
    planId: string
    planName: string
    status: "active" | "trialing" | "cancelled" | "expired" | "pending"
    creditsUsed: number
    creditsTotal: number
    creditsRemaining: number
    trialEndsAt: string | null
    /** End of the paid period (month or year) — renewal date. */
    currentPeriodEnd: string | null
    /** End of the credit window (always monthly) — when the credit bar resets. */
    creditPeriodEnd: string | null
    allowedActions: string[]
    analytics: "basic" | "full"
    maxProjects: number
    // v2: plan tracking
    planPostsUnlocked: number
    planPostsLimit: number
    planPostsTotal: number
    planGeneratedAt: string | null
    isTrial: boolean
    // v3: growth tiers
    allowedMedia: string[]
    /** Global engine kill-switches (env). Distinct from allowedMedia, which is the
     *  per-plan gate: a medium must pass BOTH to be offered in the picker. */
    reelsEnabled: boolean
    storiesEnabled: boolean
    growthTracking: boolean
    /**
     * Odvozený stav fakturace ze serveru — banner ho jen renderuje. Pravidla
     * o penězích žijí v lib/billing-period.ts, ne tady.
     */
    billingState: "ok" | "expiring_soon" | "dunning" | "grace" | "cancelled" | "expired"
    billingFailures: number
    /** Zákazník vypověděl: běží do currentPeriodEnd, pak skončí. */
    cancelAtPeriodEnd: boolean
    /** Délka zaplaceného období v měsících (1/3/6/12) — viz lib/pricing.ts. */
    termMonths: number
    /** Cena extra kreditu v haléřích, z tarifu — nikdy ji nepiš do UI natvrdo. */
    extraCreditPrice: number
    /** Kolik kreditů si klient v tomhle okně dokoupil nad rámec tarifu. */
    creditsPurchased: number
}

interface StudioState {
    activeSection: StudioSection
    setActiveSection: (s: StudioSection) => void
    projectId: string
    setProjectId: (id: string) => void
    subscription: SubscriptionState | null
    subscriptionLoading: boolean
    refreshSubscription: () => void
    generateIntent: GenerateIntent | null
    setGenerateIntent: (i: GenerateIntent | null) => void
}

const StudioContext = createContext<StudioState>({
    activeSection: "dashboard",
    setActiveSection: () => {},
    projectId: "",
    setProjectId: () => {},
    subscription: null,
    subscriptionLoading: true,
    refreshSubscription: () => {},
    generateIntent: null,
    setGenerateIntent: () => {},
})

export function StudioProvider({ children }: { children: ReactNode }) {
    const [activeSection, setActiveSectionRaw] = useState<StudioSection>(getInitialSection)
    const setActiveSection = useCallback((s: StudioSection) => {
        setActiveSectionRaw(s)
        window.history.pushState(null, "", `#${s}`)
        trackEvent('tab_viewed', { tab_name: s })
    }, [])
    const [projectId, setProjectId] = useState("")
    const [subscription, setSubscription] = useState<SubscriptionState | null>(null)
    const [subscriptionLoading, setSubscriptionLoading] = useState(true)
    const [generateIntent, setGenerateIntent] = useState<GenerateIntent | null>(null)

    // Browser back/forward navigation
    useEffect(() => {
        const handler = () => {
            const hash = window.location.hash.slice(1)
            if (VALID_SECTIONS.includes(hash as StudioSection)) {
                setActiveSectionRaw(hash as StudioSection)
            }
        }
        window.addEventListener("popstate", handler)
        return () => window.removeEventListener("popstate", handler)
    }, [])

    const refreshSubscription = useCallback(async () => {
        if (!projectId) return
        setSubscriptionLoading(true)
        try {
            const resp = await fetch(`/api/subscription?clientId=${projectId}`)
            if (resp.ok) {
                const data = await resp.json()
                // Ensure v2 fields have defaults (safe before DB migration)
                setSubscription(data ? {
                    ...data,
                    planPostsUnlocked: data.planPostsUnlocked ?? 0,
                    planPostsLimit: data.planPostsLimit ?? 0,
                    planPostsTotal: data.planPostsTotal ?? 0,
                    planGeneratedAt: data.planGeneratedAt ?? null,
                    isTrial: data.isTrial ?? false,
                    allowedMedia: data.allowedMedia ?? ALL_MEDIA,
                    // Default OFF: an older API response without the flag means we can't
                    // prove the engine will honour the medium, and offering it would be
                    // the "reel that ships as a carousel" bug.
                    reelsEnabled: data.reelsEnabled ?? false,
                    storiesEnabled: data.storiesEnabled ?? false,
                    growthTracking: data.growthTracking ?? false,
                } : null)
            } else {
                setSubscription(null)
            }
        } catch {
            setSubscription(null)
        } finally {
            setSubscriptionLoading(false)
        }
    }, [projectId])

    // Reload subscription when project changes
    useEffect(() => {
        refreshSubscription()
    }, [refreshSubscription])

    return (
        <StudioContext.Provider value={{
            activeSection, setActiveSection,
            projectId, setProjectId,
            subscription, subscriptionLoading, refreshSubscription,
            generateIntent, setGenerateIntent,
        }}>
            {children}
        </StudioContext.Provider>
    )
}

export function useStudio() {
    return useContext(StudioContext)
}
