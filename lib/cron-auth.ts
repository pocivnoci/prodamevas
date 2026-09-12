/**
 * Brána cronů — jedna pro všech jedenáct rout pod /api/cron.
 *
 * Stejné tři řádky (`auth !== \`Bearer ${secret}\``) ležely v každé routě zvlášť.
 * Kromě duplicity to bylo jediné místo v kódu, kde se tajemství porovnávalo
 * obyčejným `!==` — všechna ostatní (OAuth state, handoff, podpis e-mailu,
 * schvalovací odkaz, webhooky) jdou přes `timingSafeEqual`. CRON_SECRET přitom
 * slouží i jako záložní klíč pro `ig-oauth-state` a `ig-connect-handoff`,
 * takže chrání víc než crony.
 *
 * Fail closed: bez nastaveného CRON_SECRET neprojde nikdo.
 * Čistý modul (jen crypto) — žádná session, žádná DB, takže ho smí importovat
 * i worker, který podle aserce 2727 nesmí sahat na requireProjectAccess.
 */

import { timingSafeEqual } from "node:crypto"

export function isCronRequest(req: Request): boolean {
    const secret = process.env.CRON_SECRET
    if (!secret) return false
    const expected = Buffer.from(`Bearer ${secret}`)
    const got = Buffer.from(req.headers.get("authorization") ?? "")
    return expected.length === got.length && timingSafeEqual(expected, got)
}

/**
 * Vrátí 401 odpověď, když request není z cronu; jinak `null`.
 * Použití: `const deny = requireCron(req); if (deny) return deny`.
 */
export function requireCron(req: Request): Response | null {
    if (isCronRequest(req)) return null
    return Response.json({ error: "Unauthorized" }, { status: 401 })
}
