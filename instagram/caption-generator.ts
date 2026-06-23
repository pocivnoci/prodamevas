/**
 * Caption Generator for Instagram Autopilot
 * Schemas, mega prompt builder, config-driven helpers, quality gate.
 */

import { Type } from "@google/genai"
import { generateTextQuality } from "./gemini-client"
import { getModel, hasFallback } from "./models"
import type { ClientConfig, PostFormat } from "./configs/types"
import type { PostType, PostIdea, Review } from "./types"
import type { HookTemplate } from "./types"
import type { PerformanceInsight } from "./performance"
import { getPillarForType, createPillarMapper } from "./service"
import { buildPsychologistSection } from "./psychologist"

// ============================================
// COSTS
// ============================================

// Pricing as of June 2026 (verify against ai.google.dev/pricing on model changes):
// - Caption/critic/editorial run the Pro quality ladder (gemini-pro-latest → gemini-2.5-pro)
// - Gemini 3.1 Pro (AI Designer): $2.00/M input + $12/M output (~$0.03 per request)
// - Nano Banana Pro (gemini-3-pro-image, 2K): ~$0.134 per image — see instagram/models.ts
// - Veo 3.1: Lite ~$0.06/s · Fast $0.15/s · Standard $0.40/s
export const COSTS = {
    textGeneration: 0.025,
    promptRefinement: 0.025,
    designerBrief: 0.03,         // AI Designer (gemini-3.1-pro) structured design brief
    contextAgent: 0.025,         // 1× Gemini Flash for industry + local pulse
    imageGeneration: 0.134,      // Nano Banana Pro GA 2K
    imageQA: 0.01,               // flash vision verify (native engine)
    imageCorrectiveEdit: 0.134,  // corrective text/logo edit retry (native engine, worst case 1×)
    videoPerSecond: 0.15,        // @deprecated — use videoPerSecondByTier
    videoPerSecondByTier: { lite: 0.06, fast: 0.15, premium: 0.40 } as Record<"lite" | "fast" | "premium", number>,
    ttsVoiceover: 0.02,          // Gemini 3.1 Flash TTS (~$0.02 per request)
    perPost: 0.27,       // 3× text ($0.075) + context ($0.025) + designer ($0.03) + image ($0.134) + QA ($0.01)
    perCarousel: 0.75,   // 3× text + context + designer + 4× image ($0.536) + 4× QA + overhead
    perReel: 1.45,       // 3× text + context + Veo 3.1 Fast 8s ($1.20) + TTS ($0.02) + cover ($0.134) + QA
}

// ============================================
// FORMAT HELPERS
// ============================================

const DEFAULT_FORMAT: PostFormat = { aspectRatio: "4:5", medium: "image", overlayStyle: "default" }

export function getPostFormat(config: ClientConfig, typeName: string): PostFormat {
    // 1. Explicit per-type override (highest priority)
    if (config?.postFormats?.[typeName]) return config.postFormats[typeName]
    // 2. Convention-based: prefix determines medium
    if (typeName.startsWith("reel_")) return { aspectRatio: "9:16", medium: "reel", overlayStyle: "none" }
    if (typeName.startsWith("carousel_")) return { aspectRatio: "1:1", medium: "carousel", overlayStyle: "cover" }
    // 3. Client default format
    if (config?.defaultFormat) return config.defaultFormat
    return DEFAULT_FORMAT
}

// ─── Smart Overlay Rotation ─────────────────────────────────

type ImageOverlayStyle = "default" | "centered" | "top" | "split" | "editorial"

/** Map post type name patterns to suitable overlay layouts */
const OVERLAY_POOLS: { pattern: RegExp; styles: ImageOverlayStyle[] }[] = [
    // Educational/how-to → structured layouts
    { pattern: /tip|how_to|edukace|navod|tutorial|hack/i, styles: ["split", "top", "editorial"] },
    // Meme/humor → bold, impactful
    { pattern: /meme|humor|vtip|quote/i, styles: ["centered", "editorial"] },
    // Product/sales → classic with product visible
    { pattern: /product|produkt|drop|limitka|nabidka/i, styles: ["default", "split"] },
    // Engagement/question → attention-grabbing
    { pattern: /engage|anketa|otazka|poll|cta/i, styles: ["centered", "top", "editorial"] },
    // Behind the scenes/personal → editorial feel
    { pattern: /bts|behind|personal|story|pribehy/i, styles: ["editorial", "top", "centered"] },
    // Review/testimonial → clean readability
    { pattern: /recenze|review|testimonial/i, styles: ["split", "editorial", "centered"] },
    // Stats/data → bold typography
    { pattern: /stat|data|cisla|numbers/i, styles: ["centered", "editorial"] },
]

/** All available styles for fallback rotation */
const ALL_IMAGE_STYLES: ImageOverlayStyle[] = ["default", "centered", "top", "split", "editorial"]

/**
 * Select an overlay variant based on post type + avoid repeating the last used layout.
 * Only called for image posts — carousels use cover/step, reels use none.
 */
export function selectOverlayVariant(
    typeName: string,
    recentOverlayStyles: string[] = [],
): ImageOverlayStyle {
    // Find matching pool for this post type
    let pool: ImageOverlayStyle[] = ALL_IMAGE_STYLES
    for (const entry of OVERLAY_POOLS) {
        if (entry.pattern.test(typeName)) {
            pool = entry.styles
            break
        }
    }

    // Filter out the last 2 used styles to avoid visual repetition
    const recentSet = new Set(recentOverlayStyles.slice(0, 2))
    let candidates = pool.filter(s => !recentSet.has(s))

    // If all filtered out (small pool), use full pool
    if (candidates.length === 0) candidates = pool

    // Pick randomly from candidates
    const selected = candidates[Math.floor(Math.random() * candidates.length)]
    return selected
}

/**
 * Determine reel duration from config or convention.
 * Veo 3.1 supports 5-8s at 1080p.
 */
export function getReelDuration(typeName: string, config?: ClientConfig): number {
    // 1. Explicit per-type config
    const typeFormat = config?.postFormats?.[typeName]
    if (typeFormat?.reelDuration) return Math.min(8, Math.max(5, typeFormat.reelDuration))

    // 2. Default format config
    if (config?.defaultFormat?.reelDuration) return Math.min(8, Math.max(5, config.defaultFormat.reelDuration))

    // 3. Convention-based
    if (typeName.includes("short") || typeName.includes("quick")) return 5
    if (typeName.includes("long") || typeName.includes("tutorial")) return 8

    return 8
}

export const IDEA_COOLDOWN_DAYS = 90



export function getToneDescription(config: ClientConfig, postType: string): string {
    const tone = config.brandVoice.toneByPostType[postType]
    if (!tone) return ""

    const descriptions: string[] = []

    if (tone.humorLevel >= 4) descriptions.push("vtipný a hravý")
    else if (tone.humorLevel >= 2) descriptions.push("lehce humorný")
    else descriptions.push("vážný a seriózní")

    if (tone.urgencyLevel >= 4) descriptions.push("naléhavý")
    else if (tone.urgencyLevel >= 2) descriptions.push("motivující")
    else descriptions.push("klidný")

    if (tone.intimacyLevel >= 4) descriptions.push("osobní a blízký")
    else if (tone.intimacyLevel >= 2) descriptions.push("přátelský")
    else descriptions.push("profesionální")

    if (tone.educationalLevel >= 4) descriptions.push("vzdělávací s konkrétními fakty")
    else if (tone.educationalLevel >= 2) descriptions.push("informativní")
    else descriptions.push("zábavný")

    return descriptions.join(", ")
}

export function getHookTemplates(config: ClientConfig, postType: string, count: number = 3): HookTemplate[] {
    const applicable = config.brandVoice.hookTemplates.filter(
        template => template.bestFor.includes(postType)
    )
    return applicable.sort(() => Math.random() - 0.5).slice(0, count)
}

export function getRandomCTAs(config: ClientConfig, count: number = 3): string[] {
    return [...config.brandVoice.ctaVariations]
        .sort(() => Math.random() - 0.5)
        .slice(0, count)
}

// ============================================
// SCHEMAS
// ============================================

export function buildCaptionSchema(config: ClientConfig) {
    return {
        type: Type.OBJECT,
        properties: {
            hook: {
                type: Type.STRING,
                description: "First sentence that stops scrolling — bold, shocking (max 15 words). NO EMOJI in hook.",
            },
            body: {
                type: Type.STRING,
                description: `Main text (max 120 words). ${config.contentFocus}`,
            },
            cta: {
                type: Type.STRING,
                description: `Call to action — ideally points to ${config.website}`,
            },
            hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 relevant hashtags",
            },
            imagePrompt: {
                type: Type.STRING,
                description: "English prompt for Nano Banana Pro image generation. Create VARIED visuals — alternate between: (A) people in authentic situations with real emotions, (B) dramatic product/detail close-ups, (C) atmospheric environments/lifestyle scenes, (D) creative compositions with unexpected angles. NEVER repeat the same visual style twice in a row. Avoid boring static shots (laptop on desk, coffee on table). Style: photorealistic, editorial, cinematic lighting. NO TEXT in image. 2-3 sentences.",
            },
            imageSubtext: {
                type: Type.STRING,
                description: "Subtext below hook (benefit, max 8 words, Czech)",
            },
            accentWords: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "2-3 key words/phrases FROM the hook that should be visually highlighted (each 1-2 words, Czech, must be exact substring of hook)",
            },
        },
        required: ["hook", "body", "cta", "hashtags", "imagePrompt", "imageSubtext", "accentWords"],
    }
}

export function buildVideoSchema(config: ClientConfig) {
    return {
        type: Type.OBJECT,
        properties: {
            hook: {
                type: Type.STRING,
                description: "Opening problem/question (2-4 words, punchy, Czech). NO EMOJI.",
            },
            scenes: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        timeRange: {
                            type: Type.STRING,
                            description: "Time range for this scene (e.g. '0-2s', '2-5s', '5-8s')",
                        },
                        visual: {
                            type: Type.STRING,
                            description: "What happens visually — detailed description of the scene content, subjects, actions, environment",
                        },
                        camera: {
                            type: Type.STRING,
                            description: "Camera movement (e.g. 'slow dolly in', 'handheld tracking shot', 'static close-up', 'smooth pan left', 'aerial descending')",
                        },
                        mood: {
                            type: Type.STRING,
                            description: "Mood and lighting (e.g. 'warm golden hour, soft bokeh', 'dramatic side lighting, moody', 'bright natural daylight, energetic')",
                        },
                    },
                    required: ["timeRange", "visual", "camera", "mood"],
                },
                description: "3-4 detailed scenes for Veo 3.1 video generation. Each scene must specify what happens, camera movement, and mood.",
            },
            videoScript: {
                type: Type.STRING,
                description: "Fallback: single-string summary of all scenes for Veo 3.1 (used if scenes parsing fails)",
            },
            caption: {
                type: Type.STRING,
                description: "Instagram caption for the Reel (max 100 words, Czech)",
            },
            cta: {
                type: Type.STRING,
                description: `Must mention ${config.website}`,
            },
            hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 relevant hashtags",
            },
        },
        required: ["hook", "scenes", "caption", "cta", "hashtags"],
    }
}

export function buildCarouselSchema(config: ClientConfig) {
    return {
        type: Type.OBJECT,
        properties: {
            hook: {
                type: Type.STRING,
                description: "Cover slide headline (max 8 words, Czech, punchy). ZADNE EMOJI.",
            },
            accentWords: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "2-3 key words/phrases FROM the hook that should be visually highlighted (each 1-2 words, Czech, must be exact substring of hook)",
            },
            imageSubtext: {
                type: Type.STRING,
                description: "Cover slide subtext - brief benefit or teaser (max 8 words, Czech, e.g. 'Navod krok za krokem')",
            },
            slides: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        headline: { type: Type.STRING, description: "Step headline (max 6 words, Czech, e.g. 'Krok 1: Otevri Nastaveni')" },
                        subtext: { type: Type.STRING, description: "Step detail - exact path or explanation (max 20 words, Czech)" },
                        imagePrompt: { type: Type.STRING, description: "English image prompt for this step - MUST share the same environment/setting as all other slides. NO TEXT, NO WORDS, NO LETTERS in image. Pure background photo." },
                    },
                    required: ["headline", "subtext", "imagePrompt"],
                },
                description: "3 to 5 steps that walk through ONE topic step-by-step (cover slide introduces the topic). Use 3 for simple topics, 4-5 for richer topics.",
            },
            body: {
                type: Type.STRING,
                description: "Full caption for the post (max 120 words, Czech)",
            },
            cta: {
                type: Type.STRING,
                description: `CTA mentioning ${config.website}`,
            },
            hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 relevant hashtags",
            },
            imagePrompt: {
                type: Type.STRING,
                description: "English image prompt for cover slide background - sets the visual theme for ALL slides",
            },
            visualTheme: {
                type: Type.STRING,
                description: "Shared visual theme for ALL slides in 1 sentence (e.g. 'Dark urban street scene with neon reflections under moody studio lighting'). All slide imagePrompts MUST stay within this theme.",
            },
        },
        required: ["hook", "imageSubtext", "slides", "body", "cta", "hashtags", "imagePrompt", "visualTheme"],
    }
}

// ============================================
// WEEK PLANNER
// ============================================

export function buildSmartWeekPlan(config: ClientConfig, performance: PerformanceInsight, count: number = 14): string[] {
    if (performance.avgEngagement === 0) {
        const staticPlan: string[] = []
        for (let i = 0; i < count; i++) {
            staticPlan.push(config.weekPlan[i % config.weekPlan.length])
        }
        return staticPlan
    }

    const ratios: Record<string, number> = {}
    for (const [key, pillar] of Object.entries(config.contentPillars || {})) {
        ratios[key] = pillar.ratio
    }

    // Data-driven ratio adaptation — aggressive, not timid
    if (performance.pillarPerformance) {
        const pp = performance.pillarPerformance
        const avg = performance.avgEngagement

        for (const name of Object.keys(ratios)) {
            if (!pp[name] || pp[name].avgScore === 0) continue

            const pillarAvg = pp[name].avgScore
            if (pillarAvg > avg * 1.5) {
                // Top performer: boost ratio by 50%
                ratios[name] = Math.min(0.6, ratios[name] * 1.5)
                console.log(`   📈 ${name}: ratio ×1.5 (${pillarAvg.toFixed(0)} vs avg ${avg.toFixed(0)})`)
            } else if (pillarAvg < avg * 0.5) {
                // Underperformer: cut ratio in half
                ratios[name] = Math.max(0.05, ratios[name] * 0.5)
                console.log(`   📉 ${name}: ratio ×0.5 (${pillarAvg.toFixed(0)} vs avg ${avg.toFixed(0)})`)
            }
        }

        // Normalize so ratios sum to ~1.0
        const totalRatio = Object.values(ratios).reduce((s, r) => s + r, 0)
        if (totalRatio > 0) {
            for (const key of Object.keys(ratios)) {
                ratios[key] = ratios[key] / totalRatio
            }
        }
    }

    const plan: string[] = []
    for (const [pillar, ratio] of Object.entries(ratios)) {
        const pillarCount = Math.max(1, Math.round(count * ratio))
        const types = config.contentPillars[pillar]?.postTypes || []
        for (let i = 0; i < pillarCount && plan.length < count; i++) {
            plan.push(types[i % types.length])
        }
    }

    while (plan.length < count) {
        plan.push(config.weekPlan[plan.length % config.weekPlan.length])
    }

    const _getPillarForType = createPillarMapper(config)
    const byPillar: Record<string, string[]> = Object.fromEntries(Object.keys(config.contentPillars || {}).map(k => [k, []]))
    for (const type of plan) {
        const pillar = _getPillarForType(type)
        if (!byPillar[pillar]) {
            byPillar[pillar] = []
        }
        byPillar[pillar].push(type)
    }

    const interleaved: string[] = []
    const pillarKeys = Object.keys(config.contentPillars || {})
    let pillarOrder = pillarKeys.flatMap(k => {
        const r = config.contentPillars[k]?.ratio || 0
        return Array(Math.max(1, Math.round(r * 10))).fill(k)
    })
    
    // Fallback if pillarOrder is empty
    if (pillarOrder.length === 0) {
        pillarOrder = Object.keys(byPillar)
    }

    let pillarIdx = 0
    while (interleaved.length < count) {
        if (pillarOrder.length > 0) {
            const p = pillarOrder[pillarIdx % pillarOrder.length]
            if (byPillar[p] && byPillar[p].length > 0) {
                interleaved.push(byPillar[p].shift()!)
            }
        }
        pillarIdx++
        if (pillarIdx > count * 10) break
    }

    // Fallback: if interleaving fell short due to empty pillar queues, fill from plan
    while (interleaved.length < count) {
        interleaved.push(plan[interleaved.length % plan.length])
    }

    return interleaved.slice(0, count)
}

// ============================================
// MEGA PROMPT BUILDER
// ============================================

export function buildMegaPrompt(
    config: ClientConfig,
    postType: PostType,
    idea: PostIdea | null,
    review: Review | null,
    recentCaptions: string[],
    performance: PerformanceInsight,
    userTopic?: string,
    selectedProduct?: { name: string; type: string; slug: string; price?: string; description?: string },
    formatOverride?: PostFormat
): string {
    const bv = config.brandVoice
    const toneDesc = getToneDescription(config, postType.name)
    const hookTemplates = getHookTemplates(config, postType.name, 4)
    const ctaOptions = getRandomCTAs(config, 6)

    // Audience persona targeting — pick one at random for this post
    const selectedPersona = config.audiencePersonas && config.audiencePersonas.length > 0
        ? config.audiencePersonas[Math.floor(Math.random() * config.audiencePersonas.length)]
        : undefined
    let personaSection = ""
    if (selectedPersona) {
        const persona = selectedPersona
        personaSection = `
## 🎯 CÍLOVÁ PERSONA PRO TENTO POST
**Segment:** ${persona.label} (${persona.ageRange} let)
**Pain points:** ${persona.painPoints.join(", ")}
**Co na ně funguje:** ${persona.triggers.join(", ")}
**CTA přístup:** ${persona.ctaStyle === "hard" ? "Přímý, urgentní — tlač na akci" : persona.ctaStyle === "medium" ? "Motivující — ukaž hodnotu" : "Jemný — buduj důvěru, neptej se o nic"}

⚠️ **INSTRUKCE:** Hook, tón body a CTA MUSÍ být přizpůsobeny PŘESNĚ pro tuto personu.
- Hook musí rezonovat s jejich pain points
- Body musí používat jejich triggery
- CTA musí odpovídat jejich stylu (${persona.ctaStyle})
`
    }

    // Psycholog — prodejní psychologie do copywritingu (deterministická vrstva, žádné AI volání).
    // Vypnutelné přes config.psychologist === false. Viz instagram/psychologist.ts.
    const psychologySection = config.psychologist !== false ? buildPsychologistSection(selectedPersona) : ""

    let learningSection = ""
    if (performance.topPatterns.length > 0 || performance.bestHooks.length > 0) {
        learningSection = `
## 📊 🚨 KRITICKÁ DATA Z REÁLNÉHO VÝKONU (NEJVYŠŠÍ PRIORITA) 🚨 📊
Toto jsou historicky nejúspěšnější formáty pro tuto značku. Tvoje priorita je na nich stavět:

${performance.topPatterns.length > 0 ? `**Top Fungující Vzorce:** ${performance.topPatterns.join(", ")}` : ""}
${performance.bestHooks.length > 0 ? `**Zlaté Hooky (Nejlepší dosah):**\n${performance.bestHooks.map(h => `- "${h}"`).join("\n")}` : ""}
${performance.avgEngagement > 0 ? `**Průměrný Engagement (Benchmarking):** ${performance.avgEngagement.toFixed(0)} bodů` : ""}

⚠️ **INSTRUKCE:** NEKOPÍRUJ tyto přesné fráze doslovně, ale MUSÍŠ použít stejnou psychologii, strukturu a rytmus.
`
    }

    let productsSection = ""
    if (selectedProduct) {
        // A specific product was pre-selected — force the AI to use it
        productsSection = `
## 🎯 VYBRANÝ PRODUKT (POVINNÝ — NEMĚŇ!)
**Název:** ${selectedProduct.name}
**Typ:** ${selectedProduct.type}
${selectedProduct.description ? `**Popis:** ${selectedProduct.description}` : ""}
${selectedProduct.price ? `**Cena:** ${selectedProduct.price}` : ""}
**URL:** ${config.website}/p/${selectedProduct.slug}

### ⚠️ ABSOLUTNĚ POVINNÉ:
- Caption MUSÍ být o tomto KONKRÉTNÍM produktu: **${selectedProduct.name}**
- V CTA MUSÍ být odkaz: ${config.website}/p/${selectedProduct.slug}
- V imagePrompt MUSÍŠ popsat PŘESNĚ tento produkt (jeho barvu, design, styl)
- NESMÍŠ zmiňovat žádný jiný produkt!
`
    }
    // No product → AI generates generic branded content (no product list dump)


    const postFormat = formatOverride || getPostFormat(config, postType.name)

    return `
${bv.persona}

## TVŮJ ÚKOL
Vytvoř kompletní Instagram post typu: **${postType.emoji || "📱"} ${postType.display_name}**
${postType.description ? `(${postType.description})` : ""}

Brand: ${config.name} | Web: ${config.website} | IG: ${config.instagram}

## BRAND VOICE
${bv.voiceTraits.map(t => `- ${t}`).join("\n")}

### JAZYK
Piš česky, moderní hovorovou češtinou. Krátké věty. Přímé. Bez keců.

### ZAKÁZÁNO
${bv.antiPatterns.map(p => p).join("\n")}

### ⚠️ NIKDY NEPŘEKLÁDEJ ANGLICKÉ NÁZVY!
Názvy produktů, kolekcí a brand names ponechej V ANGLIČTINĚ! Příklady:
- ✅ "Zero Fucks Given" — SPRÁVNĚ (originální název)
- ❌ "Nula fucků na rozdávání" — ŠPATNĚ (přeložený do CZ)

## TÓN: ${toneDesc}

${productsSection}
${idea && !userTopic ? (() => {
    // Resolve category context from idea's subcategory
    const pillarKey = getPillarForType(config, postType.name)
    const pillarConfig = config.contentPillars[pillarKey]
    const ideaCategory = idea.subcategory && pillarConfig?.categories?.find(c => c.id === idea.subcategory)
    const categoryContext = ideaCategory
        ? `\n**Kategorie:** ${ideaCategory.emoji} ${ideaCategory.label}${ideaCategory.prompt ? `\n**Úhel:** ${ideaCategory.prompt}` : ""}\nPost MUSÍ odpovídat tomuto typu obsahu.`
        : `Kategorie: ${idea.category}, Platforma: ${idea.subcategory || "general"}`
    return `## ZDROJOVÝ NÁPAD
**${idea.title}**: ${idea.content}
${categoryContext}
`
})() : ""}
${userTopic ? `## 🎯 ZADANÉ TÉMA OD UŽIVATELE (NEJVYŠŠÍ PRIORITA!)
**Post MUSÍ být PŘESNĚ o tomto tématu:** ${userTopic}
` : ""}
${review ? `## RECENZE K VYUŽITÍ
"${review.quote}" — ${review.customer_initials || "Zákazník"}
` : ""}
${learningSection}
${personaSection}
${psychologySection}
## INSPIRACE PRO HOOKY
${hookTemplates.map(h => `- Vzor: "${h.pattern}" → Příklad: "${h.example}" (trigger: ${h.trigger})`).join("\n")}

## MOŽNÉ CTA (vyber nebo uprav)
${ctaOptions.map(c => `- ${c}`).join("\n")}

${(() => {
            const pillar = getPillarForType(config, postType.name)
            const pillarCfg = config.contentPillars[pillar]
            const pillarCTAs = config.ctaStrategies[pillarCfg?.ctaStrategy || "soft"]
            const ctaInstruction = pillarCfg?.ctaStrategy === "hard"
                ? `## 🎯 CONVERSION POST — CTA MUSÍ přímo odkázat na ${config.website}.`
                : pillarCfg?.ctaStrategy === "medium"
                    ? `## 📚 VALUE POST — CTA může zmínit ${config.website}, ale hlavní focus je na hodnotu.`
                    : pillarCfg?.ctaStrategy === "soft"
                        ? `## 🔥 REACH POST — CTA je čistě engagement. NEZMÍNEJ ${config.website}!`
                        : "## 🤝 CONNECT POST — Žádné CTA na web."

            return `${ctaInstruction}
**Pilíř:** ${pillar.toUpperCase()} | **Cíl:** ${pillarCfg?.description || ""}
**Doporučené CTA:**
${(pillarCTAs || []).map((c: string) => `- ${c}`).join("\n")}`
        })()}

## ⚠️ NEOPAKUJ SE! Tyto příspěvky (včetně draftů) už existují — NESMÍŠ opakovat stejné TÉMA ani stejný HOOK:
${recentCaptions.map((c, i) => {
    // Show hook + body summary so AI sees the full topic, not just the hook
    return `${i + 1}. "${c}"`
}).join("\n")}

### PRAVIDLA DEDUPLIKACE:
- Pokud existující post mluví o konkrétním místě/faktu (např. "Česká Kamenice"), NESMÍŠ o tom samém místě/faktu psát znovu
- Pokud existující post používá stejný formát (např. "POV:", "3 důvody proč..."), použij JINÝ formát
- Pokud existující posty pokrývají určitá témata, přijď s ÚPLNĚ jiným úhlem pohledu

${postFormat.medium === "reel" ? `
## 🎬 INSTAGRAM REEL — FULL VIDEO PRODUCTION
Toto je Instagram Reel (krátké video, ${postFormat.reelDuration || 8} sekund).
Video bude generováno AI (Veo 3.1) s nativním zvukem + český voiceover z narrace.

### PRAVIDLA PRO REELS:
- **HOOK** musí být v prvních 1.5 sekundách — vizuálně i textově zaujmout
- **PACING** musí být dynamický — žádné statické záběry delší než 3s
- Každá scéna MUSÍ mít narration text (bude přečtený česky jako voiceover)
- Camera movements musí být plynulé a profesionální
- Poslední scéna MUSÍ obsahovat CTA s ${config.website}

### STRUKTURA SCÉN (${postFormat.reelDuration || 8}s video):
${(postFormat.reelDuration || 8) <= 5 ? `
- Scene 1 (0-1.5s): HOOK — dramatický vizuál, narration = problém/otázka
- Scene 2 (1.5-3.5s): VALUE — řešení/produkt v akci
- Scene 3 (3.5-5s): CTA — result + ${config.website}
` : `
- Scene 1 (0-2s): HOOK — dramatický vizuál, narration = problém/otázka
- Scene 2 (2-${(postFormat.reelDuration || 8) - 3}s): VALUE — hlavní obsah, důkaz, ukázka
- Scene 3 (${(postFormat.reelDuration || 8) - 3}-${postFormat.reelDuration || 8}s): CTA — výsledek + ${config.website}
`}

### CAMERA MOVEMENTS (vybírej z těchto):
dolly in, dolly out, slow pan left/right, tracking shot, static close-up, 
overhead/bird's eye, low angle hero shot, smooth orbit, rack focus, handheld natural

### MOOD/LIGHTING (vybírej z těchto):
golden hour warmth, dramatic side-lighting, bright natural daylight, moody cinematic,
neon glow, studio softbox, high-contrast editorial, morning mist, backlit silhouette

### SOUND EFFECTS (pro Veo 3.1 nativní audio):
Do každé scény přidej zvukový efekt/atmosféru — např. "city ambience", "door opening",
"coffee pouring", "keyboard typing", "wind in trees", "footsteps on gravel"

${config.videoFocus ? `### BRAND VIDEO STYLE:\n${config.videoFocus}\n` : ""}

## VÝSTUP — vrať POUZE validní JSON:
{
  "hook": "Opening problem/question (2-4 slova, punchy, česky). ŽÁDNÉ EMOJI.",
  "scenes": [
    {
      "timeRange": "0-2s",
      "visual": "Detailed English description of what happens visually",
      "camera": "camera movement type",
      "mood": "lighting and mood description", 
      "narration": "Český text pro voiceover (1-2 věty, přirozená řeč)",
      "soundEffect": "ambient sound or effect for this scene"
    }
  ],
  "videoScript": "Fallback: single summary of all scenes in English",
  "caption": "Instagram caption pro Reel (max 100 slov, česky).",
  "cta": "MUSÍ obsahovat ${config.website}",
  "hashtags": ["8-10", "relevantních", "hashtagů"]
}
` : postFormat.medium === "carousel" ? `
## 📸 CAROUSEL POST (4-6 slidů) — JEDEN TIP, KROK ZA KROKEM

### STRUKTURA (POVINNÁ):
1. **Slide 1 (COVER):** Bold hook headline
2. **Slide 2-4 (KROKY):** Jednotlivé kroky/body
3. **Poslední slide:** Shrnutí + CTA na ${config.website}

Použij 3 kroky pro jednoduchá témata, 4-5 kroků pro komplexnější témata. Celkem 4-6 slidů (cover + 3-5 kroků).

## VÝSTUP — vrať POUZE validní JSON:
{
  "hook": "Cover headline (max 8 slov, česky). ŽÁDNÉ EMOJI.",
  "slides": [
    { "headline": "Krok 1: ...", "subtext": "...", "imagePrompt": "English prompt..." },
    { "headline": "Krok 2: ...", "subtext": "...", "imagePrompt": "English prompt..." },
    { "headline": "Krok 3: ...", "subtext": "...", "imagePrompt": "English prompt..." }
  ],  // můžeš přidat 4. a 5. krok pokud téma vyžaduje víc detailu
  "body": "Hlavní caption (max 120 slov).",
  "cta": "CTA směřující na ${config.website}",
  "hashtags": ["8-10", "hashtagů"],
  "imagePrompt": "English prompt for COVER slide background.",
  "visualTheme": "Shared visual theme for ALL slides."
}
` : `
## 🎨 OBRÁZEK

### Layout (kromě meme):
- **POZADÍ:** Full-bleed relevantní fotografie (1:1 square)
- **OVERLAY:** Barevný gradient — ${config.feedAesthetic.colorPalette}
- **TEXT DOLE:** Velký bílý tučný headline + menší subtext
- **Font:** ${config.feedAesthetic.font}
- **Feel:** ${config.feedAesthetic.feel}

### Typ-specifické foto:
${(() => {
            const instructions = config.imageInstructions || {}
            const typeInstr = instructions[postType.name] || instructions._default || "STANDARD: Pozadí: relevantní lifestyle fotka."
            return `**${postType.name.toUpperCase()}:**\n${typeInstr}`
        })()}

## VÝSTUP — vrať POUZE validní JSON:
{
  "hook": "První věta co zastaví scrollování (max 15 slov). ŽÁDNÉ EMOJI.",
  "body": "Hlavní text (max 120 slov). ${config.contentFocus}",
  "cta": "CTA — ideálně směřuje na ${config.website}",
  "hashtags": ["8-10", "relevantních", "hashtagů"],
  "imagePrompt": "English prompt for AI image generation. NO TEXT in image! ${config.contentFocus}.",
  "imageSubtext": "Podtext dole pod hookem (max 8 slov, česky)"
}
`}
`.trim()
}

// ============================================
// QUALITY GATE — Multi-Agent Dialog
// ============================================

export interface QualityGateResult {
    overall: number
    hookScore: number
    bodyScore: number
    ctaScore: number
    originalityScore: number
    feedback: {
        keep: string[]
        fix: string[]
    }
}

export async function scorePost(
    config: ClientConfig,
    captionData: {
        hook: string
        body?: string
        cta: string
        hashtags: string[]
        slides?: { headline: string; subtext: string }[]
    },
    postTypeName?: string
): Promise<{ score: number; feedback: string; detail?: QualityGateResult }> {
    const isCarousel = captionData.slides && captionData.slides.length > 0

    let slidesSection = ""
    let carouselCriteria = ""
    if (isCarousel && captionData.slides) {
        slidesSection = `\nSlides:\n${captionData.slides.map((s, i) => `  ${i + 1}. "${s.headline}" - ${s.subtext}`).join("\n")}`
        carouselCriteria = `
6. **Carousel flow (0-2 body):** Navazuji kroky logicky na sebe?
7. **Cover swipe-appeal (0-1 bod):** Primeje cover headline swipnout?`
    }

    const scorePrompt = `
Jsi prisny Instagram content reviewer pro znacku "${config.name}" (${config.website}).
IG handle: ${config.instagram}

## BRAND VOICE (post MUSI odpovidat):
${config.brandVoice.persona ? `Persona: ${config.brandVoice.persona.substring(0, 200)}` : ""}
Tón: ${config.brandVoice.voiceTraits?.slice(0, 4).join(", ") || "autentický"}

## ANTI-PATTERNS (post NESMI obsahovat):
${config.brandVoice.antiPatterns?.slice(0, 5).join(", ") || "generické fráze"}

## POST${postTypeName ? ` (typ: ${postTypeName})` : ""}:
Hook: "${captionData.hook}"
Body: "${captionData.body || ""}"${slidesSection}
CTA: "${captionData.cta}"
Hashtags: ${captionData.hashtags.join(", ")}

## KRITERIA:
1. **Hook (0-3 body):** Zastavi scrollovani? Kratky (max 15 slov)? Bez emoji?
2. **Relevance (0-2 body):** Odpovida brand voice a persone vyse?
3. **Originalita (0-2 body):** Nepusobi genericky? Nepouziva anti-patterns?
4. **CTA (0-1 bod):** Obsahuje ${config.website}?
5. **Brand compliance (0-1 bod):** Sedi ton k voice traits? Neporusuje anti-patterns?${carouselCriteria}
6. **Celkovy dojem (0-1 bod):** Zverejnil bys to jako brand manager?

## VYSTUP — vrat POUZE validni JSON s touto strukturou:
{
  "overall": <cislo 1-10>,
  "hookScore": <cislo 0-3>,
  "bodyScore": <cislo 0-3>,
  "ctaScore": <cislo 0-2>,
  "originalityScore": <cislo 0-2>,
  "keep": ["co je dobre a NESMI se menit, cesky, max 2 polozky"],
  "fix": ["co je spatne a MUSI se opravit, cesky, max 2 polozky. Prazdne pole pokud je vse OK."]
}
`

    try {
        // Critic is a quality GATE — it judges Pro-written captions, so it runs on the
        // same Pro ladder (a flash judge waves through weak posts). If both Pro tiers are
        // down it throws → the catch below passes the post through (don't block a
        // Pro-written caption just because the judge is briefly unavailable).
        const criticModels = [getModel("textPro")]
        if (hasFallback("textPro")) criticModels.push(getModel("textPro", "fallback"))
        const text = await generateTextQuality(scorePrompt, { models: criticModels, label: "critic" })
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        const result = JSON.parse(jsonMatch?.[0] || text)

        const detail: QualityGateResult = {
            overall: Math.min(10, Math.max(1, Number(result.overall) || 5)),
            hookScore: Math.min(3, Math.max(0, Number(result.hookScore) || 1)),
            bodyScore: Math.min(3, Math.max(0, Number(result.bodyScore) || 1)),
            ctaScore: Math.min(2, Math.max(0, Number(result.ctaScore) || 0)),
            originalityScore: Math.min(2, Math.max(0, Number(result.originalityScore) || 1)),
            feedback: {
                keep: Array.isArray(result.keep) ? result.keep : [],
                fix: Array.isArray(result.fix) ? result.fix : [],
            },
        }

        // Build human-readable summary
        const fixSummary = detail.feedback.fix.length > 0
            ? detail.feedback.fix.join("; ")
            : "Vše OK"

        return {
            score: detail.overall,
            feedback: fixSummary,
            detail,
        }
    } catch {
        return { score: 7, feedback: "Scoring failed - passing through" }
    }
}

// ============================================
// CAPTION REVISION (user-feedback rewrite)
// ============================================

export interface ReviseCaptionInput {
    originalCaption: string
    originalHashtags: string[]
    postTypeDisplayName: string
    feedback: string
    product?: { name: string; slug: string; price?: string | null; description?: string | null } | null
}

export interface RevisedCaption {
    caption: string
    hashtags: string[]
    hook?: string
    imagePrompt?: string
    imageSubtext?: string
}

/**
 * Rewrite an existing caption according to user feedback, preserving brand voice.
 * Lives in the engine so revisions share the same validated ClientConfig
 * (brandVoice, hashtagPools) as regular generation.
 */
export async function reviseCaption(config: ClientConfig, input: ReviseCaptionInput): Promise<RevisedCaption> {
    const bv = config.brandVoice
    const productSection = input.product
        ? `\n## PRODUKT V PŘÍSPĚVKU\nNázev: ${input.product.name}\nCena: ${input.product.price || "neuvedena"}\nPopis: ${input.product.description || ""}\nURL: ${config.website}/p/${input.product.slug}\n⚠️ Pokud feedback nemění produkt, zachovej odkaz na ${config.website}/p/${input.product.slug} v CTA.\n`
        : ""
    const hashtagSection = config.hashtagPools
        ? `\n## HASHTAG POOLS (vyber z těchto):\n- Core: ${config.hashtagPools.core?.join(", ") || ""}\n- Niche: ${config.hashtagPools.niche?.slice(0, 5).join(", ") || ""}\n- Broad: ${config.hashtagPools.broad?.slice(0, 4).join(", ") || ""}\nPoužij 8-10 hashtagů, mix core + niche + relevantní z originálu.\n`
        : ""

    const prompt = `Jsi senior copywriter pro značku "${config.name}" (${config.website || ""}).

## BRAND PERSONA
${bv?.persona || "Profesionální a přátelský tón."}

## VOICE TRAITS
${(bv?.voiceTraits || []).map((t: string) => `- ${t}`).join("\n") || "- Autentický a přirozený"}

## ZAKÁZÁNO (NIKDY NEPOUŽÍVEJ)
${(bv?.antiPatterns || []).map((p: string) => `- ${p}`).join("\n") || "- Generické fráze, emoji spam"}

## TYP PŘÍSPĚVKU: ${input.postTypeDisplayName}
${productSection}
## PŮVODNÍ CAPTION:
${input.originalCaption}

## PŮVODNÍ HASHTAGY: ${input.originalHashtags.join(" ")}
${hashtagSection}
## FEEDBACK OD KLIENTA:
"${input.feedback}"

## INSTRUKCE:
1. Přepiš caption PŘESNĚ podle feedbacku — ale zachovej brand voice a styl
2. Hook (první řádek) musí stále zastavit scrollování — max 15 slov, bez emoji
3. CTA musí směřovat na ${config.website || "web značky"}
4. Zachovej strukturu: hook → body → CTA → hashtags
5. Pokud feedback říká "zkrátit" — zkrať. Pokud "přidat humor" — přidej. Buď DOSLOVNÝ.
6. NIKDY nepřekládej anglické názvy produktů/kolekcí do češtiny

## VÝSTUP — vrať POUZE validní JSON:
{
  "caption": "kompletní nový text příspěvku (hook + body + CTA)",
  "hashtags": ["#hashtag1", "#hashtag2", "..."],
  "hook": "první řádek captiony — hook text pro overlay na obrázku (max 15 slov, bez emoji)",
  "imagePrompt": "English prompt for AI image generation — describe the background photo. NO TEXT in image. Photorealistic, editorial quality.",
  "imageSubtext": "krátký podtext pod hook na obrázku (max 8 slov, česky)"
}`

    // Copywriter = ~80% of text quality, so it runs the QUALITY LADDER: top Pro
    // (gemini-pro-latest) retried HARD on transient 503/429 for minutes, then the GA
    // Pro (gemini-2.5-pro) — NEVER flash. If both Pro tiers are truly exhausted it
    // throws QualityUnavailableError so the caller defers/fails instead of shipping a
    // flash-quality caption. In-job (800s budget), so the latency is hidden from the UI.
    const copyModels = [getModel("textPro")]
    if (hasFallback("textPro")) copyModels.push(getModel("textPro", "fallback"))

    const text = await generateTextQuality(prompt, { models: copyModels, label: "copywriter" })

    try {
        return JSON.parse(text.replace(/```json|```/g, "").trim())
    } catch {
        throw new Error("AI vrátilo neplatný JSON")
    }
}
