/**
 * Schedule distribution for the content planner.
 * ===============================================
 * Pure, dependency-free (client + server safe) — spreads N posts across weeks at
 * the brand's weekly cadence, so a "Měsíc" plan actually spans a month instead of
 * piling onto consecutive days. Never schedules in the past.
 */

export interface ScheduleSlot {
    date: string // "YYYY-MM-DD"
    time: string // "HH:MM"
}

export interface DistributeOptions {
    /** First day to schedule on. Defaults to tomorrow. */
    startDate?: Date
    /** Posts per week. Clamped 1-14. ≤7 → at most one post/day; >7 → multiple/day
     *  (e.g. 14 = 2×/day). Default 4. */
    postsPerWeek?: number
    /** Preferred posting times in "HH:MM" (LOCAL Prague), rotated across days/slots. */
    timeSlots?: string[]
    /**
     * Přes kolik dní se má `count` příspěvků rozprostřít. Bez něj se plánuje po
     * kalendářních týdnech, takže plán vždycky skončí na hranici týdne — a „měsíc"
     * tím pádem po 28 dnech, ať má měsíc 30 nebo 31.
     *
     * Pro `spanDays = týdny × 7` a `count = týdny × postsPerWeek` vyjdou přesně
     * tytéž dny jako bez něj; teprve nesoudělné rozpětí (30 dní, 31 dní) se
     * rozloží rovnoměrně místo doběhnutí do čtvrtého týdne.
     */
    spanDays?: number
}

/** Max supported cadence — 14 = 2 posts/day. Kept in sync with validateConfig's clamp. */
export const MAX_POSTS_PER_WEEK = 14

// Czech-audience defaults (morning commute, after-work, evening scroll).
const DEFAULT_TIME_SLOTS = ["09:00", "17:00", "19:00"]

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Časy publikace pro plánovač — z toho nejlepšího, co o značce víme.
 *
 * Priorita: NAMĚŘENÉ (nejlepší sloty z vlastních metrik, `analyzePerformance`) →
 * BASELINE z onboardingového skenu Instagramu (`igBaseline.bestPostingTimes`) →
 * ručně nastavené `config.postingTimes` → výchozí. Do 9/2026 četl plánovač jen
 * `config.postingTimes`, které nikdo nikde nezapisoval, takže každá značka jela
 * na výchozích 09/17/19 — i když Výkon ukazoval naměřený nejlepší čas a tarif ho
 * prodával („který formát a čas fungují nejlíp").
 *
 * Naměřené sloty se berou až od `minMeasured` postů s metrikami: pod tím je
 * „nejlepší čas" šum jednoho postu. Vrací jen hodnoty ve tvaru HH:MM — legacy
 * `time_slot` typu "afternoon" se tiše přeskočí; `undefined` = použij výchozí.
 */
export function resolvePostingTimes(input: {
    measured?: { slots: string[]; sampleSize: number } | null
    baseline?: string[] | null
    configured?: unknown
    minMeasured?: number
}): string[] | undefined {
    const clean = (arr: unknown): string[] =>
        Array.isArray(arr) ? [...new Set(arr.filter((t): t is string => typeof t === "string" && HHMM.test(t)))] : []
    const min = input.minMeasured ?? 6
    const measured = input.measured && input.measured.sampleSize >= min ? clean(input.measured.slots) : []
    if (measured.length > 0) return measured
    const baseline = clean(input.baseline)
    if (baseline.length > 0) return baseline
    const configured = clean(input.configured)
    return configured.length > 0 ? configured : undefined
}

function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Tomorrow at local midnight — the default starting day (never today/past). */
function tomorrow(): Date {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 1)
    return d
}

/**
 * Kolik dní má měsíc, který začíná daným dnem — 28 až 31, podle kalendáře.
 *
 * „Měsíc" v plánovači byly čtyři týdny, takže plán skončil vždy po 28 dnech
 * a konec skutečného měsíce zůstal prázdný. Den v měsíci se ořezává na poslední
 * existující (31. 1. + měsíc = 28. 2., ne 3. 3.), aby délka nikdy nepřesáhla
 * jeden kalendářní měsíc.
 */
export function monthSpanDays(start: Date): number {
    const y = start.getFullYear(), m = start.getMonth(), d = start.getDate()
    const lastOfNext = new Date(y, m + 2, 0).getDate() // den 0 = poslední den předchozího měsíce
    const end = new Date(y, m + 1, Math.min(d, lastOfNext))
    const from = Date.UTC(y, m, d)
    const to = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
    return Math.round((to - from) / 86_400_000)
}

/**
 * Kolik příspěvků se do rozpětí vejde při dané týdenní kadenci.
 *
 * Zaokrouhluje se **dolů**: UI u počtu slibuje „N× týdně" a přebytečný příspěvek
 * by tenhle slib v některém klouzavém týdnu porušil (18 postů na 31 dní je 4,06
 * za týden). Nejmíň jeden, ať krátké rozpětí nevrátí prázdný plán.
 */
export function postsForSpan(spanDays: number, postsPerWeek: number): number {
    return Math.max(1, Math.floor((spanDays / 7) * postsPerWeek))
}

/**
 * Produce `count` schedule slots at `postsPerWeek` per week.
 *  - `spanDays` set: dny se rozprostřou rovnoměrně přes zadané rozpětí, takže se
 *    plán trefí do skutečné délky měsíce místo do čtyř týdnů. Kolik příspěvků
 *    připadne na jeden den, pořád rozhoduje kadence (1 do 7×/týdně, jinak `perDay`).
 *  - perWeek ≤ 7: at most one post/day, spread across the week (offset
 *    `floor(j*7/perWeek)`) — cadence 4 gives a Mon/Tue/Thu/Sat rhythm.
 *  - perWeek > 7: `ceil(perWeek/7)` posts/day (14 = 2×/day), each at a different
 *    time slot within the day.
 * Times come from `timeSlots` (Prague local); a day never reuses the same slot.
 */
export function distributeSchedule(count: number, opts: DistributeOptions = {}): ScheduleSlot[] {
    if (count <= 0) return []

    const slots = (opts.timeSlots && opts.timeSlots.length > 0 ? opts.timeSlots : DEFAULT_TIME_SLOTS)
        .slice()
        .sort() // chronological within a day
    // Same clamp as validateConfig applies to config.postsPerWeek (1..14).
    const perWeek = Math.min(MAX_POSTS_PER_WEEK, Math.max(1, Math.round(opts.postsPerWeek ?? 4)))
    const perDay = Math.max(1, Math.ceil(perWeek / 7)) // 2 when perWeek=14

    // Start no earlier than tomorrow — guard against a caller passing a past date.
    const minStart = tomorrow()
    let start = opts.startDate ? new Date(opts.startDate) : minStart
    start.setHours(0, 0, 0, 0)
    if (start < minStart) start = minStart

    // Rozpětí platí pro každou kadenci. Dřív se u 2×/den ignorovalo, jenže UI
    // nabízí i 10 a 14 týdně — „měsíc" pak při kadenci 10 skončil po 22 dnech
    // a poslední týden kalendáře zůstal prázdný.
    // Rozpětí řídí JEN dny; kolik slotů má den, dál drží kadence.
    const span = opts.spanDays && opts.spanDays > 0 ? Math.round(opts.spanDays) : null
    const slotsPerDay = perWeek <= 7 ? 1 : perDay
    // Kolikátý příspěvek daného dne se zrovna plánuje — u 2×/den z toho plyne slot
    // (09:00 / 17:00). Stačí pamatovat předchozí den, protože dny jdou vzestupně.
    let prevDay = -1
    let inDay = 0

    const out: ScheduleSlot[] = []
    for (let i = 0; i < count; i++) {
        const week = Math.floor(i / perWeek)
        const j = i % perWeek
        let dayOffset: number // ode dne startu, ne od začátku týdne
        let slotIdx: number
        if (span) {
            dayOffset = Math.min(span - 1, Math.floor((i * span) / count)) // rovnoměrně přes celé rozpětí
            if (dayOffset === prevDay) inDay++
            else { inDay = 0; prevDay = dayOffset }
            // Nad 7×/týdně dopadne na den jeden nebo dva příspěvky (nikdy víc než
            // `perDay`) a druhý z nich musí dostat jiný čas. Do 7×/týdně je den
            // vždycky jen jeden, takže čas dál rotuje podle pozice v týdnu.
            slotIdx = slotsPerDay === 1 ? j % slots.length : inDay
        } else if (perWeek <= 7) {
            dayOffset = week * 7 + Math.floor((j * 7) / perWeek) // ≤1/day, spread across the week
            slotIdx = j % slots.length                           // rotate times by position
        } else {
            dayOffset = week * 7 + Math.floor(j / perDay)        // perDay posts land on the same day
            slotIdx = j % perDay                                 // …at distinct slots (09:00, 17:00, …)
        }
        const day = new Date(start)
        day.setDate(day.getDate() + dayOffset)
        out.push({ date: toDateStr(day), time: slots[slotIdx % slots.length] })
    }
    return out
}

/**
 * How many ms Europe/Prague is ahead of UTC at a given instant (DST-aware).
 * +7_200_000 in summer (CEST), +3_600_000 in winter (CET).
 */
function pragueOffsetMs(instant: number): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Prague", hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant))
    const p: Record<string, string> = {}
    for (const x of parts) p[x.type] = x.value
    const hour = p.hour === "24" ? 0 : Number(p.hour) // some engines emit "24" for midnight
    const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second))
    return asIfUtc - instant
}

/**
 * Combine a Prague-local `date`+`time` into the UTC `scheduled_for` instant the
 * publisher compares against (`scheduled_for <= now`, both UTC). Storing the raw
 * "YYYY-MM-DDTHH:MM:00" made timestamptz read it as UTC, so a "09:00" slot fired
 * at 09:00 UTC = 11:00 Prague. We now convert the wall time through Prague's
 * offset so "09:00" means 09:00 Prague. The `time_slot` column keeps the wall
 * time for display. (Single-pass offset — exact except within the ~1h DST switch
 * window at 02:00–03:00 local, which no posting slot uses.)
 */
/**
 * Kalendářní den v Praze pro daný okamžik, jako `YYYY-MM-DD`.
 *
 * Funkce na Vercelu běží v UTC, takže `toISOString().split("T")[0]` dá u postu
 * naplánovaného na 23:30 pražského času včerejšek — a týdenní přehled ho ukázal
 * o den vedle. Tohle je jediné místo, kde se den z okamžiku odvozuje.
 */
export function toPragueDateStr(instant: Date): string {
    const t = instant.getTime()
    return new Date(t + pragueOffsetMs(t)).toISOString().slice(0, 10)
}

export function toScheduledFor(date: string, time: string): string {
    const [y, mo, d] = date.split("-").map(Number)
    const [h, mi] = time.split(":").map(Number)
    const naiveAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0)
    return new Date(naiveAsUtc - pragueOffsetMs(naiveAsUtc)).toISOString()
}
