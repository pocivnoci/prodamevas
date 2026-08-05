/**
 * Memory Agent — Long-term Brand Learning
 * ========================================
 *
 * After each posted post gets performance metrics, the Memory Agent
 * analyzes WHY it worked (or didn't) and writes persistent rules
 * into ig_brand_memory. These rules feed back into the mega prompt
 * for future content generation.
 *
 * Memory Types:
 *   - pattern:    "Hooky ve formátu otázky mají 2.3x vyšší engagement"
 *   - preference: "Humor funguje lépe než edukace pro tuto značku"
 *   - avoid:      "Příliš dlouhé CTA (>20 slov) snižují konverze"
 *   - visual:     "Tmavé pozadí s neon úsvětem má 2x vyšší saves"
 */

import supabaseAdmin from "../supabase/admin"
import { ai } from "./gemini-client"
import { getModel } from "./models"
import { getActiveProject } from "./service"

// ============================================
// TYPES
// ============================================

export interface BrandMemory {
    id: string
    client_id: string
    memory_type: "pattern" | "preference" | "avoid" | "visual"
    content: string
    confidence: number
    source_post_ids: string[]
    times_confirmed: number
    created_at: string
}

// ============================================
// READ MEMORIES (for mega prompt injection)
// ============================================

export type MemoryType = BrandMemory["memory_type"]

/**
 * Get brand memories for a client — relevance-first (pipeline v2).
 * With a `topic`, memories are retrieved by embedding similarity to the topic
 * (plus the top-3 by confidence, which always ride along — global brand rules
 * stay standing), so the prompt gets guidance that matches what's being written
 * instead of the same top-N-by-confidence set every post. Without a topic, or
 * when embeddings are unavailable, falls back to confidence ordering (legacy).
 *
 * `types` filters BEFORE the limit, and that ordering is the whole point. Callers
 * used to fetch top-N across all types and filter afterwards — so once a client
 * accumulated 5 text memories with higher confidence, getVisualMemoriesSection got
 * an empty list forever and the AI Designer silently lost its visual memory section.
 * The reverse held for the copywriter: visual memories ate slots in a text prompt
 * that drops them. Filter in the query, not after it.
 */
export async function getBrandMemories(
    limit = 10,
    clientId?: string,
    pillar?: string,
    topic?: string,
    types?: MemoryType[],
): Promise<BrandMemory[]> {
    const cid = clientId ?? getActiveProject()
    const safePillar = pillar && /^[\w-]+$/.test(pillar) ? pillar : undefined
    const wantTypes = types?.length ? types : undefined

    if (topic) {
        try {
            // Self-heal: memories written since the last retrieval get vectors lazily
            // (same pattern as ensurePostTypes) — no per-insert-site wiring needed.
            await embedPendingMemories(cid)
            const { embedText } = await import("./gemini-client")
            const topicVec = await embedText(topic.substring(0, 500))
            const wanted = Math.max(1, limit - 3)
            const { data: relevant, error } = await supabaseAdmin.rpc("match_brand_memories", {
                p_client_id: cid,
                p_embedding: JSON.stringify(topicVec),
                // The RPC has no type parameter, so a type-filtered call over-fetches and
                // narrows in JS. Adding a param would mean a migration for a filter that
                // costs nothing here — the row count is bounded by pruneExcessMemories (25).
                p_match_count: wantTypes ? wanted * 3 : wanted,
                p_pillar: safePillar ?? null,
            })
            const matched = wantTypes
                ? ((relevant ?? []) as BrandMemory[]).filter(m => wantTypes.includes(m.memory_type)).slice(0, wanted)
                : ((relevant ?? []) as BrandMemory[])
            if (!error && matched.length > 0) {
                const confident = await getMemoriesByConfidence(cid, safePillar, 3, wantTypes)
                const seen = new Set(matched.map(m => m.id))
                const merged = [...matched, ...confident.filter(m => !seen.has(m.id))]
                console.log(`   🧲 Memory relevance: ${matched.length} k tématu + ${merged.length - matched.length} top-confidence`)
                return merged.slice(0, limit)
            }
        } catch (err: any) {
            console.warn(`⚠️ Relevance memory retrieval failed — fallback na confidence: ${err?.message?.substring(0, 80)}`)
        }
    }

    return getMemoriesByConfidence(cid, safePillar, limit, wantTypes)
}

/** Legacy retrieval: top-N by confidence, pillar-scoped (global NULL always included). */
async function getMemoriesByConfidence(
    clientId: string,
    safePillar: string | undefined,
    limit: number,
    types?: MemoryType[],
): Promise<BrandMemory[]> {
    let query = supabaseAdmin
        .from("ig_brand_memory")
        .select("*")
        .eq("client_id", clientId)
        .gte("confidence", 0.4) // Only include reasonably confident memories
    // Type scoping BEFORE the limit — see getBrandMemories' doc comment.
    if (types?.length) query = query.in("memory_type", types)
    // Pillar scoping: include global (NULL) memories PLUS any tagged for THIS pillar, so a
    // lesson learned in one pillar doesn't bleed into another. Regex-guarded upstream
    // (pillar keys are internal config slugs) so a stray value can't break the .or() filter.
    if (safePillar) query = query.or(`pillar.is.null,pillar.eq.${safePillar}`)
    const { data, error } = await query
        .order("confidence", { ascending: false })
        .limit(limit)

    if (error) {
        console.warn("⚠️ Failed to load brand memories:", error.message)
        return []
    }

    return (data || []) as BrandMemory[]
}

/**
 * Embed memories that don't have a vector yet (new writes from any learning path
 * — analyzeAndLearn, revisions, variants, critic insights, onboarding seed).
 * One batched call, best-effort — memory retrieval must survive embedding outages.
 */
export async function embedPendingMemories(clientId: string): Promise<number> {
    const { data: pending } = await supabaseAdmin
        .from("ig_brand_memory")
        .select("id, content")
        .eq("client_id", clientId)
        .is("embedding", null)
        .limit(50)
    if (!pending || pending.length === 0) return 0

    const { embedTexts } = await import("./gemini-client")
    const vectors = await embedTexts(pending.map(p => p.content))
    await Promise.all(pending.map((p, i) =>
        supabaseAdmin.from("ig_brand_memory").update({ embedding: JSON.stringify(vectors[i]) }).eq("id", p.id)
    ))
    console.log(`   🧲 Embedded ${pending.length} nových memories`)
    return pending.length
}

/**
 * Format text memories (pattern/preference/avoid) into a prompt section for Copywriter.
 * Visual memories are intentionally excluded here — they go to image-pipeline.ts instead.
 */
export function formatMemoriesForPrompt(memories: BrandMemory[]): string {
    const patterns = memories.filter(m => m.memory_type === "pattern")
    const preferences = memories.filter(m => m.memory_type === "preference")
    const avoids = memories.filter(m => m.memory_type === "avoid")

    if (patterns.length + preferences.length + avoids.length === 0) return ""

    let section = `\n## 🧠 BRAND MEMORY (Naučené vzorce z reálného výkonu)\n`

    if (patterns.length > 0) {
        section += `\n### ✅ Co funguje (${patterns.length} vzorů):\n`
        section += patterns.map(m => `- ${m.content} (confidence: ${(m.confidence * 100).toFixed(0)}%, potvrzen ${m.times_confirmed}×)`).join("\n")
    }

    if (preferences.length > 0) {
        section += `\n\n### 🎯 Preference značky:\n`
        section += preferences.map(m => `- ${m.content}`).join("\n")
    }

    if (avoids.length > 0) {
        section += `\n\n### ❌ VYHÝBEJ SE (nefunguje):\n`
        section += avoids.map(m => `- ${m.content}`).join("\n")
    }

    section += `\n\n⚠️ INSTRUKCE: Využij tyto vzorce jako základ. Nejsou dogma — kreativně je aplikuj.`

    return section
}

// ============================================
// GENERATION-TIME LEARNING (upsert + critic insights)
// ============================================

/**
 * Upsert-or-reinforce a single brand memory — the same dedup + confidence pattern
 * analyzeAndLearn uses: if a semantically-similar memory of the same type exists, bump its
 * confidence (+0.1) and times_confirmed; otherwise insert a new one. Factored out so
 * generation-time learners (below) reuse it without touching the metrics-driven loop.
 * Takes clientId explicitly (no getActiveProject) per the engine convention.
 */
export async function upsertMemory(
    clientId: string,
    memory: { type: "pattern" | "preference" | "avoid" | "visual"; content: string; confidence: number; sourcePostIds?: string[]; pillar?: string | null },
): Promise<void> {
    const content = memory.content.trim()
    if (!content) return

    const { data: sameType } = await supabaseAdmin
        .from("ig_brand_memory")
        .select("id, content, confidence, times_confirmed, source_post_ids, pillar")
        .eq("client_id", clientId)
        .eq("memory_type", memory.type)

    const srcIds = memory.sourcePostIds || []
    // Dedup WITHIN the same pillar scope — the same insight in two pillars stays two memories.
    const wantPillar = memory.pillar ?? null
    const match = (sameType || []).find(m => (m.pillar ?? null) === wantPillar && isSimilarMemory(m.content, content))

    if (match) {
        const newConfidence = Math.min(1, match.confidence + 0.1)
        const mergedSources = [...new Set([...(match.source_post_ids || []), ...srcIds])].slice(-20)
        await supabaseAdmin.from("ig_brand_memory").update({
            confidence: newConfidence,
            times_confirmed: (match.times_confirmed || 0) + 1,
            source_post_ids: mergedSources,
        }).eq("id", match.id)
    } else {
        await supabaseAdmin.from("ig_brand_memory").insert({
            client_id: clientId,
            memory_type: memory.type,
            content,
            confidence: Math.min(1, Math.max(0.2, memory.confidence)),
            source_post_ids: srcIds.slice(-10),
            pillar: wantPillar,
        })
    }
}

/**
 * Persist the Critic's recurring "fix" notes as low-confidence "avoid" memories so they
 * become standing rules instead of expiring after 5 posts (the open loop the audit found).
 * Seeded at 0.3 — BELOW the getBrandMemories retrieval threshold (0.4) — so a one-off fix
 * stays dormant; only a fix that RECURS across posts is reinforced (+0.1) until it crosses
 * 0.4 and gets injected into future copywriter prompts. Stale fixes decay back out on their
 * own. Non-fatal, fire-and-forget from the generation pipeline. Explicit clientId.
 */
export async function learnFromCriticInsights(
    clientId: string,
    fixItems: string[] | undefined,
    sourcePostId?: string,
    pillar?: string | null,
    max = 3,
): Promise<void> {
    try {
        const items = [...new Set(
            (fixItems || [])
                .map(f => (f || "").trim())
                .filter(f => f.length > 8 && !/^v[šs]e\s*ok/i.test(f)) // skip the "Vše OK" sentinel + noise
        )].slice(0, max)
        if (items.length === 0) return

        for (const content of items) {
            await upsertMemory(clientId, {
                type: "avoid",
                content,
                confidence: 0.3,
                sourcePostIds: sourcePostId ? [sourcePostId] : [],
                pillar: pillar ?? null,
            })
        }
        console.log(`   🧠 Persisted ${items.length} critic insight(s) → avoid memory (reinforced on recurrence)`)
    } catch (err: any) {
        console.warn("   ⚠️ learnFromCriticInsights failed (non-fatal):", err?.message)
    }
}

// ============================================
// POST TYPE BOOST (memory → post type selection)
// ============================================

/**
 * Scan memories for mentions of post types and return boost multipliers.
 * Used by autopilot.ts to weight post type selection based on what works.
 * Returns: { "behind_the_scenes": 1.5, "meme": 0.5, ... }
 */
export async function getPostTypeBoosts(availableTypes: string[]): Promise<Record<string, number>> {
    const memories = await getBrandMemories(15)
    const boosts: Record<string, number> = {}

    if (memories.length === 0) return boosts

    // Normalize type names for matching (e.g. "behind_the_scenes" → "behind the scenes")
    const typeNormalized = new Map<string, string>()
    for (const t of availableTypes) {
        typeNormalized.set(t.replace(/_/g, " ").toLowerCase(), t)
        typeNormalized.set(t.toLowerCase(), t)
    }

    for (const m of memories) {
        const contentLower = m.content.toLowerCase()
        for (const [normalized, original] of typeNormalized) {
            if (contentLower.includes(normalized)) {
                const boost = m.memory_type === "avoid"
                    ? -m.confidence * 0.3  // Penalize avoided types
                    : m.confidence * 0.4   // Boost successful types
                boosts[original] = (boosts[original] || 0) + boost
            }
        }
    }

    return boosts
}

// ============================================
// MEMORY LIFECYCLE (decay, dedup, pruning)
// ============================================

/**
 * Decay confidence of memories not confirmed in 60+ days.
 * Prevents stale patterns from dominating fresh insights.
 */
async function decayStaleMemories(clientId: string): Promise<number> {
    const threshold = new Date()
    threshold.setDate(threshold.getDate() - 60)

    const { data: stale } = await supabaseAdmin
        .from("ig_brand_memory")
        .select("id, confidence")
        .eq("client_id", clientId)
        .lt("updated_at", threshold.toISOString())
        .gte("confidence", 0.3)

    let decayed = 0
    for (const mem of stale || []) {
        const newConf = Math.max(0.2, mem.confidence - 0.15)
        await supabaseAdmin
            .from("ig_brand_memory")
            .update({ confidence: newConf })
            .eq("id", mem.id)
        decayed++
    }
    if (decayed > 0) console.log(`   📉 Decayed ${decayed} stale memories`)
    return decayed
}

/**
 * Prune excess memories — keep only top N by confidence.
 * Prevents prompt bloat from accumulating too many rules.
 */
async function pruneExcessMemories(clientId: string, maxMemories = 25): Promise<number> {
    const { data: all } = await supabaseAdmin
        .from("ig_brand_memory")
        .select("id")
        .eq("client_id", clientId)
        .order("confidence", { ascending: true })

    if (!all || all.length <= maxMemories) return 0

    const toDelete = all.slice(0, all.length - maxMemories)
    await supabaseAdmin
        .from("ig_brand_memory")
        .delete()
        .in("id", toDelete.map(m => m.id))

    console.log(`   🗑️ Pruned ${toDelete.length} low-confidence memories (cap: ${maxMemories})`)
    return toDelete.length
}

/**
 * Check if two memory contents are semantically similar.
 * Used to merge/deduplicate during learning.
 */
function isSimilarMemory(a: string, b: string): boolean {
    const normalize = (s: string) =>
        s.toLowerCase().replace(/[^\w\sáčďéěíňóřšťúůýž]/g, "").split(/\s+/).filter(w => w.length > 3)
    const wordsA = new Set(normalize(a))
    const wordsB = normalize(b)
    if (wordsA.size === 0 || wordsB.length === 0) return false
    const overlap = wordsB.filter(w => wordsA.has(w)).length
    return overlap / Math.max(wordsA.size, wordsB.length) > 0.5
}

// ============================================
// VISUAL PATTERN ANALYSIS (Phase 2)
// ============================================

/**
 * Analyze what the top/bottom posts actually LOOKED like and extract visual rules.
 * Stores results as memory_type = 'visual' in ig_brand_memory.
 * Called from analyzeAndLearn() — Phase 2 pass.
 *
 * Reads `design_brief`, not just `image_prompt`. In the native engine `image_prompt` is
 * the copywriter's raw idea for a text-free background ("NO TEXT in image") — it only
 * loosely influenced the render, while `design_brief` IS what Nano Banana was given:
 * layout archetype, typography placement, colour treatment. Correlating engagement with
 * the former could never produce the one rule that's directly actionable ("typography
 * lower-left saves 2× better"), because that fact wasn't in the data being analysed.
 */
async function analyzeVisualPatterns(
    clientId: string,
    topPostIds: string[],
    bottomPostIds: string[]
): Promise<{ created: number; updated: number }> {
    if (topPostIds.length === 0) return { created: 0, updated: 0 }

    const allIds = [...topPostIds, ...bottomPostIds].slice(0, 20)
    const { data: posts } = await supabaseAdmin
        .from("ig_posts")
        .select("id, image_prompt, image_style, design_brief, likes, saves")
        .in("id", allIds)
        .or("image_prompt.not.is.null,design_brief.not.is.null")

    if (!posts || posts.length < 2) return { created: 0, updated: 0 }

    const topSet = new Set(topPostIds)
    const topImages = posts.filter(p => topSet.has(p.id))
    const bottomImages = posts.filter(p => !topSet.has(p.id))

    if (topImages.length === 0) return { created: 0, updated: 0 }

    /** What the renderer was actually told — structured brief first, raw idea as fallback. */
    const describeVisual = (p: any, max: number): string => {
        const b = p.design_brief
        if (b) {
            const parts = [
                b.layoutArchetype && `layout: ${b.layoutArchetype}`,
                b.typography?.placement && `text: ${b.typography.placement}`,
                b.typography?.styleDescription && `typo: ${b.typography.styleDescription}`,
                b.colorTreatment && `barvy: ${String(b.colorTreatment).substring(0, 80)}`,
                b.composition && `scéna: ${String(b.composition).substring(0, max)}`,
            ].filter(Boolean)
            if (parts.length > 0) return parts.join(" | ")
        }
        return (p.image_prompt || "").substring(0, max)
    }

    const visualPrompt = `
Jsi specialista na vizuální analýzu Instagramu. Analyzuj, jak tyhle posty vypadaly.
Každý řádek popisuje SKUTEČNÉ zadání pro renderer: layout, umístění a styl typografie,
barevné ladění a scénu.

## VIZUÁLNĚ ÚSPĚŠNÉ POSTY (vysoké saves a engagement):
${topImages.map((p, i) => `${i + 1}. ${describeVisual(p, 200)} | Saves: ${p.saves || 0}`).join("\n")}

${bottomImages.length > 0 ? `## VIZUÁLNĚ SLABÉ POSTY:
${bottomImages.map((p, i) => `${i + 1}. ${describeVisual(p, 150)}`).join("\n")}` : ""}

Extrahuj max 2 konkrétní vizuální pravidla (layout, umístění typografie, osvětlení, kompozice, barvy, prostředí).
Např.: "Typografie v levém dolním rohu má 2x vyšší saves než centrovaná"
Např.: "Tmavé pozadí s neon reflexy má 2x vyšší saves než světlé scény"

Vrať POUZE validní JSON pole:
[
  { "content": "pravidlo česky", "confidence": 0.5-0.9 }
]
`

    try {
        const raw = await ai.models.generateContent({
            model: getModel("text"),
            contents: visualPrompt,
            config: { responseMimeType: "application/json" },
        })

        const text = raw.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        const learnings = JSON.parse(jsonMatch?.[0] || "[]") as { content: string; confidence: number }[]

        let created = 0
        let updated = 0

        for (const learning of learnings) {
            if (!learning.content) continue

            const keywordMatch = learning.content.split(" ").slice(0, 3).join(" ")
            const { data: existing } = await supabaseAdmin
                .from("ig_brand_memory")
                .select("id, confidence, times_confirmed")
                .eq("client_id", clientId)
                .eq("memory_type", "visual")
                .ilike("content", `%${keywordMatch}%`)
                .limit(1)

            if (existing && existing.length > 0) {
                const mem = existing[0]
                await supabaseAdmin
                    .from("ig_brand_memory")
                    .update({
                        confidence: Math.min(1, mem.confidence + 0.1),
                        times_confirmed: mem.times_confirmed + 1,
                    })
                    .eq("id", mem.id)
                updated++
                console.log(`   🖼️ Visual updated: "${learning.content}"`)
            } else {
                await supabaseAdmin
                    .from("ig_brand_memory")
                    .insert({
                        client_id: clientId,
                        memory_type: "visual",
                        content: learning.content,
                        confidence: Math.min(0.9, Math.max(0.4, learning.confidence || 0.5)),
                        source_post_ids: topPostIds.slice(0, 5),
                    })
                created++
                console.log(`   🖼️ Visual memory: "${learning.content}"`)
            }
        }

        return { created, updated }
    } catch (err: any) {
        console.warn("   ⚠️ Visual analysis failed:", err?.message)
        return { created: 0, updated: 0 }
    }
}

// ============================================
// ONBOARDING SEED (warm start from scraped IG feed)
// ============================================

/**
 * Seed brand memories from the onboarding IG scrape so a new tenant
 * doesn't start cold. Confidence 0.45 — above the 0.4 floor in
 * getBrandMemories() so the seeds are used, but low enough that real
 * post-performance learning (analyzeAndLearn) quickly outranks them.
 *
 * Only seeds when the client has NO memories yet (idempotent on re-save).
 */
export async function seedOnboardingMemories(
    clientId: string,
    seeds: { type: "pattern" | "visual"; content: string }[]
): Promise<number> {
    const valid = seeds.filter(s => s.content?.trim() && (s.type === "pattern" || s.type === "visual"))
    if (valid.length === 0) return 0

    const { count } = await supabaseAdmin
        .from("ig_brand_memory")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)

    if (count && count > 0) {
        console.log(`   🧠 Seed skipped — client already has ${count} memories`)
        return 0
    }

    const rows = valid.slice(0, 8).map(s => ({
        client_id: clientId,
        memory_type: s.type,
        content: s.content.startsWith("Z původního IG feedu") ? s.content : `Z původního IG feedu: ${s.content}`,
        confidence: 0.45,
        source_post_ids: [],
    }))

    const { error } = await supabaseAdmin.from("ig_brand_memory").insert(rows)
    if (error) throw error
    console.log(`   🧠 Seeded ${rows.length} onboarding memories (${rows.filter(r => r.memory_type === "visual").length} visual, ${rows.filter(r => r.memory_type === "pattern").length} pattern)`)
    return rows.length
}

// ============================================
// ANALYZE & LEARN (post-performance)
// ============================================

/**
 * Analyze a batch of posts with metrics and extract new learnings.
 * Phase 1: text patterns (hook/body/cta rules → pattern/preference/avoid)
 * Phase 2: visual patterns (image_prompt correlations → visual)
 *
 * Called via POST /api/ig-learn after entering post metrics.
 */
export async function analyzeAndLearn(
    posts: {
        id: string
        caption: string
        post_type_name?: string
        likes: number
        comments: number
        saves: number
        reach: number
        shares: number
        link_clicks: number
    }[],
    explicitClientId?: string
): Promise<{ memoriesCreated: number; memoriesUpdated: number }> {
    if (posts.length < 3) {
        console.log("   ℹ️ Need at least 3 posts with metrics to learn")
        return { memoriesCreated: 0, memoriesUpdated: 0 }
    }

    const clientId = explicitClientId || getActiveProject()

    // Calculate engagement scores
    const scored = posts.map(p => ({
        ...p,
        engagement: (p.likes || 0) + (p.comments || 0) * 3 + (p.saves || 0) * 5,
        conversionScore: (p.link_clicks || 0) * 10 + (p.saves || 0),
        hook: p.caption.split("\n")[0] || "",
    })).sort((a, b) => b.engagement - a.engagement)

    const avgEngagement = scored.reduce((s, p) => s + p.engagement, 0) / scored.length
    const topPosts = scored.filter(p => p.engagement > avgEngagement * 1.5)
    const bottomPosts = scored.filter(p => p.engagement < avgEngagement * 0.5)

    if (topPosts.length === 0 && bottomPosts.length === 0) {
        console.log("   ℹ️ No significant outliers — skipping learning")
        return { memoriesCreated: 0, memoriesUpdated: 0 }
    }

    // === Phase 1: Text pattern analysis ===
    const analysisPrompt = `
Jsi analytik Instagramu. Analyzuj tyto posty a identifikuj KONKRÉTNÍ vzorce.

## TOP POSTY (vysoký engagement):
${topPosts.map((p, i) => `${i + 1}. Hook: "${p.hook}" | Engagement: ${p.engagement} | Saves: ${p.saves} | Comments: ${p.comments}${p.post_type_name ? ` | Typ: ${p.post_type_name}` : ""}`).join("\n")}

## SLABÉ POSTY (nízký engagement):
${bottomPosts.map((p, i) => `${i + 1}. Hook: "${p.hook}" | Engagement: ${p.engagement} | Saves: ${p.saves} | Comments: ${p.comments}${p.post_type_name ? ` | Typ: ${p.post_type_name}` : ""}`).join("\n")}

## Průměrný engagement: ${avgEngagement.toFixed(0)}

Extrahuj max 3 pravidla. Každé pravidlo musí být:
- Konkrétní a akcionovatelné (ne obecné "buď kreativní")
- Založené na datech výše
- V češtině

Vrať POUZE validní JSON pole:
[
  { "type": "pattern"|"preference"|"avoid", "content": "pravidlo česky", "confidence": 0.5-1.0 }
]
`

    let created = 0
    let updated = 0

    try {
        const raw = await ai.models.generateContent({
            model: getModel("text"),
            contents: analysisPrompt,
            config: { responseMimeType: "application/json" },
        })

        const text = raw.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        const learnings = JSON.parse(jsonMatch?.[0] || "[]") as { type: string; content: string; confidence: number }[]

        for (const learning of learnings) {
            if (!learning.content || !learning.type) continue

            // Improved dedup: check all existing memories of same type for semantic similarity
            const { data: sameTypeMemories } = await supabaseAdmin
                .from("ig_brand_memory")
                .select("id, content, confidence, times_confirmed, source_post_ids")
                .eq("client_id", clientId)
                .eq("memory_type", learning.type)

            const sourceIds = [...topPosts, ...bottomPosts].map(p => p.id)
            const existingMatch = (sameTypeMemories || []).find(m => isSimilarMemory(m.content, learning.content))

            if (existingMatch) {
                const newConfidence = Math.min(1, existingMatch.confidence + 0.1)
                const mergedSources = [...new Set([...(existingMatch.source_post_ids || []), ...sourceIds])]

                await supabaseAdmin
                    .from("ig_brand_memory")
                    .update({
                        confidence: newConfidence,
                        times_confirmed: existingMatch.times_confirmed + 1,
                        source_post_ids: mergedSources.slice(-20),
                    })
                    .eq("id", existingMatch.id)

                updated++
                console.log(`   📝 Updated: "${learning.content}" (confidence: ${(newConfidence * 100).toFixed(0)}%)`)
            } else {
                await supabaseAdmin
                    .from("ig_brand_memory")
                    .insert({
                        client_id: clientId,
                        memory_type: learning.type,
                        content: learning.content,
                        confidence: Math.min(1, Math.max(0.3, learning.confidence || 0.5)),
                        source_post_ids: sourceIds.slice(-10),
                    })

                created++
                console.log(`   🧠 New memory: "${learning.content}" (${learning.type})`)
            }
        }
    } catch (err: any) {
        console.error("   ⚠️ Text memory analysis failed:", err?.message)
    }

    // === Phase 2: Visual pattern analysis ===
    console.log("   🖼️ Analyzing visual patterns...")
    const { created: vCreated, updated: vUpdated } = await analyzeVisualPatterns(
        clientId,
        topPosts.map(p => p.id),
        bottomPosts.map(p => p.id)
    )
    created += vCreated
    updated += vUpdated

    // === Phase 3: Memory lifecycle maintenance ===
    try {
        await decayStaleMemories(clientId)
        await pruneExcessMemories(clientId)
    } catch (lifecycleErr: any) {
        console.warn("   ⚠️ Memory lifecycle maintenance failed:", lifecycleErr?.message)
    }

    return { memoriesCreated: created, memoriesUpdated: updated }
}

// ============================================
// VARIANT SELECTION LEARNING
// ============================================

/**
 * Learn from A/B variant selection — compare winner vs losers
 * to extract user preference patterns (hook style, tone, CTA, visual).
 * Called from selectVariantWinner() in admin-actions.ts.
 */
export async function learnFromVariantSelection(
    winnerId: string,
    loserIds: string[],
    explicitClientId?: string
): Promise<{ memoriesCreated: number }> {
    const clientId = explicitClientId || getActiveProject()
    const allIds = [winnerId, ...loserIds]

    const { data: posts } = await supabaseAdmin
        .from("ig_posts")
        .select("id, caption, image_prompt, image_style")
        .in("id", allIds)

    if (!posts || posts.length < 2) return { memoriesCreated: 0 }

    const winner = posts.find(p => p.id === winnerId)
    const losers = posts.filter(p => p.id !== winnerId)

    if (!winner) return { memoriesCreated: 0 }

    const winnerHook = (winner.caption || "").split("\n")[0] || ""
    const winnerBody = (winner.caption || "").split("\n").slice(1, 4).join(" ").substring(0, 200)

    const loserSummaries = losers.map((l, i) => {
        const hook = (l.caption || "").split("\n")[0] || ""
        const body = (l.caption || "").split("\n").slice(1, 4).join(" ").substring(0, 200)
        return `ZAMÍTNUTÁ ${i + 1}:\n  Hook: "${hook}"\n  Body: "${body.substring(0, 100)}..."`
    }).join("\n\n")

    const prompt = `
Jsi analytik A/B testování pro Instagram. Uživatel vybral VÍTĚZE z variant.

## VÍTĚZ (uživatel preferoval):
Hook: "${winnerHook}"
Body: "${winnerBody}"

## ZAMÍTNUTÉ VARIANTY:
${loserSummaries}

Analyzuj PROČ uživatel vybral vítěze. Porovnej:
1. Styl hooku (otázka vs. tvrzení vs. číslo vs. provokace)
2. Tón (humor vs. edukace vs. urgence vs. empatie)
3. CTA styl (měkké vs. tvrdé)
4. Délku a strukturu

Extrahuj 1-2 konkrétní preference (ne obecné). Např.:
- "Uživatel preferuje otázkové hooky před tvrzeními"
- "Kratší body text (do 50 slov) je preferován před dlouhým vysvětlováním"

Vrať POUZE validní JSON pole:
[
  { "content": "preference česky", "confidence": 0.6 }
]
`

    try {
        const raw = await ai.models.generateContent({
            model: getModel("text"),
            contents: prompt,
            config: { responseMimeType: "application/json" },
        })

        const text = raw.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        const learnings = JSON.parse(jsonMatch?.[0] || "[]") as { content: string; confidence: number }[]

        let created = 0

        for (const learning of learnings) {
            if (!learning.content) continue

            // Check for duplicates
            const { data: existing } = await supabaseAdmin
                .from("ig_brand_memory")
                .select("id, content, confidence, times_confirmed")
                .eq("client_id", clientId)
                .eq("memory_type", "preference")

            const match = (existing || []).find(m => isSimilarMemory(m.content, learning.content))

            if (match) {
                await supabaseAdmin
                    .from("ig_brand_memory")
                    .update({
                        confidence: Math.min(1, match.confidence + 0.15),
                        times_confirmed: match.times_confirmed + 1,
                    })
                    .eq("id", match.id)
                console.log(`   🔀 Variant preference reinforced: "${learning.content}"`)
            } else {
                await supabaseAdmin
                    .from("ig_brand_memory")
                    .insert({
                        client_id: clientId,
                        memory_type: "preference",
                        content: learning.content,
                        confidence: Math.min(0.8, Math.max(0.5, learning.confidence || 0.6)),
                        source_post_ids: allIds,
                    })
                created++
                console.log(`   🔀 New variant preference: "${learning.content}"`)
            }
        }

        return { memoriesCreated: created }
    } catch (err: any) {
        console.warn(`⚠️ Variant learning failed: ${err?.message?.substring(0, 80)}`)
        return { memoriesCreated: 0 }
    }
}

/**
 * Learn from a user revision. When a user rewrites a post with explicit feedback,
 * that feedback is the highest-quality signal in the system — they told us exactly
 * what was wrong. The original caption is the rejected version; the feedback says
 * why. Extract an "avoid" or "preference" memory so the copywriter stops repeating
 * the mistake. Mirrors learnFromVariantSelection's dedup/confidence handling.
 */
export async function learnFromRevision(
    originalCaption: string,
    feedback: string,
    revisedCaption: string,
    sourcePostIds: string[],
    explicitClientId?: string
): Promise<{ memoriesCreated: number }> {
    const clientId = explicitClientId || getActiveProject()
    if (!feedback?.trim()) return { memoriesCreated: 0 }

    const origHook = (originalCaption || "").split("\n")[0] || ""
    const newHook = (revisedCaption || "").split("\n")[0] || ""

    const prompt = `
Jsi analytik značky pro Instagram. Uživatel ZAMÍTL původní verzi postu a dal KONKRÉTNÍ zpětnou vazbu, podle které jsme ho přepsali. Zpětná vazba uživatele je nejcennější signál — řekl nám přesně, co bylo špatně.

## PŮVODNÍ (zamítnutá) verze:
Hook: "${origHook}"
Text: "${(originalCaption || "").substring(0, 300)}"

## ZPĚTNÁ VAZBA UŽIVATELE (proč to bylo špatně):
"${feedback.substring(0, 400)}"

## PŘEPSANÁ (preferovaná) verze:
Hook: "${newHook}"

Extrahuj 1-2 konkrétní, trvalá ponaučení pro budoucí psaní — co se má DĚLAT (preference) nebo čemu se VYHNOUT (avoid). Buď konkrétní, ne obecný. Např.:
- avoid: "Nepoužívej klišé jako 'v dnešní uspěchané době'"
- preference: "Uživatel chce konkrétní čísla místo vágních tvrzení"

Vrať POUZE validní JSON pole:
[
  { "type": "avoid" | "preference", "content": "ponaučení česky", "confidence": 0.7 }
]
`

    try {
        const raw = await ai.models.generateContent({
            model: getModel("text"),
            contents: prompt,
            config: { responseMimeType: "application/json" },
        })

        const text = raw.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        const learnings = JSON.parse(jsonMatch?.[0] || "[]") as { type: string; content: string; confidence: number }[]

        let created = 0

        for (const learning of learnings) {
            if (!learning.content) continue
            const memoryType = learning.type === "avoid" ? "avoid" : "preference"

            const { data: existing } = await supabaseAdmin
                .from("ig_brand_memory")
                .select("id, content, confidence, times_confirmed")
                .eq("client_id", clientId)
                .eq("memory_type", memoryType)

            const match = (existing || []).find(m => isSimilarMemory(m.content, learning.content))

            if (match) {
                await supabaseAdmin
                    .from("ig_brand_memory")
                    .update({
                        confidence: Math.min(1, match.confidence + 0.15),
                        times_confirmed: match.times_confirmed + 1,
                    })
                    .eq("id", match.id)
                console.log(`   ✍️ Revision ${memoryType} reinforced: "${learning.content}"`)
            } else {
                await supabaseAdmin
                    .from("ig_brand_memory")
                    .insert({
                        client_id: clientId,
                        memory_type: memoryType,
                        content: learning.content,
                        confidence: Math.min(0.8, Math.max(0.5, learning.confidence || 0.65)),
                        source_post_ids: sourcePostIds,
                    })
                created++
                console.log(`   ✍️ New revision ${memoryType}: "${learning.content}"`)
            }
        }

        return { memoriesCreated: created }
    } catch (err: any) {
        console.warn(`⚠️ Revision learning failed: ${err?.message?.substring(0, 80)}`)
        return { memoriesCreated: 0 }
    }
}
