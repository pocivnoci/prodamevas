/**
 * Generátor ukázky pro prospekta
 * ==============================
 * Z URL firmy vyrobí skutečné příspěvky její značkou — bez zakládání klienta.
 *
 * **Prospekt NIKDY nesmí skončit řádkem v `clients`.** Ta tabulka je kořen
 * multi-tenancy; zanést do ní stovky firem, které o nás nevědí, rozbije počty,
 * audity, účtování i izolaci tenantů. Ověřeno, že to jde bez toho:
 *
 *   - `generateConfigCore()` vrací `ClientConfig` V PAMĚTI, neukládá ho
 *   - `generateDesignBrief()` bere `visualMemoriesSection` parametrem, takže se
 *     při prázdné hodnotě nesáhne na `ig_brand_memory` ani na `clientId`
 *
 * Klientem se firma stane, až se sama zaregistruje.
 *
 * Cena podle měření z 2026-08-10: jeden obrázkový příspěvek ≈ 6 Kč (obraz $0,134
 * + text a uvažování). Tři příspěvky ≈ 18 Kč na prospekta.
 */

import supabaseAdmin from "@/supabase/admin"
import { generateTextQuality, generateImageWithReferences } from "@/instagram/gemini-client"
import { getModel, hasFallback, getTemperature } from "@/instagram/models"
import { buildMegaPrompt, buildCaptionSchema, getPostFormat } from "@/instagram/caption-generator"
import { generateDesignBrief, buildNativeImagePrompt } from "@/instagram/image-pipeline"
import { generateConfigCore } from "@/app/onboarding/core"
import { scrapeBrandBasics, type BrandBasics } from "./brand-scrape"
import type { ClientConfig } from "@/instagram/configs/types"
import type { WebsiteAnalysis } from "@/app/onboarding/actions"
import type { PostType } from "@/instagram/types"
import type { PerformanceInsight } from "@/instagram/performance"

/** Sdílený bucket pro ukázky. Prospekt nemá vlastní, protože nemá tenanta. */
export const PREVIEW_BUCKET = "ig-previews"

export interface PreviewPost {
    hook: string
    body: string
    cta: string
    hashtags: string[]
    imageUrl: string
}

export interface PreviewResult {
    brand: BrandBasics
    /** Konfigurace vyrobená jen pro tuhle ukázku — nikam se neukládá. */
    config: ClientConfig
    posts: PreviewPost[]
    costCzk: number
}

/** Prázdný výkon — prospekt žádná historická data nemá. */
const NO_PERF: PerformanceInsight = {
    bestPostTypes: [], bestHooks: [], bestTimeSlots: [], avgEngagement: 0,
    topPatterns: [], conversionRate: 0, bestConvertingTypes: [],
}

/**
 * Ze staženého webu udělá `WebsiteAnalysis` — tvar, který onboarding používá dál.
 * Jedno volání modelu; `responseSchema` je whitelist, takže co tu není, model
 * nevrátí (viz pravidlo „schéma a prompt se mění SPOLU").
 */
async function analyzeBrand(b: BrandBasics): Promise<WebsiteAnalysis> {
    const schema = {
        type: "OBJECT" as any,
        properties: {
            companyName: { type: "STRING" as any },
            description: { type: "STRING" as any, description: "2 věty česky: co firma dělá a pro koho" },
            industry: { type: "STRING" as any },
            brandTone: { type: "STRING" as any, description: "3-5 slov česky" },
            targetAudience: { type: "STRING" as any, description: "1 věta česky" },
            uniqueSellingPoints: { type: "ARRAY" as any, items: { type: "STRING" as any } },
            products: {
                type: "ARRAY" as any,
                items: {
                    type: "OBJECT" as any,
                    properties: { name: { type: "STRING" as any }, type: { type: "STRING" as any } },
                    required: ["name", "type"],
                },
            },
        },
        required: ["companyName", "description", "industry", "brandTone", "targetAudience", "uniqueSellingPoints", "products"],
    }

    const prompt = `Analyzuj tuhle firmu z jejího webu. Odpovídej ČESKY a jen podle toho, co v textu skutečně je —
nic si nedomýšlej. Když něco nevíš, napiš to obecně, ale nevymýšlej fakta.

WEB: ${b.url}
TITULEK: ${b.title ?? "—"}
POPIS: ${b.description ?? "—"}
TEXT ZE STRÁNKY:
${b.text.slice(0, 3000)}`

    const models = [getModel("text")]
    if (hasFallback("text")) models.push(getModel("text", "fallback"))
    const raw = await generateTextQuality(prompt, {
        models, responseSchema: schema, temperature: getTemperature("creative"), label: "preview:analyza",
    })
    const parsed = JSON.parse(raw)

    const [primary, secondary, accent] = [...b.colors, "#111111", "#f5f5f5", "#e63946"]
    return {
        companyName: parsed.companyName || b.title || b.url,
        description: parsed.description || "",
        industry: parsed.industry || "",
        products: (parsed.products || []).map((p: any) => ({
            name: p.name, type: p.type || "product",
            slug: String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        })),
        brandTone: parsed.brandTone || "",
        colors: { primary, secondary, accent },
        targetAudience: parsed.targetAudience || "",
        uniqueSellingPoints: parsed.uniqueSellingPoints || [],
        existingContent: [],
        logoUrl: b.logo ?? undefined,
        brandImageUrls: b.image ? [b.image] : [],
    } as WebsiteAnalysis
}

/** Nahraje obrázek do sdíleného bucketu a vrátí veřejnou URL. */
async function uploadPreview(buf: Buffer, key: string): Promise<string> {
    const { error } = await supabaseAdmin.storage
        .from(PREVIEW_BUCKET)
        .upload(key, buf, { contentType: "image/webp", cacheControl: "31536000", upsert: true })
    if (error) throw new Error(`upload ukázky selhal: ${error.message}`)
    return supabaseAdmin.storage.from(PREVIEW_BUCKET).getPublicUrl(key).data.publicUrl
}

/**
 * Vyrobí ukázku. `count` příspěvků, každý ≈ 6 Kč.
 *
 * Selhání jednoho příspěvku nezhodí celou ukázku — lepší dva příspěvky než nic.
 */
export async function generatePreview(opts: {
    website: string
    igHandle?: string
    count?: number
    token: string
    onProgress?: (step: string) => void
}): Promise<PreviewResult> {
    const count = Math.max(1, Math.min(3, opts.count ?? 3))
    const say = opts.onProgress ?? (() => {})

    say("stahuji web")
    const brand = await scrapeBrandBasics(opts.website)
    if (!brand) throw new Error(`web ${opts.website} se nepodařilo načíst`)

    say("analyzuji značku")
    const analysis = await analyzeBrand(brand)

    say("skládám konfiguraci")
    // V PAMĚTI — nikdy se neukládá do `clients`.
    const config = await generateConfigCore(analysis, {}, brand.url, opts.igHandle ?? "")

    const typeName = config.postTypes?.[0] ?? "tip"
    const def = config.postTypeDefs?.find(d => d.name === typeName)
    const postType = {
        id: "preview", name: typeName,
        display_name: (def as any)?.displayName ?? typeName,
        emoji: (def as any)?.emoji ?? "📱", description: (def as any)?.description ?? "",
        frequency: "weekly",
    } as unknown as PostType

    const posts: PreviewPost[] = []
    let costCzk = 0
    const usedHooks: string[] = []

    for (let i = 0; i < count; i++) {
        try {
            say(`píšu příspěvek ${i + 1}/${count}`)
            const megaPrompt = buildMegaPrompt(config, postType, null, null, usedHooks, NO_PERF)
            const models = [getModel("textPro")]
            if (hasFallback("textPro")) models.push(getModel("textPro", "fallback"))
            const captionRaw = await generateTextQuality(megaPrompt, {
                models, responseSchema: buildCaptionSchema(config),
                temperature: getTemperature("copywriter"), label: `preview:caption${i + 1}`,
            })
            const caption = JSON.parse(captionRaw)
            usedHooks.push(caption.hook)

            say(`kreslím příspěvek ${i + 1}/${count}`)
            const brief = await generateDesignBrief({
                config, clientId: "", postType: typeName, recentBriefs: [],
                // Prázdný řetězec ZÁMĚRNĚ: brání sáhnutí na ig_brand_memory, které
                // prospekt nemá. `??` v image-pipeline reaguje jen na null/undefined.
                visualMemoriesSection: "",
                captionData: {
                    hook: caption.hook, imageSubtext: caption.imageSubtext,
                    imagePrompt: caption.imagePrompt, body: caption.body,
                    accentWords: caption.accentWords,
                },
            })

            const format = getPostFormat(config, typeName)
            const imgPrompt = buildNativeImagePrompt(brief, config)
            const buf = await generateImageWithReferences(imgPrompt, [], {
                aspectRatio: format.aspectRatio as any, resolution: "2K",
            })
            const url = await uploadPreview(buf, `${opts.token}/${i + 1}.webp`)
            costCzk += 6

            posts.push({
                hook: caption.hook, body: caption.body, cta: caption.cta,
                hashtags: caption.hashtags ?? [], imageUrl: url,
            })
        } catch (err: any) {
            // Dva příspěvky jsou pořád ukázka; nula není.
            console.warn(`⚠️ ukázka: příspěvek ${i + 1} selhal — ${err?.message?.slice(0, 140)}`)
        }
    }

    if (posts.length === 0) throw new Error("nepodařilo se vygenerovat ani jeden příspěvek")
    return { brand, config, posts, costCzk }
}
