/**
 * Hotová copy v briefu formátu — jeden predikát pro detekci i odstranění.
 * ======================================================================
 * Formát je šablona pro desítky příspěvků. Když v něm zůstane konkrétní znění
 * („Uložte si inspiraci", „Rezervujte si termín v biu"), dostane copywriter tu
 * samou větu u každého postu daného formátu a příspěvky se opakují.
 *
 * Zákaz v promptu NESTAČÍ. I s výslovným zákazem a konkrétními příklady chyb
 * nechal model hotovou copy v 11 z 95 formátů — proto se to vynucuje strojově
 * na každé cestě, která brief zapisuje (onboarding, fast-path v Nastavení,
 * migrace). `warnOnScenicFormats` používá TÝŽ predikát, takže se detekce a
 * sanitizace nemůžou rozejít.
 *
 * Co se NEODSTRAŇUJE: krátké názvy stylů a estetik ('romanticizing your life').
 * Ty do briefu patří — nejsou to repliky, které by šly vytisknout na obrázek.
 * Rozlišuje je velké počáteční písmeno nebo koncová interpunkce, tedy tvar věty.
 */

/**
 * Uvozovky se musí PÁROVAT, ne jen „nějaká otevírací … nějaká zavírací".
 * Jinak se zavírací apostrof krátké citace spáruje s další replikou o kus dál,
 * smaže se text mezi nimi a v briefu zůstane osiřelá uvozovka.
 * Zahrnuje ASCII ' a " — modely citují copy nejčastěji právě jimi.
 */
const QUOTED = /„([^„""]+?)"|"([^"]+?)"|'([^']+?)'|"([^"]+?)"|'([^']+?)'/gu

/** Alespoň tolik slov, aby šlo o větu a ne o jednoslovný termín. */
const MIN_COPY_WORDS = 3

/** Vypadá obsah uvozovek jako hotová věta (a ne jako název stylu či termín)? */
function looksLikeCopy(quote: string): boolean {
    const words = quote.trim().split(/\s+/u).filter(Boolean)
    if (words.length < MIN_COPY_WORDS) return false
    return /^\p{Lu}/u.test(quote.trim()) || /[.!?…]$/u.test(quote.trim())
}

/** Obsah, který v daném matchi skutečně padl do uvozovek. */
function matchedQuote(m: RegExpMatchArray): string {
    return m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? ""
}

/** Najde hotové repliky v textu. Prázdné pole = brief je čistý. */
export function findFinishedCopy(text: string): string[] {
    const out: string[] = []
    for (const m of text.matchAll(QUOTED)) {
        const q = matchedQuote(m)
        if (looksLikeCopy(q)) out.push(q)
    }
    return out
}

/**
 * Odstraní hotové repliky a uklidí po nich interpunkci.
 *
 * Role beatu zůstane, zmizí jen jeho obsah:
 *   „Slide 5: Vchod + CTA 'Dokonalá základna. Rezervujte'." → „Slide 5: Vchod + CTA."
 */
export function stripFinishedCopy(text: string): string {
    return text
        .replace(QUOTED, (whole, ...groups) => {
            const quote = (groups.slice(0, 5).find(g => typeof g === "string") ?? "") as string
            return looksLikeCopy(quote) ? "" : whole
        })
        // Po vyjmutí zůstávají osiřelé spojky a zdvojená interpunkce.
        .replace(/\s*\+\s*(?=[.,;:]|$)/gu, "")
        .replace(/\s{2,}/gu, " ")
        .replace(/\s+([.,;:])/gu, "$1")
        .replace(/([.,;:])\1+/gu, "$1")
        .replace(/[:,]\s*(?=[.;]|$)/gu, "")
        // „Hook: -> Kontext" → „Hook -> Kontext": po vyjmutí obsahu zůstala
        // dvojtečka bez toho, co uvozovala.
        .replace(/:\s*(?=(?:->|→|—|–)\s)/gu, " ")
        .replace(/\s{2,}/gu, " ")
        .trim()
}
