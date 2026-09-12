/**
 * Kalendářní signály — svátky, marketingové dny, jmeniny, sezóna.
 * Statická data, žádné API.
 *
 * Tabulky jsou PER ZEMĚ, protože svátky nejsou vlastnost jazyka, ale trhu: německá
 * značka má Tag der Deutschen Einheit, polská Boże Ciało, česká Den české státnosti.
 * Země se bere z jazykového balíčku (`instagram/language.ts` → `country`); angličtina
 * dostává mezinárodní marketingový kalendář, ne jednu konkrétní zemi.
 *
 * Názvy svátků jsou v jazyce trhu (jsou to vlastní jména — copywriter je má použít
 * tak, jak je publikum zná), sezóna a dny v týdnu zůstávají česky, protože jdou
 * do česky psaného promptu jako kontext, ne do výstupu.
 *
 * Pohyblivé svátky se POČÍTAJÍ (Velikonoce, Den matek, Black Friday…) — dřív byly
 * v tabulce jako „přibližné" pevné datum a jednou za rok minuly o týden.
 */

import { languagePack, type ContentLanguage } from "../language"

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

type Fixed = Record<string, string[]>
type Movable = (year: number) => Record<string, string[]>

interface CountryCalendar {
    fixed: Fixed
    /** Marketing-relevant dates that are not holidays (seasons, Blue Monday, Black Friday). */
    marketing: Fixed
    movable: Movable
    namedays: Record<string, string>
}

// ============================================
// DATE HELPERS
// ============================================

function mmdd(d: Date): string {
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function addDays(d: Date, n: number): Date {
    const out = new Date(d)
    out.setDate(out.getDate() + n)
    return out
}

/** Velikonoční neděle (gregoriánský kalendář, Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
    const a = year % 19
    const b = Math.floor(year / 100)
    const c = year % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31)
    const day = ((h + l - 7 * m + 114) % 31) + 1
    return new Date(year, month - 1, day)
}

/** N-tá neděle v měsíci (1 = první). `weekday` 0 = neděle … 6 = sobota. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
    const first = new Date(year, month - 1, 1)
    const offset = (weekday - first.getDay() + 7) % 7
    return new Date(year, month - 1, 1 + offset + (n - 1) * 7)
}

function put(into: Record<string, string[]>, d: Date, name: string): void {
    const key = mmdd(d)
    into[key] = [...(into[key] || []), name]
}

/** Velikonoce v dané jazykové podobě + volitelné odvozené dny. */
function easterFamily(year: number, names: {
    goodFriday?: string; sunday: string; monday: string
    ascension?: string; whitMonday?: string; corpusChristi?: string; fatThursday?: string
}): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    const easter = easterSunday(year)
    if (names.goodFriday) put(out, addDays(easter, -2), names.goodFriday)
    put(out, easter, names.sunday)
    put(out, addDays(easter, 1), names.monday)
    if (names.ascension) put(out, addDays(easter, 39), names.ascension)
    if (names.whitMonday) put(out, addDays(easter, 50), names.whitMonday)
    if (names.corpusChristi) put(out, addDays(easter, 60), names.corpusChristi)
    if (names.fatThursday) put(out, addDays(easter, -52), names.fatThursday)
    return out
}

/** Black Friday = pátek po čtvrtém čtvrtku v listopadu (US Thanksgiving). */
function blackFriday(year: number): Date {
    return addDays(nthWeekday(year, 11, 4, 4), 1)
}

/** Blue Monday = třetí pondělí v lednu. */
function blueMonday(year: number): Date {
    return nthWeekday(year, 1, 1, 3)
}

// ============================================
// SEASONS (Czech — context for the Czech-written prompt)
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

/** Sezónní milníky jsou pro všechny trhy stejné (severní polokoule). */
const SEASON_MARKETING: Fixed = {
    "03-20": ["Začátek jara"],
    "05-25": ["Začátek letní sezóny"],
    "06-21": ["Nejdelší den v roce / Začátek léta"],
    "09-22": ["Začátek podzimu"],
    "12-21": ["Nejkratší den / Začátek zimy"],
}

// ============================================
// CZ
// ============================================

const CZ: CountryCalendar = {
    fixed: {
        "01-01": ["Nový rok", "Den obnovy samostatného českého státu"],
        "01-06": ["Tři králové"],
        "02-14": ["Valentýn"],
        "03-08": ["Mezinárodní den žen"],
        "03-28": ["Den učitelů"],
        "04-01": ["Apríl"],
        "04-22": ["Den Země"],
        "04-30": ["Pálení čarodějnic"],
        "05-01": ["Svátek práce", "Lásky den"],
        "05-08": ["Den vítězství"],
        "06-01": ["Den dětí"],
        "07-05": ["Den slovanských věrozvěstů Cyrila a Metoděje"],
        "07-06": ["Den upálení mistra Jana Husa"],
        "09-01": ["Začátek školního roku"],
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
    },
    marketing: { ...SEASON_MARKETING, "04-07": ["Světový den zdraví"] },
    movable: year => {
        const out = easterFamily(year, { goodFriday: "Velký pátek", sunday: "Velikonoční neděle", monday: "Velikonoční pondělí" })
        put(out, nthWeekday(year, 5, 0, 2), "Den matek")
        put(out, nthWeekday(year, 6, 0, 3), "Den otců")
        put(out, blueMonday(year), "Blue Monday — nejdepresivnější den roku")
        put(out, blackFriday(year), `Black Friday ${year}`)
        put(out, addDays(blackFriday(year), 3), "Cyber Monday")
        return out
    },
    namedays: {
        "01-01": "Nový rok", "01-18": "Vladislav", "02-14": "Valentýn", "03-08": "Gabriela",
        "03-19": "Josef", "04-23": "Vojtěch", "04-24": "Jiří", "05-15": "Žofie", "05-16": "Přemysl",
        "05-30": "Ferdinand", "06-12": "Antonie", "06-24": "Jan", "07-04": "Prokop",
        "07-05": "Cyril, Metoděj", "07-26": "Anna", "08-15": "Marie", "08-20": "Bernard",
        "09-28": "Václav", "09-29": "Michal", "10-04": "František", "10-18": "Lukáš",
        "10-26": "Dimitrij", "11-11": "Martin", "11-30": "Ondřej", "12-04": "Barbora",
        "12-06": "Mikuláš", "12-13": "Lucie", "12-24": "Adam, Eva", "12-26": "Štěpán",
    },
}

// ============================================
// SK
// ============================================

const SK: CountryCalendar = {
    fixed: {
        "01-01": ["Nový rok", "Deň vzniku Slovenskej republiky"],
        "01-06": ["Zjavenie Pána (Traja králi)"],
        "02-14": ["Valentín"],
        "03-08": ["Medzinárodný deň žien"],
        "03-28": ["Deň učiteľov"],
        "04-01": ["Prvý apríl"],
        "04-22": ["Deň Zeme"],
        "05-01": ["Sviatok práce"],
        "05-08": ["Deň víťazstva nad fašizmom"],
        "06-01": ["Medzinárodný deň detí"],
        "07-05": ["Sviatok svätého Cyrila a Metoda"],
        "08-29": ["Výročie SNP"],
        "09-01": ["Deň Ústavy SR", "Začiatok školského roka"],
        "09-15": ["Sedembolestná Panna Mária"],
        "10-31": ["Halloween"],
        "11-01": ["Sviatok všetkých svätých"],
        "11-11": ["Svätý Martin"],
        "11-17": ["Deň boja za slobodu a demokraciu"],
        "12-05": ["Mikuláš"],
        "12-06": ["Mikuláš (nádielka)"],
        "12-24": ["Štedrý deň"],
        "12-25": ["Prvý sviatok vianočný"],
        "12-26": ["Druhý sviatok vianočný", "Štefan"],
        "12-31": ["Silvester"],
    },
    marketing: { ...SEASON_MARKETING },
    movable: year => {
        const out = easterFamily(year, { goodFriday: "Veľký piatok", sunday: "Veľkonočná nedeľa", monday: "Veľkonočný pondelok" })
        put(out, nthWeekday(year, 5, 0, 2), "Deň matiek")
        put(out, nthWeekday(year, 6, 0, 3), "Deň otcov")
        put(out, blueMonday(year), "Blue Monday")
        put(out, blackFriday(year), `Black Friday ${year}`)
        put(out, addDays(blackFriday(year), 3), "Cyber Monday")
        return out
    },
    namedays: {
        "03-19": "Jozef", "04-24": "Juraj", "05-15": "Žofia", "06-24": "Ján", "07-26": "Anna",
        "09-28": "Václav", "09-29": "Michal", "10-04": "František", "11-11": "Martin",
        "11-25": "Katarína", "11-30": "Ondrej", "12-04": "Barbora", "12-06": "Mikuláš",
        "12-13": "Lucia", "12-24": "Adam, Eva", "12-26": "Štefan",
    },
}

// ============================================
// PL
// ============================================

const PL: CountryCalendar = {
    fixed: {
        "01-01": ["Nowy Rok"],
        "01-06": ["Święto Trzech Króli"],
        "01-21": ["Dzień Babci"],
        "01-22": ["Dzień Dziadka"],
        "02-14": ["Walentynki"],
        "03-08": ["Dzień Kobiet"],
        "03-10": ["Dzień Mężczyzn"],
        "04-01": ["Prima Aprilis"],
        "04-22": ["Dzień Ziemi"],
        "05-01": ["Święto Pracy"],
        "05-02": ["Dzień Flagi"],
        "05-03": ["Święto Konstytucji 3 Maja"],
        "05-26": ["Dzień Matki"],
        "06-01": ["Dzień Dziecka"],
        "06-23": ["Dzień Ojca"],
        "08-15": ["Wniebowzięcie NMP", "Święto Wojska Polskiego"],
        "09-01": ["Początek roku szkolnego"],
        "09-30": ["Dzień Chłopaka"],
        "10-14": ["Dzień Edukacji Narodowej"],
        "10-31": ["Halloween"],
        "11-01": ["Wszystkich Świętych"],
        "11-11": ["Narodowe Święto Niepodległości", "Św. Marcin (rogale świętomarcińskie)"],
        "11-30": ["Andrzejki"],
        "12-06": ["Mikołajki"],
        "12-24": ["Wigilia"],
        "12-25": ["Boże Narodzenie"],
        "12-26": ["Drugi dzień Świąt"],
        "12-31": ["Sylwester"],
    },
    marketing: { ...SEASON_MARKETING },
    movable: year => {
        const out = easterFamily(year, {
            goodFriday: "Wielki Piątek", sunday: "Wielkanoc", monday: "Poniedziałek Wielkanocny (Lany Poniedziałek)",
            corpusChristi: "Boże Ciało", fatThursday: "Tłusty Czwartek",
        })
        put(out, blueMonday(year), "Blue Monday")
        put(out, blackFriday(year), `Black Friday ${year}`)
        put(out, addDays(blackFriday(year), 3), "Cyber Monday")
        return out
    },
    namedays: {
        "03-19": "Józef", "04-23": "Jerzy", "05-15": "Zofia", "06-24": "Jan", "07-26": "Anna",
        "09-29": "Michał", "10-04": "Franciszek", "11-11": "Marcin", "11-25": "Katarzyna",
        "11-30": "Andrzej", "12-04": "Barbara", "12-06": "Mikołaj", "12-13": "Łucja", "12-26": "Szczepan",
    },
}

// ============================================
// DE
// ============================================

const DE: CountryCalendar = {
    fixed: {
        "01-01": ["Neujahr"],
        "01-06": ["Heilige Drei Könige"],
        "02-14": ["Valentinstag"],
        "03-08": ["Internationaler Frauentag"],
        "04-01": ["Aprilscherz"],
        "04-22": ["Tag der Erde"],
        "05-01": ["Tag der Arbeit"],
        "06-01": ["Internationaler Kindertag"],
        "09-01": ["Schulbeginn (je nach Bundesland)"],
        "10-03": ["Tag der Deutschen Einheit"],
        "10-31": ["Halloween", "Reformationstag"],
        "11-01": ["Allerheiligen"],
        "11-11": ["Martinstag", "Karnevalsbeginn (11.11., 11:11 Uhr)"],
        "12-06": ["Nikolaus"],
        "12-24": ["Heiligabend"],
        "12-25": ["1. Weihnachtsfeiertag"],
        "12-26": ["2. Weihnachtsfeiertag"],
        "12-31": ["Silvester"],
    },
    marketing: { ...SEASON_MARKETING },
    movable: year => {
        const out = easterFamily(year, {
            goodFriday: "Karfreitag", sunday: "Ostersonntag", monday: "Ostermontag",
            ascension: "Christi Himmelfahrt (Vatertag)", whitMonday: "Pfingstmontag",
        })
        put(out, nthWeekday(year, 5, 0, 2), "Muttertag")
        put(out, blueMonday(year), "Blue Monday")
        put(out, blackFriday(year), `Black Friday ${year}`)
        put(out, addDays(blackFriday(year), 3), "Cyber Monday")
        return out
    },
    namedays: {},
}

// ============================================
// INTL — English-speaking, no single country
// ============================================

const INTL: CountryCalendar = {
    fixed: {
        "01-01": ["New Year's Day"],
        "02-14": ["Valentine's Day"],
        "03-08": ["International Women's Day"],
        "03-17": ["St. Patrick's Day"],
        "04-01": ["April Fools' Day"],
        "04-22": ["Earth Day"],
        "05-01": ["May Day"],
        "09-01": ["Back to school"],
        "10-31": ["Halloween"],
        "11-11": ["Remembrance Day / Veterans Day"],
        "12-24": ["Christmas Eve"],
        "12-25": ["Christmas Day"],
        "12-26": ["Boxing Day"],
        "12-31": ["New Year's Eve"],
    },
    marketing: { ...SEASON_MARKETING },
    movable: year => {
        const out = easterFamily(year, { goodFriday: "Good Friday", sunday: "Easter Sunday", monday: "Easter Monday" })
        put(out, nthWeekday(year, 5, 0, 2), "Mother's Day (US and most markets; UK celebrates Mothering Sunday in March)")
        put(out, nthWeekday(year, 6, 0, 3), "Father's Day")
        put(out, nthWeekday(year, 11, 4, 4), "Thanksgiving (US)")
        put(out, blueMonday(year), "Blue Monday")
        put(out, blackFriday(year), `Black Friday ${year}`)
        put(out, addDays(blackFriday(year), 3), "Cyber Monday")
        return out
    },
    namedays: {},
}

const CALENDARS: Record<string, CountryCalendar> = { CZ, SK, PL, DE, INTL }

function calendarFor(language?: ContentLanguage): CountryCalendar {
    return CALENDARS[languagePack(language).country] ?? INTL
}

// ============================================
// MAIN EXPORT
// ============================================

const DAY_NAMES_CZ = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"]
const DAY_NAMES_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

/**
 * Get complete context for a specific date. `language` picks the market calendar
 * (`ClientConfig.language`); omitted = Czech, as every client was before 9/2026.
 */
export function getDayContext(date: Date, language?: ContentLanguage): DayContext {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const dayOfWeek = date.getDay()

    const key = mmdd(date)
    const dateStr = `${year}-${key}`
    const cal = calendarFor(language)

    const holidays = [
        ...(cal.fixed[key] || []),
        ...(cal.movable(year)[key] || []),
        ...(cal.marketing[key] || []),
    ]

    const { season, context: seasonContext } = getSeason(month, day)
    const totalDays = getDaysInMonth(year, month)

    return {
        date: dateStr,
        dayOfWeek: DAY_NAMES_EN[dayOfWeek],
        dayOfWeekCz: DAY_NAMES_CZ[dayOfWeek],
        holidays,
        nameday: cal.namedays[key] || "",
        season,
        seasonContext,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        monthContext: getMonthContext(day, totalDays),
    }
}

/**
 * Get context for an entire week (7 days starting from the given date).
 */
export function getWeekContext(startDate: Date, language?: ContentLanguage): DayContext[] {
    const days: DayContext[] = []
    for (let i = 0; i < 7; i++) {
        days.push(getDayContext(addDays(startDate, i), language))
    }
    return days
}
