/**
 * Časová osa textového reelu — bez řeči, bez TTS.
 * ===============================================
 * Reel s hlasem se staví od ZVUKU: každou větu namluví TTS, změří se a z délek
 * vznikne osa (`reel-audio.ts`). Textový reel žádný zvuk k měření nemá — kartu
 * nese obraz a čas na ni určuje ČTENÍ. Proto je tady druhá, čistě aritmetická osa:
 * délka karty = počet slov / čtecí tempo, nejméně `MIN_CARD_SECONDS`, plus týž
 * nájezd, mezery a dojezd, jaké má mluvený reel (`REEL_TIMELINE`) — jinak by se
 * hook lepil na začátek videa a CTA by useknul střih.
 *
 * Když se karty do stropu velikosti nevejdou, nezrychluje se nic (zrychlit čtení
 * nejde): osa se nejdřív zkrátí až na minimum na kartu, a když to pořád nestačí,
 * vrací `tooLong` a volající text zkrátí (`condenseNarration`) — stejný postup
 * jako u řeči, jen bez druhého TTS.
 *
 * Čisté funkce bez IO — hlídá je `scripts/test-reel-pipeline.ts`.
 */

import type { TimedLine } from "./reel-audio"
import {
    REEL_TIMELINE, READ_WORDS_PER_SECOND, MIN_CARD_SECONDS, cardsFixedSeconds,
} from "../lib/reel-media"

export interface TextTimeline {
    /** Karty s časy, jak se ukážou ve videu — pro titulky i pro režiséra. */
    lines: TimedLine[]
    /** Délka videa v celých vteřinách, v mezích velikosti reelu. */
    durationSeconds: number
    /** Karty se nevejdou ani po stažení na minimum — text je nutné zkrátit. */
    tooLong: boolean
    /** Celkový čas (karty + mezery + nájezd + dojezd) v sekundách. */
    totalSeconds: number
    /** Textový reel se nezrychluje — drží se tu kvůli tvarové shodě s `Timeline`. */
    atempo: 1
}

export interface TextTimelineOptions {
    leadInSeconds: number
    gapSeconds: number
    tailSeconds: number
    /** Kolik slov přečte divák za vteřinu. */
    wordsPerSecond: number
    /** Nejkratší karta, která se ještě dá přečíst. */
    minCardSeconds: number
}

export const TEXT_TIMELINE_DEFAULTS: TextTimelineOptions = {
    leadInSeconds: REEL_TIMELINE.leadInSeconds,
    gapSeconds: REEL_TIMELINE.gapSeconds,
    tailSeconds: REEL_TIMELINE.tailSeconds,
    wordsPerSecond: READ_WORDS_PER_SECOND,
    minCardSeconds: MIN_CARD_SECONDS,
}

function round3(x: number): number {
    return Math.round(x * 1000) / 1000
}

export function cardWordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Karty → časová osa. Délka karty vychází ze čtecího tempa; když se všechny
 * nevejdou do stropu velikosti, stáhnou se ÚMĚRNĚ (dlouhá karta ubere víc než
 * krátká), nikdy ale pod `minCardSeconds` — pod tím už karta jen problikne.
 */
export function buildTextTimeline(
    cards: string[],
    limits: { minSeconds: number; maxSeconds: number },
    opts: Partial<TextTimelineOptions> = {},
): TextTimeline {
    const o = { ...TEXT_TIMELINE_DEFAULTS, ...opts }
    const texts = cards.map(c => c.trim()).filter(Boolean)
    if (texts.length === 0) throw new Error("buildTextTimeline: reel bez jediné karty")

    const n = texts.length
    const fixed = o.leadInSeconds + o.gapSeconds * Math.max(0, n - 1) + o.tailSeconds
    const natural = texts.map(t => Math.max(o.minCardSeconds, cardWordCount(t) / o.wordsPerSecond))

    // Kolik času na karty vůbec zbude. Zkrácení je poměrné, ale minimum na kartu
    // je tvrdé — proto se nestahuje na `available`, ale clampuje po kartách a
    // výsledek se změří znovu.
    const available = limits.maxSeconds - fixed
    const naturalTotal = natural.reduce((a, b) => a + b, 0)
    const scale = available > 0 && naturalTotal > available ? available / naturalTotal : 1
    const durations = natural.map(d => Math.max(o.minCardSeconds, round3(d * scale)))

    const lines: TimedLine[] = []
    let t = o.leadInSeconds
    for (let i = 0; i < n; i++) {
        lines.push({ text: texts[i], start: round3(t), end: round3(t + durations[i]) })
        t += durations[i] + (i < n - 1 ? o.gapSeconds : 0)
    }
    const totalSeconds = round3(t + o.tailSeconds)
    const durationSeconds = Math.min(limits.maxSeconds, Math.max(limits.minSeconds, Math.ceil(totalSeconds - 1e-6)))

    return {
        lines,
        durationSeconds,
        atempo: 1,
        // Tolerance 0,05 s: `Math.ceil` na celé vteřiny stejně zaokrouhluje nahoru
        // a kvůli setinovému přesahu nemá smysl platit kolo zkracování.
        tooLong: totalSeconds > limits.maxSeconds + 0.05,
        totalSeconds,
    }
}

/**
 * Strop slov pro zkrácení karet: čas, který na karty zbude, × čtecí tempo, s 10%
 * rezervou (zalomení na řádky přidává karty a s nimi mezery). Vrací aspoň slovo
 * na kartu a vždy míň slov, než text měl — jinak by `condenseNarration` mohlo
 * vracet totéž donekonečna.
 */
export function textCardWordBudget(input: { words: number; cards: number; maxSeconds: number }): number {
    const { words, cards, maxSeconds } = input
    if (words <= 0) return cards
    const available = Math.max(0, maxSeconds - cardsFixedSeconds(cards))
    return Math.max(cards, Math.min(words - 1, Math.floor(available * READ_WORDS_PER_SECOND * 0.9)))
}
