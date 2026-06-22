/**
 * Config Loader & Client Registry (Dynamic via Supabase)
 * ======================================================
 * Central registry of all available clients. Fetches from DB.
 */

import supabaseAdmin from "../../supabase/admin"
import type { ClientConfig } from "./types"

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
function validateConfig(config: ClientConfig, slug: string): ClientConfig {
    return {
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
        ctaStrategies: config.ctaStrategies || { soft: [], medium: [], hard: [], none: [] },
        feedAesthetic: config.feedAesthetic || {
            colorPalette: "Neutrální",
            overlayOpacity: "30%",
            textPosition: "BOTTOM",
            font: "Inter",
            feel: "Moderní a čistý",
            phoneModel: "iPhone 16 Pro",
        },
        weekPlan: config.weekPlan || [],
        // Keep the three per-client format sources defaulted (never undefined) so
        // ensurePostTypes/getIGPostTypes can't silently no-op on a half-filled config.
        postTypes: config.postTypes || [],
        postFormats: config.postFormats || {},
        postTypeDefs: config.postTypeDefs || [],
        hashtagPools: config.hashtagPools || { core: [], niche: [], broad: [], trending: [], czech: [] },
        contentFocus: config.contentFocus || config.name || slug,
        visualEngine: config.visualEngine || "native",
        videoTier: config.videoTier || "fast",
        psychologist: config.psychologist ?? true,
        // igBaseline is optional with no default — undefined means "no scrape
        // data available" and all consumers (planWeek) must handle that.
        igBaseline: config.igBaseline,
    }
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
