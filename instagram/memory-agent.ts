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
            model: "gemini-3.1-pro-preview",
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
    }[]
): Promise<{ memoriesCreated: number; memoriesUpdated: number }> {
    if (posts.length < 3) {
        console.log("   ℹ️ Need at least 3 posts with metrics to learn")
        return { memoriesCreated: 0, memoriesUpdated: 0 }
    }

    const clientId = getActiveProject()

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
            model: "gemini-3.1-pro-preview",
            contents: analysisPrompt,
            config: { responseMimeType: "application/json" },
        })

        const text = raw.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        const learnings = JSON.parse(jsonMatch?.[0] || "[]") as { type: string; content: string; confidence: number }[]

        for (const learning of learnings) {
            if (!learning.content || !learning.type) continue

            const keywordMatch = learning.content.split(" ").slice(0, 3).join(" ")
            const { data: existing } = await supabaseAdmin
                .from("ig_brand_memory")
                .select("id, confidence, times_confirmed, source_post_ids")
                .eq("client_id", clientId)
                .eq("memory_type", learning.type)
                .ilike("content", `%${keywordMatch}%`)
                .limit(1)

            const sourceIds = [...topPosts, ...bottomPosts].map(p => p.id)

            if (existing && existing.length > 0) {
                const mem = existing[0]
                const newConfidence = Math.min(1, mem.confidence + 0.1)
                const mergedSources = [...new Set([...(mem.source_post_ids || []), ...sourceIds])]

                await supabaseAdmin
                    .from("ig_brand_memory")
                    .update({
                        confidence: newConfidence,
                        times_confirmed: mem.times_confirmed + 1,
                        source_post_ids: mergedSources.slice(-20),
                    })
                    .eq("id", mem.id)

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

    return { memoriesCreated: created, memoriesUpdated: updated }
}
