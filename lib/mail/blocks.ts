/**
 * Slovník e-mailových bloků.
 * ==========================
 * Bloky jsou **data, ne HTML**. To je celý trik téhle vrstvy: z jednoho pole
 * bloků se vyrenderuje HTML i `text/plain` (renderery se nemusí domlouvat, co
 * kdo umí), a protože je to obyčejný JSON, umí ho admin panel poskládat
 * z formuláře, aniž by kdokoli v UI psal markup.
 *
 * Šablony jsou **listy stromu** — dostanou hotový `vars` objekt a vrátí bloky.
 * Nesmějí sahat na databázi ani na `lib/notifications`; data si obstará volající.
 * Kdyby to udělaly, vznikne cyklus `notifications → layout → templates →
 * notifications`, který pod ESM projde na hoistingu, ale pod `tsx`/CJS
 * v `npm run guard` spadne na půl inicializovaném modulu. Hlídá aserce 29.1.
 */

import type { ButtonVariant, CalloutTone } from "./tokens"

/** Karta v seznamu (digest příspěvků, výpis novinek). */
export interface CardItem {
    /** Volitelný — karta v digestu příspěvků žádný titulek nemá, jen termín a text. */
    title?: string
    text?: string
    /** Malý popisek nad titulkem — datum, typ média, štítek. */
    meta?: string
    imageUrl?: string
    href?: string
}

export type Block =
    /** Drobný popisek nad nadpisem: „NOVINKY · SRPEN 2026". */
    | { type: "eyebrow"; text: string }
    | { type: "heading"; text: string; level?: 1 | 2 }
    /** Odstavec. Umí `**tučně**` a `[popisek](url)`; zbytek se escapuje. */
    | { type: "text"; text: string }
    | { type: "button"; label: string; url: string; variant?: ButtonVariant }
    | { type: "list"; items: string[]; ordered?: boolean }
    | { type: "callout"; tone: CalloutTone; title?: string; text: string }
    | { type: "divider" }
    | { type: "spacer"; size?: "sm" | "md" | "lg" }
    | { type: "image"; src: string; alt: string; width?: number; href?: string }
    | { type: "cards"; cards: CardItem[] }
    | {
        type: "planCard"
        name: string
        price: string
        period: string
        features: string[]
        ctaLabel: string
        ctaUrl: string
        highlight?: boolean
    }
    /** Hranatý čip se slevovým kódem. */
    | { type: "promoCode"; code: string; note?: string }
    | { type: "stats"; items: { label: string; value: string }[] }
    | { type: "quote"; text: string; author?: string }
    /** Drobný text pod čarou — sem patří `vatNotice()`. */
    | { type: "footnote"; text: string }
    /**
     * Hotové HTML — **jen most pro starší volající** (`sendNotification({ body })`
     * a digest), aby šla slupka přepnout dřív, než se přepíšou všechny zprávy.
     * Nová šablona `raw` používat nemá: co projde tudy, se needituje ve formuláři,
     * nemá textovou podobu zadarmo a obchází escapování.
     */
    | { type: "raw"; html: string; text?: string }

// ── Stavitelé ───────────────────────────────────────────────────────────────
// Jen aby se šablony četly jako text, ne jako JSON s uvozovkami.

export const eyebrow = (text: string): Block => ({ type: "eyebrow", text })
export const heading = (text: string, level: 1 | 2 = 1): Block => ({ type: "heading", text, level })
export const paragraph = (text: string): Block => ({ type: "text", text })
export const button = (label: string, url: string, variant: ButtonVariant = "primary"): Block =>
    ({ type: "button", label, url, variant })
export const list = (items: string[], ordered = false): Block => ({ type: "list", items, ordered })
export const callout = (tone: CalloutTone, text: string, title?: string): Block =>
    ({ type: "callout", tone, text, title })
export const divider = (): Block => ({ type: "divider" })
export const spacer = (size: "sm" | "md" | "lg" = "md"): Block => ({ type: "spacer", size })
export const image = (src: string, alt: string, width?: number, href?: string): Block =>
    ({ type: "image", src, alt, width, href })
export const cards = (items: CardItem[]): Block => ({ type: "cards", cards: items })
export const promoCode = (code: string, note?: string): Block => ({ type: "promoCode", code, note })
export const stats = (items: { label: string; value: string }[]): Block => ({ type: "stats", items })
export const quote = (text: string, author?: string): Block => ({ type: "quote", text, author })
export const footnote = (text: string): Block => ({ type: "footnote", text })
/** Most pro starší volající — viz komentář u `type: "raw"`. */
export const raw = (html: string, text?: string): Block => ({ type: "raw", html, text })
export const planCard = (p: {
    name: string
    price: string
    period: string
    features: string[]
    ctaLabel: string
    ctaUrl: string
    highlight?: boolean
}): Block => ({ type: "planCard", ...p })

/**
 * Vyhodí prázdné bloky — šablona tak může psát `vars.code && promoCode(...)`.
 * Prázdný řetězec je mezi povolenými schválně: proměnné šablon jsou vždy
 * `string`, takže nevyplněné pole se do podmínky propíše jako `""`.
 */
export function compact(blocks: (Block | false | null | undefined | "")[]): Block[] {
    return blocks.filter((b): b is Block => Boolean(b))
}
