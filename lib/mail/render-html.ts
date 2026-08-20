/**
 * Bloky → HTML pro schránku.
 * ==========================
 * Pravidla, která tady platí a v běžném webovém kódu ne:
 *
 *  - **Všechno je `<table>`.** Outlook (Word engine) neumí `float`, `flex` ani
 *    spolehlivě `div` s pozadím. Tabulka je jediný layout, kterému věří všichni.
 *  - **Barva pozadí se píše dvakrát** — `bgcolor` atributem i v `style`.
 *    Starý Outlook čte atribut, moderní klienti styl.
 *  - **Žádný VML u tlačítek.** Značka má radius 2 px; Outlook ho zahodí a nikdo
 *    si nevšimne. Ušetří to podmíněné komentáře kolem každého CTA.
 *  - **Odsazení dělá `padding` na buňce**, ne `margin` — margin je v e-mailu
 *    nejméně spolehlivá vlastnost vůbec.
 */

import type { Block } from "./blocks"
import { parseInline } from "./inline"
import { escapeHtml } from "./links"
import { BUTTON, CALLOUT, COLOR, FONT, METRIC, TYPE } from "./tokens"

const GAP = 20

/** Tokeny odstavce → HTML. Cokoli, co parser nerozpoznal, se escapuje. */
function inlineHtml(text: string): string {
    return parseInline(text).map(t => {
        if (t.t === "bold") return `<strong style="color:${COLOR.ink};font-weight:700">${escapeHtml(t.v)}</strong>`
        if (t.t === "link") {
            return `<a href="${escapeHtml(t.href)}" style="color:${COLOR.accent};text-decoration:underline">${escapeHtml(t.v)}</a>`
        }
        return escapeHtml(t.v).replace(/\n/g, "<br/>")
    }).join("")
}

/** Obalí obsah do tabulky přes celou šířku — základ skoro každého bloku. */
function row(inner: string, style = ""): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;${style}"><tr>${inner}</tr></table>`
}

function buttonHtml(b: Extract<Block, { type: "button" }>): string {
    const v = BUTTON[b.variant || "primary"]
    // Hrana dole je to, co z obdélníku dělá značku — a je to jen border, takže
    // ji nepokazí ani Outlook.
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 ${GAP}px">
  <tr><td bgcolor="${v.bg}" style="background:${v.bg};border:1px solid ${v.border};border-bottom:3px solid ${v.edge};border-radius:${METRIC.radius}px">
    <a href="${escapeHtml(b.url)}" style="${TYPE.button};color:${v.fg};padding:14px 28px">${escapeHtml(b.label)}</a>
  </td></tr>
</table>`
}

function cardsHtml(b: Extract<Block, { type: "cards" }>): string {
    return b.cards.map(c => {
        const title = !c.title ? ""
            : c.href
                ? `<a href="${escapeHtml(c.href)}" style="${TYPE.h2};text-decoration:none">${escapeHtml(c.title)}</a>`
                : `<p style="${TYPE.h2}">${escapeHtml(c.title)}</p>`
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 12px">
  <tr><td style="border:1px solid ${COLOR.hairline};border-radius:${METRIC.radius}px;padding:18px">
    ${c.meta ? `<p style="${TYPE.eyebrow};margin:0 0 10px">${escapeHtml(c.meta)}</p>` : ""}
    ${c.imageUrl ? `<img src="${escapeHtml(c.imageUrl)}" alt="" width="120" style="display:block;border:0;max-width:120px;border-radius:${METRIC.radius}px;margin:0 0 12px" />` : ""}
    ${title}
    ${c.text ? `<p style="${TYPE.body};font-size:14px;margin:8px 0 0;white-space:pre-wrap">${escapeHtml(c.text)}</p>` : ""}
  </td></tr>
</table>`
    }).join("")
}

function planCardHtml(b: Extract<Block, { type: "planCard" }>): string {
    const border = b.highlight ? `2px solid ${COLOR.accent}` : `1px solid ${COLOR.hairline}`
    const features = b.features.map(f =>
        `<tr>
      <td width="14" valign="top" style="padding:0 8px 6px 0"><div style="width:6px;height:6px;background:${COLOR.accent};margin-top:7px"></div></td>
      <td style="${TYPE.body};font-size:14px;padding:0 0 6px">${escapeHtml(f)}</td>
    </tr>`).join("")
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 ${GAP}px">
  <tr><td style="border:${border};border-radius:${METRIC.radius}px;padding:24px">
    <p style="${TYPE.eyebrow};margin:0 0 8px">${escapeHtml(b.name)}</p>
    <p style="${TYPE.h1};font-size:26px;margin:0 0 2px">${escapeHtml(b.price)}</p>
    <p style="${TYPE.small};margin:0 0 16px">${escapeHtml(b.period)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 18px">${features}</table>
    ${buttonHtml({ type: "button", label: b.ctaLabel, url: b.ctaUrl, variant: b.highlight ? "accent" : "primary" })}
  </td></tr>
</table>`
}

function blockHtml(b: Block): string {
    switch (b.type) {
        case "eyebrow":
            return `<p style="${TYPE.eyebrow};margin:0 0 12px">${escapeHtml(b.text)}</p>`

        case "heading":
            return b.level === 2
                ? `<p style="${TYPE.h2};margin:${GAP}px 0 10px">${escapeHtml(b.text)}</p>`
                : `<h1 style="${TYPE.h1};margin:0 0 16px">${escapeHtml(b.text)}</h1>`

        case "text":
            return `<p style="${TYPE.body};margin:0 0 16px">${inlineHtml(b.text)}</p>`

        case "button":
            return buttonHtml(b)

        case "list": {
            // Tabulkový seznam místo <ul> — odsazení <ul> se v každém klientovi
            // liší o desítky pixelů. Čtvereček navíc sedne brutalistní značce.
            const items = b.items.map((item, i) => {
                const marker = b.ordered
                    ? `<span style="${TYPE.body};color:${COLOR.accent};font-weight:700">${i + 1}.</span>`
                    : `<div style="width:6px;height:6px;background:${COLOR.accent};margin-top:8px"></div>`
                return `<tr>
      <td width="22" valign="top" style="padding:0 10px 8px 0">${marker}</td>
      <td style="${TYPE.body};padding:0 0 8px">${inlineHtml(item)}</td>
    </tr>`
            }).join("")
            return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 ${GAP}px">${items}</table>`
        }

        case "callout": {
            const t = CALLOUT[b.tone]
            return row(
                `<td bgcolor="${t.bg}" style="background:${t.bg};border:1px solid ${t.border};border-left:3px solid ${t.title};border-radius:${METRIC.radius}px;padding:16px 18px">
      ${b.title ? `<p style="${TYPE.h2};font-size:12px;color:${t.title};margin:0 0 6px">${escapeHtml(b.title)}</p>` : ""}
      <p style="${TYPE.body};font-size:14px;margin:0">${inlineHtml(b.text)}</p>
    </td>`,
                `margin:0 0 ${GAP}px`,
            )
        }

        case "divider":
            return row(`<td style="border-top:1px solid ${COLOR.hairline};font-size:0;line-height:0">&nbsp;</td>`, `margin:${GAP}px 0`)

        case "spacer": {
            const h = b.size === "sm" ? 8 : b.size === "lg" ? 32 : 16
            return `<div style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</div>`
        }

        case "image": {
            const img = `<img src="${escapeHtml(b.src)}" alt="${escapeHtml(b.alt)}" ${b.width ? `width="${b.width}"` : ""} style="display:block;border:0;width:100%;max-width:${b.width || METRIC.width - METRIC.pad * 2}px;height:auto;border-radius:${METRIC.radius}px" />`
            return `<div style="margin:0 0 ${GAP}px">${b.href ? `<a href="${escapeHtml(b.href)}">${img}</a>` : img}</div>`
        }

        case "cards":
            return cardsHtml(b)

        case "planCard":
            return planCardHtml(b)

        case "promoCode":
            return row(
                `<td align="center" style="border:2px dashed ${COLOR.ink};border-radius:${METRIC.radius}px;padding:20px">
      <p style="${TYPE.eyebrow};margin:0 0 8px">Slevový kód</p>
      <p style="font-family:${FONT};font-size:26px;font-weight:900;letter-spacing:.2em;color:${COLOR.ink};margin:0">${escapeHtml(b.code)}</p>
      ${b.note ? `<p style="${TYPE.small};margin:8px 0 0">${escapeHtml(b.note)}</p>` : ""}
    </td>`,
                `margin:0 0 ${GAP}px`,
            )

        case "stats": {
            const cells = b.items.map(s =>
                `<td valign="top" style="padding:0 12px 0 0">
      <p style="${TYPE.h1};font-size:24px;margin:0 0 4px">${escapeHtml(s.value)}</p>
      <p style="${TYPE.eyebrow};margin:0">${escapeHtml(s.label)}</p>
    </td>`).join("")
            return row(cells, `margin:0 0 ${GAP}px`)
        }

        case "quote":
            return row(
                `<td style="border-left:3px solid ${COLOR.accent};padding:4px 0 4px 18px">
      <p style="${TYPE.body};font-style:italic;margin:0">${inlineHtml(b.text)}</p>
      ${b.author ? `<p style="${TYPE.eyebrow};margin:8px 0 0">${escapeHtml(b.author)}</p>` : ""}
    </td>`,
                `margin:0 0 ${GAP}px`,
            )

        case "footnote":
            return `<p style="${TYPE.small};font-size:12px;color:${COLOR.muted};margin:0 0 10px">${inlineHtml(b.text)}</p>`

        case "raw":
            return b.html
    }
}

export function renderBlocksHtml(blocks: Block[]): string {
    return blocks.map(blockHtml).join("\n")
}
