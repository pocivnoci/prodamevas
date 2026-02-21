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

// ─── Caches ──────────────────────────────────────────────────────────
// Avoid repeated lookups in the same process lifecycle.

const configCache = new Map<string, ClientConfig>()
const clientIdCache = new Map<string, string>() // slug → uuid

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Load client config by name (cached)
 * @param name - Config slug (mobilnamiru, hanzfans, etc.)
 */
export async function loadConfig(name: string = "mobilnamiru"): Promise<ClientConfig> {
    const cached = configCache.get(name)
    if (cached) return cached

    const { data, error } = await supabaseAdmin
        .from("clients")
        .select("config")
        .eq("slug", name)
        .single()

    if (error || !data) {
        throw new Error(`Failed to load config "${name}" from Supabase: ${error?.message || "Not found"}`)
    }

    const config = data.config as ClientConfig
    configCache.set(name, config)
    return config
}

/**
 * Get metadata for all available active clients (for dashboard dropdowns)
 * Lightweight — doesn't load full configs.
 */
export async function getAvailableClients(): Promise<ClientMeta[]> {
    const { data, error } = await supabaseAdmin
        .from("clients")
        .select("slug, name, website")
        .eq("is_active", true)

    if (error || !data) return []

    return data.map(client => ({
        id: client.slug,
        name: client.name,
        icon: "📱", // Default icon
        description: client.website || ""
    }))
}

/**
 * Get list of available config names
 */
export async function getAvailableConfigNames(): Promise<string[]> {
    const { data, error } = await supabaseAdmin
        .from("clients")
        .select("slug")
        .eq("is_active", true)

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
