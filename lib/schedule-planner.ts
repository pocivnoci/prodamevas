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
    /** Posts per week, spread evenly across each 7-day week. Clamped 1-7. Default 4. */
    postsPerWeek?: number
    /** Preferred posting times in "HH:MM", rotated across the days of a week. */
    timeSlots?: string[]
}

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
 * Produce `count` schedule slots at `postsPerWeek` per week. Within each 7-day
 * week the posts land on evenly spaced days (offset `floor(j*7/perWeek)`), so
 * cadence 4 gives Mon/Tue/Thu/Sat-style rhythm and there is never more than one
 * post per day. Times rotate through `timeSlots` by day-of-week position, stable
 * week over week.
 */
export function distributeSchedule(count: number, opts: DistributeOptions = {}): ScheduleSlot[] {
    if (count <= 0) return []

    const slots = (opts.timeSlots && opts.timeSlots.length > 0 ? opts.timeSlots : DEFAULT_TIME_SLOTS)
        .slice()
        .sort() // chronological within a day
    // Same 1-7 clamp as validateConfig applies to config.postsPerWeek.
    const perWeek = Math.min(7, Math.max(1, Math.round(opts.postsPerWeek ?? 4)))

    // Start no earlier than tomorrow — guard against a caller passing a past date.
    const minStart = tomorrow()
    let start = opts.startDate ? new Date(opts.startDate) : minStart
    start.setHours(0, 0, 0, 0)
    if (start < minStart) start = minStart

    const out: ScheduleSlot[] = []
    for (let i = 0; i < count; i++) {
        const week = Math.floor(i / perWeek)
        const j = i % perWeek
        const day = new Date(start)
        day.setDate(day.getDate() + week * 7 + Math.floor((j * 7) / perWeek))
        out.push({ date: toDateStr(day), time: slots[j % slots.length] })
    }
    return out
}

/** Combine a slot into the `scheduled_for` shape the DB/calendar expect. */
export function toScheduledFor(date: string, time: string): string {
    return `${date}T${time}:00`
}
