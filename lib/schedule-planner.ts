/**
 * Schedule distribution for the content planner.
 * ===============================================
 * Pure, dependency-free (client + server safe) — spreads N posts across upcoming
 * days at preferred time slots so a content-plan batch gets sensible posting times
 * the user can then fine-tune. Never schedules in the past.
 */

export interface ScheduleSlot {
    date: string // "YYYY-MM-DD"
    time: string // "HH:MM"
}

export interface DistributeOptions {
    /** First day to schedule on. Defaults to tomorrow. */
    startDate?: Date
    /** Posts per day before rolling to the next day. Default 1. */
    postsPerDay?: number
    /** Preferred posting times in "HH:MM", used in order per day. */
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
 * Produce `count` schedule slots, `postsPerDay` per day, cycling through
 * `timeSlots`. If a day has more posts than time slots, extra posts fall to the
 * next day so two posts never collide on the same minute.
 */
export function distributeSchedule(count: number, opts: DistributeOptions = {}): ScheduleSlot[] {
    if (count <= 0) return []

    const slots = (opts.timeSlots && opts.timeSlots.length > 0 ? opts.timeSlots : DEFAULT_TIME_SLOTS)
        .slice()
        .sort() // chronological within a day
    const perDay = Math.max(1, Math.min(opts.postsPerDay ?? 1, slots.length))

    // Start no earlier than tomorrow — guard against a caller passing a past date.
    const minStart = tomorrow()
    let day = opts.startDate ? new Date(opts.startDate) : minStart
    day.setHours(0, 0, 0, 0)
    if (day < minStart) day = minStart

    const out: ScheduleSlot[] = []
    let idxInDay = 0
    while (out.length < count) {
        out.push({ date: toDateStr(day), time: slots[idxInDay] })
        idxInDay++
        if (idxInDay >= perDay) {
            idxInDay = 0
            day = new Date(day)
            day.setDate(day.getDate() + 1)
        }
    }
    return out
}

/** Combine a slot into the `scheduled_for` shape the DB/calendar expect. */
export function toScheduledFor(date: string, time: string): string {
    return `${date}T${time}:00`
}
