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

/**
 * Rozpočet jednoho renderu v lambdě. Vercel Fluid má strop 800 s; 100 s rezerva
 * kryje zápis do DB, refund a odpověď. Kampaňový worker i reelový orchestrátor
 * čtou TOTÉŽ číslo — dva rozpočty by se rozešly přesně v tu chvíli, kdy na tom
 * záleží. Env override existuje jen pro test parkovací cesty (viz plán reelů).
 */
export const RENDER_BUDGET_MS = Number(process.env.RENDER_BUDGET_MS || 700_000)

/** Za jak dlouho se vrátit k videu, které u Seedance ještě renderuje. */
export const VIDEO_RETRY_MINUTES = 2
/** Kolikrát smí job kvůli běžícímu videu odejít z lambdy, než je to zásek. */
export const MAX_VIDEO_POLL_ROUNDS = 3

/**
 * Uživatelský text — musí říct, že se nic neztratilo a že nemá klikat znovu.
 *
 * Úmyslně RELATIVNÍ čas. Absolutní hodina se formátovala podle časové zóny
 * procesu, jenže funkce na Vercelu běží v UTC — zákazník v Česku by dostal čas
 * posunutý o dvě hodiny a čekal marně.
 */
export function parkedMessage(minutes: number): string {
    const human = minutes >= 60
        ? `${Math.round(minutes / 60)} h`
        : `${minutes} min`
    return `⏸️ Čekáme na kvalitní model — dokončíme to automaticky (další pokus za ~${human})`
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
            agent_message: parkedMessage(minutes),
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

/**
 * Zaparkuje job, jehož video u Seedance ještě renderuje (`VideoPendingError`).
 *
 * Liší se od parkování kvůli kvalitě ve dvou věcech: odstup je krátký (video
 * dobíhá v řádu minut, ne hodin) a `retry_count` se NEZVYŠUJE — počet kol
 * hlídá checkpoint videa (`pollRounds`), protože jde o jiný rozpočet než
 * pokusy o Pro model. Kredit zůstává: úloha u poskytovatele je zaplacená a
 * resume ji dopolluje z checkpointu, nikdy nezadává znovu.
 */
export async function parkJobForVideo(jobId: string): Promise<{ retryAfter: Date } | null> {
    const retryAfter = new Date(Date.now() + VIDEO_RETRY_MINUTES * 60_000)
    const { error } = await supabaseAdmin
        .from("ig_jobs")
        .update({
            status: "failed",
            retry_after: retryAfter.toISOString(),
            agent_message: `🎬 Video se ještě renderuje — dokončíme automaticky (~${VIDEO_RETRY_MINUTES} min)`,
            error: "Video u poskytovatele ještě renderuje. Příspěvek dokončíme automaticky během pár minut — kredit vám zůstává, najdete ho v Příspěvcích.",
        })
        .eq("id", jobId)

    if (error) {
        console.error(`🚨 job ${jobId}: parkování kvůli videu selhalo (${error.message})`)
        return null
    }
    console.log(`🎬 job ${jobId} zaparkován — video dobíhá, návrat za ${VIDEO_RETRY_MINUTES} min`)
    return { retryAfter }
}
