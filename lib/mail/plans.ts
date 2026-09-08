/**
 * Ceník uvnitř e-mailu — jediný překlad z `lib/pricing.ts` do vět.
 * ================================================================
 * Doktrína je stejná jako v `templates/offer.ts`: **v šabloně se nepíše ručně
 * ani jedno číslo.** Cena opsaná do textu zestárne při nejbližším přecenění
 * a nikdo se to nedozví — zákazník dostane cenu, kterou mu pokladna neúčtuje.
 *
 * A netýká se to jen odesílaného textu. `sample` je v Mailingu **předvyplnění
 * formuláře** (`MailingTab`: `setVars({ ...t.sample })`), ne jen náhled: co je
 * v ukázce, to obchodník odešle, když to nepřepíše. Šablony předplatného proto
 * do 9/2026 nabízely „Růst za 1 990 Kč" — cenu z ceníku v5, o tisícovku pod
 * skutečností, a k tomu 45 kreditů, které tarif nemá.
 *
 * Reels mají vlastní past: `REELS_ENABLED` potichu překlápí `reel` na karusel
 * a od 9/2026 je Růst v `PLAN_COPY` vůbec nemá (drží je až Dominance). Odrážku
 * o videu proto smí napsat jen `planBullets()`, kde platí obojí.
 *
 * Modul je čistý — žádná DB, žádné `server-only` (aserce 29.1).
 */

import { countLabel, CREDITS } from "@/lib/plural"
import { creditExample } from "@/lib/credits"
import { FALLBACK_PLANS, formatCzk, PLAN_COPY, type PricingPlan } from "@/lib/pricing"

/** Jedou reels doopravdy? Stejná otázka, jakou si klade ceník na landingu. */
export const reelsLive = (): boolean => process.env.REELS_ENABLED === "1"

/** Nabízí tenhle tarif reels *a* jsou zapnuté? Obojí musí platit. */
export const planHasReels = (plan: PricingPlan): boolean => plan.allowsReels && reelsLive()

/**
 * Tarif, na kterém stojí ukázky a nabídky — ten, který ceník sám doporučuje
 * (`highlight` v `PLAN_COPY`, dnes Růst). Ne první v poli: doporučený tarif je
 * obchodní rozhodnutí, které už jednou padlo na ceníku.
 */
export function recommendedPlan(): PricingPlan {
    return FALLBACK_PLANS.find(p => PLAN_COPY[p.id]?.highlight) ?? FALLBACK_PLANS[0]
}

/**
 * Tarif podle toho, co obchodník napsal do formuláře. Diakritika ani velikost
 * písmen nerozhoduje — „dominance" i „Dominance" musí najít totéž. Když se nic
 * netrefí, padá to na doporučený tarif, ne na nejlevnější.
 */
export function pickPlan(name: string): PricingPlan {
    const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    const wanted = norm(name)
    const byName = wanted && FALLBACK_PLANS.find(p => norm(p.name) === wanted || norm(p.id) === wanted)
    return byName || recommendedPlan()
}

/** Odrážky tarifu z ceníkové kopie; reels si nesou přiznání, když jsou vypnuté. */
export function planBullets(plan: PricingPlan): string[] {
    return (PLAN_COPY[plan.id]?.bullets ?? []).map(b =>
        typeof b === "string" ? b : reelsLive() ? b.text : `${b.text} (připravujeme)`,
    )
}

/** „70 kreditů měsíčně — ≈ 70 obrázků nebo 23 carouselů" */
export function creditLine(plan: PricingPlan): string {
    return `${countLabel(plan.creditsPerMonth, CREDITS)} měsíčně — ${creditExample(plan.creditsPerMonth, { reels: planHasReels(plan) })}`
}

// ─── Ukázková data šablon ────────────────────────────────────────────────────

/** „2 999 Kč" — měsíční cena doporučeného tarifu. */
export function samplePrice(): string {
    return formatCzk(recommendedPlan().monthlyHaleru)
}

/** „2 999 Kč měsíčně" — tam, kde věta potřebuje i období. */
export function samplePriceMonthly(): string {
    return `${samplePrice()} měsíčně`
}

/** „70" — kolik kreditů doporučený tarif opravdu dává. */
export function sampleCredits(): string {
    return String(recommendedPlan().creditsPerMonth)
}

/** „Růst" — název doporučeného tarifu. */
export function samplePlanName(): string {
    return recommendedPlan().name
}
