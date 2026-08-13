/**
 * Config Loader & Client Registry (Dynamic via Supabase)
 * ======================================================
 * Central registry of all available clients. Fetches from DB.
 */

import supabaseAdmin from "../../supabase/admin"
import type { ClientConfig } from "./types"
import { FORMAT_BRIEF_LIMITS } from "./types"
import { reconcileFormats } from "./reconcile"
import { isFeedPattern } from "../../lib/feed-pattern"
import { CAROUSEL_MAX_TOTAL_SLIDES } from "../caption-generator"

export interface ClientMeta {
    id: string
    name: string
    icon: string
    description: string
}

// ─── Super-admin check (from ENV, not hardcoded) ─────────────────────
function isSuperAdmin(email: string | undefined): boolean {
    const admins = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
    return admins.includes(email || "")
}

// ─── Caches ──────────────────────────────────────────────────────────
// Short TTL: invalidateConfigCache() only clears THIS lambda instance —
// other warm serverless instances must expire on their own, otherwise
// they serve stale config indefinitely after a settings change.

const CONFIG_CACHE_TTL_MS = 60_000

const configCache = new Map<string, { config: ClientConfig; expiresAt: number }>()
const clientIdCache = new Map<string, string>() // slug → uuid (immutable mapping, no TTL needed)

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Load client config by name (cached)
 * @param name - Config slug (e.g. mobilnamiru, or a UUID)
 * @param forceRefresh - Skip cache and fetch from DB
 */
export async function loadConfig(name: string, forceRefresh = false): Promise<ClientConfig> {
    if (!name) {
        throw new Error("loadConfig: chybí slug klienta — tenant musí být vždy explicitní")
    }
    if (!forceRefresh) {
        const cached = configCache.get(name)
        if (cached && cached.expiresAt > Date.now()) return cached.config
    }

    const { data, error } = await supabaseAdmin
        .from("clients")
        .select("config")
        .eq("slug", name)
        .single()

    if (error || !data) {
        throw new Error(`Failed to load config "${name}" from Supabase: ${error?.message || "Not found"}`)
    }

    const config = validateConfig(data.config as ClientConfig, name)
    configCache.set(name, { config, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS })
    return config
}

/** Fill safe defaults for missing required fields to prevent runtime crashes */
/**
 * `postTypeDefs[].structure` je volný text, který napsala AI při onboardingu, a do
 * promptu se vkládá jako „**závazná** — slidy přesně podle ní". Když vyjmenuje víc
 * slidů, než unese schéma karuselu, dostane model dvě neslučitelné instrukce a řeší
 * to pokaždé jinak. Doteď to nic nekontrolovalo (`config.postTypeDefs || []`).
 *
 * Záměrně jen **hlasitě loguje** a nechává hodnotu být: kreativní zadání klienta se
 * automaticky nepřepisuje a tichá degradace je tu zakázaná. Report napříč tenanty
 * dělá `scripts/audit-formats-pillars.ts`.
 */
function warnOnOversizedStructures(defs: NonNullable<ClientConfig["postTypeDefs"]>, slug: string) {
    for (const def of defs) {
        if (!def?.structure) continue
        // Onboarding generuje osnovu ve tvaru „Slide 1 COVER: … Slide 7 CTA: …".
        const numbers = [...String(def.structure).matchAll(/\bSlide\s+(\d+)/gi)].map(m => Number(m[1]))
        const highest = numbers.length > 0 ? Math.max(...numbers) : 0
        if (highest > CAROUSEL_MAX_TOTAL_SLIDES) {
            console.warn(
                `⚠️ config[${slug}] formát "${def.name}": structure předepisuje ${highest} slidů, ` +
                `schéma karuselu jich unese ${CAROUSEL_MAX_TOTAL_SLIDES}. Model dostane dvě neslučitelné ` +
                `instrukce — zkrať structure, nebo zvyš PROMPT_LIMITS.carouselInnerMax.`,
            )
        }
    }
    return defs
}

/** Značky beatů a obecná jména, která ve formátu nejsou podpisem konkrétní scény. */
const BEAT_MARKERS = /^(COVER|CTA|HOOK|PAYOFF|VALUE|SLIDE|SCENE|SCÉNA|INTRO|OUTRO|POV|ASMR|AI|Instagram|Reels?|Stories|Story|Karusel|Feed)$/i

/**
 * Formát MUSÍ být invariant — šablona, kterou značka použije na DESÍTKY různých témat.
 * Onboarding ho ale historicky generoval jako storyboard JEDNOHO postu (včetně přesných
 * replik a CTA). Takový „formát" se pak vkládá do promptu u každého svého postu, takže
 * se stejný příspěvek vrací donekonečna — u `chrlit` vyšlo 170 postů z 8 formátů.
 *
 * Heuristika hlásí tři podpisy storyboardu:
 *   1. hotová replika v uvozovkách — copy píše copywriter pokaždé znovu, ne formát
 *   2. vlastní jméno uprostřed věty — konkrétní osoba/místo patří do NÁMĚTU
 *   3. brief výrazně delší než AI strop — do velkého prostoru se scénář vejde sám
 *
 * Záměrně jen **loguje**: kreativní zadání klienta se nikdy automaticky nepřepisuje
 * (stejná politika jako warnOnOversizedStructures). Hromadný převod starých formátů
 * na invarianty dělá `scripts/degeneralize-formats.ts`.
 */
function warnOnScenicFormats(defs: NonNullable<ClientConfig["postTypeDefs"]>, slug: string) {
    for (const def of defs) {
        if (!def) continue
        const fields: Array<[string, string | undefined, number]> = [
            ["description", def.description, FORMAT_BRIEF_LIMITS.description],
            ["structure", def.structure, FORMAT_BRIEF_LIMITS.structure],
            ["visualStyle", def.visualStyle, FORMAT_BRIEF_LIMITS.visualStyle],
        ]
        const signals: string[] = []

        for (const [field, raw, limit] of fields) {
            if (!raw) continue
            const text = String(raw)

            // 1) Hotová replika: ≥3 slova v uvozovkách. Uvozovky samy nestačí — nesou
            //    i názvy estetik ('romanticizing your life'), a ty do formátu patří.
            //    Hotovou copy pozná velké počáteční písmeno nebo koncová interpunkce.
            for (const m of text.matchAll(/[„"'']\s*(\S+(?:\s+\S+){2,}?)\s*[""'']/gu)) {
                const quote = m[1]
                if (/^\p{Lu}/u.test(quote) || /[.!?…]$/u.test(quote)) {
                    signals.push(`${field}: hotová replika „${quote.slice(0, 40)}"`)
                    break
                }
            }

            // 2) Vlastní jméno uprostřed věty — první slovo věty se přeskakuje.
            const properNouns = new Set<string>()
            // Beaty se v briefech oddělují i šipkou/odrážkou — bez nich by první slovo
            // každého beatu ("Hodnota", "Závěr") vypadalo jako vlastní jméno.
            for (const sentence of text.split(/(?<=[.!?:])\s+|\n+|\s*[→•·|]\s*|\s+[-–—]\s+/u)) {
                const words = sentence.trim().split(/\s+/u)
                for (const word of words.slice(1)) {
                    const bare = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
                    if (bare.length < 3 || BEAT_MARKERS.test(bare)) continue
                    if (bare === bare.toUpperCase()) continue // ALL-CAPS = značka beatu
                    if (/^\p{Lu}\p{Ll}+$/u.test(bare)) properNouns.add(bare)
                }
            }
            if (properNouns.size > 0) {
                signals.push(`${field}: vlastní jméno (${[...properNouns].slice(0, 3).join(", ")})`)
            }

            // 3) Brief výrazně delší než strop pro AI-generované formáty.
            if (text.length > limit * 1.5) {
                signals.push(`${field}: ${text.length} znaků (strop pro AI je ${limit})`)
            }
        }

        if (signals.length > 0) {
            console.warn(
                `⚠️ config[${slug}] formát "${def.name}" vypadá jako STORYBOARD jednoho postu, ` +
                `ne jako znovupoužitelná šablona — ${signals.join(" · ")}. ` +
                `Takový formát vyrábí pořád tentýž příspěvek. Převod: npx tsx scripts/degeneralize-formats.ts --slug=${slug}`,
            )
        }
    }
    return defs
}

function validateConfig(config: ClientConfig, slug: string): ClientConfig {
    // reconcileFormats self-heals the four format sources on every load — drift
    // (e.g. a format orphaned by a deleted pillar) never reaches the pipeline.
    return reconcileFormats({
        ...config,
        id: config.id || slug,
        name: config.name || slug,
        website: config.website || "",
        instagram: config.instagram || "",
        brandVoice: config.brandVoice || {
            persona: "Přátelský poradce",
            hookTemplates: [],
            ctaVariations: [],
            voiceTraits: ["přátelský"],
            values: [],
            antiPatterns: [],
            toneByPostType: {},
        },
        contentPillars: config.contentPillars || {},
        // Voice anchor (few-shot). Optional feature — default to empty so the copywriter
        // prompt simply omits the section until the brand has curated/auto-promoted examples.
        brandVoiceExamples: config.brandVoiceExamples || [],
        ctaStrategies: config.ctaStrategies || { soft: [], medium: [], hard: [], none: [] },
        feedAesthetic: config.feedAesthetic || {
            colorPalette: "Neutrální",
            overlayOpacity: "30%",
            textPosition: "BOTTOM",
            font: "Inter",
            feel: "Moderní a čistý",
            phoneModel: "iPhone 16 Pro",
        },
        // Grid rhythm. Clamped, not defaulted-through: engine code indexes ARCHETYPE_GROUPS by
        // the derived visual mode, so a garbage value must never reach it.
        feedPattern: isFeedPattern(config.feedPattern) ? config.feedPattern : "none",
        weekPlan: config.weekPlan || [],
        // Real posting cadence drives content-plan length (duration × postsPerWeek). Clamp to a
        // sane 1–14 (14 = 2×/day; must match distributeSchedule's MAX_POSTS_PER_WEEK) and
        // default to 4 — never let a missing/garbage value inflate or zero out the plan.
        postsPerWeek: Math.min(14, Math.max(1, Math.round(config.postsPerWeek || 4))),
        // Hands-free publishing — opt-in, default OFF so arming stays a human step
        // unless a tenant deliberately turns it on (and only fires with a live connection).
        autoPublish: config.autoPublish ?? false,
        // Idea-bank auto-replenishment — default ON (inert bank rows, free, bounded);
        // false is an explicit per-client opt-out (lib/agents/idea-replenish.ts).
        autoReplenishIdeas: config.autoReplenishIdeas ?? true,
        // Keep the three per-client format sources defaulted (never undefined) so
        // ensurePostTypes/getIGPostTypes can't silently no-op on a half-filled config.
        postTypes: config.postTypes || [],
        postFormats: config.postFormats || {},
        postTypeDefs: warnOnScenicFormats(warnOnOversizedStructures(config.postTypeDefs || [], slug), slug),
        hashtagPools: config.hashtagPools || { core: [], niche: [], broad: [], trending: [], czech: [] },
        contentFocus: config.contentFocus || config.name || slug,
        videoTier: config.videoTier || "fast",
        psychologist: config.psychologist ?? true,
        // igBaseline is optional with no default — undefined means "no scrape
        // data available" and all consumers (planWeek) must handle that.
        igBaseline: config.igBaseline,
    })
}

/**
 * Invalidate cached config for a slug (or all if no slug given).
 * Call after onboarding, updateClientConfig, or any config mutation.
 */
export function invalidateConfigCache(slug?: string): void {
    if (slug) {
        configCache.delete(slug)
    } else {
        configCache.clear()
    }
}

import { createClient } from "@/supabase/server"

/**
 * Get metadata for all available active clients (for dashboard dropdowns)
 * Lightweight — doesn't load full configs. Only loads allowed projects (RBAC).
 * Non-super-admins see only clients linked via user_clients join table.
 */
export async function getAvailableClients(): Promise<ClientMeta[]> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return []

    if (isSuperAdmin(user.email)) {
        // Super admin sees everything
        const { data, error } = await supabaseAdmin
            .from("clients")
            .select("slug, name, website")
            .eq("is_active", true)

        if (error || !data) return []
        return data.map(client => ({
            id: client.slug,
            name: client.name,
            icon: "📱",
            description: client.website || ""
        }))
    }

    // Normal user: join through user_clients
    const { data: links } = await supabaseAdmin
        .from("user_clients")
        .select("client_id")
        .eq("user_id", user.id)

    if (!links || links.length === 0) return []

    const clientIds = links.map(l => l.client_id)
    const { data, error } = await supabaseAdmin
        .from("clients")
        .select("slug, name, website")
        .eq("is_active", true)
        .in("id", clientIds)

    if (error || !data) return []
    return data.map(client => ({
        id: client.slug,
        name: client.name,
        icon: "📱",
        description: client.website || ""
    }))
}

/**
 * Get list of available config names (slugs)
 */
export async function getAvailableConfigNames(): Promise<string[]> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return []

    if (isSuperAdmin(user.email)) {
        const { data, error } = await supabaseAdmin
            .from("clients")
            .select("slug")
            .eq("is_active", true)

        if (error || !data) return []
        return data.map(row => row.slug)
    }

    // Normal user: join through user_clients
    const { data: links } = await supabaseAdmin
        .from("user_clients")
        .select("client_id")
        .eq("user_id", user.id)

    if (!links || links.length === 0) return []

    const clientIds = links.map(l => l.client_id)
    const { data, error } = await supabaseAdmin
        .from("clients")
        .select("slug")
        .eq("is_active", true)
        .in("id", clientIds)

    if (error || !data) return []
    return data.map(row => row.slug)
}

/**
 * Get pillar name for a given post type from config
 */
export function getPillarForPostType(config: ClientConfig, postType: string): string | null {
    if (!config.contentPillars) return null
    for (const [pillar, pillarConfig] of Object.entries(config.contentPillars)) {
        if (pillarConfig.postTypes && pillarConfig.postTypes.includes(postType)) {
            return pillar
        }
    }
    return null
}

/**
 * Resolve a client slug (e.g. "mobilnamiru") to its uuid primary key.
 * Cached per process to avoid repeated DB lookups.
 */
export async function resolveClientId(slug: string): Promise<string> {
    const cached = clientIdCache.get(slug)
    if (cached) return cached

    const { data, error } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("slug", slug)
        .single()

    if (error || !data) {
        throw new Error(`Client "${slug}" not found in DB: ${error?.message || "No data"}`)
    }

    clientIdCache.set(slug, data.id)
    return data.id
}
