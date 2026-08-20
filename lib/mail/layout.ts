/**
 * Slupka e-mailu — černé pásy, bílá karta, patička.
 * =================================================
 * Vrací **obě podoby najednou**, `{ html, text }`. Ne z pohodlnosti: patička
 * (odhlášení, identifikace podnikatele) je přesně to, co musí být v HTML
 * i v textu. Kdyby funkce vracela jeden řetězec, textová verze by se skládala
 * někde jinde a při první změně patičky by se rozešly — a rozejde se vždycky ta,
 * na kterou se nikdo nedívá.
 */

import { formatIdentityLine, LEGAL } from "@/lib/legal"
import type { Block } from "./blocks"
import { stripInline } from "./inline"
import { renderBlocksHtml } from "./render-html"
import { renderBlocksText } from "./render-text"
import { siteUrl, unsubscribeUrl } from "./links"
import { COLOR, FONT, METRIC, TYPE } from "./tokens"

export type MailKind = "transactional" | "notification"

export interface MailDocument {
    subject: string
    blocks: Block[]
    kind: MailKind
    /** Řádek vedle předmětu v seznamu zpráv. Výchozí: první věta prvního odstavce. */
    preheader?: string
    /** Popisek v černém pásu nad obsahem: „NOVINKY · SRPEN 2026". */
    eyebrow?: string
    /** Adresa pro podepsaný odhlašovací odkaz. Povinná u `kind: "notification"`. */
    unsubscribeEmail?: string
    /** `ops` = interní pošta zakladateli: bez identifikace podnikatele a bez odhlášení. */
    variant?: "customer" | "ops"
}

/**
 * Náhledový text ve schránce. Bez něj Gmail i Apple ukážou první viditelný
 * text — a to je u černého pásu wordmark, takže by každá zpráva v seznamu
 * vypadala jako „Chrlit — Chrlit".
 */
function derivePreheader(doc: MailDocument): string {
    if (doc.preheader) return doc.preheader
    const firstText = doc.blocks.find(b => b.type === "text") as Extract<Block, { type: "text" }> | undefined
    if (!firstText) return doc.subject
    const sentence = stripInline(firstText.text).split(/(?<=[.!?])\s/)[0] || ""
    return sentence.slice(0, 140)
}

/**
 * Skrytý preheader. `&#8199;&#65279;` (mezera pevné šířky + zero-width no-break)
 * odsune za náhledový text prázdno místo začátku HTML — jinak schránka doplní
 * náhled tím, co následuje.
 */
function preheaderHtml(text: string): string {
    return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLOR.card};opacity:0">${text}${"&#8199;&#65279;".repeat(60)}</div>`
}

function footerHtml(doc: MailDocument): string {
    const link = (href: string, label: string) =>
        `<a href="${href}" style="color:${COLOR.onBand};text-decoration:underline">${label}</a>`

    const rows: string[] = [
        `<p style="${TYPE.legal};color:${COLOR.onBandStrong};font-weight:700;letter-spacing:.18em;text-transform:uppercase;margin:0 0 10px">Chrlit</p>`,
    ]
    if (doc.variant === "ops") {
        rows.push(`<p style="${TYPE.legal};margin:0">Interní zpráva ze studia · ${link(siteUrl(), "chrlit.cz")}</p>`)
    } else {
        rows.push(`<p style="${TYPE.legal};margin:0 0 6px">${formatIdentityLine()}</p>`)
        rows.push(`<p style="${TYPE.legal};margin:0">${link(siteUrl(), "chrlit.cz")} · ${link(`mailto:${LEGAL.email}`, LEGAL.email)}</p>`)
        if (doc.kind === "notification" && doc.unsubscribeEmail) {
            rows.push(`<p style="${TYPE.legal};margin:12px 0 0">${link(unsubscribeUrl(doc.unsubscribeEmail), "Odhlásit odběr")}</p>`)
        }
    }
    return rows.join("\n      ")
}

function footerText(doc: MailDocument): string {
    const rows = ["CHRLIT"]
    if (doc.variant === "ops") {
        rows.push(`Interní zpráva ze studia · ${siteUrl()}`)
    } else {
        rows.push(formatIdentityLine())
        rows.push(`${siteUrl()} · ${LEGAL.email}`)
        if (doc.kind === "notification" && doc.unsubscribeEmail) {
            // Odhlášení musí být i tady. Kdo čte textovou verzi a odkaz nenajde,
            // neodhlásí se — klikne na „spam", a to platíme doručitelností všeho
            // ostatního, včetně dokladů.
            rows.push(`Odhlásit odběr: ${unsubscribeUrl(doc.unsubscribeEmail)}`)
        }
    }
    return rows.join("\n")
}

export function renderEmail(doc: MailDocument): { html: string; text: string } {
    const preheader = derivePreheader(doc)
    const bandPad = `${28}px ${METRIC.pad}px`

    const html = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<!-- Vzhled je zamčený na světlý. Bez těchhle dvou si Gmail i Apple Mail
     e-mail „pomůžou" invertovat a z černého pásu udělají šedý s nečitelným
     textem — přesně to, kvůli čemu je tělo světlé. -->
<meta name="color-scheme" content="only light" />
<meta name="supported-color-schemes" content="only light" />
<title>${doc.subject}</title>
<style>
  @media only screen and (max-width:620px) {
    .pad { padding-left:${METRIC.padMobile}px !important; padding-right:${METRIC.padMobile}px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLOR.canvas};font-family:${FONT};-webkit-font-smoothing:antialiased">
${preheaderHtml(preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.canvas}" style="width:100%;border-collapse:collapse;background:${COLOR.canvas}">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="${METRIC.width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${METRIC.width}px;border-collapse:collapse">

      <tr><td bgcolor="${COLOR.band}" class="pad" style="background:${COLOR.band};padding:${bandPad}">
        <a href="${siteUrl()}" style="${TYPE.wordmark}">Chrlit</a>
        ${doc.eyebrow ? `<p style="${TYPE.eyebrow};color:${COLOR.onBand};margin:10px 0 0">${doc.eyebrow}</p>` : ""}
      </td></tr>
      <tr><td bgcolor="${COLOR.accent}" style="background:${COLOR.accent};height:3px;font-size:0;line-height:0">&nbsp;</td></tr>

      <tr><td bgcolor="${COLOR.card}" class="pad" style="background:${COLOR.card};padding:${METRIC.pad}px">
${renderBlocksHtml(doc.blocks)}
      </td></tr>

      <tr><td bgcolor="${COLOR.band}" class="pad" style="background:${COLOR.band};padding:${bandPad}">
      ${footerHtml(doc)}
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`

    const text = [
        "CHRLIT",
        doc.eyebrow ? doc.eyebrow.toUpperCase() : null,
        "",
        renderBlocksText(doc.blocks),
        "",
        "────────────────────────────────",
        footerText(doc),
    ].filter(v => v !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim()

    return { html, text }
}
