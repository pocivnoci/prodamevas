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
