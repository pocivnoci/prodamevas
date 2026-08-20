"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { trackEvent } from "@/lib/analytics"
import { ALL_MEDIA } from "@/lib/credits"
import { ALL_SECTIONS, SWIPE_ORDER } from "./nav"

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
    | "emails"
    | "company"

// Seznam platných sekcí odvozuje registr v `nav.ts` (import nahoře) — ručně
// udržovaná kopie se od unionu výš pokaždé rozešla. Union zůstává ručně: je to
// typ, proti kterému se registr validuje (`NavItem.id: StudioSection`).
const VALID_SECTIONS = ALL_SECTIONS

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
    /** Dopočítané při načtení — viz `refreshSubscription`. */
    trialDaysLeft: number | null
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
    setActiveSection: (s: StudioSection, opts?: { replace?: boolean }) => void
    projectId: string
    setProjectId: (id: string) => void
    subscription: SubscriptionState | null
    subscriptionLoading: boolean
    refreshSubscription: () => void
    generateIntent: GenerateIntent | null
    setGenerateIntent: (i: GenerateIntent | null) => void
    /** Odkud kam se šlo v rámci lišty: -1 doleva, 1 doprava, 0 skok jinam. */
    navDirection: number
    /** Zvýší se při tažení pro obnovení; `page.tsx` ho má v `key`, takže se tab přemountuje. */
    refreshNonce: number
    bumpRefresh: () => void
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
    navDirection: 0,
    refreshNonce: 0,
    bumpRefresh: () => {},
})

export function StudioProvider({ children }: { children: ReactNode }) {
    const [activeSection, setActiveSectionRaw] = useState<StudioSection>(getInitialSection)
    const [navDirection, setNavDirection] = useState(0)
    const [refreshNonce, setRefreshNonce] = useState(0)
    // Směr se počítá ze sekce, ze které odcházíme. Ref, ne stav — čte se uvnitř
    // setteru a nesmí ho zpožďovat další render.
    const currentRef = useRef<StudioSection>(activeSection)
    currentRef.current = activeSection

    const setActiveSection = useCallback((s: StudioSection, opts?: { replace?: boolean }) => {
        const from = SWIPE_ORDER.indexOf(currentRef.current)
        const to = SWIPE_ORDER.indexOf(s)
        setNavDirection(from >= 0 && to >= 0 && from !== to ? Math.sign(to - from) : 0)

        setActiveSectionRaw(s)
        // `replace` je pro ťuknutí na už otevřenou položku lišty — jinak by se
        // historie zaplnila stejným záznamem a tlačítko zpět by přestalo fungovat.
        const url = `#${s}`
        if (opts?.replace) window.history.replaceState(null, "", url)
        else window.history.pushState(null, "", url)
        trackEvent('tab_viewed', { tab_name: s })
    }, [])

    const bumpRefresh = useCallback(() => setRefreshNonce(n => n + 1), [])
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
                    // Počítá se tady, ne při vykreslení: `Date.now()` v renderu je
                    // nečistá funkce a hodnota by se měnila při každém překreslení.
                    // Zbývající dny navíc patří k načteným datům — jsou stejně čerstvé.
                    trialDaysLeft: data.trialEndsAt
                        ? Math.max(0, Math.ceil((new Date(data.trialEndsAt).getTime() - Date.now()) / 86400000))
                        : null,
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
            navDirection, refreshNonce, bumpRefresh,
        }}>
            {children}
        </StudioContext.Provider>
    )
}

export function useStudio() {
    return useContext(StudioContext)
}

/**
 * Přepnutí sekce odkudkoli pod dashboard layoutem.
 *
 * Sekce je stav, ne route, takže `setActiveSection` sám o sobě nic neudělá na
 * `/dashboard/settings` — ta stránka ho nečte. Sidebar tím trpí už dnes: kliknutí
 * na položku tam vypadá jako zaseknutá aplikace. Pořadí je podstatné — stav se
 * nastaví první, layout se při změně route nedemountuje, takže `getInitialSection()`
 * podruhé neproběhne a nepřebije ho hashem.
 */
export function useStudioNavigate() {
    const { setActiveSection } = useStudio()
    const pathname = usePathname()
    const router = useRouter()

    return useCallback((s: StudioSection, opts?: { replace?: boolean }) => {
        setActiveSection(s, opts)
        if (pathname !== "/dashboard/instagram") router.push("/dashboard/instagram")
    }, [setActiveSection, pathname, router])
}
