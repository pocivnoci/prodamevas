/**
 * Token usage meter
 * =================
 * Sčítá spotřebu tokenů napříč všemi voláními modelu v rámci JEDNÉ generace.
 *
 * Proč vůbec: COGS tohohle produktu jsou tokeny, ale `gemini-client.ts` doteď nikde
 * nečetl `usageMetadata`, takže skutečná cena za příspěvek nebyla měřitelná. Cenový
 * model (`docs/pricing/cost-model.ts`) proto stojí na blended údaji z Google faktury —
 * jedno číslo za všechno. Tohle ho rozpadá na příspěvek, médium a klienta.
 *
 * Proč AsyncLocalStorage a ne modulová proměnná: jedna lambda obsluhuje víc requestů
 * současně (Fluid Compute), takže globální akumulátor by míchal spotřebu mezi tenanty
 * úplně stejně, jako to umí `setActiveProject()`. Stejný vzor jako tenant scope
 * v `instagram/service.ts`.
 */

import { AsyncLocalStorage } from "node:async_hooks"

export interface ModelCall {
    model: string
    /** Volitelný štítek kroku (copywriter, critic, designer, vision-qa…) */
    label?: string
    promptTokens: number
    outputTokens: number
    /** Tokeny „přemýšlení" u modelů s thinking režimem — účtují se jako výstup. */
    thoughtTokens: number
    /** Část promptu obsloužená z cache (implicitní i explicitní) — levnější sazba. */
    cachedTokens: number
    /** Netokenové jednotky: Veo se účtuje za vteřinu videa, obrázkové modely za kus.
     *  Bez tohohle by reel — nejdražší médium v produktu — vyšel v telemetrii na nulu. */
    units?: { kind: "seconds" | "images"; n: number }
}

export interface UsageTotals {
    promptTokens: number
    outputTokens: number
    thoughtTokens: number
    cachedTokens: number
    /** Celkem tokenů (prompt + výstup + thinking) — to, co jde do `tokens_used`. */
    totalTokens: number
    /** Kolik volání modelu příspěvek stálo. */
    calls: number
    /** Rozpad po krocích — kvůli otázce „který krok je drahý". */
    breakdown: ModelCall[]
}

class UsageAccumulator {
    readonly calls: ModelCall[] = []

    record(call: ModelCall) {
        this.calls.push(call)
    }

    totals(): UsageTotals {
        const t = this.calls.reduce(
            (acc, c) => ({
                promptTokens: acc.promptTokens + c.promptTokens,
                outputTokens: acc.outputTokens + c.outputTokens,
                thoughtTokens: acc.thoughtTokens + c.thoughtTokens,
                cachedTokens: acc.cachedTokens + c.cachedTokens,
            }),
            { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 },
        )
        return {
            ...t,
            totalTokens: t.promptTokens + t.outputTokens + t.thoughtTokens,
            calls: this.calls.length,
            breakdown: this.calls,
        }
    }
}

const usageStorage = new AsyncLocalStorage<UsageAccumulator>()

/**
 * Spustí `fn` ve vlastním měřicím scope. Všechna volání modelu uvnitř (včetně
 * vnořených await) se sečtou do jednoho výsledku.
 *
 * Měření nesmí nikdy shodit generaci — když `fn` vyhodí, výjimka propadne ven
 * nedotčená a naměřené se zahodí spolu se scope.
 */
export async function withUsageMeter<T>(fn: () => Promise<T>): Promise<{ result: T; usage: UsageTotals }> {
    const acc = new UsageAccumulator()
    const result = await usageStorage.run(acc, fn)
    return { result, usage: acc.totals() }
}

/**
 * Založí měřicí scope a vrátí rovnou výsledek `fn` — pro místa, kde se spotřeba čte
 * ještě zevnitř (`currentUsage()`), typicky protože se loguje před koncem generace.
 */
export function withUsageScope<T>(fn: () => Promise<T>): Promise<T> {
    return usageStorage.run(new UsageAccumulator(), fn)
}

/** Součet naměřený *doteď* v aktuálním scope. Mimo scope `null`. */
export function currentUsage(): UsageTotals | null {
    return usageStorage.getStore()?.totals() ?? null
}

/**
 * Zapíše spotřebu jednoho volání. Mimo `withUsageMeter` scope je to no-op — CLI
 * skripty a jednorázová volání nemusí nic obalovat.
 *
 * Bere surové `usageMetadata` ze SDK; chybějící pole je 0, ne odhad.
 */
export function recordUsage(model: string, usageMetadata: unknown, label?: string): void {
    const acc = usageStorage.getStore()
    if (!acc) return

    const u = (usageMetadata ?? {}) as Record<string, unknown>
    const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

    acc.record({
        model,
        label,
        promptTokens: num(u.promptTokenCount),
        outputTokens: num(u.candidatesTokenCount),
        thoughtTokens: num(u.thoughtsTokenCount),
        cachedTokens: num(u.cachedContentTokenCount),
    })
}

/**
 * Zapíše netokenové volání — video za vteřiny, obrázek za kus. Veo přes
 * `generateVideos` vrací operaci bez `usageMetadata`, takže by jinak nejdražší
 * médium v produktu měřilo nulu.
 */
export function recordUnits(model: string, kind: "seconds" | "images", n: number, label?: string): void {
    const acc = usageStorage.getStore()
    if (!acc) return
    acc.record({
        model,
        label,
        promptTokens: 0,
        outputTokens: 0,
        thoughtTokens: 0,
        cachedTokens: 0,
        units: { kind, n },
    })
}

/** Běží kód uvnitř měřicího scope? Pro testy a diagnostiku. */
export function isMetering(): boolean {
    return usageStorage.getStore() !== undefined
}
