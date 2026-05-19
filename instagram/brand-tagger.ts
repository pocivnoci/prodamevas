/**
 * Brand Image Tagger
 * ==================
 * Uses Gemini to analyze brand photos and generate:
 * - tags: what the image shows (exterior, interior, bedroom, pool, etc.)
 * - description: one-sentence Czech description
 * 
 * Used during onboarding, rescan, and manual upload to build
 * a searchable library of brand assets for intelligent post generation.
 */

import { GoogleGenAI } from "@google/genai"
import type { BrandImage } from "./configs/types"

const VALID_TAGS = [
    "exterior", "interior", "bedroom", "bathroom", "kitchen", "living",
    "pool", "restaurant", "team", "product", "logo", "food", "nature",
    "detail", "lobby", "garden", "terrace", "parking", "view", "sport",
    "wellness", "bar", "conference", "office", "shop", "warehouse",
] as const

/**
 * Analyze a brand image and return tags + description.
 * Uses Gemini Flash (cheap, fast) with vision to understand what the image shows.
 */
export async function tagBrandImage(
    imageBuffer: Buffer,
    mimeType: string = "image/jpeg",
    brandName?: string,
): Promise<{ tags: string[]; description: string }> {
    try {
        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) return { tags: [], description: "" }

        const ai = new GoogleGenAI({ apiKey })

        const prompt = `Analyzuj tento obrázek značky${brandName ? ` "${brandName}"` : ""}.

1. Popiš jednou krátkou větou v češtině co přesně je na obrázku (max 15 slov).
2. Přiřaď 1-3 tagy z tohoto seznamu: ${VALID_TAGS.join(", ")}

Odpověz PŘESNĚ v tomto formátu (nic jiného):
POPIS: [popis]
TAGY: [tag1, tag2]`

        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: [{
                role: "user",
                parts: [
                    {
                        inlineData: {
                            mimeType,
                            data: imageBuffer.toString("base64"),
                        },
                    },
                    { text: prompt },
                ],
            }],
            config: {
                temperature: 0.2,
            },
        })

        const text = response.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""

        // Parse response
        const descMatch = text.match(/POPIS:\s*(.+)/i)
        const tagsMatch = text.match(/TAGY:\s*(.+)/i)

        const description = descMatch?.[1]?.trim() || ""
        const rawTags = tagsMatch?.[1]?.trim().split(/[,\s]+/).map(t => t.trim().toLowerCase()) || []
        const tags = rawTags.filter(t => (VALID_TAGS as readonly string[]).includes(t))

        if (!description && tags.length === 0) {
            return { tags: ["detail"], description: "Obrázek značky" }
        }

        return { tags: tags.length > 0 ? tags : ["detail"], description }
    } catch (err) {
        console.warn(`⚠️ Image tagging failed: ${(err as Error).message?.substring(0, 80)}`)
        return { tags: [], description: "" }
    }
}

/**
 * Tag multiple brand images in sequence.
 * Returns BrandImage objects with metadata.
 */
export async function tagBrandImages(
    images: { url: string; buffer: Buffer; mimeType?: string }[],
    brandName?: string,
): Promise<BrandImage[]> {
    const results: BrandImage[] = []

    for (const img of images) {
        const { tags, description } = await tagBrandImage(
            img.buffer,
            img.mimeType || "image/jpeg",
            brandName,
        )
        results.push({ url: img.url, tags, description })
        if (tags.length > 0) {
            console.log(`   🏷️  ${tags.join(", ")} — ${description.substring(0, 50)}`)
        }
    }

    return results
}
