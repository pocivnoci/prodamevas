/**
 * Content Planner — AI-driven weekly content strategy
 * 
 * Takes weather forecast, calendar events, performance data, and brand config.
 * Produces a strategic week plan: which posts, which days, which times, and WHY.
 * Then generates the actual posts via autopilot and schedules them into ig_content_calendar.
 */

import { ai } from "./gemini-client"
import { getModel } from "./models"
import { getWeekContext, type DayContext } from "./signals/calendar"
import { getWeatherForecast, formatForecastForAI, type WeekForecast } from "./signals/weather"
import { analyzePerformance, type PerformanceInsight } from "./performance"
import type { ClientConfig } from "./configs/types"

// ============================================
// TYPES
// ============================================

export interface PlannedSlot {
    day: string          // "monday"
    date: string         // "2026-05-19"
    time: string         // "17:00"
    postType: string     // "behind_the_scenes"
    topic: string        // "Příprava na horký čtvrtek"
    reason: string       // "Pondělní BTS buduje očekávání"
    weatherContext: string | null
    calendarContext: string | null
    source: "planned" | "reactive"
}

export interface WeekPlan {
    weekStart: string
    weekEnd: string
    slots: PlannedSlot[]
    city: string | null
    weatherAvailable: boolean
}

// ============================================
// AI CONTENT STRATEGIST
// ============================================

/**
 * Use AI to create a strategic week plan based on all available signals.
 */
export async function planWeek(
    config: ClientConfig,
    startDate: Date,
    performance: PerformanceInsight,
    postsPerWeek: number = 5,
    city?: string,
    /** Revision notes from Chief Editor — if provided, planner must address them */
    revisionContext?: string,
): Promise<WeekPlan> {
    // Collect signals
    const calendarContext = getWeekContext(startDate)
    const weatherCity = city || config.city || "Praha"
    const forecast = await getWeatherForecast(weatherCity)

    // Build AI prompt
    const weatherSection = forecast
        ? formatForecastForAI(forecast)
        : "Počasí: nedostupné (OPENWEATHER_API_KEY není nastaven)"

    const calendarSection = calendarContext.map(d => {
        const holidays = d.holidays.length > 0 ? ` — ${d.holidays.join(", ")}` : ""
        const nameday = d.nameday ? ` (jmeniny: ${d.nameday})` : ""
        return `${d.dayOfWeekCz} ${d.date}${holidays}${nameday} [${d.seasonContext}]`
    }).join("\n")

    // Performance context
    let perfSection = "Žádná historická data — prvotní plánování."
    if (performance.avgEngagement > 0) {
        const bestTimes = performance.bestTimeSlots.length > 0
            ? `Nejlepší časy: ${performance.bestTimeSlots.join(", ")}`
            : ""
        const patterns = performance.topPatterns.length > 0
            ? `Fungující vzorce: ${performance.topPatterns.join(", ")}`
            : ""
        perfSection = [
            `Průměrný engagement: ${performance.avgEngagement.toFixed(0)} bodů`,
            bestTimes,
            patterns,
            performance.bestHooks.length > 0 ? `Top hooky: "${performance.bestHooks[0]}"` : "",
        ].filter(Boolean).join("\n")
    }

    // Available post types
    const availableTypes = config.weekPlan.length > 0
        ? [...new Set(config.weekPlan)]
        : Object.values(config.contentPillars).flatMap(p => p.postTypes)

    // Inject brand memories into planning context
    let memorySection = ""
    try {
        const { getBrandMemories, formatMemoriesForPrompt } = await import("./memory-agent")
        const { setActiveProject } = await import("./service")
        // Ensure active project is set for memory queries
        const { resolveClientId } = await import("./configs")
        const clientId = await resolveClientId(config.id)
        setActiveProject(clientId)
        const memories = await getBrandMemories(8)
        if (memories.length > 0) {
            memorySection = formatMemoriesForPrompt(memories)
            console.log(`   🧠 Brand memory: ${memories.length} vzorců injected into content planner`)
        }
    } catch {
        // Non-fatal — continue without memories
    }

    // Inject context agent (plan mode — broader perspective for week planning)
    let contextSection = ""
    try {
        const { gatherContext, formatContextForPrompt } = await import("./context-agent")
        const context = await gatherContext(config, "plan")
        contextSection = formatContextForPrompt(context)
        console.log(`   🌍 Context (plan): ${context.season} | ${context.pulse.length} signálů`)
    } catch {
        // Non-fatal — continue without context
    }

    const planPrompt = `
Jsi content strategist pro značku "${config.name}" (${config.industry || "business"}).
Web: ${config.website} | IG: ${config.instagram}

## BRAND PERSONA
${config.brandVoice?.persona || ""}
${config.contentFocus ? `Zaměření: ${config.contentFocus}` : ""}

${config.products?.length ? `## PRODUKTY (${config.products.length})\n${config.products.slice(0, 8).map(p => `- ${p.name} (${p.type})${p.price ? ` — ${p.price}` : ""}`).join("\n")}\n` : ""}
## TENTO TÝDEN:
${calendarSection}

## POČASÍ (${weatherCity}):
${weatherSection}

## PERFORMANCE DATA:
${perfSection}
${memorySection}${contextSection}
## DOSTUPNÉ TYPY POSTŮ:
${availableTypes.map(t => `- ${t}`).join("\n")}
${revisionContext ? `
## 🎖️ POZNÁMKY ŠÉFREDAKTORA (MUSÍŠ REAGOVAT!)
${revisionContext}

Předchozí verze plánu byla vrácena k přepracování. Adresuj KAŽDOU poznámku:
- Implementuj požadovanou změnu, NEBO
- Vysvětli proč nesouhlasíš (s argumenty)
` : ""}
## INSTRUKCE:
Vytvoř strategický plán na tento týden. Potřebuji přesně ${postsPerWeek} postů.

Pro KAŽDÝ post urči:
1. **Den a čas** — využij performance data (nejlepší časy) a logiku (ráno = kavárna, večer = restaurace)
2. **Typ postu** — vyber z dostupných typů, snaž se o rozmanitost
3. **Téma** — konkrétní, specifické pro TUTO značku. Propoj s počasím/kalendářem kde to PŘIROZENĚ dává smysl
4. **Důvod** — proč PRÁVĚ tento post PRÁVĚ tento den (1 věta)
5. **Weather kontext** — pokud je počasí klíčové pro tento post, uveď jaké
6. **Calendar kontext** — pokud je svátek/akce klíčová, uveď jaký

PRAVIDLA:
- Ne KAŽDÝ post musí reagovat na počasí — jen tam kde to dává smysl
- Rozlož posty rovnoměrně přes týden (ne 3 za sebou)
- Víkendy mohou mít jiný vibe než pracovní dny
- Pokud je významný svátek → minimálně 1 post k němu
- Neplánuj víc než 1 post za den

Vrať POUZE validní JSON pole:
[
  {
    "day": "monday",
    "date": "${calendarContext[0].date}",
    "time": "17:00",
    "postType": "behind_the_scenes",
    "topic": "téma česky — konkrétní, ne obecné",
    "reason": "důvod proč tento den a čas",
    "weatherContext": "28°C jasno" | null,
    "calendarContext": "Den matek" | null
  }
]
`

    try {
        const response = await ai.models.generateContent({
            model: getModel("text"),
            contents: planPrompt,
            config: { responseMimeType: "application/json" },
        })

        const text = response.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        const slots: PlannedSlot[] = JSON.parse(jsonMatch?.[0] || "[]")

        // Validate and tag as planned
        const validSlots = slots
            .filter(s => s.day && s.postType && s.topic)
            .map(s => ({ ...s, source: "planned" as const }))

        console.log(`📅 Week plan: ${validSlots.length} posts planned`)
        for (const s of validSlots) {
            const weather = s.weatherContext ? ` ☁️ ${s.weatherContext}` : ""
            const calendar = s.calendarContext ? ` 📅 ${s.calendarContext}` : ""
            console.log(`   ${s.day} ${s.time} → ${s.postType}: "${s.topic}"${weather}${calendar}`)
        }

        return {
            weekStart: calendarContext[0].date,
            weekEnd: calendarContext[6].date,
            slots: validSlots,
            city: forecast?.city || null,
            weatherAvailable: forecast !== null,
        }
    } catch (err: any) {
        console.error("❌ Week planning failed:", err?.message)
        return {
            weekStart: calendarContext[0].date,
            weekEnd: calendarContext[6].date,
            slots: [],
            city: null,
            weatherAvailable: false,
        }
    }
}
