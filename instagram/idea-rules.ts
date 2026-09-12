/**
 * Pravidla zásobníku nápadů — čisté funkce, bez DB a bez modelu.
 * ================================================================
 * Nápad je TÉMA („o čem"), nikdy FORMÁT („jak se to natočí"). Formát vybírá
 * až plán podle každého slotu (obrázek / karusel / reel) a mechanismus je
 * univerzální (`mechanisms.ts`). Když nápad předepisuje „zábavné reels video",
 * plán ho posadí do slotu s obrázkem a copywriter pak v popisku slibuje video,
 * které se nikdy nevyrenderuje — přesně ta vada, kvůli které tenhle modul vznikl
 * (září 2026: 18 ze 42 nápadů jednoho klienta předepisovalo video).
 *
 * Druhá polovina: kategorie pilíře je jediný způsob, jak uživatel řídí, O ČEM se
 * generuje. Nápad bez kategorie (nebo s kategorií, kterou konfigurace už nezná,
 * protože se pilíře přegenerovaly) z toho řízení vypadává a v záložce Nápady je
 * pod čipy neviditelný. `findMiscategorized` takové nápady najde; zařazení pak
 * dělá model (`classifyUncategorizedIdeas` v idea-generator.ts).
 */

/** Slova, kterými text předepisuje VIDEO — včetně české flexe
 *  (video/videa/videu/videem/videí, reel/reels/reelsy, natočíme, natáčení, klip). */
const VIDEO_WORDS =
    /(?<![\p{L}\p{N}])(?:reels?[a-zě]*|vide(?:[oaueí][a-zí]*|jk[a-z]*)|natoč[a-zíěý]*|natáč[a-zíě]*|klip[a-zů]*|tiktok[a-zů]*|timelapse|vlog[a-zů]*|voiceover[a-zů]*)(?![\p{L}\p{N}])/giu

/** Slova, kterými text předepisuje KARUSEL (slidy). */
const CAROUSEL_WORDS =
    /(?<![\p{L}\p{N}])(?:karusel[a-zů]*|carousel[a-z]*|slajd[a-zů]*|slid[eyů][a-z]*)(?![\p{L}\p{N}])/giu

/** Slova, kterými text předepisuje STORY. „storytelling" formát není — proto ne `story[a-z]*`. */
const STORY_WORDS =
    /(?<![\p{L}\p{N}])(?:stories|storky|storyčk[a-z]*|story)(?![\p{L}\p{N}])/giu

export type FormatWords = { video: string[]; carousel: string[]; story: string[] }

/** Která formátová slova text obsahuje, po skupinách. Prázdné pole = nic. */
export function formatWordsIn(text: string): FormatWords {
    const pick = (re: RegExp) => Array.from(String(text || "").matchAll(re), m => m[0])
    return { video: pick(VIDEO_WORDS), carousel: pick(CAROUSEL_WORDS), story: pick(STORY_WORDS) }
}

/** Nápad v zásobníku nemá slot, takže JAKÉKOLI formátové slovo je předpis formátu. */
export function prescribesFormat(text: string): boolean {
    const w = formatWordsIn(text)
    return w.video.length > 0 || w.carousel.length > 0 || w.story.length > 0
}

/** Plochý seznam nalezených slov — do logu a do promptu přepisovače. */
export function formatWordsList(text: string): string[] {
    const w = formatWordsIn(text)
    return [...new Set([...w.video, ...w.carousel, ...w.story].map(s => s.toLowerCase()))]
}

export type SlotMedium = "image" | "carousel" | "reel" | "reel_long"

/**
 * Koncept v plánu už slot MÁ — formátové slovo vadí jen tehdy, když slotu neodpovídá:
 * „za 60 sekund ti ukážu" u obrázku, „na pěti slidech" u jednoho obrázku. Karusel smí
 * mluvit o slidech, reel o videu. Story plán nezná, takže ta vadí vždycky.
 */
export function violatesSlot(text: string, medium: SlotMedium): string[] {
    const w = formatWordsIn(text)
    const bad: string[] = []
    if (medium !== "reel" && medium !== "reel_long") bad.push(...w.video)
    if (medium !== "carousel") bad.push(...w.carousel)
    bad.push(...w.story)
    return [...new Set(bad.map(s => s.toLowerCase()))]
}

/** Lidský štítek slotu pro výtku přepisovači. */
export function slotLabel(medium: SlotMedium): string {
    return medium === "carousel" ? "KARUSEL (statické slidy)"
        : medium === "reel_long" ? "DLOUHÝ REEL (video)"
        : medium === "reel" ? "REEL (video)"
        : "JEDEN STATICKÝ OBRÁZEK"
}

// ─── Kategorie ───────────────────────────────────────────────────────────────

export interface IdeaCategoryRow {
    id: string
    /** Klíč pilíře (`ig_post_ideas.category`). */
    category: string
    /** Id kategorie pilíře (`ig_post_ideas.subcategory`), nebo nic. */
    subcategory: string | null
}

export type PillarCategoryMap = Record<string, { categories?: { id: string }[] } | undefined>

/**
 * Nápady, které v konfiguraci nemají platnou kategorii, ačkoli jejich pilíř
 * kategorie má. Pilíř bez kategorií (nebo pilíř, který v konfiguraci už není)
 * se nehodnotí — není do čeho zařazovat.
 */
export function findMiscategorized<T extends IdeaCategoryRow>(ideas: T[], pillars: PillarCategoryMap): T[] {
    const valid = new Map<string, Set<string>>()
    for (const [key, pillar] of Object.entries(pillars || {})) {
        const ids = (pillar?.categories || []).map(c => c.id).filter(Boolean)
        if (ids.length > 0) valid.set(key, new Set(ids))
    }
    return ideas.filter(idea => {
        const ids = valid.get(idea.category)
        if (!ids) return false
        return !idea.subcategory || !ids.has(idea.subcategory)
    })
}

/** Množina `pilíř:kategorie` — pro porovnání „změnily se kategorie?" při uložení configu. */
export function categoryKeySet(pillars: PillarCategoryMap): Set<string> {
    const out = new Set<string>()
    for (const [key, pillar] of Object.entries(pillars || {})) {
        for (const c of pillar?.categories || []) if (c?.id) out.add(`${key}:${c.id}`)
    }
    return out
}

/** Jeden řádek katalogu kategorií do promptu: id, štítek, prompt hint, váha. */
export function categoryLine(cat: { id: string; emoji?: string; label?: string; prompt?: string; weight?: number }): string {
    const weight = typeof cat.weight === "number" && cat.weight > 0 ? ` (váha ${Math.round(cat.weight * 100)} %)` : ""
    return `- ${cat.id}: ${cat.emoji || "📌"} ${cat.label || cat.id}${cat.prompt ? ` — ${cat.prompt}` : ""}${weight}`
}
