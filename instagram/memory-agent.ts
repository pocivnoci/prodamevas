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
 *   - pattern: "Hooky ve formátu otázky mají 2.3x vyšší engagement"
 *   - preference: "Humor funguje lépe než edukace pro tuto značku"
 *   - avoid: "Příliš dlouhé CTA (>20 slov) snižují konverze"
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
    memory_type: "pattern" | "preference" | "avoid"
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
 * Format memories into a prompt section for the Copywriter.
 */
export function formatMemoriesForPrompt(memories: BrandMemory[]): string {
    if (memories.length === 0) return ""

    const patterns = memories.filter(m => m.memory_type === "pattern")
    const preferences = memories.filter(m => m.memory_type === "preference")
    const avoids = memories.filter(m => m.memory_type === "avoid")

    let section = `\n## 🧠 BRAND MEMORY (Naučené vzorce z reálného výkonu)\n`

    if (patterns.length > 0) {
        section += `\n### ✅ Co funguje (${patterns.length} vzorců):\n`
        section += patterns.map(m => `- ${m.content} (confidence: ${(m.confidence * 100).toFixed(0)}%, potvrzeno ${m.times_confirmed}×)`).join("\n")
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
// ANALYZE & LEARN (post-performance)
// ============================================

/**
 * Analyze a batch of posts with metrics and extract new learnings.
 * Called after metrics are entered (manually or via API).
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

    // Ask Gemini to extract patterns
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

    try {
        const raw = await ai.models.generateContent({
            model: "gemini-2.5-pro",
            contents: analysisPrompt,
            config: { responseMimeType: "application/json" },
        })

        const text = raw.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        const learnings = JSON.parse(jsonMatch?.[0] || "[]") as { type: string; content: string; confidence: number }[]

        let created = 0
        let updated = 0

        for (const learning of learnings) {
            if (!learning.content || !learning.type) continue

            // Check if similar memory already exists
            const { data: existing } = await supabaseAdmin
                .from("ig_brand_memory")
                .select("id, confidence, times_confirmed, source_post_ids")
                .eq("client_id", getActiveProject())
                .eq("memory_type", learning.type)
                .textSearch("content", learning.content.split(" ").slice(0, 3).join(" & "), { type: "plain" })
                .limit(1)

            const sourceIds = [...topPosts, ...bottomPosts].map(p => p.id)

            if (existing && existing.length > 0) {
                // Update existing memory — increase confidence
                const mem = existing[0]
                const newConfidence = Math.min(1, mem.confidence + 0.1)
                const mergedSources = [...new Set([...(mem.source_post_ids || []), ...sourceIds])]

                await supabaseAdmin
                    .from("ig_brand_memory")
                    .update({
                        confidence: newConfidence,
                        times_confirmed: mem.times_confirmed + 1,
                        source_post_ids: mergedSources.slice(-20), // Keep last 20
                    })
                    .eq("id", mem.id)

                updated++
                console.log(`   📝 Updated: "${learning.content}" (confidence: ${(newConfidence * 100).toFixed(0)}%)`)
            } else {
                // Create new memory
                await supabaseAdmin
                    .from("ig_brand_memory")
                    .insert({
                        client_id: getActiveProject(),
                        memory_type: learning.type,
                        content: learning.content,
                        confidence: Math.min(1, Math.max(0.3, learning.confidence || 0.5)),
                        source_post_ids: sourceIds.slice(-10),
                    })

                created++
                console.log(`   🧠 New memory: "${learning.content}" (${learning.type})`)
            }
        }

        return { memoriesCreated: created, memoriesUpdated: updated }
    } catch (err: any) {
        console.error("   ⚠️ Memory analysis failed:", err?.message)
        return { memoriesCreated: 0, memoriesUpdated: 0 }
    }
}
