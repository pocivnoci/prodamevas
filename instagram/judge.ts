/**
 * Cross-family judge dispatch.
 * ============================
 * The Critic + Chief Editor call judgeText() instead of generateTextQuality() directly. When the
 * Claude judge is enabled (ANTHROPIC_API_KEY set) it runs Claude Sonnet 5, so a DIFFERENT model
 * family gates the Gemini-written caption (writer ≠ judge → no self-preference bias). When Claude
 * is off — or errors mid-request — it falls back to the exact prior behaviour: the Gemini `textPro`
 * Pro ladder at the low "judge" temperature. Same contract as generateTextQuality: prompt in,
 * JSON-ish text out (callers parse identically either way). See docs/AI_PROVIDER_STRATEGY.md.
 */

import { generateTextQuality } from "./gemini-client"
import { claudeJudgeEnabled, judgeWithClaude } from "./anthropic-client"
import { getModel, hasFallback, getTemperature } from "./models"

export async function judgeText(prompt: string, opts: { label: string; maxTokens?: number }): Promise<string> {
    if (claudeJudgeEnabled()) {
        try {
            return await judgeWithClaude(prompt, opts)
        } catch (err: any) {
            // Non-fatal: any Claude hiccup drops to the Gemini judge rather than failing the post.
            console.warn(`⚠️ Claude judge (${opts.label}) failed — falling back to Gemini: ${String(err?.message || err).slice(0, 120)}`)
        }
    }
    // Gemini fallback (also the default when no key): Pro ladder at the low judge temperature.
    const models = [getModel("textPro")]
    if (hasFallback("textPro")) models.push(getModel("textPro", "fallback"))
    return generateTextQuality(prompt, { models, label: opts.label, temperature: getTemperature("judge") })
}

/**
 * Same cross-family dispatch as judgeText, but for a judge prompt that also needs to SEE images
 * (the native image QA). Without this, the Gemini image renderer grades its own Gemini render —
 * exactly the self-preference risk the text judge was built to avoid. Claude Sonnet 5 is
 * multimodal, so routing vision QA through it closes that gap; a Claude vision hiccup drops to
 * the Gemini visionQA ladder, same fail-open contract as judgeText.
 */
export async function judgeVision(
    prompt: string,
    images: { buffer: Buffer; mimeType?: string }[],
    opts: { label: string; maxTokens?: number },
): Promise<string> {
    if (claudeJudgeEnabled()) {
        try {
            return await judgeWithClaude(prompt, { ...opts, images })
        } catch (err: any) {
            console.warn(`⚠️ Claude vision judge (${opts.label}) failed — falling back to Gemini: ${String(err?.message || err).slice(0, 120)}`)
        }
    }
    const models = [getModel("visionQA")]
    if (hasFallback("visionQA")) models.push(getModel("visionQA", "fallback"))
    return generateTextQuality(prompt, { models, images, label: opts.label, temperature: getTemperature("judge") })
}
