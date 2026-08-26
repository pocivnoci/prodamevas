/**
 * Měření útraty za modely MIMO generování příspěvků.
 * =================================================
 * `withUsageScope` obaluje jedinou cestu — `generateOnePost`. Všechno ostatní, co
 * volá model, bylo v účetnictví neviditelné: nápady, onboarding, produktové studio,
 * tisk, štítkování fotek.
 *
 * Naměřeno 23. 8. 2026: Google za týden 411,78 Kč, `ig_generation_log` uměl vysvětlit
 * ~100 Kč. Největší položka týdne (400 nápadů jedním hromadným během, ~250 Kč) v datech
 * nebyla vůbec — našla se až ručním porovnáním s fakturou. Tenhle modul to zavírá.
 *
 * Server-only (service-role klient). Zápis do `ai_spend`.
 */

import supabaseAdmin from "@/supabase/admin"
import { withUsageScope, currentUsage } from "./usage-meter"
import { costUsdForBreakdown } from "@/lib/model-pricing"

/** Krátký, stabilní klíč operace — seskupuje se podle něj, takže se nesmí rozjet. */
export type SpendOperation =
    | "ideas"                 // generování nápadů (CLI, UI i noční doplňování)
    | "onboarding_analyze"    // scrape webu + AI analýza značky + dotazník
    | "onboarding_config"     // skládání ClientConfig včetně štítkování fotek
    | "product_ideas"         // produktové studio — nápady
    | "product_design"        // produktové studio — grafika a mockupy
    | "product_line"          // produktová řada — návrh i revize SKU
    | "product_import"        // čtení produktů z odkazů (AI fallback nad stránkou)
    | "print"                 // tiskový engine — brief, artwork, mockup
    | "content_plan"          // hluboká pipeline obsahového plánu
    | "post_edit"             // retuš hotového příspěvku (edit obrázku)
    | "learn"                 // učení z metrik (analyzeAndLearn)
    | "sales_preview"         // ukázka pro obchodního agenta
    | "other"

/**
 * Slug → UUID klienta pro účely účtování.
 *
 * Vrací `null`, když se tenant nepodaří přeložit — a to je tady schválně, na rozdíl
 * od zbytku aplikace, kde chybějící identifikátor musí vyhodit výjimku. Účtovací
 * řádek bez klienta je pořád pravdivý (`ai_spend.client_id` je nullable kvůli
 * systémovým běhům); zahodit kvůli neznámému tenantovi celou informaci o útratě by
 * znamenalo vrátit se přesně k té slepé skvrně, kterou tahle tabulka zavírá.
 * Nikdy se tu nedosazuje náhradní tenant — jen se přizná, že není známý.
 */
export async function spendClientId(slug: string | null | undefined): Promise<string | null> {
    if (!slug) return null
    try {
        const { resolveClientId } = await import("./configs")
        return await resolveClientId(slug)
    } catch {
        return null
    }
}

/**
 * Spustí `fn` v měřicím scope a naměřenou spotřebu uloží do `ai_spend`.
 *
 * Měření NIKDY neshodí práci, kterou měří: když selže zápis, jen se to zaloguje.
 * Když selže `fn`, výjimka propadne ven nedotčená — ale to, co se do té chvíle
 * spotřebovalo, se přesto zapíše. Právě neúspěšné běhy jsou totiž ty, u kterých
 * člověk potřebuje vědět, kolik stály.
 */
export async function trackSpend<T>(
    operation: SpendOperation,
    opts: { clientId?: string | null; refId?: string | null },
    fn: () => Promise<T>,
): Promise<T> {
    // Scope + čtení zevnitř `finally` schválně: kdyby se spotřeba brala až
    // z návratové hodnoty, běh, který spadl v půlce, by se nezapsal vůbec — a právě
    // ty jsou nejdražší, protože se za ně zaplatilo a nic z nich není.
    return withUsageScope(async () => {
        try {
            return await fn()
        } finally {
            const usage = currentUsage()
            if (usage) await persist(operation, opts, usage)
        }
    })
}

async function persist(
    operation: SpendOperation,
    opts: { clientId?: string | null; refId?: string | null },
    usage: { promptTokens: number; outputTokens: number; thoughtTokens: number; cachedTokens: number; calls: number; breakdown: unknown[] },
): Promise<void> {
    if (usage.calls === 0) return // nic se nevolalo → není co účtovat
    try {
        const cost = costUsdForBreakdown(usage.breakdown as never)
        await supabaseAdmin.from("ai_spend").insert({
            client_id: opts.clientId ?? null,
            operation,
            ref_id: opts.refId ?? null,
            prompt_tokens: usage.promptTokens,
            output_tokens: usage.outputTokens,
            thought_tokens: usage.thoughtTokens,
            cached_tokens: usage.cachedTokens,
            model_calls: usage.calls,
            cost_usd: cost, // null = neznámá sazba; vymyšlená nula by lhala
            breakdown: usage.breakdown as never,
        })
        const czk = cost === null ? "?" : (cost * (Number(process.env.USD_CZK_RATE) || 21.2)).toFixed(2)
        console.log(`   💰 ${operation}: ${usage.calls} volání, ${czk} Kč`)
    } catch (err) {
        // Účetnictví nesmí shodit práci, kterou účtuje.
        console.warn(`⚠️ ai_spend zápis selhal (${operation}): ${(err as Error).message?.slice(0, 100)}`)
    }
}
