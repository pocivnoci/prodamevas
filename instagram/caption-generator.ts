/**
 * Caption Generator for Instagram Autopilot
 * Schemas, mega prompt builder, config-driven helpers, quality gate.
 */

import { Type } from "@google/genai"
import { ai } from "./gemini-client"
import type { ClientConfig, PostFormat } from "./configs/types"
import type { PostType, PostIdea, Review } from "./types"
import type { HookTemplate } from "./types"
import type { PerformanceInsight } from "./performance"
import { getPillarForType, createPillarMapper } from "./service"

// ============================================
// COSTS
// ============================================

// Pricing as of May 2026:
// - Gemini 3.5 Flash: primary model for caption generation
// - Gemini 3.1 Pro: $2.00/M input + $12/M output (~$0.03 per request)
// - Nano Banana Pro (gemini-3-pro-image-preview): primary image gen
// - Veo 3.1 Fast: $0.15/second
export const COSTS = {
    textGeneration: 0.025,
    promptRefinement: 0.025,
    imageGeneration: 0.06,
    videoPerSecond: 0.15,
    perPost: 0.14,       // 3× text ($0.075) + 1× image ($0.06) + overhead
    perCarousel: 0.35,   // 3× text + 4× image ($0.24) + overhead
    perReel: 1.30,       // 3× text + Veo 3.1 Fast 8s ($1.20)
}

// ============================================
// FORMAT HELPERS
// ============================================

const DEFAULT_FORMAT: PostFormat = { aspectRatio: "3:4", medium: "image", overlayStyle: "default" }

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

export const getReelDuration = (_typeName: string) => 8

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
            videoScript: {
                type: Type.STRING,
                description: `Scene-by-scene description for Veo 3.1. MUST have 3 scenes: Scene 1 (0-2s): Hook visual. Scene 2 (2-7s): Main content. Scene 3 (7-10s): CTA with ${config.website}.`,
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
        required: ["hook", "videoScript", "caption", "cta", "hashtags"],
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
                        imagePrompt: { type: Type.STRING, description: "English image prompt for this step - MUST share the same environment/setting as all other slides" },
                    },
                    required: ["headline", "subtext", "imagePrompt"],
                },
                description: "Exactly 3 steps that walk through ONE topic step-by-step (cover slide introduces the topic)",
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
    for (const [key, pillar] of Object.entries(config.contentPillars)) {
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
    const byPillar: Record<string, string[]> = Object.fromEntries(Object.keys(config.contentPillars).map(k => [k, []]))
    for (const type of plan) {
        const pillar = _getPillarForType(type)
        byPillar[pillar].push(type)
    }

    const interleaved: string[] = []
    const pillarKeys = Object.keys(config.contentPillars)
    const pillarOrder = pillarKeys.flatMap(k => {
        const r = config.contentPillars[k].ratio
        return Array(Math.max(1, Math.round(r * 10))).fill(k)
    })
    let pillarIdx = 0
    while (interleaved.length < count) {
        const p = pillarOrder[pillarIdx % pillarOrder.length]
        if (byPillar[p].length > 0) {
            interleaved.push(byPillar[p].shift()!)
        }
        pillarIdx++
        if (pillarIdx > count * 3) break
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
    selectedProduct?: { name: string; type: string; slug: string; price?: string; description?: string }
): string {
    const bv = config.brandVoice
    const toneDesc = getToneDescription(config, postType.name)
    const hookTemplates = getHookTemplates(config, postType.name, 4)
    const ctaOptions = getRandomCTAs(config, 6)

    // Audience persona targeting — pick one at random for this post
    let personaSection = ""
    if (config.audiencePersonas && config.audiencePersonas.length > 0) {
        const persona = config.audiencePersonas[Math.floor(Math.random() * config.audiencePersonas.length)]
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
    } else if (config.products) {
        productsSection = `
## PRODUKTY ZNAČKY (${config.products.length} produktů na ${config.website})
${config.products.map(p => `- **${p.name}** (${p.type}): ${p.description || ""} ${p.price ? `— ${p.price}` : ""} → ${config.website}/p/${p.slug}`).join("\n")}
`
    }


    const postFormat = getPostFormat(config, postType.name)

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
${idea && !userTopic ? `## ZDROJOVÝ NÁPAD
**${idea.title}**: ${idea.content}
Kategorie: ${idea.category}, Platforma: ${idea.subcategory || "general"}
` : ""}
${userTopic ? `## 🎯 ZADANÉ TÉMA OD UŽIVATELE (NEJVYŠŠÍ PRIORITA!)
**Post MUSÍ být PŘESNĚ o tomto tématu:** ${userTopic}
` : ""}
${review ? `## RECENZE K VYUŽITÍ
"${review.quote}" — ${review.customer_initials || "Zákazník"}
` : ""}
${learningSection}
${personaSection}
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
## 🎬 REELS VIDEO
Toto je Instagram Reel (krátké video, 7-10 sekund).

### STRUKTURA (POVINNÁ):
1. **Scene 1 (0-2s): HOOK**
2. **Scene 2 (2-7s): VALUE**
3. **Scene 3 (7-10s): CTA** — "${config.website}"

## VÝSTUP — vrať POUZE validní JSON:
{
  "hook": "Opening problem/question (2-4 slova, punchy, česky). ŽÁDNÉ EMOJI.",
  "videoScript": "Scene-by-scene popis pro Veo 3.1.",
  "caption": "Instagram caption pro Reel (max 100 slov, česky).",
  "cta": "MUSÍ obsahovat ${config.website}",
  "hashtags": ["8-10", "relevantních", "hashtagů"]
}
` : postFormat.medium === "carousel" ? `
## 📸 CAROUSEL POST (4 slidy) — JEDEN TIP, KROK ZA KROKEM

### STRUKTURA (POVINNÁ):
1. **Slide 1 (COVER):** Bold hook headline
2. **Slide 2 (KROK 1):** První krok
3. **Slide 3 (KROK 2):** Další krok
4. **Slide 4 (KROK 3):** Poslední krok + CTA na ${config.website}

## VÝSTUP — vrať POUZE validní JSON:
{
  "hook": "Cover headline (max 8 slov, česky). ŽÁDNÉ EMOJI.",
  "slides": [
    { "headline": "Krok 1: ...", "subtext": "...", "imagePrompt": "English prompt..." },
    { "headline": "Krok 2: ...", "subtext": "...", "imagePrompt": "English prompt..." },
    { "headline": "Krok 3: ...", "subtext": "...", "imagePrompt": "English prompt..." }
  ],
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
        const raw = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: scorePrompt,
            config: { responseMimeType: "application/json" },
        })
        const parts = raw.candidates?.[0]?.content?.parts || []
        const textPart = parts.find((p: any) => p.text)
        const text = textPart?.text || ""
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
