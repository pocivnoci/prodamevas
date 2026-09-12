/**
 * Reel subtitles — titulkové karty a ASS soubor pro vypálení.
 * ===========================================================
 * Titulky nejsou SRT s Arialem dole u okraje. Jsou to krátké KARTY (nejvýš dvě
 * řádky), časované podle skutečně namluvené řeči, posazené do bezpečné zóny
 * Instagramu (nad spodní UI lištu ~20 % a vlevo od pravého sloupce ikon ~12 %),
 * tučným bundlovaným fontem s plnou českou diakritikou (`assets/fonts/Inter-Bold.ttf`, OFL).
 *
 * Karta se dělí podle ŘEČI, ne podle šířky: konec věty je vždy konec karty, čárka
 * a pomlčka jsou přirozené hranice, a karta ani řádek nikdy nekončí předložkou
 * nebo spojkou („neprodáte ji / přes noc. Proto" byl přesně ten dojem „automatické
 * titulky z telefonu", kvůli kterému tohle vzniklo — září 2026). Jednoslovná karta
 * na konci se slije s předchozí.
 *
 * Výchozí preset `pop` zvýrazňuje právě mluvené slovo barvou značky: každé slovo
 * je vlastní ASS událost s celou kartou a jedním obarveným slovem, délka slova se
 * odhaduje z počtu znaků (řeč je v rámci karty zhruba rovnoměrná).
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

/**
 * Slova, kterými česky nekončí řádek ani karta: jednopísmenné předložky a spojky
 * (typografické pravidlo) a krátké předložky/spojky, po kterých čtenář čeká
 * pokračování. Slovo s čárkou nebo tečkou na konci už větu člení samo — to se
 * nekontroluje.
 */
export const NO_BREAK_AFTER = new Set([
    "a", "i", "k", "o", "s", "u", "v", "z",
    "na", "do", "od", "po", "za", "ve", "ke", "se", "si", "ze", "ku",
    "pro", "při", "bez", "nad", "pod", "před", "mezi", "přes", "skrz", "kolem", "vedle", "podle",
    "že", "ale", "nebo", "či", "proto", "když", "aby", "jak", "jako", "než", "až", "ať",
    "jestli", "pokud", "protože", "zatímco", "takže",
])

const bareWord = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")

/** Končí seznam slov předložkou/spojkou, po které se nesmí zlomit? */
export function endsWithNoBreakWord(words: string[]): boolean {
    const last = words[words.length - 1]
    if (!last) return false
    if (/[.,;:!?…—–]["»“)]*$/.test(last)) return false
    return NO_BREAK_AFTER.has(bareWord(last))
}

/** Síla hranice ZA slovem: 2 = konec věty, 1 = čárka/středník/dvojtečka/pomlčka, 0 = nic. */
export function boundaryAfter(word: string): 0 | 1 | 2 {
    if (/[.!?…]["»“)]*$/.test(word)) return 2
    if (/[,;:]["»“)]*$/.test(word)) return 1
    if (/^[—–-]$/.test(word) || /[—–]$/.test(word)) return 1
    return 0
}

/**
 * Hladové zalomení s vyvážením (dvouřádek nemá mít první řádek přeplněný a druhý
 * o jednom slově) a s českým pravidlem: řádek nekončí předložkou ani spojkou.
 */
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

    // Předložka na konci řádku jde na začátek dalšího, když se tam vejde —
    // šířka řádku je bezpečná zóna Instagramu, ta se nepřetahuje ani o znak.
    for (let i = 0; i + 1 < lines.length; i++) {
        const a = lines[i].split(" ")
        if (a.length < 2 || !endsWithNoBreakWord(a)) continue
        const newB = `${a[a.length - 1]} ${lines[i + 1]}`
        if (newB.length > maxChars) continue
        lines[i] = a.slice(0, -1).join(" ")
        lines[i + 1] = newB
    }
    return lines
}

/**
 * Rozdělí větu na karty (skupiny slov, které se vejdou do `maxLines` řádků) —
 * podle řeči: konec věty ukončí kartu vždy; když dojde místo uprostřed věty,
 * karta se vrátí k poslední čárce/pomlčce (pokud je aspoň ze 40 % plná);
 * karta nekončí předložkou ani spojkou; jednoslovný sirotek na konci se slije.
 */
function splitIntoCards(text: string, o: SubtitleChunkOpts): string[][] {
    const words = text.trim().split(/\s+/).filter(Boolean)
    const capacity = o.maxCharsPerLine * o.maxLines
    const fits = (ws: string[]) => wrapWords(ws, o.maxCharsPerLine).length <= o.maxLines
    const cards: string[][] = []
    let i = 0
    while (i < words.length) {
        const start = i
        let cur: string[] = []
        let goodCut = -1
        let sentenceEnd = false
        while (i < words.length) {
            if (cur.length > 0 && !fits([...cur, words[i]])) break
            cur.push(words[i])
            i++
            const b = boundaryAfter(words[i - 1])
            if (b === 2) { sentenceEnd = true; break }
            if (b === 1 && cur.join(" ").length >= capacity * 0.4) goodCut = i
        }
        if (!sentenceEnd && i < words.length && goodCut > start) {
            i = goodCut
            cur = words.slice(start, goodCut)
        }
        while (i < words.length && cur.length > 1 && endsWithNoBreakWord(cur)) {
            cur.pop()
            i--
        }
        cards.push(cur)
    }

    // Jednoslovná karta: nejdřív ji slij s předchozí (když se vejde), jinak si
    // půjč jedno až tři poslední slova předchozí karty tak, aby ta nekončila
    // předložkou — a kdyby tím osiřela ona, pokračuj dozadu
    // („garanci zpětného / odkupu." → „nabízíme garanci / zpětného odkupu.").
    for (let i = cards.length - 1; i > 0; i--) {
        if (cards[i].length >= 2) continue
        const prev = cards[i - 1]
        if (fits([...prev, ...cards[i]])) {
            cards.splice(i - 1, 2, [...prev, ...cards[i]])
            continue
        }
        let done = false
        for (let k = 1; k <= 3 && k < prev.length && !done; k++) {
            const rest = prev.slice(0, -k)
            const moved = prev.slice(-k)
            if (endsWithNoBreakWord(rest) || !fits([...moved, ...cards[i]])) continue
            cards[i - 1] = rest
            cards[i] = [...moved, ...cards[i]]
            done = true
        }
        if (!done) break
    }
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

        // Sluč karty, dokud by některá byla kratší než minimum (nejvýš 3 řádky po sloučení):
        // nejdřív podle průměru, pak každou konkrétní krátkou kartu s tou před ní —
        // čas karty jde z počtu znaků, takže krátká karta je „karet." samo o sobě.
        while (cards.length > 1 && span / cards.length < o.minDisplaySeconds) {
            const last = cards.pop()!
            cards[cards.length - 1] = [...cards[cards.length - 1], ...last]
        }
        for (let guard = 0; guard < 8 && cards.length > 1; guard++) {
            const chars = cards.reduce((a, c) => a + c.join(" ").length, 0) || 1
            const short = cards.findIndex(c => (span * c.join(" ").length) / chars < o.minDisplaySeconds)
            if (short < 0) break
            const into = short > 0 ? short - 1 : 1
            const merged = short > 0 ? [...cards[into], ...cards[short]] : [...cards[short], ...cards[into]]
            cards.splice(Math.min(into, short), 2, merged)
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
    /** Barva právě mluveného slova (`&HAABBGGRR`). Nic = bez zvýraznění, jedna
     *  událost na kartu. S barvou je každé slovo vlastní událost (preset `pop`). */
    highlightColour?: string
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

/** Barva stylu `&HAABBGGRR` → tvar pro override tag `\1c&HBBGGRR&`. */
export function assTagColour(styleColour: string): string {
    return `&H${styleColour.replace(/^&H/i, "").slice(-6).toUpperCase()}&`
}

const dialogue = (start: number, end: number, text: string): string =>
    `Dialogue: 0,${assTime(start)},${assTime(end)},Chrlit,,0,0,0,,${text}`

/**
 * Jedna událost na SLOVO: celá karta, právě mluvené slovo v barvě zvýraznění.
 * Délka slova se odhaduje z počtu znaků (+1 za mezeru), poslední slovo dojede
 * na konec karty. Události na sebe navazují bez překryvu, takže libass nikdy
 * nekreslí kartu dvakrát přes sebe.
 */
export function wordHighlightEvents(card: SubtitleCard, s: Pick<AssStyle, "primaryColour" | "highlightColour">): string[] {
    const flat = card.lines.flatMap((line, li) => line.split(" ").filter(Boolean).map(w => ({ w, li })))
    if (flat.length === 0 || !s.highlightColour) return [dialogue(card.start, card.end, card.lines.map(escapeAssText).join("\\N"))]
    const weights = flat.map(x => x.w.length + 1)
    const total = weights.reduce((a, b) => a + b, 0)
    const span = Math.max(0.1, card.end - card.start)
    const hi = `{\\1c${assTagColour(s.highlightColour)}}`
    const base = `{\\1c${assTagColour(s.primaryColour)}}`

    let t = card.start
    return flat.map((_, idx) => {
        const start = t
        const end = idx === flat.length - 1 ? card.end : t + (span * weights[idx]) / total
        t = end
        let k = 0
        const text = card.lines.map(line =>
            line.split(" ").filter(Boolean).map(w => {
                const esc = escapeAssText(w)
                return k++ === idx ? `${hi}${esc}${base}` : esc
            }).join(" "),
        ).join("\\N")
        return dialogue(start, end, text)
    })
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
    const events = s.highlightColour
        ? cards.flatMap(c => wordHighlightEvents(c, s))
        : cards.map(c => dialogue(c.start, c.end, c.lines.map(escapeAssText).join("\\N")))
    return [...header, ...events, ""].join("\n")
}

// ─── Styl titulků per značka ────────────────────────────────

/**
 * Čtyři presety, ne volný editor. Titulek je VYPÁLENÝ do videa — chyba ve stylu se
 * pozná až na hotovém MP4 a opravit ji jde jen přerenderováním, takže povolujeme
 * jen kombinace, které jsme viděli vyrenderované.
 *
 *   pop     — VÝCHOZÍ (od 9/2026): větší písmo, silný obrys, právě mluvené slovo
 *             v barvě značky (`accent`, jinak `feedAesthetic.accentColor`, jinak žlutá).
 *             Dnešní standard reelů; bez něj titulky vypadaly jako automat z telefonu.
 *   classic — bílý text, černý obrys, poloprůhledný podklad. Nic nezvýrazňuje.
 *   cards   — větší písmo, míň znaků na řádek, NEPRŮHLEDNÝ box (`BorderStyle: 3`,
 *             kde se `Outline` chová jako odsazení boxu). Čitelné i na neklidném
 *             videu; výchozí pro textový reel.
 *   minimal — bez podkladu, tenký obrys. Nejmíň ruší obraz, ale na světlé scéně
 *             se ztrácí — proto to není default.
 *
 * Font je vždy `Inter` z `assets/fonts` (připnutý v `next.config.ts`
 * `outputFileTracingIncludes`). Nepřipnutý font = na Vercelu prázdné titulky,
 * takže se odsud nevybírá.
 */
export const SUBTITLE_PRESETS: Record<SubtitlePreset, { chunk: Partial<SubtitleChunkOpts>; ass: Partial<AssStyle> }> = {
    pop: {
        // Kratší řádky: velké písmo se na 18 znaků do bezpečné zóny nevejde.
        // Kratší karty než u classic: zvýrazněné slovo drží tempo řeči i na 0,7 s.
        chunk: { maxCharsPerLine: 16, minDisplaySeconds: 0.7 },
        ass: { fontSize: 48, outline: 4, shadow: 2, backColour: "&H90000000" },
    },
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

/** Zvýraznění bez barvy značky — teplá žlutá, kterou čtou titulky na celém Instagramu. */
export const POP_DEFAULT_ACCENT = "#FFD60A"

/**
 * Barva značky se pro zvýraznění hodí jen tehdy, když je na bílém textu VIDĚT:
 * bílá (chrlit má accent #ffffff) by nezvýraznila nic, šedá (#888888) vypadá jako
 * ztlumené slovo a skoro černá se v obryse ztratí. Takové barvy padají na žlutou.
 */
export function usableHighlight(hex: string | undefined): string {
    if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex.trim())) return POP_DEFAULT_ACCENT
    const h = hex.trim().replace(/^#/, "")
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const sat = max === 0 ? 0 : (max - min) / max
    if (lum > 0.85 || lum < 0.18 || sat < 0.35) return POP_DEFAULT_ACCENT
    return `#${h.toUpperCase()}`
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
    preset: "pop",
    position: "bottom",
    size: "m",
}

export function isSubtitlePreset(v: unknown): v is SubtitlePreset {
    return v === "pop" || v === "classic" || v === "cards" || v === "minimal"
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
 * `chunkForSubtitles` a `buildAss`. Čistá funkce bez IO; všechny presety
 * hlídá `scripts/test-reel-pipeline.ts`.
 *
 * Zdrojem může být celý `ClientConfig` (má `subtitleStyle` a `feedAesthetic`) nebo
 * holý `SubtitleStyleConfig` (přerenderování — tam už je barva značky uložená
 * v `accent`, protože se sem při prvním renderu propsala).
 */
export function resolveSubtitleStyle(
    source: { subtitleStyle?: SubtitleStyleConfig; feedAesthetic?: { accentColor?: string } } | SubtitleStyleConfig | undefined,
    opts: { reelMode?: ReelMode; brandAccent?: string } = {},
): ResolvedSubtitleStyle {
    const isConfig = !!source && "subtitleStyle" in source
    const raw = isConfig
        ? (source as { subtitleStyle?: SubtitleStyleConfig }).subtitleStyle
        : (source as SubtitleStyleConfig | undefined)
    const brandAccent = opts.brandAccent
        ?? (isConfig ? (source as { feedAesthetic?: { accentColor?: string } }).feedAesthetic?.accentColor : undefined)

    // Textový reel nemá hlas — karta JE sdělení, ne doprovod řeči, a zvýrazňování
    // slov bez řeči nedává smysl. Proto je u něj výchozí preset `cards`. Přepisuje
    // se jen globální default: jakmile si značka vybrala něco jiného, platí její volba.
    const style = opts.reelMode === "text" && (raw?.preset ?? SUBTITLE_STYLE_DEFAULT.preset) === SUBTITLE_STYLE_DEFAULT.preset
        ? clampSubtitleStyle({ ...raw, preset: "cards" })
        : clampSubtitleStyle(raw)
    // Barva zvýraznění se do stylu PROPÍŠE, aby ji přerenderování dostalo i bez configu.
    if (style.preset === "pop" && !style.accent) {
        style.accent = usableHighlight(brandAccent)
    }
    const preset = SUBTITLE_PRESETS[style.preset]
    const scale = SIZE_SCALE[style.size ?? "m"]

    const baseFontSize = preset.ass.fontSize ?? ASS_DEFAULTS.fontSize
    const baseChars = preset.chunk.maxCharsPerLine ?? SUBTITLE_DEFAULTS.maxCharsPerLine

    const assStyle: Partial<AssStyle> = {
        ...preset.ass,
        fontSize: Math.round(baseFontSize * scale),
        marginV: POSITION_MARGIN_V[style.position ?? "bottom"],
        ...(style.color ? { primaryColour: hexToAssColour(style.color) } : {}),
        // Akcent barví to, co je u presetu vidět: u `pop` mluvené slovo, u `cards`
        // podkladový box, jinde obrys.
        ...(style.accent
            ? style.preset === "pop"
                ? { highlightColour: hexToAssColour(style.accent) }
                : style.preset === "cards"
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
