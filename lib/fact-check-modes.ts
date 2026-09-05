/**
 * Posuvník opatrnosti — JEDINÝ zdroj pravdy o jeho stupních.
 *
 * Popisky žijí tady, ne v komponentách: posuvník je ve dvou různých UI (Nastavení
 * a onboarding) a kdyby si každé psalo svoje, rozejdou se v tom, co uživateli
 * slibují — a slib o tom, jestli se text opraví sám, nebo se pošle člověku, je
 * přesně ten druh věty, který se rozejít nesmí.
 *
 * Chování režimů vynucuje instagram/fact-check.ts. Ani jeden konec posuvníku
 * nepouští lež: mění se jen to, KDO nepodložené tvrzení vyřeší.
 */

export type FactCheckMode = "off" | "safe" | "balanced" | "bold"

export const FACT_CHECK_MODES: {
    value: FactCheckMode
    label: string
    /** Jedna věta do UI — co se stane s textem. */
    detail: string
}[] = [
    {
        value: "off",
        label: "Vypnuto",
        detail: "Kontrola neběží. AI má pořád zakázáno vymýšlet si údaje, ale nikdo to po ní nekontroluje.",
    },
    {
        value: "safe",
        label: "Opatrné",
        detail: "Opraví všechno, na co si troufne, včetně nadpisů v obrázku. Nejbezpečnější — a občas nejnudnější.",
    },
    {
        value: "balanced",
        label: "Vyvážené",
        detail: "V textu příspěvku opraví, v nadpisu vymění jen špatné číslo za správné. Nadpis bez opory nechá být a označí ho vám.",
    },
    {
        value: "bold",
        label: "Odvážné",
        detail: "Nepřepisuje nic. Text si drží úder a všechna riziková tvrzení dostanete označená k rozhodnutí.",
    },
]

export const DEFAULT_FACT_CHECK_MODE: FactCheckMode = "balanced"

export function factCheckModeIndex(mode: string | undefined): number {
    const i = FACT_CHECK_MODES.findIndex(m => m.value === mode)
    return i === -1 ? FACT_CHECK_MODES.findIndex(m => m.value === DEFAULT_FACT_CHECK_MODE) : i
}
