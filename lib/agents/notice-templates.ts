/**
 * Znění zákaznických oznámení — čistá funkce, žádná DB.
 * =====================================================
 * Odděleno od `customer-notices.ts` schválně: ten modul sahá na Supabase (dedupe
 * přes `agent_actions`), takže by se text e-mailu nedal vyrenderovat v guardu ani
 * v `scripts/test-customer-notices.ts` bez `.env.local` — a přesně tam se pozná
 * prosáklé „undefined", cena bez věty o DPH nebo druhý hlas. Stejná dělba jako
 * `lib/mail/templates/*` versus `lib/notifications.ts`.
 *
 * Odkazy proto chodí z `lib/mail/links.ts`, ne z `lib/notifications.ts`.
 */

import { MAX_BILLING_FAILURES } from "@/lib/billing-period"
import { vatNotice } from "@/lib/legal"
import { siteUrl, studioDeepLink } from "@/lib/mail/links"
import { formatCzk } from "@/lib/pricing"
import { countLabel, plural, POSTS } from "@/lib/plural"

export type NoticeKind =
    | "renewal_upcoming"
    | "charge_failed"
    | "manual_renew"
    | "expired"
    | "payment_recovered"
    | "generation_failed"
    | "publish_failed"
    | "facts_pending"

export interface NoticeVars {
    clientName?: string | null
    clientId?: string | null
    /** Haléře — formátuje se až v šabloně, nikdy se nepočítá v korunách. */
    amountHaleru?: number | null
    /**
     * Táž částka BEZ DPH. Uvádí se v závorce: ceník je B2B a zákazník se
     * dohodl na základu, ale z karty jde částka s daní — bez obou čísel
     * nesedí e-mail ani s ceníkem, ani s výpisem.
     */
    netHaleru?: number | null
    /** Datum česky, např. „3. 9. 2026". */
    date?: string | null
    /** Automatické stržení (má uložený token) vs. ruční obnova. */
    auto?: boolean
    /** Kolikátý pokus dunningu (1…`MAX_BILLING_FAILURES`). */
    attempt?: number
    /** Čeho se incident týká — „příspěvek plánovaný na 12. 8.". */
    what?: string | null
    /** Délka obnovovaného období, česky — „na 12 měsíců". */
    termLabel?: string | null
    /** Proč to selhalo, jednou větou a bez technikálií. */
    reason?: string | null
    /** Kolik věcí se zprávy týká — „3 příspěvky čekají". Skloňuje šablona. */
    count?: number | null
}

export const KIND_LABELS: Record<NoticeKind, string> = {
    renewal_upcoming: "Blíží se obnova",
    charge_failed: "Platba selhala",
    manual_renew: "Ruční obnova",
    expired: "Předplatné vypršelo",
    payment_recovered: "Platba se podařila",
    generation_failed: "Generování selhalo",
    publish_failed: "Publikace selhala",
    facts_pending: "Příspěvky čekají na ověření faktů",
}

const APP_URL = () => siteUrl()
const link = (clientId: string | null | undefined, section: string) =>
    clientId ? studioDeepLink(clientId, section) : `${APP_URL()}/dashboard/instagram`

/**
 * Haléře na koruny umí jedině `formatCzk()` (`lib/pricing.ts`). Lokální kopie
 * dělení stem se tu jednou už rozešla se zbytkem aplikace zaokrouhlením a
 * zákazník dostal e-mail s „3 628,79 Kč".
 */
const czk = (haleru?: number | null) =>
    typeof haleru === "number" ? formatCzk(haleru) : "částku dle plánu"

/** „36 288 Kč (29 990 Kč bez DPH)" — jen když se ta dvě čísla liší. */
function priceWithNet(vars: NoticeVars): string {
    const gross = czk(vars.amountHaleru)
    if (typeof vars.amountHaleru !== "number" || typeof vars.netHaleru !== "number") return gross
    if (vars.netHaleru === vars.amountHaleru) return gross
    return `${gross} (${czk(vars.netHaleru)} bez DPH)`
}

/**
 * Věta o DPH pod zprávou, ve které padlo číslo. Cena bez upřesnění vypadá
 * u plátce jako konečná — a zákazník pak na výpisu najde o pětinu víc.
 */
const vatFootnote = (vars: NoticeVars) =>
    typeof vars.amountHaleru === "number" ? `\n\n<small>${vatNotice()}</small>` : ""

// ── Šablony ─────────────────────────────────────────────────────────────────

export function buildCustomerNotice(kind: NoticeKind, vars: NoticeVars): { subject: string; body: string } {
    const name = vars.clientName || "váš účet"
    const sub = link(vars.clientId, "subscription")
    const cal = link(vars.clientId, "calendar")

    switch (kind) {
        case "renewal_upcoming": {
            // Předmět nesmí tvrdit „za 3 dny": u víceměsíčního období chodí
            // upozornění měsíc dopředu (renewalNoticeDays), protože nečekaných
            // 19 900 Kč na výpisu je nejlevnější cesta k chargebacku.
            const term = vars.termLabel ? ` ${vars.termLabel}` : ""
            return vars.auto
                ? {
                    subject: vars.date ? `Připomínka: předplatné se obnoví ${vars.date}` : "Připomínka: předplatné se brzy obnoví",
                    body: `Dobrý den,

${vars.date ? `<strong>${vars.date}</strong> ` : "Brzy "}vám automaticky strhneme <strong>${priceWithNet(vars)}</strong> za předplatné${term} pro <strong>${name}</strong>. Nemusíte nic dělat — píšeme jen proto, abyste to na výpisu čekali.

Pokud si přejete plán změnit nebo zrušit, stihnete to do té doby:

<a href="${sub}">Spravovat předplatné →</a>

Tým Chrlit${vatFootnote(vars)}`,
                }
                : {
                    subject: vars.date ? `Předplatné končí ${vars.date}` : "Předplatné brzy končí",
                    body: `Dobrý den,

předplatné pro <strong>${name}</strong> končí ${vars.date ? `<strong>${vars.date}</strong>` : "brzy"}. Nemáme uloženou kartu, takže se automaticky neobnoví — aby generování příspěvků nepřestalo, obnovte plán prosím ručně:

<a href="${sub}">Obnovit předplatné →</a>

Tým Chrlit`,
                }
        }

        case "charge_failed":
            // Počet pokusů je tentýž, podle kterého dunning končí — natvrdo psaná
            // trojka by po změně `MAX_BILLING_FAILURES` slibovala jiný počet, než
            // kolik jich zákazník dostane.
            return {
                subject: "Platba za Chrlit se nezdařila",
                body: `Dobrý den,

automatickou platbu ${typeof vars.amountHaleru === "number" ? `<strong>${priceWithNet(vars)}</strong> ` : ""}za předplatné <strong>${name}</strong> se nepodařilo strhnout${vars.attempt ? ` (pokus ${vars.attempt} z ${MAX_BILLING_FAILURES})` : ""}. Zkusíme to znovu zítra — zkontrolujte prosím platební kartu, případně obnovte plán ručně:

<a href="${sub}">Zkontrolovat předplatné →</a>

Tým Chrlit${vatFootnote(vars)}`,
            }

        case "manual_renew":
            return {
                subject: "Obnovte si předplatné Chrlit",
                body: `Dobrý den,

předplatné pro <strong>${name}</strong> právě doběhlo. Aby generování příspěvků pokračovalo bez přerušení, obnovte si prosím plán jedním kliknutím:

<a href="${sub}">Obnovit předplatné →</a>

Tým Chrlit`,
            }

        case "expired":
            return {
                subject: "Vaše předplatné Chrlit vypršelo",
                body: `Dobrý den,

předplatné pro <strong>${name}</strong> vypršelo. Vaše data, značka i naučené preference zůstávají zachovány; generování se znovu spustí hned po obnovení plánu:

<a href="${sub}">Obnovit předplatné →</a>

Tým Chrlit`,
            }

        case "payment_recovered":
            return {
                subject: "Platba prošla — vše je zase v pořádku",
                body: `Dobrý den,

platba za <strong>${name}</strong> se nakonec podařila a předplatné pokračuje bez přerušení. Nic dalšího dělat nemusíte.

<a href="${sub}">Zobrazit předplatné →</a>

Tým Chrlit`,
            }

        // ── Tichý support: produkt se přiznává sám ───────────────────────────
        // Zákazník u toho nebyl, takže se to jinak nedozví — a co se nedozví,
        // na to se druhý den ptá e-mailem. Levnější je říct to první.
        case "generation_failed":
            return {
                subject: "Jeden příspěvek se nepodařilo vygenerovat",
                body: `Dobrý den,

${vars.what ? `<strong>${vars.what}</strong> se` : "Jeden z naplánovaných příspěvků pro <strong>" + name + "</strong> se"} nepodařilo vygenerovat.${vars.reason ? ` Důvod: ${vars.reason}.` : ""}

Zkusíme to automaticky znovu při dalším běhu — dělat nemusíte nic. Pokud se to zopakuje, ozveme se sami.

<a href="${cal}">Zobrazit kalendář →</a>

Tým Chrlit`,
            }

        // Auto-publikování zadrželo příspěvek, protože v něm zůstalo tvrzení bez
        // opory. Chodí JEDNOU DENNĚ a souhrnně: jeden e-mail na příspěvek by z
        // opatrnosti udělal spam a klient by si příště vypnul kontrolu, ne text.
        case "facts_pending": {
            const n = typeof vars.count === "number" && vars.count > 0 ? vars.count : 1
            const what = countLabel(n, POSTS)
            return {
                subject: `${what} ${plural(n, { one: "čeká", few: "čekají", many: "čeká" })} na ověření faktů`,
                body: `Dobrý den,

u <strong>${name}</strong> ${plural(n, { one: "je", few: "jsou", many: "je" })} ${what} s tvrzením, které nemá oporu v ověřených faktech — třeba číslo, letopočet, záruka nebo technický parametr. Automaticky ${plural(n, { one: "nevyjde", few: "nevyjdou", many: "nevyjde" })}: tohle je přesně ten typ údaje, za který se ručí vám, ne nám.

Ve studiu u ${plural(n, { one: "něj", few: "nich", many: "nich" })} uvidíte, o které tvrzení jde. Buď ho potvrďte jedním kliknutím (uloží se mezi ověřená fakta), nebo ho z textu smažte — pak ${plural(n, { one: "příspěvek vyjde", few: "příspěvky vyjdou", many: "příspěvky vyjdou" })} v dalším termínu.

<a href="${cal}">Otevřít kalendář →</a>

Tým Chrlit`,
            }
        }

        case "publish_failed":
            return {
                subject: "Naplánovaný příspěvek se nepodařilo publikovat",
                body: `Dobrý den,

${vars.what ? `<strong>${vars.what}</strong>` : `naplánovaný příspěvek pro <strong>${name}</strong>`} se nepodařilo publikovat na Instagram ani po opakovaných pokusech.${vars.reason ? ` Důvod: ${vars.reason}.` : ""}

Příspěvek je hotový a čeká v kalendáři — nejčastější příčinou je odpojený nebo vypršelý účet Instagramu. Stačí ho znovu připojit a příspěvek pustit:

<a href="${cal}">Otevřít kalendář →</a>

Tým Chrlit`,
            }
    }
}

