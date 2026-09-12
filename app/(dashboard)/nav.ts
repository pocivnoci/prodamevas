import {
    Home, Images, CalendarDays, Sparkles, Lightbulb, Image as ImageIcon, BarChart3,
    Package, Building2, CircleCheck, UserPlus, KeyRound, Mail, Brain,
    CircleQuestionMark, Settings, LayoutTemplate, ListChecks, Handshake,
    type LucideIcon,
} from "lucide-react"
import type { StudioSection } from "./StudioContext"

/**
 * Jediný seznam navigace pro celé studio.
 *
 * Předtím žil na třech místech — dvě pole a dvě položky natvrdo v JSX sidebaru —
 * takže každá nová obrazovka se musela doplnit ručně na všech. `brain` se doplnit
 * zapomněl a byl dosažitelný jen ručním `#brain` v adresním řádku.
 *
 * Import typu `StudioSection` je záměrně `import type`: `StudioContext` si odsud
 * bere `VALID_SECTIONS`, a typová reference se při buildu zahodí, takže z toho
 * nevznikne cyklus za běhu.
 */

export type NavGroupId = "root" | "content" | "create" | "inspiration" | "analytics" | "account" | "admin"

/** Klíč do `nav` namespace v messages (`t(GROUP_LABELS[g])`). Prázdný = skupina
 *  se v sidebaru vykreslí bez nadpisu. Text samotný žije v `messages/<locale>.json`. */
export const GROUP_LABELS: Record<NavGroupId, string> = {
    root: "",
    content: "groups.content",
    create: "groups.create",
    inspiration: "groups.inspiration",
    analytics: "groups.analytics",
    account: "",
    admin: "groups.admin",
}

/**
 * Klíč do `StudioContext.navBadges`. Odznak je součást registru, ne výjimka
 * v JSX sidebaru: kdyby se číslo dopisovalo natvrdo, spodní lišta a rozbalovací
 * panel by ho neměly — přesně ta chyba, kvůli které registr vznikl.
 */
export type NavBadgeId = "tasksAwaitingAnswer"

export interface NavItem {
    id: StudioSection
    /** Klíč plného názvu v `nav` namespace messages (`t(item.label)`) — sidebar
     *  a rozbalovací panel. Registr nese KLÍČ, text je v `messages/<locale>.json`:
     *  jazyk UI je vlastnost uživatele, registr je jeden pro všechny. */
    label: string
    /** Klíč zkráceného názvu do spodní lišty, kde je na slot ~70 px. */
    shortLabel?: string
    icon: LucideIcon
    /**
     * Další sekce, které tuhle položku rozsvítí. Bez toho by „Kalendář" zhasl,
     * jakmile se přepne na feed nebo se skočí do `plan` — přitom je to pořád
     * tatáž část aplikace.
     */
    matches?: StudioSection[]
    /** Nenulové číslo z `navBadges[badge]` se vykreslí jako odznak. */
    badge?: NavBadgeId
    group: NavGroupId
}

export const NAV_ITEMS: NavItem[] = [
    { id: "dashboard", label: "items.dashboard.label", shortLabel: "items.dashboard.short", icon: Home, group: "root" },

    { id: "posts", label: "items.posts.label", shortLabel: "items.posts.short", icon: Images, group: "content" },
    { id: "plan", label: "items.plan.label", shortLabel: "items.plan.short", icon: CalendarDays, matches: ["plan", "calendar", "feed"], group: "content" },

    { id: "generate", label: "items.generate.label", shortLabel: "items.generate.short", icon: Sparkles, group: "create" },

    { id: "inspiration", label: "items.inspiration.label", icon: Lightbulb, matches: ["inspiration", "ideas", "reviews"], group: "inspiration" },
    { id: "brand", label: "items.brand.label", icon: ImageIcon, group: "inspiration" },

    { id: "performance", label: "items.performance.label", icon: BarChart3, group: "analytics" },
    // Paměť se do sidebaru nikdy nedostala, přestože sekce existuje.
    { id: "brain", label: "items.brain.label", icon: Brain, group: "analytics" },

    { id: "faq", label: "items.faq.label", icon: CircleQuestionMark, group: "account" },
    { id: "settings", label: "items.settings.label", icon: Settings, group: "account" },

    // Otázka od AI čeká na odpověď, dokud si jí někdo nevšimne — odznak je
    // jediné místo, kde je vidět bez otevření sekce.
    { id: "tasks", label: "items.tasks.label", icon: ListChecks, badge: "tasksAwaitingAnswer", group: "admin" },
    { id: "leads", label: "items.leads.label", shortLabel: "items.leads.short", icon: Handshake, group: "admin" },
    { id: "products", label: "items.products.label", icon: Package, group: "admin" },
    { id: "company", label: "items.company.label", icon: Building2, group: "admin" },
    { id: "approvals", label: "items.approvals.label", icon: CircleCheck, group: "admin" },
    { id: "onboard", label: "items.onboard.label", icon: UserPlus, group: "admin" },
    { id: "waitlist", label: "items.waitlist.label", icon: KeyRound, group: "admin" },
    { id: "mailing", label: "items.mailing.label", icon: Mail, group: "admin" },
    { id: "emails", label: "items.emails.label", icon: LayoutTemplate, group: "admin" },
]

/** Sekce, které nemají vlastní položku — dosažitelné jen přes sub-taby nebo prokliky. */
const SUBSECTIONS: StudioSection[] = ["calendar", "feed", "ideas", "reviews"]

/** Zdroj pravdy pro validaci hashe v URL. Dřív to byla ručně udržovaná kopie. */
export const ALL_SECTIONS: StudioSection[] = [
    ...new Set<StudioSection>([...NAV_ITEMS.map(i => i.id), ...SUBSECTIONS]),
]

export function navItem(id: StudioSection): NavItem | undefined {
    return NAV_ITEMS.find(i => i.id === id)
}

/** Svítí položka pro právě otevřenou sekci? */
export function navMatches(item: NavItem, active: StudioSection): boolean {
    return item.id === active || (item.matches?.includes(active) ?? false)
}

export function itemsInGroup(group: NavGroupId): NavItem[] {
    return NAV_ITEMS.filter(i => i.group === group)
}

/** Skupiny do hlavní části sidebaru, v pořadí. Admin a account se vykreslují zvlášť. */
export const SIDEBAR_GROUPS: NavGroupId[] = ["root", "content", "create", "inspiration", "analytics"]

/**
 * Spodní lišta: dvě položky, zvýrazněná akce uprostřed, jedna položka, „Více".
 * Sestava vychází z běžného denního průchodu — kouknu, co je nového, něco
 * vygeneruju, naplánuju to.
 */
export const BOTTOM_NAV_LEFT: StudioSection[] = ["dashboard", "posts"]
export const BOTTOM_NAV_RIGHT: StudioSection[] = ["plan"]
export const BOTTOM_NAV_FAB: StudioSection = "generate"

/**
 * Mezi čím se dá přejíždět prstem — jen položky lišty, v pořadí zleva doprava.
 * Ne přes všech 20 sekcí: formuláře a dlouhé běhy se nesmí dát opustit omylem.
 */
export const SWIPE_ORDER: StudioSection[] = [...BOTTOM_NAV_LEFT, ...BOTTOM_NAV_RIGHT]
