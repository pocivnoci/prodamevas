'use client'

/**
 * Čekání na durable onboardingovou úlohu — sdílené oběma průvodci
 * ==============================================================
 * Onboarding UI existuje dvakrát (`app/onboarding/page.tsx` pro nové zákazníky,
 * `tabs/OnboardTab.tsx` v dashboardu). Smyčka „šťouchni a ptej se" je proto tady,
 * ne v obou — z dvojníků v onboardingu už bylo dost.
 */

export interface TaskProgressUpdate {
    progress: number
    message: string
}

/**
 * Přeloží selhání do věty, které zákazník rozumí.
 *
 * „Failed to fetch" je hláška prohlížeče o rozpadlém spojení — technický detail
 * v angličtině, který se k zákazníkovi nikdy neměl dostat. Právě tuhle větu lidi
 * z onboardingu hlásili. Ostatní hlášky už česky jsou, ty pusť beze změny.
 */
export function humanizeClientError(err: unknown): string {
    const msg = (err as Error)?.message || String(err)
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
        return 'Ztratilo se spojení se serverem. Zkus to prosím znovu — rozdělaná práce se neztratila, běží dál na serveru.'
    }
    return msg
}

/** Jak často se ptáme na stav. Stejné tempo jako u generování příspěvků. */
const POLL_MS = 2000

/** Strop čekání v prohlížeči. Delší než serverový reaper (15 min), takže normálně
 *  úlohu ukončí server; tohle je jen pojistka proti nekonečné smyčce. */
const GIVE_UP_MS = 20 * 60 * 1000

/**
 * Rozjede zařazenou úlohu a čeká na výsledek dotazováním na její stav.
 *
 * Rozpadlé spojení tady nic nestojí: práce běží na serveru, stav je v DB a další
 * dotaz si ji zase najde. Dřív tudy visel jeden blokující request na celé minuty —
 * když umřel, zahodila se hotová a zaplacená práce a uživatel viděl „Failed to fetch".
 *
 * @throws když úloha selže nebo se nedočkáme; hláška je česká, rovnou k zobrazení.
 */
export async function awaitOnboardingTask<T>(
    taskId: string,
    onProgress: (update: TaskProgressUpdate) => void,
): Promise<T> {
    // Šťouchnutí, ať se práce rozjede hned a nečeká se až minutu na cron. Odpověď
    // nikoho nezajímá — když tenhle request umře, úlohu stejně sebere cron.
    void fetch('/api/onboarding/run-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
    }).catch(() => { /* dotazování si poradí samo */ })

    const deadline = Date.now() + GIVE_UP_MS
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_MS))

        let data: {
            status?: string
            progress?: number
            agentMessage?: string | null
            result?: unknown
            error?: string | null
        }
        try {
            const res = await fetch(`/api/onboarding/task-status?id=${taskId}`)
            if (!res.ok) continue
            data = await res.json()
        } catch {
            // Výpadek sítě není konec — za dvě vteřiny se zeptáme znovu. Přesně tohle
            // dřív celý onboarding shodilo.
            continue
        }

        onProgress({ progress: data.progress ?? 0, message: data.agentMessage || '' })

        if (data.status === 'done') return data.result as T
        if (data.status === 'failed') throw new Error(data.error || 'Úloha selhala.')
    }

    throw new Error('Příprava trvá neobvykle dlouho. Zkus to prosím znovu.')
}
