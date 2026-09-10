/**
 * Výběr fotek značky k příspěvku
 * ==============================
 * Jedna funkce pro obraz i reel. Do 9/2026 stálo skórování ve dvou kopiích
 * (`image-orchestrator.ts` a `reel-orchestrator.ts`), takže se vylepšení jedné
 * cesty do druhé nikdy nepropsalo — a obě měly stejné dvě vady:
 *
 *   1. **Diakritika a skloňování.** Porovnávalo se `context.includes(slovo)` nad
 *      surovým textem. Popis „koupelna s vanou" se proti postu „v koupelně"
 *      netrefil, protože „koupelna" ≠ „koupelně". Čeština skloňuje skoro všechno,
 *      takže shoda vznikala hlavně náhodou.
 *
 *   2. **Štítky se hledaly jako podřetězec.** Štítek `bar` se trefil do „barva",
 *      „barevný" i „baru"; `shop` do „shopping". Falešná shoda je horší než žádná:
 *      posune fotku nahoru a vytlačí tu správnou.
 *
 * Navíc se štítky porovnávaly jen anglickým ID (`bedroom`, `exterior`), zatímco
 * text příspěvku je česky — česká jmenovka ze `BRAND_IMAGE_TAGS` se nečetla vůbec.
 *
 * Měřeno na produkčních datech (12 klientů, 92 příspěvků): chytrý výběr zabral
 * u 68 % příspěvků, u zbytku se losovaly tři náhodné fotky.
 */

import { BRAND_IMAGE_TAGS, type BrandImage } from "./configs/types"

/** Kolik znaků se u slova porovnává, aby přežilo skloňování. */
const STEM = 5
/**
 * Nejkratší slovo, u kterého ještě dává předpona smysl.
 *
 * Čtyři znaky schválně, ne pět: česká slova, na kterých u fotek nejvíc záleží,
 * jsou krátká — „auto", „olej", „voda", „logo". S pětiznakovým prahem propadl
 * celý autoservisní slovník a klientovi s osmi fotkami aut se výběr zhoršil.
 * Kratší slova (tří- a méněznaková anglická ID jako `bar`) se porovnávají
 * na přesnou shodu — viz `hits`.
 */
const MIN_WORD = 4
/**
 * Strop příspěvku popisu ke skóre.
 *
 * Popis má 15 slov, štítek se počítá za 3 — bez stropu by dlouhý popis přebil
 * jakýkoli štítek a kurátorská práce člověka by nic neznamenala. Šest bodů =
 * „popis smí rozhodnout mezi dvěma stejně oštítkovanými fotkami, ne přebít štítek".
 */
const MAX_DESC_SCORE = 6

/** Malá čeština: bez diakritiky, jen písmena a číslice, rozsekané na slova. */
export function words(text: string): string[] {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
}

/** Štítek → slova, podle kterých se dá hledat: anglické ID + česká jmenovka. */
const TAG_STEMS = new Map<string, string[]>(
    BRAND_IMAGE_TAGS.map(t => {
        return [t.id, Array.from(new Set([t.id.toLowerCase(), ...words(t.label)]))]
    }),
)

/** Slova neznámého štítku (legacy data, ručně dopsané) — aspoň to jeho ID. */
function wordsForTag(tag: string): string[] {
    const known = TAG_STEMS.get(tag)
    if (known) return known
    return words(tag)
}

/**
 * Sedí dvě slova na sebe navzdory skloňování?
 *
 * Čeština mění konec slova („koupelna" → „v koupelně") a odvozuje přídavná jména
 * („olej" → „olejový"), takže shodu nejde hledat na rovnost. Porovnává se délka
 * SPOLEČNÉ PŘEDPONY, ve třech režimech podle toho, jak krátké to slovo je:
 *
 *   • **Tři znaky a míň** → jen přesná shoda. Anglická ID jako `bar` nebo `tym`
 *     jsou proti české větě příliš ambivalentní; s předponou by `bar` sedělo do
 *     „barvy" a k příspěvku o fasádě by se přiložila fotka baru. Ztratíme „baru",
 *     ale falešná shoda je horší než žádná — neposune jen skóre, ona vytlačí
 *     správnou fotku ven.
 *   • **Obě slova delší než kmen** → stačí prvních `STEM` znaků. Na koncovce
 *     nezáleží vůbec, takže projde jakýkoli pád.
 *   • **Mezi tím** → společná předpona musí být celé kratší slovo bez poslední
 *     hlásky. „auto"/„auta" projde přes „aut", „olej"/„olejový" přes „olej",
 *     ale „food"/„fotbal" ne (společné jsou jen dvě písmena).
 *
 * Porovnávají se vždy CELÁ slova, nikdy podřetězec věty — původní
 * `context.includes(slovo)` hledal „bar" i uprostřed „barvy".
 */
function commonPrefix(a: string, b: string): number {
    const max = Math.min(a.length, b.length)
    let i = 0
    while (i < max && a[i] === b[i]) i++
    return i
}

function wordMatches(a: string, b: string): boolean {
    const shorter = Math.min(a.length, b.length)
    if (shorter <= 3) return a === b
    const common = commonPrefix(a, b)
    if (a.length > STEM && b.length > STEM) return common >= STEM
    return common >= shorter - 1
}

/** Sedí slovo na některé slovo kontextu? */
function hits(word: string, ctx: string[]): boolean {
    return ctx.some(w => wordMatches(word, w))
}

/**
 * Jak moc se fotka hodí k tomuhle příspěvku. 0 = netrefila se v ničem.
 *
 * Štítek 3 body (kurátorská informace), slovo z popisu 1 bod se stropem —
 * viz `MAX_DESC_SCORE`.
 */
export function scoreBrandPhoto(img: Pick<BrandImage, "tags" | "description">, context: string[]): number {
    let score = 0
    for (const tag of img.tags || []) {
        if (wordsForTag(tag).some(w => hits(w, context))) score += 3
    }
    let desc = 0
    for (const w of words(img.description || "")) {
        if (w.length < MIN_WORD) continue
        if (hits(w, context)) desc += 1
    }
    return score + Math.min(desc, MAX_DESC_SCORE)
}

/**
 * Vyber `count` fotek k příspěvku.
 *
 * `matched: false` znamená „nic se netrefilo, tady jsou náhodné" — volající to
 * loguje, aby šlo poznat rozdíl mezi kurátorským a losovaným výběrem.
 */
export function pickBrandPhotos<T extends Pick<BrandImage, "tags" | "description">>(
    images: T[],
    /** Vše, co o příspěvku víme: typ, hook, tělo, prompt na obrázek. */
    contextParts: (string | null | undefined)[],
    count: number,
): { picks: T[]; matched: boolean } {
    if (images.length <= count) return { picks: [...images], matched: false }

    const context = words(contextParts.filter(Boolean).join(" "))
    const scored = images
        .map(img => ({ img, score: scoreBrandPhoto(img, context) }))
        .sort((a, b) => b.score - a.score)

    if ((scored[0]?.score ?? 0) > 0) {
        return { picks: scored.filter(s => s.score > 0).slice(0, count).map(s => s.img), matched: true }
    }
    return { picks: [...images].sort(() => Math.random() - 0.5).slice(0, count), matched: false }
}
