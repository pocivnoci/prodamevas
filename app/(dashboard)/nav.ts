import {
    Home, Images, CalendarDays, Sparkles, Lightbulb, Image as ImageIcon, BarChart3,
    Package, Building2, CircleCheck, UserPlus, KeyRound, Mail, Brain,
    CircleQuestionMark, Settings, LayoutTemplate,
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

/** Prázdný label = skupina se v sidebaru vykreslí bez nadpisu. */
export const GROUP_LABELS: Record<NavGroupId, string> = {
    root: "",
    content: "Obsah",
    create: "Tvořit",
    inspiration: "Inspirace",
    analytics: "Analytika",
    account: "",
    admin: "Admin",
}

export interface NavItem {
    id: StudioSection
    /** Plný název — sidebar a rozbalovací panel. */
    label: string
    /** Zkrácený název do spodní lišty, kde je na slot ~70 px. */
    shortLabel?: string
    icon: LucideIcon
    /**
     * Další sekce, které tuhle položku rozsvítí. Bez toho by „Kalendář" zhasl,
     * jakmile se přepne na feed nebo se skočí do `plan` — přitom je to pořád
     * tatáž část aplikace.
     */
    matches?: StudioSection[]
    group: NavGroupId
}

export const NAV_ITEMS: NavItem[] = [
    { id: "dashboard", label: "Dashboard", shortLabel: "Přehled", icon: Home, group: "root" },

    { id: "posts", label: "Příspěvky", shortLabel: "Příspěvky", icon: Images, group: "content" },
    { id: "plan", label: "Plán", shortLabel: "Kalendář", icon: CalendarDays, matches: ["plan", "calendar", "feed"], group: "content" },

    { id: "generate", label: "Generovat", shortLabel: "Generovat", icon: Sparkles, group: "create" },

    { id: "inspiration", label: "Nápady & Recenze", icon: Lightbulb, matches: ["inspiration", "ideas", "reviews"], group: "inspiration" },
    { id: "brand", label: "Fotky značky", icon: ImageIcon, group: "inspiration" },

    { id: "performance", label: "Výkon", icon: BarChart3, group: "analytics" },
    // Paměť se do sidebaru nikdy nedostala, přestože sekce existuje.
    { id: "brain", label: "Paměť", icon: Brain, group: "analytics" },

    { id: "faq", label: "Nápověda", icon: CircleQuestionMark, group: "account" },
    { id: "settings", label: "Nastavení", icon: Settings, group: "account" },

    { id: "products", label: "Produkty", icon: Package, group: "admin" },
    { id: "company", label: "Firma", icon: Building2, group: "admin" },
    { id: "approvals", label: "Schválení", icon: CircleCheck, group: "admin" },
    { id: "onboard", label: "Onboarding", icon: UserPlus, group: "admin" },
    { id: "waitlist", label: "Waitlist", icon: KeyRound, group: "admin" },
    { id: "mailing", label: "Mailing", icon: Mail, group: "admin" },
    { id: "emails", label: "Šablony", icon: LayoutTemplate, group: "admin" },
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
