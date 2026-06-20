/**
 * Domain event subscribers.
 * =========================
 * Importing this module registers all event→reaction handlers. The emit caller
 * imports it once before emitting so handlers are guaranteed registered.
 *
 * Fáze 4 migrates the existing metrics→learning fire-and-forget onto the seam,
 * with identical behavior: on `metrics.updated` run the same
 * propagateMetricsToSources + analyzeAndLearn the metrics path used to call
 * directly. Future reactions (ops agents) register here too.
 */

import { on, type DomainEvent } from "@/lib/events"

on("metrics.updated", async (event: DomainEvent) => {
    const clientId = event.clientId
    if (!clientId) return

    // 1) Propagate metrics to idea/review performance scores (weighted selection).
    try {
        const { propagateMetricsToSources } = await import("@/instagram/service")
        const { ideasUpdated, reviewsUpdated } = await propagateMetricsToSources(clientId)
        if (ideasUpdated > 0 || reviewsUpdated > 0) {
            console.log(`📊 Metrics propagated: ${ideasUpdated} ideas, ${reviewsUpdated} reviews`)
        }
    } catch (err) {
        console.warn("⚠️ propagateMetricsToSources failed (non-fatal):", (err as Error)?.message)
    }

    // 2) Learn brand-memory patterns from the updated metrics.
    const learnData = (event.payload?.learnData as unknown[]) || []
    if (learnData.length > 0) {
        try {
            const { analyzeAndLearn } = await import("@/instagram/memory-agent")
            const result = await analyzeAndLearn(learnData as never, clientId)
            if (result.memoriesCreated > 0 || result.memoriesUpdated > 0) {
                console.log(`🧠 Learning triggered: ${result.memoriesCreated} new memories, ${result.memoriesUpdated} updated`)
            }
        } catch (err) {
            console.warn("⚠️ Learning trigger failed (non-fatal):", (err as Error)?.message)
        }
    }
})

export {} // side-effect module
