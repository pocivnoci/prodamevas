/**
 * Drobné značkování uvnitř odstavce: `**tučně**` a `[popisek](url)`.
 * ==================================================================
 * Tokenizace je společná, vypisování se liší — HTML udělá `<a href>`, text
 * napíše „popisek: url". Proto bydlí parser tady a ne v jednom z rendererů:
 * `render-text.ts` nesmí importovat `render-html.ts` (vypadají symetricky, ale
 * nejsou — HTML escapuje, text naopak entity rozkódovává).
 *
 * Vstup je **nedůvěryhodný** — texty píše admin ve formuláři. Nic se odsud
 * nepropustí jako HTML; escapuje se všechno kromě značek, které tenhle parser
 * sám rozpoznal.
 */

export type InlineToken =
    | { t: "text"; v: string }
    | { t: "bold"; v: string }
    | { t: "link"; v: string; href: string }

/** `[popisek](https://…)` — schválně jen http(s), ať se nedá podstrčit `javascript:`. */
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
const BOLD = /\*\*([^*]+)\*\*/g

/**
 * Rozseká odstavec na tokeny. Odkazy se hledají první, aby `**[a](b)**`
 * nerozbilo URL uprostřed.
 */
export function parseInline(text: string): InlineToken[] {
    const out: InlineToken[] = []

    const pushWithBold = (chunk: string) => {
        let last = 0
        BOLD.lastIndex = 0
        for (let m = BOLD.exec(chunk); m; m = BOLD.exec(chunk)) {
            if (m.index > last) out.push({ t: "text", v: chunk.slice(last, m.index) })
            out.push({ t: "bold", v: m[1] })
            last = m.index + m[0].length
        }
        if (last < chunk.length) out.push({ t: "text", v: chunk.slice(last) })
    }

    let last = 0
    LINK.lastIndex = 0
    for (let m = LINK.exec(text); m; m = LINK.exec(text)) {
        if (m.index > last) pushWithBold(text.slice(last, m.index))
        out.push({ t: "link", v: m[1], href: m[2] })
        last = m.index + m[0].length
    }
    if (last < text.length) pushWithBold(text.slice(last))

    return out
}

/**
 * Odstavec bez značkování — pro preheader a pro odvození předmětu.
 * Vrací čitelnou větu: z odkazu zbude jen jeho popisek.
 */
export function stripInline(text: string): string {
    return parseInline(text).map(t => t.v).join("")
}
