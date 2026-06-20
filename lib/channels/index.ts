/**
 * Channel adapter registry. Resolve a ChannelAdapter by channel id.
 * Adding a new channel = implement ChannelAdapter + register it here.
 */

import type { Channel, ChannelAdapter } from "./types"
import { instagramAdapter } from "./instagram"

const ADAPTERS: Partial<Record<Channel, ChannelAdapter>> = {
    instagram: instagramAdapter,
    // linkedin: linkedinAdapter,   // future
    // facebook: facebookAdapter,   // future
}

export function getChannelAdapter(channel: Channel = "instagram"): ChannelAdapter {
    const adapter = ADAPTERS[channel]
    if (!adapter) throw new Error(`No channel adapter registered for '${channel}'.`)
    return adapter
}

export function listChannels(): Channel[] {
    return Object.keys(ADAPTERS) as Channel[]
}

export * from "./types"
