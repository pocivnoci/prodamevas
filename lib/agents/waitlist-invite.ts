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
 * Zpoždění se v e-mailu **přizná**. Omluva, která ho zamlčí, působí hůř než ta,
 * co ho pojmenuje.
 */

import supabaseAdmin from "@/supabase/admin"
import { sendNotification, siteUrl } from "@/lib/notifications"

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

export function renderInvite(row: WaitlistRow, code: string): { subject: string; body: string } {
    const days = daysWaiting(row.created_at)
    // Zpoždění pojmenovat konkrétně. „Omlouváme se za prodlevu" je fráze;
    // „čekáte 17 dní" je přiznání, kterému se dá věřit.
    const delay = days >= 7
        ? `Zapsal jste se k nám před ${days} dny a čekal jste dlouho — omlouvám se, ozývám se až teď.`
        : `Zapsal jste se k nám na seznam zájemců, tak se ozývám.`

    return {
        subject: "Váš přístup do Chrlitu je připravený",
        body: [
            "Dobrý den,",
            delay,
            "Chrlit se z vašeho webu naučí značku a napíše hotové příspěvky na Instagram — texty, obrázky i hashtagy. Nemusíte nic vyplňovat ani nastavovat.",
            `<b>Váš kód: ${code}</b>`,
            `Stačí ho zadat při registraci na <a href="${siteUrl()}/register">${siteUrl().replace(/^https?:\/\//, "")}/register</a>, vložit adresu svého webu a za pár minut uvidíte první příspěvky.`,
            "Prvních pár příspěvků je zdarma a nezávazně — chci hlavně vědět, jestli to, co vám to napíše, sedí. Když ne, napište mi rovnou zpátky na tenhle e-mail, čtu to já.",
            "Tomáš, Chrlit",
        ].join("\n\n"),
    }
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
        // kind "notification" → kontrola email_optouts + odhlašovací patička.
        await sendNotification({ to: row.email, subject: msg.subject, body: msg.body, kind: "notification" })
        out.push({ email: row.email, sent: true })
    }
    return out
}
