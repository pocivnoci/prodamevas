/**
 * Přeprava odchozích obchodních zpráv — ODDĚLENÁ od transakční pošty
 * ==================================================================
 * Tohle je záměrně vlastní cesta a **nikdy nesmí sáhnout na `lib/email.ts`**.
 *
 * Důvod je ověřený, ne opatrnický: pravidla Resendu zakazují *„nevyžádané zprávy
 * jakéhokoli druhu, včetně studeného oslovení, koupených seznamů a scrapovaných
 * kontaktů"*, vyžadují míru stížností pod 0,08 % a účet ruší **bez varování**.
 * A přes Resend chodí potvrzení o platbách. Kdyby oslovení jelo tudy, jedna
 * stížnost může zabít doručování daňových dokladů zákazníkům.
 *
 * Proto: oslovení jde přes vlastního poskytovatele na vyhrazené doméně. Dokud
 * není nastavený, **nic se neodešle** — a je to vidět, ne tiše přeskočené.
 *
 * Nastavení (až bude poskytovatel koupený):
 *   OUTREACH_TRANSPORT=smtp
 *   OUTREACH_SMTP_URL=smtp://uzivatel:heslo@host:587
 *   OUTREACH_FROM_EMAIL="Tomáš z Chrlitu <tomas@chrlit.email>"
 */

export interface OutreachMessage {
    to: string
    subject: string
    /** Čistý text. Do studeného oslovení nepatří HTML ani obrázky. */
    text: string
}

export type TransportKind = "none" | "smtp"

export function transportKind(): TransportKind {
    const t = (process.env.OUTREACH_TRANSPORT || "").toLowerCase()
    return t === "smtp" ? "smtp" : "none"
}

/** Je odesílání oslovení vůbec nastavené? Volá se před zařazením úloh. */
export function isOutreachConfigured(): boolean {
    return transportKind() !== "none"
        && Boolean(process.env.OUTREACH_FROM_EMAIL)
        && Boolean(process.env.OUTREACH_SMTP_URL)
}

/** Co přesně chybí — ať se to nemusí dohledávat v kódu. */
export function outreachSetupHint(): string {
    const missing: string[] = []
    if (transportKind() === "none") missing.push("OUTREACH_TRANSPORT=smtp")
    if (!process.env.OUTREACH_SMTP_URL) missing.push("OUTREACH_SMTP_URL")
    if (!process.env.OUTREACH_FROM_EMAIL) missing.push("OUTREACH_FROM_EMAIL")
    return missing.length
        ? `Odesílání oslovení není nastavené — chybí: ${missing.join(", ")}`
        : "Odesílání oslovení je nastavené."
}

/**
 * Odešle jednu zprávu. Vyhodí, když přeprava není nastavená — **nikdy nepadá
 * zpátky na transakční kanál.** Tichý fallback na Resend je přesně ta chyba,
 * která by stála účet.
 */
export async function sendOutreach(msg: OutreachMessage): Promise<{ id?: string }> {
    if (!isOutreachConfigured()) {
        throw new Error(outreachSetupHint())
    }

    const url = process.env.OUTREACH_SMTP_URL!
    const from = process.env.OUTREACH_FROM_EMAIL!

    // nodemailer se načítá až tady, aby build nespadl, když balíček není
    // nainstalovaný a odesílání se nepoužívá.
    let nodemailer: any
    try {
        nodemailer = (await import("nodemailer")).default
    } catch {
        throw new Error("Chybí balíček nodemailer — nainstaluj: npm i nodemailer")
    }

    const info = await nodemailer.createTransport(url).sendMail({
        from, to: msg.to, subject: msg.subject, text: msg.text,
    })
    return { id: info?.messageId }
}
