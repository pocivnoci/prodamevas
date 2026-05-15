/**
 * Czech Calendar Signals
 * Static data — no API needed.
 * Provides holidays, name days, seasons, and contextual signals for content planning.
 */

// ============================================
// TYPES
// ============================================

export interface DayContext {
    date: string           // "2026-05-22"
    dayOfWeek: string      // "thursday"
    dayOfWeekCz: string    // "čtvrtek"
    holidays: string[]     // ["Den matek"]
    nameday: string        // "Emílie"
    season: string         // "jaro"
    seasonContext: string  // "pozdní jaro, blíží se léto"
    isWeekend: boolean
    monthContext: string   // "konec měsíce — lidé mají výplatu"
}

// ============================================
// CZECH HOLIDAYS (fixed + movable)
// ============================================

const FIXED_HOLIDAYS: Record<string, string[]> = {
    "01-01": ["Nový rok", "Den obnovy samostatného českého státu"],
    "01-06": ["Tři králové"],
    "02-14": ["Valentýn"],
    "03-08": ["Mezinárodní den žen"],
    "03-28": ["Den učitelů"],
    "04-01": ["Apríl"],
    "04-22": ["Den Země"],
    "05-01": ["Svátek práce", "Lásky den"],
    "05-08": ["Den vítězství"],
    "05-11": ["Den matek"],  // 2nd Sunday of May (approx)
    "06-15": ["Den otců"],   // 3rd Sunday of June (approx)
    "07-05": ["Den slovanských věrozvěstů Cyrila a Metoděje"],
    "07-06": ["Den upálení mistra Jana Husa"],
    "09-28": ["Den české státnosti"],
    "10-28": ["Den vzniku samostatného československého státu"],
    "10-31": ["Halloween"],
    "11-11": ["Den veteránů", "Svatý Martin"],
    "11-17": ["Den boje za svobodu a demokracii"],
    "12-05": ["Mikuláš"],
    "12-06": ["Mikuláš (nadílka)"],
    "12-24": ["Štědrý den"],
    "12-25": ["1. svátek vánoční"],
    "12-26": ["2. svátek vánoční", "Štěpán"],
    "12-31": ["Silvestr"],
}

// Marketing-relevant events
const MARKETING_EVENTS: Record<string, string[]> = {
    "01-17": ["Blue Monday — nejdepresivnější den roku"],
    "03-20": ["Začátek jara"],
    "04-07": ["Světový den zdraví"],
    "05-25": ["Začátek letní sezóny"],
    "06-21": ["Nejdelší den v roce / Začátek léta"],
    "09-01": ["Začátek školního roku"],
    "09-22": ["Začátek podzimu"],
    "11-29": ["Black Friday 2026"],  // approximate
    "12-21": ["Nejkratší den / Začátek zimy"],
}

// ============================================
// CZECH NAME DAYS (simplified — top 50 days)
// Full list would be 366 entries, this covers the most common
// ============================================

const NAME_DAYS: Record<string, string> = {
    "01-01": "Nový rok",
    "01-18": "Vladislav",
    "02-14": "Valentýn",
    "03-08": "Gabriela",
    "03-19": "Josef",
    "04-23": "Vojtěch",
    "04-24": "Jiří",
    "05-15": "Žofie",
    "05-16": "Přemysl",
    "05-30": "Ferdinand",
    "06-12": "Antonie",
    "06-24": "Jan",
    "07-04": "Prokop",
    "07-05": "Cyril, Metoděj",
    "07-26": "Anna",
    "08-15": "Marie",
    "08-20": "Bernard",
    "09-28": "Václav",
    "09-29": "Michal",
    "10-04": "František",
    "10-18": "Lukáš",
    "10-26": "Dimitrij",
    "11-11": "Martin",
    "11-30": "Ondřej",
    "12-04": "Barbora",
    "12-06": "Mikuláš",
    "12-13": "Lucie",
    "12-24": "Adam, Eva",
    "12-26": "Štěpán",
}

// ============================================
// SEASONS
// ============================================

function getSeason(month: number, day: number): { season: string; context: string } {
    if ((month === 3 && day >= 20) || (month > 3 && month < 6) || (month === 6 && day < 21)) {
        if (month === 3) return { season: "jaro", context: "začátek jara, příroda se probouzí" }
        if (month === 4) return { season: "jaro", context: "jaro v plném proudu" }
        if (month === 5) return { season: "jaro", context: "pozdní jaro, blíží se léto" }
        return { season: "jaro", context: "konec jara" }
    }
    if ((month === 6 && day >= 21) || (month > 6 && month < 9) || (month === 9 && day < 22)) {
        if (month === 6) return { season: "léto", context: "začátek léta, nejdelší dny" }
        if (month === 7) return { season: "léto", context: "hlavní letní sezóna" }
        if (month === 8) return { season: "léto", context: "léto, konec prázdnin se blíží" }
        return { season: "léto", context: "babí léto" }
    }
    if ((month === 9 && day >= 22) || (month > 9 && month < 12) || (month === 12 && day < 21)) {
        if (month === 9) return { season: "podzim", context: "začátek podzimu" }
        if (month === 10) return { season: "podzim", context: "podzim, barevné listí" }
        if (month === 11) return { season: "podzim", context: "pozdní podzim, blíží se zima" }
        return { season: "podzim", context: "konec podzimu" }
    }
    if (month === 12) return { season: "zima", context: "začátek zimy, vánoční období" }
    if (month === 1) return { season: "zima", context: "zima, nový rok" }
    if (month === 2) return { season: "zima", context: "konec zimy, dny se prodlužují" }
    return { season: "zima", context: "zima" }
}

// ============================================
// MONTH CONTEXT
// ============================================

function getMonthContext(day: number, totalDays: number): string {
    if (day <= 5) return "začátek měsíce"
    if (day <= 10) return "první polovina měsíce"
    if (day <= 20) return "střed měsíce"
    if (day <= totalDays - 5) return "druhá polovina měsíce"
    return "konec měsíce — lidé mají výplatu"
}

function getDaysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate()
}

// ============================================
// MAIN EXPORT
// ============================================

const DAY_NAMES_CZ = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"]
const DAY_NAMES_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

/**
 * Get complete context for a specific date.
 */
export function getDayContext(date: Date): DayContext {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const dayOfWeek = date.getDay()

    const mmdd = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    const dateStr = `${year}-${mmdd}`

    const holidays = [
        ...(FIXED_HOLIDAYS[mmdd] || []),
        ...(MARKETING_EVENTS[mmdd] || []),
    ]

    const { season, context: seasonContext } = getSeason(month, day)
    const totalDays = getDaysInMonth(year, month)

    return {
        date: dateStr,
        dayOfWeek: DAY_NAMES_EN[dayOfWeek],
        dayOfWeekCz: DAY_NAMES_CZ[dayOfWeek],
        holidays,
        nameday: NAME_DAYS[mmdd] || "",
        season,
        seasonContext,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        monthContext: getMonthContext(day, totalDays),
    }
}

/**
 * Get context for an entire week (7 days starting from the given date).
 */
export function getWeekContext(startDate: Date): DayContext[] {
    const days: DayContext[] = []
    for (let i = 0; i < 7; i++) {
        const d = new Date(startDate)
        d.setDate(d.getDate() + i)
        days.push(getDayContext(d))
    }
    return days
}
