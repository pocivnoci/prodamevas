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
import supabaseAdmin from "@/supabase/admin"

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

    // 1b) Rozhodnuté A/B souboje → preference značky. Duely se počítaly jen pro
    // Výkon tab a věta pro zákazníka („Chrlit s tím počítá při psaní dalších
    // příspěvků") nebyla pravda: learnFromVariantSelection se volal jen na lidský
    // tip před publikací, nikdy na naměřený výsledek. Jedno volání modelu na
    // NOVĚ rozhodnutý duel; už zpracovaný pár se pozná podle source_post_ids.
    try {
        const { data: rows } = await supabaseAdmin
            .from("ig_posts")
            .select("id, caption, image_url, status, posted_at, likes, comments, saves, link_type, revision_of")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(200)
        const { buildDuels } = await import("@/lib/ab-duel")
        const decided = buildDuels((rows || []) as never).filter(d => d.verdict === "rozhodnuto" && d.winner)
        if (decided.length > 0) {
            const { learnFromVariantSelection } = await import("@/instagram/memory-agent")
            let learned = 0
            for (const d of decided.slice(0, 3)) {
                const winner = d.winner === "variant" ? d.variant : d.original
                const loser = d.winner === "variant" ? d.original : d.variant
                const { count } = await supabaseAdmin
                    .from("ig_brand_memory")
                    .select("id", { count: "exact", head: true })
                    .eq("client_id", clientId)
                    .contains("source_post_ids", [winner.id, loser.id])
                if (count && count > 0) continue // tenhle souboj už paměť zná
                const { memoriesCreated } = await learnFromVariantSelection(winner.id, [loser.id], clientId)
                learned += memoriesCreated
            }
            if (learned > 0) console.log(`🥊 A/B souboje: ${learned} nových preferencí z naměřených vítězů`)
        }
    } catch (err) {
        console.warn("⚠️ učení z A/B soubojů selhalo (non-fatal):", (err as Error)?.message)
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
