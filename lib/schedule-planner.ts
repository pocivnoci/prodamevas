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
}

/** Max supported cadence — 14 = 2 posts/day. Kept in sync with validateConfig's clamp. */
export const MAX_POSTS_PER_WEEK = 14

// Czech-audience defaults (morning commute, after-work, evening scroll).
const DEFAULT_TIME_SLOTS = ["09:00", "17:00", "19:00"]

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
 * Produce `count` schedule slots at `postsPerWeek` per week.
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

    const out: ScheduleSlot[] = []
    for (let i = 0; i < count; i++) {
        const week = Math.floor(i / perWeek)
        const j = i % perWeek
        let dayOffset: number
        let slotIdx: number
        if (perWeek <= 7) {
            dayOffset = Math.floor((j * 7) / perWeek) // ≤1/day, spread across the week
            slotIdx = j % slots.length                // rotate times by position
        } else {
            dayOffset = Math.floor(j / perDay)        // perDay posts land on the same day
            slotIdx = j % perDay                      // …at distinct slots (09:00, 17:00, …)
        }
        const day = new Date(start)
        day.setDate(day.getDate() + week * 7 + dayOffset)
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
export function toScheduledFor(date: string, time: string): string {
    const [y, mo, d] = date.split("-").map(Number)
    const [h, mi] = time.split(":").map(Number)
    const naiveAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0)
    return new Date(naiveAsUtc - pragueOffsetMs(naiveAsUtc)).toISOString()
}
