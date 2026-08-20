/**
 * Lehké značkování → bloky.
 * =========================
 * Tohle je autorská plocha pro admin panel. Bez ní by „napsat novinky" znamenalo
 * buď psát HTML, nebo se smířit s jedním nekonečným odstavcem.
 *
 * Umí schválně málo — jen to, co se dá v e-mailu spolehlivě vykreslit:
 *
 * ```
 * ## Mezinadpis
 * Odstavec s **tučným** a [odkazem](https://…).
 * - položka seznamu
 * 1. číslovaná položka
 * > citace
 * ---
 * ```
 *
 * Cokoli jiného je obyčejný odstavec. Nic se odsud nepropustí jako HTML —
 * escapování řeší renderer, takže ani vložený `<script>` nikam neuteče.
 */

import { compact, divider, heading, list, paragraph, quote, type Block } from "./blocks"

/** Odstavce oddělené prázdným řádkem; uvnitř odstavce se ctí jednotlivé řádky. */
export function markdownToBlocks(src: string): Block[] {
    const out: Block[] = []
    let bullets: string[] = []
    let ordered = false

    const flushList = () => {
        if (bullets.length === 0) return
        out.push(list(bullets, ordered))
        bullets = []
        ordered = false
    }

    for (const rawLine of (src || "").split("\n")) {
        const line = rawLine.trim()

        if (!line) { flushList(); continue }

        const bullet = /^[-*]\s+(.*)$/.exec(line)
        const numbered = /^\d+[.)]\s+(.*)$/.exec(line)

        if (bullet || numbered) {
            const isOrdered = Boolean(numbered)
            // Přepnutí typu seznamu uprostřed uzavře ten předchozí, jinak by se
            // odrážky a čísla slily do jednoho seznamu.
            if (bullets.length > 0 && isOrdered !== ordered) flushList()
            ordered = isOrdered
            bullets.push((bullet?.[1] ?? numbered?.[1] ?? "").trim())
            continue
        }

        flushList()

        if (/^---+$/.test(line)) { out.push(divider()); continue }
        const h2 = /^##\s+(.*)$/.exec(line)
        if (h2) { out.push(heading(h2[1].trim(), 2)); continue }
        const h1 = /^#\s+(.*)$/.exec(line)
        if (h1) { out.push(heading(h1[1].trim(), 1)); continue }
        const q = /^>\s?(.*)$/.exec(line)
        if (q) { out.push(quote(q[1].trim())); continue }

        // Souvislý text: navazující řádky patří k témuž odstavci.
        const last = out[out.length - 1]
        if (last && last.type === "text") last.text += `\n${line}`
        else out.push(paragraph(line))
    }

    flushList()
    return compact(out)
}
