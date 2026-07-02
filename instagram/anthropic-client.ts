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
 * Run a judge prompt through Claude and return the raw text. The prompt already instructs a JSON
 * shape, and callers parse it exactly as they parse the Gemini judge output — so this is a drop-in.
 *
 * Reliability without a temperature knob: Sonnet 5 is a "5-generation" model (like Opus 4.8 / Fable
 * 5) — it rejects `temperature`/`top_p`/`top_k`. We instead run at LOW effort with adaptive thinking
 * left off, and lean on the tight scoring rubric already baked into the prompt. Small `max_tokens`
 * (judge output is a score + a couple short lists) keeps it fast and cheap across ≤3 rounds/post.
 */
export async function judgeWithClaude(
    prompt: string,
    opts: { label?: string; maxTokens?: number } = {},
): Promise<string> {
    const model = getModel("judge")
    const resp = await getClient().messages.create({
        model,
        max_tokens: opts.maxTokens ?? 2048,
        // effort is GA (no beta header). Low = fast/cheap, appropriate for an evaluative gate.
        output_config: { effort: "low" },
        messages: [{ role: "user", content: prompt }],
    })

    const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text
    if (!text) throw new Error("Claude judge returned no text")
    if (opts.label) console.log(`   ⚖️  ${opts.label}: ${model}`)
    return text
}
