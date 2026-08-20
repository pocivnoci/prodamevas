/**
 * Bloky → `text/plain`.
 * =====================
 * Textová část není formalita. Chybějící `text/plain` je poznávací znamení
 * strojové pošty a zhoršuje skóre u filtrů; navíc ji reálně čtou čtečky
 * a klienti s vypnutým HTML.
 *
 * **Nesmí importovat `render-html.ts`.** Vypadají symetricky, ale nejsou —
 * HTML escapuje, text naopak entity rozkódovává, a jakmile jeden zavolá druhý,
 * začne se text renderovat přes markup a zpátky.
 */

import type { Block } from "./blocks"
import { parseInline } from "./inline"

/** Tokeny odstavce → text. Z odkazu musí zbýt adresa, jinak je odstavec k ničemu. */
function inlineText(text: string): string {
    return parseInline(text).map(t => (t.t === "link" ? `${t.v} (${t.href})` : t.v)).join("")
}

/** Nadpis podtržený čárou — brutalistní i v monospace. */
function underline(text: string): string {
    const t = text.toUpperCase()
    return `${t}\n${"─".repeat(Math.min(t.length, 46))}`
}

function blockText(b: Block): string {
    switch (b.type) {
        case "eyebrow":
            return b.text.toUpperCase()
        case "heading":
            return b.level === 2 ? b.text.toUpperCase() : underline(b.text)
        case "text":
            return inlineText(b.text)
        case "button":
            return `→ ${b.label.toUpperCase()}: ${b.url}`
        case "list":
            return b.items.map((i, n) => `${b.ordered ? `${n + 1}.` : "·"} ${inlineText(i)}`).join("\n")
        case "callout":
            return [b.title ? `[ ${b.title.toUpperCase()} ]` : null, inlineText(b.text)]
                .filter(Boolean).join("\n")
        case "divider":
            return "────────────────────────────────"
        case "spacer":
            return ""
        case "image":
            // Popisek obrázku nese informaci jen když ji autor napsal; prázdný alt
            // je dekorace a do textové části nepatří.
            return b.alt ? `[obrázek: ${b.alt}]` : ""
        case "cards":
            return b.cards.map(c => [
                c.meta ? `— ${c.meta}` : null,
                c.title ? c.title.toUpperCase() : null,
                c.text || null,
                c.href || null,
            ].filter(Boolean).join("\n")).join("\n\n")
        case "planCard":
            return [
                underline(b.name),
                `${b.price} ${b.period}`,
                ...b.features.map(f => `· ${f}`),
                `→ ${b.ctaLabel.toUpperCase()}: ${b.ctaUrl}`,
            ].join("\n")
        case "promoCode":
            return [`SLEVOVÝ KÓD: ${b.code}`, b.note || null].filter(Boolean).join("\n")
        case "stats":
            return b.items.map(s => `${s.value} — ${s.label}`).join("\n")
        case "quote":
            return [`„${inlineText(b.text)}"`, b.author ? `— ${b.author}` : null].filter(Boolean).join("\n")
        case "footnote":
            return inlineText(b.text)
        case "raw":
            return b.text ?? htmlToText(b.html) ?? ""
    }
}

export function renderBlocksText(blocks: Block[]): string {
    return blocks.map(blockText).filter(s => s.trim().length > 0).join("\n\n")
}

const ENTITIES: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
    "&apos;": "'", "&nbsp;": " ", "&hellip;": "…", "&mdash;": "—", "&ndash;": "–",
}

/**
 * Legacy cesta: `body` (a v pár místech i hotové HTML) → text.
 *
 * Past, kvůli které tahle funkce vůbec existuje: **`body` není čistý text.**
 * Nese inline HTML a v půlce zpráv je `<a href="…">Obnovit předplatné →</a>`
 * jediná užitečná věc v celém e-mailu. Naivní `replace(/<[^>]+>/g, "")` z něj
 * udělá „Obnovit předplatné →" bez adresy — tedy zprávu, která po převodu do
 * textu ztratí smysl. Odkazy se proto nejdřív rozbalí i s adresou.
 *
 * Vrací `undefined`, když nezbude nic — prázdný řetězec by se poslal Resendu
 * jako skutečná prázdná textová část a někteří klienti pak ukážou prázdnou
 * zprávu místo HTML verze.
 */
export function htmlToText(html: string): string | undefined {
    const text = html
        .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
            (_m, href, label) => {
                const clean = String(label).replace(/<[^>]+>/g, "").trim()
                return clean && !clean.includes(href) ? `${clean} (${href})` : href
            })
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n\n")
        .replace(/<li\b[^>]*>/gi, "· ")
        .replace(/<[^>]+>/g, "")
        .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
        .replace(/&[a-z]+;/gi, e => ENTITIES[e.toLowerCase()] ?? e)
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    return text.length > 0 ? text : undefined
}
