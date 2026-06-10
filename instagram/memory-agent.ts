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

/**
 * Get the most confident brand memories for a client.
 * These are injected into the Copywriter's mega prompt as context.
 */
export async function getBrandMemories(limit = 10): Promise<BrandMemory[]> {
    const { data, error } = await supabaseAdmin
        .from("ig_brand_memory")
        .select("*")
        .eq("client_id", getActiveProject())
        .gte("confidence", 0.4) // Only include reasonably confident memories
        .order("confidence", { ascending: false })
        .limit(limit)

    if (error) {
        console.warn("⚠️ Failed to load brand memories:", error.message)
        return []
    }

    return (data || []) as BrandMemory[]
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
 * Analyze image prompts from top/bottom posts to extract visual rules.
 * Stores results as memory_type = 'visual' in ig_brand_memory.
 * Called from analyzeAndLearn() — Phase 2 pass.
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
        .select("id, image_prompt, image_style, likes, saves")
        .in("id", allIds)
        .not("image_prompt", "is", null)

    if (!posts || posts.length < 2) return { created: 0, updated: 0 }

    const topSet = new Set(topPostIds)
    const topImages = posts.filter(p => topSet.has(p.id))
    const bottomImages = posts.filter(p => !topSet.has(p.id))

    if (topImages.length === 0) return { created: 0, updated: 0 }

    const visualPrompt = `
Jsi specialista na vizuální analýzu Instagramu. Analyzuj image prompty těchto postů.

## VIZUÁLNĚ ÚSPĚŠNÉ POSTY (vysoké saves a engagement):
${topImages.map((p, i) => `${i + 1}. "${(p.image_prompt || "").substring(0, 200)}" | Saves: ${p.saves || 0}`).join("\n")}

${bottomImages.length > 0 ? `## VIZUÁLNĚ SLABÉ POSTY:
${bottomImages.map((p, i) => `${i + 1}. "${(p.image_prompt || "").substring(0, 150)}"`).join("\n")}` : ""}

Extrahuj max 2 konkrétní vizuální pravidla (osvětlení, kompozice, barvy, styl, prostředí).
Např.: "Tmavé pozadí s neon reflexy má 2x vyšší saves než světlé scény"

Vrať POUZE validní JSON pole:
[
  { "content": "pravidlo česky", "confidence": 0.5-0.9 }
]
`

    try {
        const raw = await ai.models.generateContent({
            model: "gemini-3.5-flash",
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
            model: "gemini-3.5-flash",
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
            model: "gemini-3.5-flash",
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
