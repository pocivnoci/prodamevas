/**
 * Media-weighted credit costs — client-safe module (no server imports).
 * Single source of truth; lib/subscription.ts re-exports these for the backend,
 * client components import directly for UI estimates.
 *
 * 1 credit ≈ $0.30 of AI COGS: a reel costs ~4× an image to produce, so a flat
 * 1-credit-per-post price sold reels below cost. See docs/UNIT_ECONOMICS_AND_PRICING.md §4.
 */

// Skloňování počítaných jmen je sdílené (`lib/plural.ts`), ne lokální kopie: čtyři
// kopie téhož `n === 1 ? … : …` se mezi sebou lišily v tom, co je „2–4" a co „5+".
// `plural.ts` je stejně client-safe jako tenhle modul (žádné server importy).
import { countLabel, CAROUSELS, IMAGES } from "@/lib/plural"

/**
 * The price of every medium the engine can produce — and, via `MediumType` below,
 * the DEFINITION of which media exist at all.
 *
 * Adding a key here is the ONE edit that opens a new medium: every exhaustive
 * switch over `MediumType` stops compiling until it is handled. The inversion is
 * deliberate — a medium the engine can render but nobody priced is not
 * representable, which is how `story` was almost shipped billing 1 credit through
 * `creditsForMedia`'s image fallback.
 */
export const MEDIA_CREDITS = {
    image: 1,
    story: 2,
    carousel: 3,
    /** Krátký reel — do 8 s videa (Seedance 480p + český voiceover + titulky + cover). */
    reel: 5,
    /** Dlouhý reel — do 20 s. Samostatné médium, ne příznak: `media_type` na řádku
     *  příspěvku rozhoduje o zúčtování, takže délka MUSÍ být ve jméně média
     *  (`lib/reel-media.ts`). */
    reel_long: 10,
} as const

export type MediumType = keyof typeof MEDIA_CREDITS

/** České názvy médií pro nápovědu a ceník; `Record<MediumType, …>` přestane
 *  kompilovat, jakmile v `MEDIA_CREDITS` přibude médium bez popisku. */
export const MEDIA_LABELS_CZ: Record<MediumType, string> = {
    image: "obrázek",
    story: "story",
    carousel: "carousel",
    reel: "reel",
    reel_long: "dlouhý reel",
}

/** „obrázek 1 · story 2 · carousel 3 · reel 5 · dlouhý reel 10" — z tabulky vah, ne z ruky.
 *  Nápověda tu do 9/2026 tvrdila „reel 5" a dlouhý reel vynechala. */
export function mediaCreditsSentence(): string {
    return ALL_MEDIA.map((m) => `${MEDIA_LABELS_CZ[m]} ${MEDIA_CREDITS[m]}`).join(" · ")
}

// ─── Akce mimo média ──────────────────────────────────────────

export type ActionType =
    | "post"
    | "post_edit"
    | "post_variant"
    | "idea_generate"
    | "product_ideas"
    | "product_visual"
    | "product_design"
    | "product_mockup"
    | "product_brief"
    | "product_line"

/**
 * How many credits each action costs (for EXTRA posts, not plan posts).
 * Žije tady (client-safe), ne v lib/subscription.ts: nápověda a ceník v UI
 * z něj skládají věty, a server-only modul se do klientské komponenty
 * importovat nedá — proto FAQ do 9/2026 nesla čísla opsaná ručně.
 */
export const ACTION_CREDITS: Record<ActionType, number> = {
    post: 1,               // base = image; carousel/reel are weighted via creditsForMedia()
    post_edit: 1,          // targeted retouch = ONE image call — flat, never media-weighted
    post_variant: 1,       // base = image; weighted via creditsForMedia()
    idea_generate: 1,      // batch of ideas
    product_ideas: 2,      // 5 product ideas
    product_visual: 2,     // Imagen render
    product_design: 3,     // concept + render
    product_mockup: 2,     // photorealistic mockup
    product_brief: 5,      // full business analysis
    product_line: 8,       // whole line: Pro-ladder strategy + N SKUs + specs + repair round
}

/** Everything a plan with no `allowed_media` may use (legacy/trial = all). */
export const ALL_MEDIA = Object.keys(MEDIA_CREDITS) as MediumType[]

/** Narrowing guard for values arriving from the DB / job configs as bare strings. */
export function isMediumType(v: unknown): v is MediumType {
    return typeof v === "string" && v in MEDIA_CREDITS
}

/**
 * Credit cost of a post for a given medium; unknown/missing medium = image (cheapest).
 *
 * The fallback stays deliberately lenient: the input is `string | null` straight from
 * `ig_posts.media_type`, where every row predating 20260622 is NULL, and throwing here
 * would break the posts list. It is also safe by construction — `reconcileJobCharge`
 * only ever refunds DOWNWARD, so pricing an unknown medium as the cheapest yields the
 * maximum refund, never an overcharge. The "every medium is priced" guarantee comes
 * from `MediumType` being derived from this table, not from this runtime path.
 */
export function creditsForMedia(medium?: string | null): number {
    return MEDIA_CREDITS[medium as MediumType] ?? MEDIA_CREDITS.image
}

/**
 * „≈ 20 obrázků nebo 6 carouselů" — co si za daný počet kreditů reálně koupím.
 *
 * PROČ TO EXISTUJE: ceník do teď říkal jen „20 kreditů měsíčně" a vedle toho
 * sliboval „Až 20 příspěvků" i „Carousel posty". Jenže carousel stojí tři kredity,
 * takže tentýž tarif je 20 obrázků NEBO 6 carouselů — a kupující se to nedozvěděl,
 * dokud nezaplatil. Aplikace váhy uváděla, marketing ne.
 *
 * Počítá se z `MEDIA_CREDITS`, nikdy se nepíše ručně. Když se váha změní, změní se
 * i věta na ceníku — druhá pravda o ceně je přesně to, co tenhle modul zavírá.
 *
 * Reels se přidávají jen když jsou zapnuté (`REELS_ENABLED`): slibovat počet reelů
 * u funkce, která se potichu překlopí na carousel, je horší než ji nezmínit.
 */
export function creditExample(credits: number, opts?: { reels?: boolean }): string {
    const kusu = (medium: MediumType) => Math.floor(credits / MEDIA_CREDITS[medium])

    const obrazky = kusu("image")
    const carousely = kusu("carousel")
    const reely = kusu("reel")

    // Obrázky jsou vždycky — je to nejlevnější médium, takže jich nikdy nevyjde nula.
    // Dražší média se vypisují jen když si jich tarif dovolí aspoň jedno: „0 carouselů"
    // není informace, je to jenom ošklivé místo na ceníku.
    const casti = [countLabel(obrazky, IMAGES)]
    if (carousely > 0) casti.push(countLabel(carousely, CAROUSELS))
    // „reels" zůstává nesklonné — tak se ta funkce jmenuje i v UI a na Instagramu.
    if (opts?.reels && reely > 0) casti.push(`${reely} reels`)

    if (casti.length === 1) return `≈ ${casti[0]}`

    const posledni = casti.pop()
    return `≈ ${casti.join(", ")} nebo ${posledni}`
}
