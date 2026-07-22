"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { trackEvent } from "@/lib/analytics"

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

const VALID_SECTIONS: StudioSection[] = [
    "dashboard", "posts", "calendar", "feed", "plan", "generate",
    "ideas", "reviews", "inspiration", "brand", "products",
    "performance", "settings", "onboard", "waitlist", "brain", "faq", "approvals", "mailing",
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
    currentPeriodEnd: string | null
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
    growthTracking: boolean
    /** Global reel kill-switch (REELS_ENABLED env) — false = engine clamps reels to carousel */
    reelsEnabled: boolean
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
                    allowedMedia: data.allowedMedia ?? ["image", "carousel", "reel"],
                    growthTracking: data.growthTracking ?? false,
                    reelsEnabled: data.reelsEnabled ?? false,
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
