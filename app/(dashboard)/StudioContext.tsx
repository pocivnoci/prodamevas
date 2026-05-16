"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"

export type StudioSection =
    | "posts"
    | "calendar"
    | "feed"
    | "generate"
    | "ideas"
    | "reviews"
    | "brand"
    | "products"
    | "performance"
    | "settings"

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
}

interface StudioState {
    activeSection: StudioSection
    setActiveSection: (s: StudioSection) => void
    projectId: string
    setProjectId: (id: string) => void
    subscription: SubscriptionState | null
    subscriptionLoading: boolean
    refreshSubscription: () => void
}

const StudioContext = createContext<StudioState>({
    activeSection: "posts",
    setActiveSection: () => {},
    projectId: "",
    setProjectId: () => {},
    subscription: null,
    subscriptionLoading: true,
    refreshSubscription: () => {},
})

export function StudioProvider({ children }: { children: ReactNode }) {
    const [activeSection, setActiveSection] = useState<StudioSection>("posts")
    const [projectId, setProjectId] = useState("")
    const [subscription, setSubscription] = useState<SubscriptionState | null>(null)
    const [subscriptionLoading, setSubscriptionLoading] = useState(true)

    const refreshSubscription = useCallback(async () => {
        if (!projectId) return
        setSubscriptionLoading(true)
        try {
            const resp = await fetch(`/api/subscription?clientId=${projectId}`)
            if (resp.ok) {
                const data = await resp.json()
                setSubscription(data)
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
        }}>
            {children}
        </StudioContext.Provider>
    )
}

export function useStudio() {
    return useContext(StudioContext)
}
