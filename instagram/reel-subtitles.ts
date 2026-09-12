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
import type { SubtitleStyleConfig, SubtitlePreset, SubtitlePosition, SubtitleSize } from "./configs/types"
import type { ReelMode } from "../lib/reel-media"

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

/** Rozvolněný tvar `SUBTITLE_DEFAULTS` — `as const` z něj dělá literálové typy,
 *  takže preset s jiným počtem znaků na řádek by se do `Partial<typeof …>` nevešel. */
export type SubtitleChunkOpts = { -readonly [K in keyof typeof SUBTITLE_DEFAULTS]: number }

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
function splitIntoCards(text: string, o: SubtitleChunkOpts): string[][] {
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
export function chunkForSubtitles(timed: TimedLine[], opts: Partial<SubtitleChunkOpts> = {}): SubtitleCard[] {
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
    /** 1 = obrys + stín (text „plave" v obraze), 3 = neprůhledný box za textem
     *  (`outline` se pak chová jako odsazení boxu). Preset `cards` jede na 3. */
    borderStyle: 1 | 3
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
    borderStyle: 1,
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
        `Style: Chrlit,${s.fontName},${s.fontSize},${s.primaryColour},${s.primaryColour},${s.outlineColour},${s.backColour},-1,0,0,0,100,100,0,0,${s.borderStyle},${s.outline},${s.shadow},2,${s.marginL},${s.marginR},${s.marginV},1`,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    const events = cards.map(c =>
        `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Chrlit,,0,0,0,,${c.lines.map(escapeAssText).join("\\N")}`,
    )
    return [...header, ...events, ""].join("\n")
}

// ─── Styl titulků per značka ────────────────────────────────

/**
 * Tři presety, ne volný editor. Titulek je VYPÁLENÝ do videa — chyba ve stylu se
 * pozná až na hotovém MP4 a opravit ji jde jen přerenderováním, takže povolujeme
 * jen kombinace, které jsme viděli vyrenderované.
 *
 *   classic — dnešní vzhled: bílý text, černý obrys, poloprůhledný podklad.
 *   cards   — větší písmo, míň znaků na řádek, NEPRŮHLEDNÝ box (`BorderStyle: 3`,
 *             kde se `Outline` chová jako odsazení boxu). Čitelné i na neklidném
 *             videu.
 *   minimal — bez podkladu, tenký obrys. Nejmíň ruší obraz, ale na světlé scéně
 *             se ztrácí — proto to není default.
 *
 * Font je vždy `Inter` z `assets/fonts` (připnutý v `next.config.ts`
 * `outputFileTracingIncludes`). Nepřipnutý font = na Vercelu prázdné titulky,
 * takže se odsud nevybírá.
 */
export const SUBTITLE_PRESETS: Record<SubtitlePreset, { chunk: Partial<SubtitleChunkOpts>; ass: Partial<AssStyle> }> = {
    classic: {
        chunk: {},
        ass: {},
    },
    cards: {
        // Větší písmo se na 18 znaků do bezpečné zóny nevejde — šířka řádku jde s ním.
        chunk: { maxCharsPerLine: 13, minDisplaySeconds: 1.0 },
        ass: { fontSize: 52, outline: 12, shadow: 0, backColour: "&H14000000", borderStyle: 3 },
    },
    minimal: {
        // Plně průhledný `backColour`: při `BorderStyle: 1` se kreslí jako stín za textem.
        chunk: { maxCharsPerLine: 20 },
        ass: { fontSize: 34, outline: 1.5, shadow: 0, backColour: "&HFF000000" },
    },
}

/**
 * Svislé usazení. Držíme `Alignment: 2` (dole na střed) a hýbeme jen `MarginV`,
 * protože u zarovnání 5/8 mění libass význam okrajů a „střed" by skočil jinam, než
 * ukazuje náhled. Čísla jsou v jednotkách `PlayResY` (864) měřená ODSPODU:
 * 290 = nad spodní UI lištou IG, 620 = pod horní lištou.
 */
const POSITION_MARGIN_V: Record<SubtitlePosition, number> = { bottom: 290, center: 400, top: 620 }

/** Velikost škáluje písmo i šířku řádku PROTI SOBĚ — větší text, míň znaků na řádek. */
const SIZE_SCALE: Record<SubtitleSize, number> = { s: 0.85, m: 1, l: 1.2 }

export const SUBTITLE_STYLE_DEFAULT: Required<Pick<SubtitleStyleConfig, "preset" | "position" | "size">> = {
    preset: "classic",
    position: "bottom",
    size: "m",
}

export function isSubtitlePreset(v: unknown): v is SubtitlePreset {
    return v === "classic" || v === "cards" || v === "minimal"
}

/** `#RRGGBB` (s mřížkou i bez). Cokoli jiného se zahodí — do ASS se nesmí dostat řetězec, který libass nepřečte. */
function isHexColour(v: unknown): v is string {
    return typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v.trim())
}

/** `#RRGGBB` → `&HAABBGGRR` (ASS má bajty obráceně a alfu napřed; `00` = plně viditelné). */
export function hexToAssColour(hex: string, alpha = "00"): string {
    const h = hex.trim().replace(/^#/, "").toUpperCase()
    return `&H${alpha.toUpperCase()}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`
}

/** Clamp pro `validateConfig()` — nikdy nevrací `undefined` a nikdy nepustí neznámou hodnotu dál. */
export function clampSubtitleStyle(raw: SubtitleStyleConfig | undefined): SubtitleStyleConfig {
    const position = raw?.position && raw.position in POSITION_MARGIN_V ? raw.position : SUBTITLE_STYLE_DEFAULT.position
    const size = raw?.size && raw.size in SIZE_SCALE ? raw.size : SUBTITLE_STYLE_DEFAULT.size
    return {
        preset: isSubtitlePreset(raw?.preset) ? raw.preset : SUBTITLE_STYLE_DEFAULT.preset,
        position,
        size,
        ...(isHexColour(raw?.color) ? { color: raw!.color!.trim() } : {}),
        ...(isHexColour(raw?.accent) ? { accent: raw!.accent!.trim() } : {}),
    }
}

export interface ResolvedSubtitleStyle {
    /** Override pro `chunkForSubtitles` — šířka řádku se mění s velikostí písma. */
    chunkOpts: Partial<SubtitleChunkOpts>
    /** Override pro `buildAss`. */
    assStyle: Partial<AssStyle>
    /** Co se z nastavení skutečně použilo — tohle se ukládá do `ig_posts.video_source`. */
    style: SubtitleStyleConfig
}

/**
 * Styl značky (nebo jednorázový override u přerenderování) → hotové vstupy pro
 * `chunkForSubtitles` a `buildAss`. Čistá funkce bez IO; všechny tři presety
 * hlídá `scripts/test-reel-pipeline.ts`.
 */
export function resolveSubtitleStyle(
    source: { subtitleStyle?: SubtitleStyleConfig } | SubtitleStyleConfig | undefined,
    opts: { reelMode?: ReelMode } = {},
): ResolvedSubtitleStyle {
    const raw = source && "subtitleStyle" in source
        ? (source as { subtitleStyle?: SubtitleStyleConfig }).subtitleStyle
        : (source as SubtitleStyleConfig | undefined)
    // Textový reel nemá hlas — karta JE sdělení, ne doprovod řeči, a `classic`
    // (tenký text u spodní hrany) se na neklidném videu ztratí. Proto je u něj
    // výchozí preset `cards`. Přepisuje se jen globální default: jakmile si značka
    // vybrala něco jiného, platí její volba i v textovém reelu.
    const style = opts.reelMode === "text" && (raw?.preset ?? SUBTITLE_STYLE_DEFAULT.preset) === SUBTITLE_STYLE_DEFAULT.preset
        ? clampSubtitleStyle({ ...raw, preset: "cards" })
        : clampSubtitleStyle(raw)
    const preset = SUBTITLE_PRESETS[style.preset]
    const scale = SIZE_SCALE[style.size ?? "m"]

    const baseFontSize = preset.ass.fontSize ?? ASS_DEFAULTS.fontSize
    const baseChars = preset.chunk.maxCharsPerLine ?? SUBTITLE_DEFAULTS.maxCharsPerLine

    const assStyle: Partial<AssStyle> = {
        ...preset.ass,
        fontSize: Math.round(baseFontSize * scale),
        marginV: POSITION_MARGIN_V[style.position ?? "bottom"],
        ...(style.color ? { primaryColour: hexToAssColour(style.color) } : {}),
        // Akcent barví to, co je u presetu vidět: u `cards` podkladový box, jinde obrys.
        ...(style.accent
            ? style.preset === "cards"
                ? { backColour: hexToAssColour(style.accent, "14") }
                : { outlineColour: hexToAssColour(style.accent) }
            : {}),
    }

    return {
        chunkOpts: { ...preset.chunk, maxCharsPerLine: Math.max(8, Math.round(baseChars / scale)) },
        assStyle,
        style,
    }
}

/**
 * Uživatelem upravené karty (text + čas) → `SubtitleCard[]` se zalomením podle
 * AKTUÁLNÍHO stylu. Text je uživatelův (nepřepisujeme ho), ale zalomení musí
 * odpovídat zvolené šířce řádku — jinak by po přepnutí presetu přetekl.
 */
export function cardsFromEdits(
    edits: { text: string; start: number; end: number }[],
    opts: Partial<SubtitleChunkOpts> = {},
): SubtitleCard[] {
    const o = { ...SUBTITLE_DEFAULTS, ...opts }
    return edits
        .filter(c => c.text.trim() && c.end > c.start)
        .map(c => ({
            start: round3(c.start),
            end: round3(Math.max(c.start + 0.1, c.end)),
            lines: wrapWords(c.text.trim().split(/\s+/).filter(Boolean), o.maxCharsPerLine).slice(0, 3),
        }))
        .sort((a, b) => a.start - b.start)
}
