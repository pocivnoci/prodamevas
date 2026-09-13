"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { trackEvent } from "@/lib/analytics"
import { ALL_MEDIA } from "@/lib/credits"
import { ALL_SECTIONS, SWIPE_ORDER } from "./nav"
import { getAvailableIGClients, isCurrentUserSuperAdmin } from "@/app/actions/admin-actions"

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
    | "tasks"
    | "leads"
    | "finance"

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

/** Značka v přepínači. `id` je SLUG klienta, ne UUID — viz `projectId` níž. */
export interface ClientInfo { id: string; clientId?: string; name: string; icon: string; description: string }

/** Last tenant the user picked in the sidebar. Value is a client SLUG (`projectId`
 *  is a slug despite the name). Only ever trusted after it is matched against the
 *  list getAvailableIGClients() returns for the current session. */
const PROJECT_STORAGE_KEY = "chrlit_active_project"

function readStoredProject(): string | null {
    try {
        return localStorage.getItem(PROJECT_STORAGE_KEY)
    } catch {
        return null // private mode / storage disabled
    }
}

/**
 * Hash nese sekci a nepovinné parametry: `#tasks?id=<uuid>`, `#mailing?to=…`.
 *
 * Query ZA hashem, ne před ním: sekce je stav uvnitř jedné stránky, takže
 * `?id=…#tasks` by poslalo parametr na server (a v logu by skončilo UUID úkolu),
 * zatímco tenhle tvar zůstane v prohlížeči. Adresa zároveň jde poslat kolegovi —
 * a to je celý smysl: „koukni na tenhle úkol" místo „otevři Úkoly a najdi ho".
 */
function parseHash(raw: string): { section: StudioSection; params: Record<string, string> } {
    const hash = raw.startsWith("#") ? raw.slice(1) : raw
    const [name, query] = hash.split("?")
    const section = VALID_SECTIONS.includes(name as StudioSection) ? (name as StudioSection) : "dashboard"
    const params: Record<string, string> = {}
    if (query) {
        for (const [k, v] of new URLSearchParams(query)) params[k] = v
    }
    return { section, params }
}

function getInitialSection(): StudioSection {
    if (typeof window === "undefined") return "dashboard"
    return parseHash(window.location.hash).section
}

function getInitialDeepLink(): Record<string, string> | null {
    if (typeof window === "undefined") return null
    const { params } = parseHash(window.location.hash)
    return Object.keys(params).length > 0 ? params : null
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
    billingState: "ok" | "expiring_soon" | "dunning" | "grace" | "cancelled" | "expired" | "gift_ending"
    billingFailures: number
    /** Zákazník vypověděl: běží do currentPeriodEnd, pak skončí. */
    cancelAtPeriodEnd: boolean
    /** Délka zaplaceného období v měsících (1/3/6/12) — viz lib/pricing.ts. */
    termMonths: number
    /** `gift` = tarif zdarma od správce: nic se nestrhává a na konci skončí. */
    provider?: "comgate" | "stripe" | "gift"
    /** Cena extra kreditu v haléřích, z tarifu — nikdy ji nepiš do UI natvrdo. */
    extraCreditPrice: number
    /** Kolik kreditů si klient v tomhle okně dokoupil nad rámec tarifu. */
    creditsPurchased: number
}

interface StudioState {
    activeSection: StudioSection
    setActiveSection: (s: StudioSection, opts?: { replace?: boolean; query?: Record<string, string> }) => void
    projectId: string
    setProjectId: (id: string) => void
    /** Značky, na které tenhle účet vidí. */
    clients: ClientInfo[]
    /** Je přihlášený super-admin? Než se to zjistí, `false` — admin sekce se
     *  během načítání neukazuje. */
    isAdmin: boolean
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
    /**
     * Parametry za hashem pro právě otevřenou sekci (`#tasks?id=…`). Tab si je
     * přečte při příchodu — rozbalí úkol, předvyplní příjemce — a zahodí přes
     * `clearDeepLink()`, aby se to nedělo znovu při každém překreslení.
     */
    deepLink: Record<string, string> | null
    clearDeepLink: () => void
    /**
     * Čísla do odznaků v navigaci, klíčované `NavItem.badge`. Drží je kontext,
     * protože je čte sidebar i spodní lišta a obojí je v DOM zároveň — dva
     * nezávislé fetche by znamenaly dvě server akce na každé načtení studia.
     */
    navBadges: Record<string, number>
    refreshNavBadges: () => void
}

const StudioContext = createContext<StudioState>({
    activeSection: "dashboard",
    setActiveSection: () => {},
    projectId: "",
    setProjectId: () => {},
    clients: [],
    isAdmin: false,
    subscription: null,
    subscriptionLoading: true,
    refreshSubscription: () => {},
    generateIntent: null,
    setGenerateIntent: () => {},
    navDirection: 0,
    refreshNonce: 0,
    bumpRefresh: () => {},
    deepLink: null,
    clearDeepLink: () => {},
    navBadges: {},
    refreshNavBadges: () => {},
})

export function StudioProvider({ children }: { children: ReactNode }) {
    const [activeSection, setActiveSectionRaw] = useState<StudioSection>(getInitialSection)
    const [navDirection, setNavDirection] = useState(0)
    const [refreshNonce, setRefreshNonce] = useState(0)
    // Směr se počítá ze sekce, ze které odcházíme. Ref, ne stav — čte se uvnitř
    // setteru a nesmí ho zpožďovat další render.
    const currentRef = useRef<StudioSection>(activeSection)
    currentRef.current = activeSection

    const [deepLink, setDeepLink] = useState<Record<string, string> | null>(getInitialDeepLink)
    const clearDeepLink = useCallback(() => setDeepLink(null), [])
    const [navBadges, setNavBadges] = useState<Record<string, number>>({})

    const setActiveSection = useCallback((s: StudioSection, opts?: { replace?: boolean; query?: Record<string, string> }) => {
        const from = SWIPE_ORDER.indexOf(currentRef.current)
        const to = SWIPE_ORDER.indexOf(s)
        setNavDirection(from >= 0 && to >= 0 && from !== to ? Math.sign(to - from) : 0)

        setActiveSectionRaw(s)
        // Parametry se nastaví rovnou, ne až z `popstate` — ten se při vlastním
        // `pushState` nespustí a cílový tab by o deep-linku nevěděl.
        setDeepLink(opts?.query && Object.keys(opts.query).length > 0 ? opts.query : null)

        // `replace` je pro ťuknutí na už otevřenou položku lišty — jinak by se
        // historie zaplnila stejným záznamem a tlačítko zpět by přestalo fungovat.
        const query = opts?.query ? new URLSearchParams(opts.query).toString() : ""
        const url = query ? `#${s}?${query}` : `#${s}`
        if (opts?.replace) window.history.replaceState(null, "", url)
        else window.history.pushState(null, "", url)
        trackEvent('tab_viewed', { tab_name: s })
    }, [])

    const bumpRefresh = useCallback(() => setRefreshNonce(n => n + 1), [])
    const [projectId, setProjectId] = useState("")
    const [clients, setClients] = useState<ClientInfo[]>([])
    const [isAdmin, setIsAdmin] = useState(false)
    const [subscription, setSubscription] = useState<SubscriptionState | null>(null)
    const [subscriptionLoading, setSubscriptionLoading] = useState(true)
    const [generateIntent, setGenerateIntent] = useState<GenerateIntent | null>(null)

    /**
     * Kdo je přihlášený a na co vidí — načte se JEDNOU za život tohohle layoutu.
     *
     * Dřív si obojí drželo `StudioNavPanel` v promisách na úrovni MODULU, aby
     * dvojitý mount panelu na telefonu (skrytý sidebar + vyjížděcí sheet)
     * neznamenal dvě volání serveru. Jenže odhlášení je `redirect()` ze server
     * akce, tedy měkká navigace — dokument se nepřenačte a modul si cache nese
     * dál. Kdo se po adminovi přihlásil v témž panelu, viděl v menu adminskou
     * sekci i cizí značky. Provider žije v layoutu `(dashboard)`, který se při
     * odchodu na `/` odmountuje, takže se identita nemá kde přežít.
     */
    useEffect(() => {
        let alive = true
        getAvailableIGClients()
            .then(list => {
                if (!alive) return
                setClients(list)
                if (list.length === 0) return
                // Precedence: explicit deep link → last selection → first client.
                //
                // `projectId` is plain React state, so a reload wipes it. "Aktualizovat"
                // is window.location.reload(), which meant every refresh silently threw
                // you back to clients[0] — and because activeSection rides the URL hash
                // and DOES survive, you stayed on the same tab while the tenant under it
                // changed. Persisting the choice is what makes refresh non-destructive.
                //
                // Every candidate is validated against the user's OWN list before it can
                // select anything: a stale slug (access revoked, another account on a
                // shared browser) must fall through to clients[0], never resolve.
                // `?project=` z e-mailu nese UUID (agenti mají po ruce client_id, ne slug),
                // sidebar a localStorage slug. Obojí se mapuje na slug PŘES vlastní seznam —
                // neznámá hodnota nikdy nic nevybere.
                const wanted = new URLSearchParams(window.location.search).get("project")
                const stored = readStoredProject()
                const toSlug = (id: string | null) => id ? list.find(c => c.id === id || c.clientId === id)?.id ?? null : null
                const pick = toSlug(wanted) ?? toSlug(stored)
                setProjectId(prev => prev || pick || list[0].id)
            })
            .catch(() => { if (alive) setClients([]) })

        isCurrentUserSuperAdmin()
            .then(admin => { if (alive) setIsAdmin(admin) })
            .catch(() => { if (alive) setIsAdmin(false) })

        return () => { alive = false }
    }, [])

    // Remember the active tenant across reloads (see precedence note above).
    useEffect(() => {
        if (!projectId) return
        try {
            localStorage.setItem(PROJECT_STORAGE_KEY, projectId)
        } catch {
            // Private mode / storage disabled — selection just won't survive a reload.
        }
    }, [projectId])

    // Browser back/forward navigation
    useEffect(() => {
        const handler = () => {
            const raw = window.location.hash.slice(1)
            const name = raw.split("?")[0]
            if (!VALID_SECTIONS.includes(name as StudioSection)) return
            const { section, params } = parseHash(raw)
            setActiveSectionRaw(section)
            setDeepLink(Object.keys(params).length > 0 ? params : null)
        }
        window.addEventListener("popstate", handler)
        return () => window.removeEventListener("popstate", handler)
    }, [])

    /**
     * Odznaky v navigaci. Otázka od AI visí na úkolu, dokud na ni někdo
     * neodpoví — a bez čísla u položky „Úkoly" se na ni přijde jen tak, že se
     * tam někdo náhodou podívá.
     *
     * Akce je adminská a pro běžného uživatele vyhodí výjimku; to není chyba,
     * jen nula. Načítá se jednou při mountu, ne na časovač: číslo, které se
     * mění párkrát denně, nestojí za opakovaný dotaz.
     */
    const refreshNavBadges = useCallback(() => {
        import("@/app/actions/task-actions")
            .then(m => m.countTasksAwaitingAnswer())
            .then(count => setNavBadges(prev => ({ ...prev, tasksAwaitingAnswer: count })))
            .catch(() => { /* není admin, nebo je databáze mimo — odznak prostě není */ })
    }, [])

    useEffect(() => { refreshNavBadges() }, [refreshNavBadges])

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
            clients, isAdmin,
            subscription, subscriptionLoading, refreshSubscription,
            generateIntent, setGenerateIntent,
            navDirection, refreshNonce, bumpRefresh,
            deepLink, clearDeepLink,
            navBadges, refreshNavBadges,
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

    /**
     * Druhý parametr je buď volby (`{ replace: true }`), nebo rovnou parametry
     * pro cílový tab (`{ to: "…" }`) — proklik „Napsat e-mail" se tak píše
     * `navigate("mailing", { to: lead.email })` a nemusí znát vnitřek Mailingu.
     */
    return useCallback((s: StudioSection, opts?: { replace?: boolean } | Record<string, string>) => {
        // Bez options se dřív jen nastavil stav a route zůstala — přesně ta „zaseknutá
        // aplikace" z komentáře výš, jen v nejběžnějším volání `navigate("settings")`.
        const { replace, ...rest } = (opts ?? {}) as { replace?: boolean } & Record<string, string>
        setActiveSection(s, { replace, query: Object.keys(rest).length > 0 ? rest : undefined })
        if (pathname !== "/dashboard/instagram") router.push("/dashboard/instagram")
    }, [setActiveSection, pathname, router])
}
