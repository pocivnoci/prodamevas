/**
 * Anthropic Claude client — the cross-family JUDGE gateway.
 * ========================================================
 * ONLY the Critic + Chief Editor route here (the copywriter stays Gemini 3 Pro), so a different
 * model family second-guesses the caption without self-preference bias — the "writer ≠ judge"
 * rule from docs/AI_PROVIDER_STRATEGY.md. Activated only when ANTHROPIC_API_KEY is present;
 * otherwise callers fall back to the Gemini judge (see instagram/judge.ts) and nothing changes.
 *
 * Model IDs live in instagram/models.ts — getModel("judge") → claude-sonnet-5.
 */

import Anthropic from "@anthropic-ai/sdk"
import sharp from "sharp"
import { getModel } from "./models"
import dotenv from "dotenv"

// Load env for CLI usage (mirrors gemini-client.ts). In the Next runtime env is already present.
dotenv.config({ path: ".env.local" })

let _client: Anthropic | null = null
function getClient(): Anthropic {
    if (!_client) _client = new Anthropic() // reads ANTHROPIC_API_KEY from the environment
    return _client
}

/**
 * Whether the Claude judge is available. False (→ Gemini fallback) unless an ANTHROPIC_API_KEY is
 * set. Set CLAUDE_JUDGE=off to force the Gemini judge even when a key is present (kill switch).
 */
export function claudeJudgeEnabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.CLAUDE_JUDGE !== "off"
}

/**
 * Anthropic's three vision limits. Each one is a hard 400 (verified against the live API):
 *   - `media_type` must match the real bytes: "specified image/png, but appears to be image/jpeg"
 *   - neither dimension may exceed 8000 px
 *   - the base64 string may not exceed 10 MB
 *
 * Callers hand us whatever the renderer or a tenant upload produced, so we trust neither their
 * mime label nor their size — we sniff the buffer and only re-encode when a limit is actually
 * breached. Claude downscales anything past ~2576 px on its own, so clamping the long edge there
 * costs no readable detail (Czech diacritics survive) while keeping us far under the byte cap.
 */
const MAX_BASE64_BYTES = 10 * 1024 * 1024
const MAX_LONG_EDGE = 2576

type ClaudeMedia = "image/png" | "image/jpeg" | "image/webp" | "image/gif"
const SUPPORTED: Record<string, ClaudeMedia> = {
    png: "image/png",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
}

const base64Bytes = (buf: Buffer) => Math.ceil(buf.length / 3) * 4

async function toImageBlock(img: { buffer: Buffer; mimeType?: string }): Promise<Anthropic.ImageBlockParam> {
    const block = (data: Buffer, media_type: ClaudeMedia): Anthropic.ImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type, data: data.toString("base64") },
    })

    const meta = await sharp(img.buffer).metadata()
    const detected = meta.format ? SUPPORTED[meta.format] : undefined
    const oversized = Math.max(meta.width ?? 0, meta.height ?? 0) > MAX_LONG_EDGE
    const tooHeavy = base64Bytes(img.buffer) > MAX_BASE64_BYTES

    // Already legal — ship the original bytes, just labelled with what they actually are.
    if (detected && !oversized && !tooHeavy) return block(img.buffer, detected)

    const fit = () =>
        sharp(img.buffer).resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: "inside", withoutEnlargement: true })

    // PNG stays PNG (crisp typography for the QA read); anything else re-encodes to JPEG.
    let out = detected === "image/png" ? await fit().png().toBuffer() : await fit().jpeg({ quality: 92 }).toBuffer()
    let media: ClaudeMedia = detected === "image/png" ? "image/png" : "image/jpeg"

    // A noisy 2576px PNG can still clear 10 MB — step down to JPEG rather than send a doomed request.
    for (const quality of [85, 70, 55]) {
        if (base64Bytes(out) <= MAX_BASE64_BYTES) break
        out = await fit().jpeg({ quality }).toBuffer()
        media = "image/jpeg"
    }
    return block(out, media)
}

/**
 * Run a judge prompt through Claude and return the raw text. The prompt already instructs a JSON
 * shape, and callers parse it exactly as they parse the Gemini judge output — so this is a drop-in.
 *
 * Reliability without a temperature knob: Sonnet 5 is a "5-generation" model (like Opus 4.8 / Fable
 * 5) — it rejects `temperature`/`top_p`/`top_k`. We instead run at LOW effort with adaptive thinking
 * left off, and lean on the tight scoring rubric already baked into the prompt. Small `max_tokens`
 * (judge output is a score + a couple short lists) keeps it fast and cheap across ≤3 rounds/post.
 *
 * `images` lets the SAME cross-family gate judge a rendered picture, not just text — Claude Sonnet
 * 5 is multimodal, so the vision QA gets "writer ≠ judge" too (Gemini renders, Claude reads).
 * Each image is normalized by toImageBlock first: Claude rejects a mislabeled `media_type` outright,
 * so we derive it from the bytes and ignore `img.mimeType` (which stays on the shape because the
 * Gemini fallback path in judge.ts still reads it).
 */
export async function judgeWithClaude(
    prompt: string,
    opts: { label?: string; maxTokens?: number; images?: { buffer: Buffer; mimeType?: string }[] } = {},
): Promise<string> {
    const model = getModel("judge")
    const content: Anthropic.ContentBlockParam[] = [
        ...(await Promise.all((opts.images ?? []).map(toImageBlock))),
        { type: "text", text: prompt },
    ]
    const resp = await getClient().messages.create({
        model,
        max_tokens: opts.maxTokens ?? 2048,
        // effort is GA (no beta header). Low = fast/cheap, appropriate for an evaluative gate.
        output_config: { effort: "low" },
        messages: [{ role: "user", content }],
    })

    const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text
    if (!text) throw new Error("Claude judge returned no text")
    if (opts.label) console.log(`   ⚖️  ${opts.label}: ${model}`)
    return text
}
