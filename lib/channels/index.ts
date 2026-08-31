/**
 * Channel adapter registry. Resolve a ChannelAdapter by (channel, transport).
 *
 * Two orthogonal axes:
 *   channel   — WHICH network (instagram, linkedin, …)
 *   transport — HOW we reach it (our own Meta app, or upload-post's approved one)
 *
 * Adding a network = implement ChannelAdapter + register it here.
 * Adding a way to reach an existing network = same, with a different transport.
 */

import type { Channel, ChannelAdapter, Transport } from "./types"
import { instagramAdapter } from "./instagram"
import { uploadPostAdapter } from "./uploadpost"

type RegistryKey = `${Channel}:${Transport}`

const key = (channel: Channel, transport: Transport): RegistryKey => `${channel}:${transport}`

const ADAPTERS: Partial<Record<RegistryKey, ChannelAdapter>> = {
    "instagram:meta": instagramAdapter,
    "instagram:uploadpost": uploadPostAdapter,
    // "linkedin:meta": linkedinAdapter,   // future
}

/**
 * Resolve the adapter for a connection.
 *
 * `transport` is REQUIRED and has no default on purpose — it comes off the
 * connection row. Defaulting it here would let an upload-post tenant fall through
 * to the Graph adapter, which would then send a profile username where a Graph
 * token belongs. Fail loudly instead.
 */
export function getChannelAdapter(channel: Channel, transport: Transport): ChannelAdapter {
    const adapter = ADAPTERS[key(channel, transport)]
    if (!adapter) {
        throw new Error(`No channel adapter registered for '${channel}' via transport '${transport}'.`)
    }
    return adapter
}

/** Every registered (channel, transport) pair. */
export function listAdapters(): { channel: Channel; transport: Transport }[] {
    return Object.keys(ADAPTERS).map(k => {
        const [channel, transport] = k.split(":") as [Channel, Transport]
        return { channel, transport }
    })
}

/** Distinct channels that have at least one transport registered. */
export function listChannels(): Channel[] {
    return [...new Set(listAdapters().map(a => a.channel))]
}

export * from "./types"
