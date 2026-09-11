/**
 * Reel subtitles — titulkové karty a ASS soubor pro vypálení.
 * ===========================================================
 * Titulky nejsou SRT s Arialem dole u okraje. Jsou to krátké KARTY (nejvýš dvě
 * řádky po ~18 znacích), časované podle skutečně namluvené řeči, posazené do
 * bezpečné zóny Instagramu (nad spodní UI lištu ~20 % a vlevo od pravého
 * sloupce ikon ~12 %), tučným bundlovaným fontem s plnou českou diakritikou
 * (`assets/fonts/Inter-Bold.ttf`, OFL).
 *
 * Formát je ASS (Advanced SubStation Alpha): jediný, který umí libass v
 * ffmpeg-static vykreslit s vlastním fontem přes `fontsdir` — `drawtext` ve
 * statické binárce chybí (ověřeno 2026-09-11). Zalamování si děláme sami
 * (`WrapStyle: 2`), aby řádky nikdy nepřetekly přes pravý okraj.
 *
 * Všechno tady je čisté — hlídá to `scripts/test-reel-pipeline.ts`.
 */

import type { TimedLine } from "./reel-audio"

export interface SubtitleCard {
    start: number
    end: number
    /** 1–2 řádky (výjimečně 3 při sloučení příliš krátkých karet). */
    lines: string[]
}

export const SUBTITLE_DEFAULTS = {
    maxCharsPerLine: 18,
    maxLines: 2,
    /** Kratší karta se nedá přečíst — slučuje se se sousední. */
    minDisplaySeconds: 0.8,
    /** Mezera mezi kartami, ať vidí divák střih textu. */
    gapSeconds: 0.05,
} as const

/** Hladové zalomení s vyvážením: dvouřádek nemá mít první řádek přeplněný a druhý o jednom slově. */
export function wrapWords(words: string[], maxChars: number): string[] {
    const lines: string[] = []
    let cur = ""
    for (const w of words) {
        if (!cur) { cur = w; continue }
        if ((cur + " " + w).length <= maxChars) cur += " " + w
        else { lines.push(cur); cur = w }
    }
    if (cur) lines.push(cur)

    // Vyvážení: přesuň poslední slovo z delšího řádku na kratší následující, dokud to zlepšuje.
    for (let i = 0; i + 1 < lines.length; i++) {
        for (let guard = 0; guard < 4; guard++) {
            const a = lines[i].split(" ")
            if (a.length < 2) break
            const moved = a[a.length - 1]
            const newA = a.slice(0, -1).join(" ")
            const newB = `${moved} ${lines[i + 1]}`
            if (newB.length > maxChars) break
            const before = Math.abs(lines[i].length - lines[i + 1].length)
            const after = Math.abs(newA.length - newB.length)
            if (after >= before) break
            lines[i] = newA
            lines[i + 1] = newB
        }
    }
    return lines
}

/** Rozdělí větu na karty (skupiny slov, které se vejdou do `maxLines` řádků). */
function splitIntoCards(text: string, o: typeof SUBTITLE_DEFAULTS): string[][] {
    const words = text.trim().split(/\s+/).filter(Boolean)
    const cards: string[][] = []
    let cur: string[] = []
    for (const w of words) {
        const attempt = wrapWords([...cur, w], o.maxCharsPerLine)
        if (attempt.length > o.maxLines && cur.length > 0) {
            cards.push(cur)
            cur = [w]
        } else {
            cur.push(w)
        }
    }
    if (cur.length) cards.push(cur)
    return cards
}

/**
 * Věty s časy → titulkové karty. Čas každé věty se rozdělí mezi její karty
 * podle počtu znaků (tempo řeči je v rámci věty zhruba rovnoměrné); karta pod
 * `minDisplaySeconds` se sloučí s předchozí.
 */
export function chunkForSubtitles(timed: TimedLine[], opts: Partial<typeof SUBTITLE_DEFAULTS> = {}): SubtitleCard[] {
    const o = { ...SUBTITLE_DEFAULTS, ...opts }
    const out: SubtitleCard[] = []

    for (const line of timed) {
        if (!line.text.trim()) continue
        const cards = splitIntoCards(line.text, o)
        const span = Math.max(0.1, line.end - line.start)

        // Sluč karty, dokud by některá byla kratší než minimum (nejvýš 3 řádky po sloučení).
        while (cards.length > 1 && span / cards.length < o.minDisplaySeconds) {
            const last = cards.pop()!
            cards[cards.length - 1] = [...cards[cards.length - 1], ...last]
        }

        const totalChars = cards.reduce((a, c) => a + c.join(" ").length, 0) || 1
        let t = line.start
        cards.forEach((wordsOfCard, i) => {
            const share = wordsOfCard.join(" ").length / totalChars
            const dur = span * share
            const start = t
            const end = i === cards.length - 1 ? line.end : t + dur - o.gapSeconds
            out.push({ start: round3(start), end: round3(Math.max(start + 0.1, end)), lines: wrapWords(wordsOfCard, o.maxCharsPerLine) })
            t += dur
        })
    }
    return out
}

function round3(x: number): number {
    return Math.round(x * 1000) / 1000
}

// ─── ASS ────────────────────────────────────────────────────────────────────

export interface AssStyle {
    fontName: string
    /** Velikost v jednotkách PlayResY (864 pro 9:16). */
    fontSize: number
    playResX: number
    playResY: number
    marginL: number
    /** Pravý okraj širší: sloupec ikon Instagramu zabírá ~12 % šířky. */
    marginR: number
    /** Od spodního okraje — text sedí kolem 2/3 výšky, nad UI lištou (~20 %). */
    marginV: number
    outline: number
    shadow: number
    /** ASS barvy jsou &HAABBGGRR. */
    primaryColour: string
    outlineColour: string
    backColour: string
}

export const ASS_DEFAULTS: AssStyle = {
    fontName: "Inter",
    fontSize: 40,
    playResX: 486,
    playResY: 864,
    marginL: 40,
    marginR: 70,
    marginV: 290,
    outline: 3,
    shadow: 1,
    primaryColour: "&H00FFFFFF",
    outlineColour: "&H00000000",
    backColour: "&H80000000",
}

/** `H:MM:SS.cc` — ASS má setiny, ne milisekundy. */
export function assTime(seconds: number): string {
    const s = Math.max(0, seconds)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    const cs = Math.round((s - Math.floor(s)) * 100)
    const csClamped = Math.min(99, cs)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(csClamped).padStart(2, "0")}`
}

/** Složené závorky a zpětná lomítka jsou v ASS řídicí znaky; nový řádek je `\N`. */
export function escapeAssText(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\r?\n/g, "\\N")
}

export function buildAss(cards: SubtitleCard[], style: Partial<AssStyle> = {}): string {
    const s = { ...ASS_DEFAULTS, ...style }
    const header = [
        "[Script Info]",
        "ScriptType: v4.00+",
        `PlayResX: ${s.playResX}`,
        `PlayResY: ${s.playResY}`,
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        `Style: Chrlit,${s.fontName},${s.fontSize},${s.primaryColour},${s.primaryColour},${s.outlineColour},${s.backColour},-1,0,0,0,100,100,0,0,1,${s.outline},${s.shadow},2,${s.marginL},${s.marginR},${s.marginV},1`,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    const events = cards.map(c =>
        `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Chrlit,,0,0,0,,${c.lines.map(escapeAssText).join("\\N")}`,
    )
    return [...header, ...events, ""].join("\n")
}
