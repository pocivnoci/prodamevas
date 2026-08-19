/**
 * Parkování zakázky, když je kvalita dočasně nedostupná.
 * ======================================================
 * CLAUDE.md zakazuje tichou degradaci: Pro tier nesmí spadnout na flash. Když
 * tedy dojdou všechny Pro stupně, engine nemá čím render dokončit — ale to není
 * důvod zákazníka odmítnout. Zadání zní: **radši zítra, ale v top kvalitě.**
 *
 * Zaparkovaný job proto zůstává `failed` (stav má v DB pevný CHECK a resume cesta
 * v `/api/ig-run-job` na `failed` + caption checkpoint spoléhá), ale nese
 * `retry_after`. Tím se liší od skutečného selhání:
 *
 *   selhání   → kredit se VRACÍ, job je mrtvý
 *   parkování → kredit ZŮSTÁVÁ, job se sám dokončí (`/api/cron/job-resume`)
 *
 * Druhý pokus stojí jen render — textová fáze se přeskočí z checkpointu.
 */

import supabaseAdmin from "@/supabase/admin"

/** Odstupy mezi pokusy. Rozestupy rostou, protože přetížení Pro modelu trvá
 *  spíš desítky minut než sekundy; poslední pokus padne zhruba po 15 hodinách,
 *  takže „dorazí to druhý den" platí doslova. */
const BACKOFF_MINUTES = [15, 30, 60, 120, 240, 480] as const

export const MAX_QUALITY_RETRIES = BACKOFF_MINUTES.length

/** Uživatelský text — musí říct, že se nic neztratilo a že nemá klikat znovu. */
export function parkedMessage(retryAfter: Date): string {
    const t = retryAfter.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })
    return `⏸️ Čekáme na kvalitní model — dokončíme automaticky (další pokus ~${t})`
}

/**
 * Zaparkuje job k pozdějšímu dokončení.
 * @returns `{ retryAfter }` když byl odložen, `null` když už došly pokusy
 *          (volající pak pokračuje běžnou cestou selhání včetně vrácení kreditu).
 */
export async function parkJobForQuality(
    jobId: string,
    retryCount: number,
): Promise<{ retryAfter: Date } | null> {
    if (retryCount >= MAX_QUALITY_RETRIES) {
        console.error(`🚨 job ${jobId}: kvalita nedostupná i po ${retryCount} pokusech — končím a vracím kredit`)
        return null
    }

    const minutes = BACKOFF_MINUTES[retryCount] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1]
    const retryAfter = new Date(Date.now() + minutes * 60_000)

    const { error } = await supabaseAdmin
        .from("ig_jobs")
        .update({
            status: "failed",
            retry_after: retryAfter.toISOString(),
            retry_count: retryCount + 1,
            agent_message: parkedMessage(retryAfter),
            error: "Všechny Pro modely jsou právě vytížené. Kvalita má přednost před rychlostí, "
                + "takže post dokončíme automaticky, jakmile se uvolní — kredit vám zůstává.",
        })
        .eq("id", jobId)

    if (error) {
        console.error(`🚨 job ${jobId}: parkování selhalo (${error.message}) — padám na běžné selhání`)
        return null
    }

    console.log(`⏸️ job ${jobId} zaparkován, pokus ${retryCount + 1}/${MAX_QUALITY_RETRIES} za ${minutes} min`)
    return { retryAfter }
}
