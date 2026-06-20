/**
 * Domain event seam (core hardening Fáze 4).
 * ==========================================
 * A tiny in-process pub/sub over an append-only `domain_events` log. Producers
 * `emit()` named events at meaningful moments; subscribers (registered via `on()`)
 * react — typically by enqueuing an agent_task. This decouples triggers from
 * reactions and replaces ad-hoc waitUntil fire-and-forget with something named,
 * auditable, and replayable.
 *
 * Not a message broker — single-process dispatch with a durable log row. For
 * heavier needs, swap the dispatch for Vercel Queues later; the emit/on API stays.
 *
 * IMPORTANT: subscribers live in lib/events/subscribers.ts and must be imported
 * before emit() runs (the emit caller imports them) — otherwise an event is
 * logged but nothing reacts.
 */

import supabaseAdmin from "@/supabase/admin"

export interface DomainEvent {
    name: string
    clientId: string | null
    payload: Record<string, unknown>
}

export type EventHandler = (event: DomainEvent) => Promise<void> | void

const subscribers = new Map<string, EventHandler[]>()

/** Register a reaction to an event. Multiple handlers per event are allowed. */
export function on(name: string, handler: EventHandler): void {
    const list = subscribers.get(name) || []
    list.push(handler)
    subscribers.set(name, list)
}

/**
 * Emit an event: append to domain_events (durable) then dispatch to subscribers.
 * Handlers are error-isolated — one failing reaction never breaks the emit or the
 * other handlers. Returns once all handlers settle.
 */
export async function emit(
    name: string,
    opts: { clientId?: string | null; payload?: Record<string, unknown> } = {},
): Promise<void> {
    const event: DomainEvent = { name, clientId: opts.clientId ?? null, payload: opts.payload || {} }

    // Durable log first (best-effort — a logging hiccup must not block reactions).
    try {
        await supabaseAdmin.from("domain_events").insert({
            name: event.name,
            client_id: event.clientId,
            payload: event.payload,
        })
    } catch (err) {
        console.warn(`events: failed to log '${name}':`, (err as Error).message)
    }

    const handlers = subscribers.get(name) || []
    await Promise.all(
        handlers.map(h =>
            Promise.resolve()
                .then(() => h(event))
                .catch(err => console.warn(`events: handler for '${name}' failed:`, (err as Error).message)),
        ),
    )
}

/** Test/introspection helper. */
export function subscriberCount(name: string): number {
    return (subscribers.get(name) || []).length
}
