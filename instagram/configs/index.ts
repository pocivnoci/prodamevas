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

import { createClient } from "@/supabase/server"

/**
 * Get metadata for all available active clients (for dashboard dropdowns)
 * Lightweight — doesn't load full configs. Only loads allowed projects (RBAC).
 */
export async function getAvailableClients(): Promise<ClientMeta[]> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    let query = supabaseAdmin
        .from("clients")
        .select("slug, name, website")
        .eq("is_active", true)

    if (user) {
        const isSuperAdmin = ["honza.poc@gmail.com", "hanzfans.cz@gmail.com", "honza@hanzfans.cz"].includes(user.email || "")
        if (!isSuperAdmin) {
            query = query.eq("user_id", user.id)
        }
    } else {
        // Unauthenticated -> no clients
        return []
    }

    const { data, error } = await query

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
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    let query = supabaseAdmin
        .from("clients")
        .select("slug")
        .eq("is_active", true)

    if (user) {
        const isSuperAdmin = ["honza.poc@gmail.com", "hanzfans.cz@gmail.com", "honza@hanzfans.cz"].includes(user.email || "")
        if (!isSuperAdmin) {
            query = query.eq("user_id", user.id)
        }
    } else {
        return []
    }

    const { data, error } = await query

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
