"use server"

import { requireProjectAccess } from "@/lib/auth-guard"
import supabaseAdmin from "@/supabase/admin"
import { buildDuels, type Duel } from "@/lib/ab-duel"

/**
 * Vyhodnocení A/B soubojů.
 *
 * Varianty se generovaly od chvíle, kdy vznikl tarif Růst, ale nikdo je nikdy
 * neporovnal — zákazník dostal dvě verze, jednu vybral a tím to skončilo. Data
 * přitom v `ig_posts` ležela celou dobu: varianta nese `link_type='variant'`
 * a přes `revision_of` ukazuje na originál, metriky mají obě.
 *
 * Rozhodování o vítězi je v čistém `lib/ab-duel.ts`, aby šlo otestovat bez DB.
 * Tady zůstává jen ověření přístupu, dotaz a tarifní brána.
 */

export interface DuelsResult {
    /** `false` = tarif na tohle nemá. UI ukáže zámek, ne prázdný seznam. */
    allowed: boolean
    duels: Duel[]
    error?: string
}

export async function getVariantDuels(projectSlug: string): Promise<DuelsResult> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // Brána je na SERVERU, ne jen ve schování komponenty. Skrytá sekce, kterou
        // vrátí i tak plná server action, není placená hranice — je to dekorace.
        const { getClientSubscription } = await import("@/lib/subscription")
        const sub = await getClientSubscription(clientId)
        if (!sub?.features?.allowed_actions?.includes("post_variant")) {
            return { allowed: false, duels: [] }
        }

        // Načítá se originál i varianta v jednom dotazu; párování řeší buildDuels.
        // Filtr na `revision_of not null` by originály vynechal, takže se bere
        // okno posledních příspěvků a spáruje se v paměti.
        const { data } = await supabaseAdmin
            .from("ig_posts")
            .select("id, caption, image_url, status, likes, comments, saves, posted_at, link_type, revision_of")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(120)

        return { allowed: true, duels: buildDuels(data || []) }
    } catch (err) {
        return { allowed: false, duels: [], error: (err as Error).message }
    }
}
