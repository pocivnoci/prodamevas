/**
 * Tokeny e-mailového designu — jediný zdroj pravdy o tom, jak Chrlit vypadá
 * ve schránce.
 * =========================================================================
 * Web má tokeny v `app/globals.css` (@theme). Sem se přepisují ručně, protože
 * e-mail neumí CSS proměnné ani Tailwind — všechno musí být inline a doslovné.
 * Aserce 29.2 v `npm run guard` hlídá, že se odstín značky nerozejde.
 *
 * Vzhled je **hybrid**: světlé tělo, černé pásy. Ne proto, že by byl hezčí než
 * tmavý web, ale protože tmavé pozadí v e-mailu drží jen do první schránky —
 * Outlook zahodí `background` na `<div>`u a z tmavého designu zbude bílá
 * stránka s bílým textem. Černá se proto nese na `<td bgcolor>`, kterému věří
 * všichni, a jen v pruzích, kde nevadí, když ji klient přebarví.
 *
 * Značka je brutalistní: `rounded-sm` (2 px) prakticky všude. Vedlejší efekt je,
 * že **tlačítka nepotřebují VML fallback pro Outlook** — hranaté rohy vypadají
 * v Outlooku stejně jako v Gmailu, takže si celý systém vystačí s `<table>`
 * a inline styly, bez podmíněných komentářů kolem každého CTA.
 */

/** Paleta. Odvozeno z `--color-aisummit-*` v app/globals.css. */
export const COLOR = {
    /** Plátno za kartou — jemně šedé, aby bílá karta měla hranu i bez rámečku. */
    canvas: "#f2f2f2",
    card: "#ffffff",
    /** Černý pás hlavičky a patičky. Tentýž odstín jako pozadí aplikace. */
    band: "#050505",
    /** Cinnabar. Kanonický akcent značky — MUSÍ souhlasit s globals.css. */
    accent: "#e63946",
    ink: "#050505",
    body: "#3a3a3a",
    muted: "#767676",
    hairline: "#e6e6e6",
    /** Sekundární text na černém pásu. */
    onBand: "#9a9a9a",
    onBandStrong: "#ffffff",
} as const

/** Rozměry. 600 px je nejširší bezpečná šířka — Outlook čte podokno na 600. */
export const METRIC = {
    width: 600,
    pad: 40,
    padMobile: 24,
    /** `rounded-sm` z UI. Malý radius Outlook ignoruje a nikdo si nevšimne. */
    radius: 2,
} as const

/**
 * Písmo. Inter je značkové, ale webfont ve schránce spolehlivě nedoručíš —
 * proto stack, kde Inter jen „vyhraje, když je". Na Applu padne na
 * -apple-system, ve Windows na Segoe UI, jinde na Arial.
 */
export const FONT =
    `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`

/**
 * Typografická škála jako hotové fragmenty inline stylu.
 * Renderer je jen slepuje — díky tomu existuje každá velikost jednou
 * a nedá se „jen pro tenhle jeden e-mail" o pixel posunout.
 */
export const TYPE = {
    eyebrow: `font-family:${FONT};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.28em;color:${COLOR.muted};margin:0`,
    h1: `font-family:${FONT};font-size:30px;line-height:1.06;font-weight:900;text-transform:uppercase;letter-spacing:-.02em;color:${COLOR.ink};margin:0`,
    h2: `font-family:${FONT};font-size:15px;line-height:1.3;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:${COLOR.ink};margin:0`,
    body: `font-family:${FONT};font-size:15px;line-height:1.65;color:${COLOR.body};margin:0`,
    small: `font-family:${FONT};font-size:13px;line-height:1.6;color:${COLOR.muted};margin:0`,
    legal: `font-family:${FONT};font-size:11px;line-height:1.6;color:${COLOR.onBand};margin:0`,
    button: `font-family:${FONT};font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.18em;text-decoration:none;display:inline-block`,
    /** Wordmark v černém pásu — živý text, ne obrázek. Viz layout.ts. */
    wordmark: `font-family:${FONT};font-size:22px;font-weight:800;text-transform:uppercase;letter-spacing:.28em;color:${COLOR.onBandStrong};text-decoration:none;margin:0`,
} as const

export type ButtonVariant = "primary" | "accent" | "ghost"

/**
 * Varianty tlačítka. `primary` je černá výplň s cinnabarovou linkou dole —
 * hrana, která z obyčejného obdélníku dělá značku, a přitom je to jen
 * `border-bottom`, takže ji nepokazí ani Outlook.
 */
export const BUTTON: Record<ButtonVariant, { bg: string; fg: string; edge: string; border: string }> = {
    primary: { bg: COLOR.band, fg: "#ffffff", edge: COLOR.accent, border: COLOR.band },
    accent: { bg: COLOR.accent, fg: "#ffffff", edge: COLOR.band, border: COLOR.accent },
    ghost: { bg: COLOR.card, fg: COLOR.ink, edge: COLOR.accent, border: COLOR.ink },
}

export type CalloutTone = "info" | "success" | "warning" | "danger"

/**
 * Tóny upozornění. Semantické barvy kopírují stavové badge v UI
 * (emerald = hotovo, amber = pozor, red = problém), jen posunuté do světlého
 * podkladu, aby na bílé kartě zůstaly čitelné.
 */
export const CALLOUT: Record<CalloutTone, { bg: string; border: string; title: string }> = {
    info: { bg: "#f4f6f8", border: "#d7dde3", title: "#2b3a45" },
    success: { bg: "#eefaf3", border: "#c2e8d4", title: "#1c6b45" },
    warning: { bg: "#fff8ec", border: "#f2ddb4", title: "#7a5510" },
    danger: { bg: "#fdf1f1", border: "#f2c9c9", title: "#9c2a2a" },
}

/**
 * Nad ~102 KB Gmail zprávu ořízne a schová zbytek za „[Zpráva byla zkrácena]".
 * Stříhá **odspodu**, takže první zmizí CTA a odhlašovací patička — tedy přesně
 * to, bez čeho e-mail nemá smysl a začne sbírat stížnosti na spam.
 * Strop je schválně níž, aby zbyla rezerva na delší text v proměnných.
 */
export const GMAIL_CLIP_LIMIT_KB = 90
