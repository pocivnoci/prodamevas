/**
 * Anthropic Claude client — the cross-family gateway.
 * ===================================================
 * Two doors, two purposes:
 *
 *  - `judgeWithClaude` — the Critic + Chief Editor (the copywriter stays Gemini 3 Pro), so a
 *    different model family second-guesses the caption without self-preference bias — the
 *    "writer ≠ judge" rule from docs/AI_PROVIDER_STRATEGY.md. getModel("judge") → claude-sonnet-5.
 *  - `searchWithClaude` — the web-search pass of the fact gate (instagram/fact-web.ts): can a
 *    public page back this claim up, verbatim? getModel("factWeb") → claude-haiku-4-5.
 *
 * Both activate only when ANTHROPIC_API_KEY is present; otherwise the judge falls back to the
 * Gemini ladder (see instagram/judge.ts) and the web pass simply doesn't run — in both cases
 * behaviour returns to what it was before the feature existed, never to something worse.
 *
 * Model IDs live in instagram/models.ts.
 */

import Anthropic from "@anthropic-ai/sdk"
import sharp from "sharp"
import { getModel } from "./models"
import { recordUsage, recordUnits } from "./usage-meter"
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

    // Claude hlásí spotřebu pod jinými jmény než Gemini — mapujeme na tvar měřiče,
    // ať soudce není v telemetrii neviditelný (běží u každého postu, i vícekrát).
    recordUsage(model, {
        promptTokenCount: resp.usage?.input_tokens,
        candidatesTokenCount: resp.usage?.output_tokens,
        cachedContentTokenCount: resp.usage?.cache_read_input_tokens,
    }, opts.label ?? "judge")

    const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text
    if (!text) throw new Error("Claude judge returned no text")
    if (opts.label) console.log(`   ⚖️  ${opts.label}: ${model}`)
    return text
}

/**
 * Jeden nalezený doklad — přesně to, co API skutečně vrátilo.
 *
 * `url` a `title` pocházejí z bloků `web_search_result` / z citací
 * `web_search_result_location`, `quote` je `cited_text` (API ho zkracuje na 150
 * znaků). **Nic z toho nepíše model** — proto se tomu dá věřit i na levném tieru.
 */
export interface SearchEvidence {
    url: string
    title?: string
    quote?: string
}

/** Kolikrát smí jedno volání pokračovat po `pause_turn`, než to vzdáme. */
const MAX_PAUSE_CONTINUATIONS = 2

/**
 * Claude s web searchem — druhá, levná brána k Anthropicu vedle `judgeWithClaude`.
 * =============================================================================
 * Existuje kvůli jediné otázce: **stojí tohle tvrzení na nějaké veřejné stránce
 * doslova napsané?** Volá ji `instagram/fact-web.ts`; nic jiného sem nemá chodit.
 *
 * Vrací text modelu ZVLÁŠŤ od dokladů, protože volající nesmí věřit textu. `evidence`
 * je množina toho, co API opravdu našlo — a jen proti ní se pak ověřuje, jestli si
 * model URL nevymyslel (táž pojistka jako `known.has()` v `lib/brand-facts.ts`).
 *
 * Tři zvláštnosti server toolu, které tu musí být ošetřené, protože jinak padají tiše:
 *  1. `web_search_tool_result.content` je při úspěchu POLE výsledků, ale při chybě
 *     OBJEKT `{ error_code }` — indexace by spadla, nebo (hůř) prošla jako prázdno.
 *  2. `stop_reason: "pause_turn"` znamená „běžím dál" — asistentova zpráva se posílá
 *     beze změny zpátky. Bez toho by se dlouhé hledání utnulo v půlce.
 *  3. Odpověď s hledáním má textových bloků VÍC (model komentuje mezi hledáními),
 *     takže se musí spojit všechny. `find(...)` by vrátil úvodní „Podívám se…".
 *
 * Účtování jde ve DVOU záznamech: tokeny (`recordUsage`) a hledání (`recordUnits`,
 * $0,01/kus). Jeden záznam neumí obojí a mlčky by zahodil polovinu ceny.
 */
export async function searchWithClaude(
    prompt: string,
    opts: { label?: string; maxTokens?: number; maxSearches?: number; blockedDomains?: string[] } = {},
): Promise<{ text: string; evidence: SearchEvidence[] }> {
    const model = getModel("factWeb")
    const blocked = (opts.blockedDomains ?? []).filter(Boolean)
    const tool: Record<string, unknown> = {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: opts.maxSearches ?? 3,
    }
    // `allowed_domains` a `blocked_domains` se navzájem vylučují (jinak 400); posílá
    // se jen neprázdný seznam.
    if (blocked.length > 0) tool.blocked_domains = blocked

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }]
    const evidence: SearchEvidence[] = []
    const texts: string[] = []
    let searches = 0

    for (let turn = 0; turn <= MAX_PAUSE_CONTINUATIONS; turn++) {
        const resp = await getClient().messages.create({
            model,
            max_tokens: opts.maxTokens ?? 2048,
            // Haiku 4.5 NENÍ „5-generation" model: `output_config.effort` na něm končí
            // chybou (na rozdíl od Sonnetu 5 v judgeWithClaude výš). Thinking se tu
            // nezapíná — úkol je vyhledat a odpovědět, ne uvažovat.
            tools: [tool as unknown as Anthropic.ToolUnion],
            messages,
        })

        recordUsage(model, {
            promptTokenCount: resp.usage?.input_tokens,
            candidatesTokenCount: resp.usage?.output_tokens,
            cachedContentTokenCount: resp.usage?.cache_read_input_tokens,
        }, opts.label ?? "fact-web")
        searches += (resp.usage as { server_tool_use?: { web_search_requests?: number } } | undefined)
            ?.server_tool_use?.web_search_requests ?? 0

        for (const block of resp.content as unknown as Record<string, any>[]) {
            if (block.type === "text") {
                if (typeof block.text === "string") texts.push(block.text)
                // Citace nesou doslovný úryvek stránky — nejcennější část dokladu.
                for (const c of (block.citations ?? []) as Record<string, any>[]) {
                    if (typeof c?.url === "string") {
                        evidence.push({ url: c.url, title: c.title, quote: c.cited_text })
                    }
                }
            }
            if (block.type === "web_search_tool_result") {
                // Chybový tvar: `content` je objekt, ne pole. Hlásí se, ale nezabíjí —
                // nenalezené tvrzení prostě zůstane nepodložené.
                if (!Array.isArray(block.content)) {
                    console.warn(`   ⚠️ web_search: ${block.content?.error_code ?? "neznámá chyba"}`)
                    continue
                }
                for (const r of block.content as Record<string, any>[]) {
                    if (typeof r?.url === "string") evidence.push({ url: r.url, title: r.title })
                }
            }
        }

        if (resp.stop_reason !== "pause_turn") break
        // Pokračování: asistentova zpráva se vrací BEZE ZMĚNY (včetně
        // `encrypted_content` u výsledků, jinak API odpoví 400).
        messages.push({ role: "assistant", content: resp.content })
    }

    if (searches > 0) recordUnits(model, "searches", searches, opts.label ?? "fact-web")
    if (opts.label) console.log(`   🌐 ${opts.label}: ${model} (${searches}× hledání)`)

    return { text: texts.join("\n"), evidence }
}

// ─── Reelový režisér ────────────────────────────────────────────────────────

/**
 * Whether the Claude reel director is available. Same shape as the judge switch:
 * needs ANTHROPIC_API_KEY; CLAUDE_DIRECTOR=off forces the Gemini Pro ladder.
 */
export function claudeDirectorEnabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.CLAUDE_DIRECTOR !== "off"
}

/**
 * Storyboard pass for reels (`instagram/reel-director.ts`). Unlike the judge this is a
 * CREATIVE step, so it runs at medium effort with room for a full JSON storyboard.
 * Reference images (brand photos, product, logo) go in labelled, so the director can
 * point each shot at a concrete picture instead of describing a generic one.
 */
export async function directWithClaude(
    prompt: string,
    opts: { label?: string; maxTokens?: number; images?: { buffer: Buffer; mimeType?: string; label?: string }[] } = {},
): Promise<string> {
    const model = getModel("reelDirector")
    const content: Anthropic.ContentBlockParam[] = []
    for (const img of opts.images ?? []) {
        if (img.label) content.push({ type: "text", text: img.label })
        content.push(await toImageBlock(img))
    }
    content.push({ type: "text", text: prompt })

    const resp = await getClient().messages.create({
        model,
        max_tokens: opts.maxTokens ?? 4096,
        output_config: { effort: "medium" },
        messages: [{ role: "user", content }],
    })

    recordUsage(model, {
        promptTokenCount: resp.usage?.input_tokens,
        candidatesTokenCount: resp.usage?.output_tokens,
        cachedContentTokenCount: resp.usage?.cache_read_input_tokens,
    }, opts.label ?? "reel-director")

    const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text
    if (!text) throw new Error("Claude director returned no text")
    console.log(`   🎬 ${opts.label ?? "reel-director"}: ${model}`)
    return text
}
