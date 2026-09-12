/**
 * Jak se pozná otázka od AI.
 *
 * Třídič (`lib/tasks/triage.ts`) píše nejistotu do `blocked_on` s touhle
 * předponou. Je to jediný rozdíl mezi „čekám na banku" (čeká se na svět)
 * a „čekám na tebe" (čeká se na člověka) — a stojí na něm sekce „Čeká na tvou
 * odpověď" i odznak v navigaci. Vlastní sloupec by byl čistší, ale znamenal by
 * migraci kvůli údaji, který už v datech je.
 *
 * Bez `"use server"` a bez závislostí schválně: čte to server i klient.
 */
export const QUESTION_PREFIX = "otázka:"

/** Čeká úkol na odpověď člověka, ne na vnější událost? */
export function isQuestionForHuman(blockedOn: string | null | undefined): boolean {
    return Boolean(blockedOn?.startsWith(QUESTION_PREFIX))
}
