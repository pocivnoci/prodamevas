/**
 * Reel storyboard — čisté typy a funkce režiséra (bez sítě, bez DB).
 * ====================================================================
 * Oddělené od `reel-director.ts` (který volá Claude/Gemini a čte brand memory
 * ze Supabase), aby je `scripts/test-reel-pipeline.ts` mohl importovat v guardu
 * bez env. Schéma, prompt, parser, validátor a finální prompt pro Seedance.
 */

import { Type } from "@google/genai"
import type { ClientConfig, PostTypeDef } from "./configs/types"
import type { CtaPolicy } from "./cta-policy"
import type { SelectedProduct } from "./orchestrators/types"
import type { ReelMedium } from "../lib/reel-media"
import type { TimedLine } from "./reel-audio"

export interface ReelReference {
    /** 1-based — tak se na ni odkazuje prompt („Image 2"). */
    index: number
    kind: "photo" | "product" | "logo"
    /** Veřejná URL (nebo data URL u loga) — tohle dostane Seedance. */
    url: string
    description: string
    tags: string[]
    /** Bajty pro vision vstup režiséra; Seedance dostává URL. */
    buffer?: Buffer
    mimeType?: string
}

export interface ReelShot {
    start: number
    end: number
    /** Co je v záběru — anglicky, konkrétně (subjekt, akce, prostředí). */
    visual: string
    camera: string
    /** Reference, které záběr používá (1-based indexy do `references`). */
    referenceIndexes: number[]
}

export interface ReelStoryboard {
    shots: ReelShot[]
    /** Nálada zvuku — jde do TTS tagů i do promptu (např. "warm, calm morning"). */
    audioMood: string
    soundDesign: string[]
    /** Vizuál pro cover (bez textu — hook na cover dává existující cover pipeline). */
    coverScene: string
    /** Jeden anglický prompt pro Seedance. Tvrdé zákazy doplňuje `finalizeVideoPrompt`. */
    videoPrompt: string
}

export interface DirectReelInput {
    config: ClientConfig
    clientId: string
    medium: ReelMedium
    durationSeconds: number
    hook: string
    /** Věty narrace s časy z TTS — režisér na ně zarovnává záběry. */
    narration: TimedLine[]
    /** Scény copywritera (vizuál/kamera/nálada) jako inspirace, ne zákon. */
    scenes?: { visual: string; camera: string; mood: string; soundEffect?: string }[]
    cta: string
    postType: string
    typeDef?: PostTypeDef
    ctaPolicy?: CtaPolicy
    selectedProduct?: SelectedProduct
    references: ReelReference[]
}

/** Tolerance pro navazování záběrů (sekundy). */
const SHOT_TOLERANCE = 0.35
const SHOT_MIN = 1.0
const SHOT_MAX = 7.0
const PROMPT_MIN_CHARS = 80
const PROMPT_MAX_CHARS = 1600

const URL_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(cz|com|sk|eu|net|io|shop)\b/i

export function buildStoryboardSchema() {
    return {
        type: Type.OBJECT,
        properties: {
            shots: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                        visual: { type: Type.STRING },
                        camera: { type: Type.STRING },
                        referenceIndexes: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                    },
                    required: ["start", "end", "visual", "camera", "referenceIndexes"],
                },
            },
            audioMood: { type: Type.STRING },
            soundDesign: { type: Type.ARRAY, items: { type: Type.STRING } },
            coverScene: { type: Type.STRING },
            videoPrompt: { type: Type.STRING },
        },
        required: ["shots", "audioMood", "soundDesign", "coverScene", "videoPrompt"],
        propertyOrdering: ["shots", "audioMood", "soundDesign", "coverScene", "videoPrompt"],
    }
}

function fmtTime(s: number): string {
    return `${s.toFixed(1)}s`
}

/** Čistý prompt builder — testovatelný bez sítě. */
export function buildReelDirectorPrompt(input: DirectReelInput, memorySection: string, factsSection: string): string {
    const { config, references, narration, durationSeconds, ctaPolicy } = input
    const aesthetic = config.feedAesthetic
    const refsText = references.length
        ? references.map(r => `Image ${r.index} (${r.kind}${r.tags.length ? `, tags: ${r.tags.join(", ")}` : ""}): ${r.description}`).join("\n")
        : "(no reference images — describe the brand world from the brief below)"
    const narrationText = narration.map((l, i) => `${i + 1}. [${fmtTime(l.start)}–${fmtTime(l.end)}] "${l.text}"`).join("\n")
    const scenesText = input.scenes?.length
        ? input.scenes.map((s, i) => `Scene ${i + 1}: ${s.visual} — camera: ${s.camera} — mood: ${s.mood}${s.soundEffect ? ` — sfx: ${s.soundEffect}` : ""}`).join("\n")
        : "(none)"
    const productText = input.selectedProduct
        ? `Product in this reel: ${input.selectedProduct.name} (${input.selectedProduct.type})${input.selectedProduct.description ? ` — ${input.selectedProduct.description.slice(0, 240)}` : ""}. It must look EXACTLY like its reference image (shape, colours, label).`
        : "No specific product — the brand world itself is the subject."
    const websiteRule = ctaPolicy && !ctaPolicy.allowWebsite
        ? `⛔ This post's CTA policy (${ctaPolicy.pillarLabel.toUpperCase()}) forbids the website: NO URL, NO domain, NO address anywhere in the video. Land the final shot on a stable brand moment (product, packaging, signature space).`
        : `The final shot may hold on branded packaging or a signature brand visual; the Czech CTA is spoken and subtitled, never rendered as text.`

    return `You are the DIRECTOR of a ${durationSeconds}-second vertical Instagram Reel (9:16) for the Czech brand "${config.name}".
The copy is FINAL and already approved — you do not write or change it. Your job is the picture: a shot list that matches the spoken narration second by second, built from the brand's own reference images, and ONE video-generation prompt for the Seedance model.

## BRAND
- Voice/persona: ${config.brandVoice?.persona || "—"}
- Content focus: ${config.contentFocus || "—"}
- Visual feel: ${aesthetic?.feel || "—"}; palette: ${aesthetic?.colorPalette || "—"}${aesthetic?.customInstructions ? `; notes: ${aesthetic.customInstructions}` : ""}
- Video style notes: ${config.videoFocus || "cinematic, natural light, real textures, smooth camera"}
${config.characterDescription ? `- Recurring person: ${config.characterDescription}` : ""}
${factsSection}
${memorySection}

## REFERENCE IMAGES (cite them as "Image N" — they are attached in this order)
${refsText}

${productText}

## SPOKEN NARRATION (Czech, measured timings — shots must follow this timeline)
Hook: "${input.hook}"
${narrationText}
Total video length: ${durationSeconds}s. Speech ends before the video does — the last second is a hold.

## COPYWRITER'S SCENE IDEAS (inspiration, not law)
${scenesText}

## RULES
- Shots are CONTIGUOUS from 0.0 to ${durationSeconds}.0, each ${SHOT_MIN}–${SHOT_MAX} s. Shot changes should land on narration boundaries (a new sentence = new shot or a clear camera move).
- Every shot names the reference images it is built from ("referenceIndexes"). Use the brand's own spaces, people, products and textures — never a generic stock scene when a reference exists.
- The product (if any) must be recognisable and true to its image. The logo (if provided) may appear ONLY as a physical object already in the scene (packaging, signage, printed material) — never as an overlay or floating graphic.
- NO on-screen text, captions, titles, subtitles, watermarks or UI in the video. Text is added later by us.
- NO speech, NO dialogue, NO lip-sync, NO singing. Sound = ambience and diegetic effects only (the Czech voiceover is mixed in afterwards).
- ${websiteRule}
- Camera choreography must be a smooth continuous flow with concrete moves (dolly, orbit, rack focus, handheld tracking…). Consistent lighting within a shot.
- The first 1.5 s must visually hook (movement, contrast, a face, a reveal).

## OUTPUT — JSON only, no markdown:
{
  "shots": [{ "start": 0.0, "end": 2.4, "visual": "English, concrete", "camera": "move", "referenceIndexes": [1] }],
  "audioMood": "2-4 English words for the sound and delivery mood",
  "soundDesign": ["ambient sound 1", "effect 2"],
  "coverScene": "one English sentence describing the strongest single frame (no text)",
  "videoPrompt": "ONE English paragraph (600-1200 characters) for the video model: a timestamped shot list in prose, citing 'Image N' for subjects/spaces/product, camera moves, lighting, textures, ambience. Explicitly say: no text, no speech."
}`
}

/** Vytáhne JSON z odpovědi (Claude občas obalí ```json … ```). */
export function parseStoryboard(raw: string): ReelStoryboard {
    let text = raw.trim()
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) text = fence[1].trim()
    const first = text.indexOf("{")
    const last = text.lastIndexOf("}")
    if (first < 0 || last <= first) throw new Error("storyboard: odpověď neobsahuje JSON objekt")
    const obj = JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>
    const shotsRaw = Array.isArray(obj.shots) ? obj.shots : []
    const shots: ReelShot[] = shotsRaw.map((raw: unknown) => {
        const s = (raw ?? {}) as Record<string, unknown>
        return ({
        start: Number(s.start),
        end: Number(s.end),
        visual: String(s.visual ?? ""),
        camera: String(s.camera ?? ""),
        referenceIndexes: Array.isArray(s.referenceIndexes) ? s.referenceIndexes.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n)) : [],
        })
    })
    return {
        shots,
        audioMood: String(obj.audioMood ?? "").trim(),
        soundDesign: Array.isArray(obj.soundDesign) ? obj.soundDesign.map(String) : [],
        coverScene: String(obj.coverScene ?? "").trim(),
        videoPrompt: String(obj.videoPrompt ?? "").trim(),
    }
}

/** Seznam problémů; prázdný = v pořádku. Čisté — hlídá to test-reel-pipeline. */
export function validateStoryboard(
    sb: ReelStoryboard,
    ctx: { durationSeconds: number; referenceCount: number; allowWebsite: boolean },
): string[] {
    const problems: string[] = []
    const shots = [...sb.shots].sort((a, b) => a.start - b.start)
    if (shots.length === 0) problems.push("no shots")
    for (const [i, s] of shots.entries()) {
        if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) { problems.push(`shot ${i + 1}: non-numeric times`); continue }
        const len = s.end - s.start
        if (len < SHOT_MIN - 0.05 || len > SHOT_MAX + 0.05) problems.push(`shot ${i + 1}: length ${len.toFixed(1)}s outside ${SHOT_MIN}–${SHOT_MAX}s`)
        if (!s.visual.trim()) problems.push(`shot ${i + 1}: empty visual`)
        for (const r of s.referenceIndexes) {
            if (r < 1 || r > ctx.referenceCount) problems.push(`shot ${i + 1}: referenceIndex ${r} out of range 1–${ctx.referenceCount}`)
        }
        if (i > 0) {
            const gap = s.start - shots[i - 1].end
            if (Math.abs(gap) > SHOT_TOLERANCE) problems.push(`shot ${i + 1}: ${gap > 0 ? "gap" : "overlap"} of ${Math.abs(gap).toFixed(2)}s after shot ${i}`)
        }
    }
    if (shots.length) {
        if (shots[0].start > SHOT_TOLERANCE) problems.push(`first shot starts at ${shots[0].start}s, must start at 0`)
        const end = shots[shots.length - 1].end
        if (Math.abs(end - ctx.durationSeconds) > SHOT_TOLERANCE) problems.push(`last shot ends at ${end}s, video is ${ctx.durationSeconds}s`)
    }
    const p = sb.videoPrompt
    if (p.length < PROMPT_MIN_CHARS) problems.push(`videoPrompt too short (${p.length} chars)`)
    if (p.length > PROMPT_MAX_CHARS) problems.push(`videoPrompt too long (${p.length} chars, max ${PROMPT_MAX_CHARS})`)
    if (!ctx.allowWebsite && URL_RE.test(p)) problems.push("videoPrompt mentions a URL/domain but the CTA policy forbids the website")
    if (!ctx.allowWebsite && sb.shots.some(s => URL_RE.test(s.visual))) problems.push("a shot mentions a URL/domain but the CTA policy forbids the website")
    if (!sb.coverScene) problems.push("coverScene missing")
    return problems
}

/**
 * Prompt pro Seedance = režisérův text + tvrdé zákazy, které se do modelu
 * NEPOSÍLAJÍ na důvěru: bez textu v obraze, bez řeči, formát a délka.
 */
export function finalizeVideoPrompt(sb: ReelStoryboard, input: Pick<DirectReelInput, "durationSeconds" | "ctaPolicy">): string {
    const noWeb = input.ctaPolicy && !input.ctaPolicy.allowWebsite ? " No website address, URL or domain anywhere." : ""
    return `${sb.videoPrompt.trim()}\n\nFormat: vertical 9:16, ${input.durationSeconds} seconds, continuous cinematic camera. Sound: ${sb.audioMood || "natural ambience"}; ${sb.soundDesign.slice(0, 4).join(", ") || "ambient sound only"}. STRICT: no on-screen text, captions, titles, logos as overlays or watermarks; no speech, dialogue, singing or lip movement.${noWeb}`
}
