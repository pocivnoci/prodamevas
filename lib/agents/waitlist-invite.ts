/**
 * Aktivace waitlistu — lidem, kteří sami zvedli ruku
 * =================================================
 * Tohle NENÍ studené oslovení: člověk se na waitlist zapsal sám, takže je to
 * vyžádaná komunikace a smí jít přes běžný transakční kanál (Resend). Odchozí
 * obchodní zprávy neznámým firmám mají vlastní přepravu (`lib/agents/sales/`),
 * a ty dvě cesty se nesmí míchat.
 *
 * Kontext, proč to vzniklo: waitlist měl 11. 8. 2026 tři skutečné cizí lidi
 * zapsané 25.–26. 7. — a nikdo jim za sedmnáct dní neodepsal. Byli to tehdy
 * nejteplejší kontakty, jaké produkt měl.
 *
 * Zpoždění se v e-mailu **přizná** — ale text sám se tu nepíše. Znění je
 * registrová šablona `waitlist_invite` (`lib/mail/templates/waitlist.ts`): tenhle
 * modul měl vlastní kopii v jiném hlase („já", podpis „Tomáš, Chrlit"), takže
 * dva skoro stejné e-maily mluvily za dvě různé firmy a v náhledové galerii byl
 * vidět jen jeden z nich.
 *
 * Jazyk: čekatel účet nemá, takže jazyk příjemce neznáme — pozvánka jde česky.
 * `renderInvite(row, code, locale)` ale jazyk umí, až bude odkud ho vzít.
 */

import supabaseAdmin from "@/supabase/admin"
import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locales"
import { mailTranslatorSync } from "@/lib/mail/i18n"
import { siteUrl } from "@/lib/mail/links"
import { getTemplate } from "@/lib/mail/registry"
import type { RenderedTemplate } from "@/lib/mail/template"

export interface WaitlistRow {
    id: string
    email: string
    created_at: string
    invited_at: string | null
}

/** Interní adresy a testy — nemá smysl zvát sám sebe. */
function isInternal(email: string): boolean {
    const e = email.toLowerCase()
    return e.endsWith("@example.com")
        || e.includes("qa-test")
        || e.endsWith("@prodamevas.cz")
        || e.endsWith("@chrlit.cz")
}

/**
 * Kdo ještě pozvánku nedostal, nejstarší první — ti čekají nejdéle.
 *
 * Vyřazují se i lidé, kteří se mezitím sami zaregistrovali. Poslat „váš přístup
 * je připravený" někomu, kdo produkt už půl roku používá, působí rozbitě a
 * podkopává důvěru ve všechno ostatní, co mu přijde.
 */
export async function pendingInvites(): Promise<WaitlistRow[]> {
    const { data } = await supabaseAdmin
        .from("waitlist").select("id, email, created_at, invited_at")
        .is("invited_at", null).order("created_at", { ascending: true })
    const rows = (data ?? []).filter(r => !isInternal(r.email)) as WaitlistRow[]
    if (rows.length === 0) return rows

    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    const registered = new Set((users?.users ?? []).map(u => (u.email || "").toLowerCase()))
    return rows.filter(r => !registered.has(r.email.toLowerCase()))
}

function daysWaiting(createdAt: string): number {
    return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000))
}

/**
 * Proměnné pro šablonu `waitlist_invite`.
 *
 * Zpoždění pojmenovat konkrétně: „omlouváme se za prodlevu" je fráze, „čekáte
 * 17 dní" je přiznání, kterému se dá věřit. Pod týden se počet dní vynechává —
 * šablona pak pošle kratší variantu věty.
 */
export function inviteVars(row: WaitlistRow, code: string, locale: UiLocale = DEFAULT_UI_LOCALE): Record<string, string> {
    const t = mailTranslatorSync(locale, "notices")
    const days = daysWaiting(row.created_at)
    return {
        headline: t("waitlist.headline"),
        code,
        waitedDays: days >= 7 ? String(days) : "",
        expiresNote: "",
        ctaUrl: `${siteUrl()}/register`,
    }
}

/**
 * Pozvánka vyrenderovaná z registru — jediné znění, jeden hlas, vidět v galerii.
 * Odhlašovací patička je součástí renderu (šablona je `notification`); `locale`
 * jde do registru, který si z něj postaví překladač šablony i chrome.
 */
export function renderInvite(row: WaitlistRow, code: string, locale: UiLocale = DEFAULT_UI_LOCALE): RenderedTemplate {
    const template = getTemplate("waitlist_invite")
    if (!template) throw new Error("Šablona waitlist_invite chybí v registru") // i18n-ignore: interní chyba, končí jen v logu
    return template.render(inviteVars(row, code, locale), row.email, locale)
}

export interface InviteResult {
    email: string
    sent: boolean
    reason?: string
}

/**
 * Rozešle pozvánky. `dryRun` nic neodešle ani nezapíše — jen vrátí, co by udělal.
 *
 * Zápis `invited_at` je PŘED odesláním schválně: kdyby odeslání spadlo někde
 * uprostřed, druhý běh tomu člověku nenapíše podruhé. Nepřijatá pozvánka je
 * menší škoda než dvě pozvánky za sebou.
 *
 * Odhlášené adresy se ctí: kdo si vypnul poštu, pozvánku nedostane, ale z fronty
 * odejde (jinak by se nabízel v každém dalším běhu).
 */
export async function sendWaitlistInvites(opts: { code: string; limit?: number; dryRun?: boolean } ): Promise<InviteResult[]> {
    const rows = (await pendingInvites()).slice(0, opts.limit ?? 20)
    const out: InviteResult[] = []

    for (const row of rows) {
        const msg = renderInvite(row, opts.code)
        if (opts.dryRun) {
            out.push({ email: row.email, sent: false, reason: "dry-run" })
            continue
        }
        await supabaseAdmin.from("waitlist")
            .update({ invited_at: new Date().toISOString() }).eq("id", row.id)
        const { data: optedOut } = await supabaseAdmin
            .from("email_optouts").select("email").eq("email", row.email.toLowerCase()).maybeSingle()
        if (optedOut) {
            out.push({ email: row.email, sent: false, reason: "opted-out" })
            continue
        }
        // Přímo přes sendEmail (jako pozvánka k předání značky): vyhodí výjimku,
        // takže se pozná, jestli e-mail opravdu odešel — `sendNotification` by
        // hlásila „odesláno" i na mrtvý klíč.
        try {
            const { sendEmail } = await import("@/lib/email")
            await sendEmail({ to: row.email, subject: msg.subject, html: msg.html, text: msg.text })
            out.push({ email: row.email, sent: true })
        } catch (err: any) {
            console.warn(`waitlist-invite: pozvánku pro ${row.email} se nepodařilo odeslat: ${err?.message}`)
            out.push({ email: row.email, sent: false, reason: err?.message || "send failed" })
        }
    }
    return out
}
