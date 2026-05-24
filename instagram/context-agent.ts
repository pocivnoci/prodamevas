/**
 * Context Agent — Seasonal, Local & Industry Intelligence
 * =======================================================
 *
 * Gathers real-world context BEFORE caption generation to ensure
 * posts feel grounded in reality, not generic AI slop.
 *
 * Sources:
 *   📅 signals/calendar.ts  — holidays, namedays, season (static, 0 API calls)
 *   📊 Gemini 3.5 Flash     — industry + local + seasonal pulse (1 API call, ~$0.025)
 *
 * Two modes:
 *   "single" — context for generating a single post (today-focused, post-type aware)
 *   "plan"   — context for weekly/monthly content planning (broader, strategic)
 *
 * Cache: Results cached per-client per-mode for 6 hours in-memory.
 */

import { getDayContext, type DayContext } from "./signals/calendar"
import { generateText } from "./gemini-client"
import type { ClientConfig } from "./configs/types"

// ============================================
// TYPES
// ============================================

export interface ContextSignals {
    /** Season description, e.g. "pozdní jaro, blíží se léto" */
    season: string
    /** Upcoming holidays (today + lookahead) */
    holidays: string[]
    /** Today's nameday (if known) */
    nameday: string
    isWeekend: boolean
    /** Month phase, e.g. "konec měsíce — lidé mají výplatu" */
    monthPhase: string
    /** AI-generated contextual bullets the Copywriter can cherry-pick from */
    pulse: string[]
    /** Date string for logging */
    date: string
    /** Mode used */
    mode: "single" | "plan"
}

// ============================================
// CACHE (in-memory, per-client+mode, 6h TTL)
// ============================================

interface CacheEntry {
    signals: ContextSignals
    expiresAt: number
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const contextCache = new Map<string, CacheEntry>()

// ============================================
// MAIN
// ============================================

/**
 * Collect seasonal, industry, and local context for a client.
 *
 * @param mode "single" = one post (today), "plan" = week/month strategy
 * @param postType Optional — when mode is "single", what kind of post is being made
 */
export async function gatherContext(
    config: ClientConfig,
    mode: "single" | "plan" = "single",
    postType?: string,
): Promise<ContextSignals> {
    // Cache key includes postType for single mode so different post types get different angles
    const cacheKey = `${config.id}:${mode}:${postType || "_"}`
    const cached = contextCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) {
        return cached.signals
    }

    const now = new Date()
    const today = getDayContext(now)

    // Scan upcoming days for holidays
    const lookAhead = mode === "plan" ? 14 : 5
    const upcomingHolidays: string[] = [...today.holidays]
    for (let i = 1; i <= lookAhead; i++) {
        const future = new Date(now)
        future.setDate(future.getDate() + i)
        const futureCtx = getDayContext(future)
        for (const h of futureCtx.holidays) {
            upcomingHolidays.push(`${h} (za ${i} ${i === 1 ? "den" : i < 5 ? "dny" : "dní"})`)
        }
    }

    // AI pulse — grounded in brand config, not generic fluff
    let pulse: string[] = []
    try {
        pulse = await generatePulse(config, today, mode, postType)
    } catch (err: any) {
        console.warn(`   ⚠️ Context pulse failed: ${err?.message?.substring(0, 80)}`)
    }

    const signals: ContextSignals = {
        season: today.seasonContext,
        holidays: upcomingHolidays,
        nameday: today.nameday,
        isWeekend: today.isWeekend,
        monthPhase: today.monthContext,
        pulse,
        date: today.date,
        mode,
    }

    contextCache.set(cacheKey, {
        signals,
        expiresAt: Date.now() + CACHE_TTL_MS,
    })

    return signals
}

// ============================================
// AI PULSE — the core intelligence
// ============================================

async function generatePulse(
    config: ClientConfig,
    today: DayContext,
    mode: "single" | "plan",
    postType?: string,
): Promise<string[]> {
    const industry = config.industry || "business"
    const city = config.city || "Česká republika"
    const contentFocus = config.contentFocus || ""

    // Build brand context — ground the AI in what the brand actually does
    const pillars = Object.entries(config.contentPillars || {})
        .map(([id, p]) => `${p.emoji} ${p.label} (${p.postTypes.join(", ")})`)
        .join("\n")

    const personas = config.audiencePersonas?.slice(0, 3)
        .map(p => `${p.label} (${p.ageRange}): ${p.painPoints[0]}`)
        .join("\n") || ""

    // Mode-specific instructions
    const modeBlock = mode === "plan"
        ? `## MÓD: PLÁNOVÁNÍ (1-2 týdny dopředu)
Generuj kontext pro STRATEGICKÉ PLÁNOVÁNÍ obsahu:
- Jaké sezónní příležitosti přichází v tomto oboru?
- Jaké obsahové formáty teď fungují nejlépe?
- Co by se dalo propojit s blížícími se svátky/událostmi?
- Jaké nálady/potřeby mají zákazníci v tomto období?`
        : `## MÓD: JEDEN POST (dnes)
${postType ? `Typ postu: ${postType}` : ""}
Generuj kontext pro JEDEN KONKRÉTNÍ příspěvek:
- Co je DNES aktuální a jak to propojit s tímto oborem?
- Jaký úhel by rezonoval s cílovou skupinou PRÁVĚ TEĎ?
- Jaká sezónní nálada/situace je v tomto regionu?`

    const prompt = `
Jsi kontextový analytik pro českou značku. Tvůj výstup použije AI copywriter jako INSPIRACI — vybere si co sedí.

## DATUM & SEZÓNA
- ${today.date} (${today.dayOfWeekCz}), ${today.seasonContext}
- Region: ${city}
${today.holidays.length > 0 ? `- Dnes: ${today.holidays.join(", ")}` : ""}

## ZNAČKA
- Název: ${config.name} | Obor: ${industry}
- Zaměření: ${contentFocus}
${pillars ? `- Pilíře obsahu:\n${pillars}` : ""}
${personas ? `- Cílová skupina:\n${personas}` : ""}

${modeBlock}

## PRAVIDLA
1. Přesně 4 body, max 1-2 věty každý
2. Každý bod MUSÍ být specifický pro tento obor + sezónu — NE "buďte autentičtí" nebo "sdílejte příběhy"
3. Mix: oborový trend, sezónní angle, chování zákazníků, regionální kontext
4. Piš FAKTA a ÚHLY — ne instrukce pro copywritera
5. Česky, bez odrážek na začátku

Vrať POUZE validní JSON:
{ "pulse": ["bod 1", "bod 2", "bod 3", "bod 4"] }
`

    const raw = await generateText(prompt, { model: "gemini-3.5-flash" })

    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        const parsed = JSON.parse(jsonMatch?.[0] || raw)
        const items = parsed.pulse || parsed.items || []
        return Array.isArray(items)
            ? items.filter((s: any) => typeof s === "string" && s.length > 0).slice(0, 5)
            : []
    } catch {
        return []
    }
}

// ============================================
// FORMAT FOR MEGA PROMPT
// ============================================

/**
 * Format gathered context into a lean prompt section.
 * Copywriter gets context as optional inspiration, not mandatory instructions.
 */
export function formatContextForPrompt(ctx: ContextSignals): string {
    const parts: string[] = []

    parts.push(`\n\n## 🌍 KONTEXT (${ctx.date}, ${ctx.isWeekend ? "víkend" : "pracovní den"} — ${ctx.season})`)

    // Calendar signals (only if relevant)
    if (ctx.holidays.length > 0) {
        parts.push(`📅 ${ctx.holidays.join(" | ")}`)
    }
    if (ctx.monthPhase && ctx.monthPhase !== "první polovina měsíce" && ctx.monthPhase !== "střed měsíce" && ctx.monthPhase !== "druhá polovina měsíce") {
        parts.push(`💰 ${ctx.monthPhase}`)
    }

    // AI pulse
    if (ctx.pulse.length > 0) {
        parts.push("")
        for (const item of ctx.pulse) {
            parts.push(`• ${item}`)
        }
    }

    parts.push(`\n💡 Vyber si z kontextu CO SEDÍ k tématu postu. Nemusíš použít vše — ale generický post odtržený od reality = selhání.`)

    return parts.join("\n")
}
