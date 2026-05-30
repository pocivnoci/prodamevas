/**
 * Editorial Board — Multi-Round Review System (Šéfredaktor)
 * ===========================================================
 *
 * Implements a hierarchical editorial review where a Chief Editor
 * reviews and iterates on content with subordinate agents:
 *
 *   🎖️ Chief Editor (Šéfredaktor) — top-level reviewer
 *   📊 Strategist (Content Planner) — creates week plans
 *   ✍️ Copywriter — generates captions
 *   🔍 Critic — scores quality
 *
 * Agents can "push back" — argue against changes they disagree with.
 * Multiple review rounds ensure quality. Token cost is intentionally higher.
 *
 * Usage:
 *   - reviewContentPlan() — multi-round review of a week plan
 *   - reviewPost()         — multi-round review of a single post
 */

import { generateText } from "./gemini-client"
import { COSTS } from "./caption-generator"
import type { ClientConfig } from "./configs/types"
import type {
    EditorialMessage,
    EditorialRound,
    EditorialPlanResult,
    EditorialPostResult,
    EditorialProgressCallback,
    EditorialAction,
} from "./types"

// ============================================
// CONFIG
// ============================================

const MAX_PLAN_ROUNDS = 3
const MAX_POST_ROUNDS = 3

// ============================================
// CHIEF EDITOR — Content Plan Review
// ============================================

/**
 * Build the Chief Editor prompt for reviewing a content plan.
 * The editor is strict, opinionated, and checks for strategic coherence.
 */
function buildPlanReviewPrompt(
    config: ClientConfig,
    plan: any[],
    conversationHistory: EditorialMessage[],
    round: number,
): string {
    const historyBlock = conversationHistory.length > 0
        ? `\n## PŘEDCHOZÍ DISKUZE (${conversationHistory.length} zpráv)\n${conversationHistory.map(m => {
            const roleLabel = {
                strategist: "📊 STRATÉG",
                copywriter: "✍️ COPYWRITER",
                critic: "🔍 KRITIK",
                chief_editor: "🎖️ ŠÉFREDAKTOR",
            }[m.role]
            return `**${roleLabel}** [${m.action}]:\n${m.content}`
        }).join("\n\n---\n\n")}\n`
        : ""

    const planBlock = plan.map((s, i) => {
        const weather = s.weatherContext ? ` | ☁️ ${s.weatherContext}` : ""
        const calendar = s.calendarContext ? ` | 📅 ${s.calendarContext}` : ""
        return `${i + 1}. **${s.day} ${s.time}** → ${s.postType}: "${s.topic}"${weather}${calendar}\n   Důvod: ${s.reason}`
    }).join("\n")

    return `
Jsi ŠÉFREDAKTOR (Chief Editor) pro značku "${config.name}" (${config.website}).
Tvoje role je NEKOMPROMISNÍ kontrola kvality obsahového plánu.

## BRAND IDENTITA
${config.brandVoice?.persona?.substring(0, 300) || ""}
Hodnoty: ${config.brandVoice?.values?.join(", ") || ""}
Obor: ${config.industry || "business"} | Web: ${config.website} | IG: ${config.instagram}

## PILÍŘE OBSAHU
${Object.entries(config.contentPillars).map(([key, p]) => `- ${p.emoji} ${p.label} (${p.postTypes.join(", ")}): ${p.description || ""}`).join("\n")}

${config.products?.length ? `## PRODUKTY (${config.products.length})\n${config.products.slice(0, 5).map(p => `- ${p.name}`).join("\n")}` : ""}
${historyBlock}
## AKTUÁLNÍ CONTENT PLAN (kolo ${round}/${MAX_PLAN_ROUNDS})
${planBlock}

## TVOJE KRITÉRIA (kontroluj KAŽDÉ):
1. **KOHERENCE** — Navazují dny tematicky? Buduje se příběh přes týden, nebo je to nahodilý mix?
2. **ROZMANITOST** — Nejsou 2+ stejné typy postů za sebou? Mix formátů (carousel, reel, image)?
3. **SEZÓNNOST** — Využívá plan sezónní příležitosti, svátky, počasí kde to dává smysl?
4. **BRAND FIT** — Odpovídá KAŽDÝ post brand voice a hodnotám značky?
5. **TIMING** — Dávají časy postingu smysl (ráno vs večer pro daný typ)?
6. **ENGAGEMENT STRATEGIE** — Je mix reach/conversion/value postů správný?
7. **CHYBĚJÍCÍ PŘÍLEŽITOSTI** — Vidíš něco co plan ignoruje a neměl by?

## INSTRUKCE
- Pokud je plan dobrý, odpověz verdict: "approved"
- Pokud má problémy, odpověz verdict: "revise" a dej KONKRÉTNÍ poznámky CO a JAK opravit
- Pokud je plan úplně mimo, odpověz verdict: "rejected" s vysvětlením
- Buď PŘÍSNÝ — schvaluj JEN to, co bys sám jako šéfredaktor publikoval
- Pokud Stratég pushbacknul na tvou předchozí poznámku a má pravdu, uznej to
- Nebuď zbytečně přísný na věci co fungují — zaměř se na REÁLNÉ problémy

Vrať POUZE validní JSON:
{
  "verdict": "approved" | "revise" | "rejected",
  "feedback": "Celkové hodnocení (1-2 věty)",
  "issues": [
    { "slot": 1, "problem": "popis problému", "suggestion": "co s tím" }
  ],
  "strengths": ["co je dobré a NESMÍ se měnit"]
}
`.trim()
}

/**
 * Build the Strategist's revision prompt — takes editor feedback
 * and either implements changes or pushes back with reasoning.
 */
function buildStrategistRevisionPrompt(
    config: ClientConfig,
    currentPlan: any[],
    editorFeedback: string,
    conversationHistory: EditorialMessage[],
): string {
    const planBlock = currentPlan.map((s, i) =>
        `${i + 1}. ${s.day} ${s.time} → ${s.postType}: "${s.topic}"`
    ).join("\n")

    return `
Jsi CONTENT STRATÉG pro značku "${config.name}" (${config.website}).
Šéfredaktor ti vrátil content plan s poznámkami. Musíš reagovat.

## TVŮJ AKTUÁLNÍ PLÁN
${planBlock}

## ŠÉFREDAKTOROVY POZNÁMKY
${editorFeedback}

## PILÍŘE OBSAHU (co máš k dispozici)
${Object.entries(config.contentPillars).map(([key, p]) => `- ${p.emoji} ${p.label}: ${p.postTypes.join(", ")}`).join("\n")}

## INSTRUKCE
Pro KAŽDOU poznámku šéfredaktora buď:
1. **IMPLEMENTUJ** změnu — přepracuj daný slot v plánu
2. **PUSHBACK** — pokud nesouhlasíš, vysvětli PROČ (s argumenty, ne jen "nechci")

PRAVIDLA:
- Pushback je OK pokud máš dobrý důvod (brand specifický kontext, data, logika)
- Pokud pushbackneš, nabídni ALTERNATIVU
- Nikdy nepushbackuj na VŠE — to je sabotáž, ne spolupráce
- Zachovej všechny sloty co šéfredaktor pochválil

Vrať POUZE validní JSON:
{
  "action": "fix" | "pushback",
  "explanation": "Co jsi změnil a proč (nebo proč nesouhlasíš)",
  "plan": [
    {
      "day": "monday",
      "date": "2026-05-19",
      "time": "17:00",
      "postType": "behind_the_scenes",
      "topic": "přepracované téma",
      "reason": "proč tento den a čas",
      "weatherContext": "28°C jasno" | null,
      "calendarContext": "Den matek" | null
    }
  ]
}
`.trim()
}

/**
 * Multi-round editorial review of a content plan.
 * Returns the final approved plan + full conversation log.
 */
export async function reviewContentPlan(
    config: ClientConfig,
    initialPlan: any[],
    onProgress?: EditorialProgressCallback,
): Promise<EditorialPlanResult> {
    const report = onProgress || (async () => {})
    const allMessages: EditorialMessage[] = []
    const rounds: EditorialRound[] = []
    let currentPlan = [...initialPlan]
    let totalCost = 0

    // Initial strategist proposal
    const initialProposal: EditorialMessage = {
        role: "strategist",
        action: "propose",
        content: `Content plan: ${currentPlan.map(s => `${s.day} ${s.time} → ${s.postType}: "${s.topic}"`).join("; ")}`,
        summary: `📊 Stratég navrhl ${currentPlan.length} postů`,
    }
    allMessages.push(initialProposal)

    for (let round = 1; round <= MAX_PLAN_ROUNDS; round++) {
        await report(
            "chief_editor",
            10 + round * 5,
            `🎖️ Šéfredaktor reviewuje content plan (kolo ${round}/${MAX_PLAN_ROUNDS})...`,
            [...allMessages],
        )

        // Chief Editor reviews
        console.log(`\n🎖️ [Editorial] Content Plan — Kolo ${round}/${MAX_PLAN_ROUNDS}`)
        const reviewPrompt = buildPlanReviewPrompt(config, currentPlan, allMessages, round)
        const reviewRaw = await generateText(reviewPrompt, { model: "gemini-3.5-flash" })
        totalCost += COSTS.textGeneration

        let review: { verdict: string; feedback: string; issues?: any[]; strengths?: string[] }
        try {
            const jsonMatch = reviewRaw.match(/\{[\s\S]*\}/)
            review = JSON.parse(jsonMatch?.[0] || reviewRaw)
        } catch {
            review = { verdict: "approved", feedback: "Review parse failed — auto-approve" }
        }

        const editorMessage: EditorialMessage = {
            role: "chief_editor",
            action: review.verdict === "approved" ? "approve" : review.verdict === "rejected" ? "reject" : "revise",
            content: `${review.feedback}${review.issues?.length ? `\n\nProblémy:\n${review.issues.map(i => `- Slot ${i.slot}: ${i.problem} → ${i.suggestion}`).join("\n")}` : ""}${review.strengths?.length ? `\n\nSilné stránky: ${review.strengths.join(", ")}` : ""}`,
            summary: review.verdict === "approved"
                ? `✅ Šéfredaktor schválil plan`
                : `🔄 Šéfredaktor vrátil: ${review.issues?.length || 0} poznámek`,
        }
        allMessages.push(editorMessage)

        console.log(`   ${review.verdict === "approved" ? "✅" : "🔄"} Verdict: ${review.verdict} — ${review.feedback}`)
        if (review.issues?.length) {
            review.issues.forEach(i => console.log(`   📌 Slot ${i.slot}: ${i.problem}`))
        }

        // If approved, we're done
        if (review.verdict === "approved") {
            rounds.push({
                round,
                messages: [editorMessage],
                verdict: "approved",
            })
            await report(
                "chief_editor",
                25,
                `✅ Content plan schválen po ${round} ${round === 1 ? "kole" : "kolech"}`,
                [...allMessages],
            )
            break
        }

        // If rejected on last round, accept what we have
        if (round === MAX_PLAN_ROUNDS) {
            rounds.push({
                round,
                messages: [editorMessage],
                verdict: review.verdict as "revise" | "rejected",
            })
            console.log(`   ⏰ Max rounds reached — using current plan`)
            await report(
                "chief_editor",
                25,
                `⏰ Max ${MAX_PLAN_ROUNDS} kol — používám aktuální verzi`,
                [...allMessages],
            )
            break
        }

        // Strategist revises or pushes back
        await report(
            "strategist",
            10 + round * 5 + 3,
            `📊 Stratég přepracovává plan...`,
            [...allMessages],
        )

        const revisionPrompt = buildStrategistRevisionPrompt(
            config,
            currentPlan,
            editorMessage.content,
            allMessages,
        )
        const revisionRaw = await generateText(revisionPrompt, { model: "gemini-3.5-flash" })
        totalCost += COSTS.textGeneration

        let revision: { action: string; explanation: string; plan: any[] }
        try {
            const jsonMatch = revisionRaw.match(/\{[\s\S]*\}/)
            revision = JSON.parse(jsonMatch?.[0] || revisionRaw)
        } catch {
            revision = { action: "fix", explanation: "Parse failed — keeping plan", plan: currentPlan }
        }

        const strategistAction: EditorialAction = revision.action === "pushback" ? "pushback" : "fix"
        const strategistMessage: EditorialMessage = {
            role: "strategist",
            action: strategistAction,
            content: revision.explanation,
            summary: strategistAction === "pushback"
                ? `💬 Stratég nesouhlasí: ${revision.explanation.substring(0, 80)}...`
                : `🔧 Stratég přepracoval plan`,
        }
        allMessages.push(strategistMessage)

        console.log(`   📊 Stratég: [${strategistAction}] ${revision.explanation.substring(0, 100)}`)

        // Update plan with revisions (even pushback may have partial changes)
        if (revision.plan?.length > 0) {
            // Validate slots have required fields
            const validSlots = revision.plan.filter(s => s.day && s.postType && s.topic)
            if (validSlots.length > 0) {
                currentPlan = validSlots.map(s => ({ ...s, source: "planned" as const }))
            }
        }

        rounds.push({
            round,
            messages: [editorMessage, strategistMessage],
            verdict: "revise",
        })
    }

    return {
        plan: currentPlan,
        rounds,
        totalTokenCost: totalCost,
        approved: rounds[rounds.length - 1]?.verdict === "approved",
    }
}

// ============================================
// CHIEF EDITOR — Single Post Review
// ============================================

/**
 * Build Chief Editor prompt for reviewing a single post.
 */
function buildPostReviewPrompt(
    config: ClientConfig,
    captionData: any,
    postTypeName: string,
    criticFeedback: { score: number; detail?: any },
    conversationHistory: EditorialMessage[],
    round: number,
): string {
    const historyBlock = conversationHistory.length > 0
        ? `\n## PŘEDCHOZÍ DISKUZE (${conversationHistory.length} zpráv)\n${conversationHistory.map(m => {
            const roleLabel = {
                strategist: "📊 STRATÉG",
                copywriter: "✍️ COPYWRITER",
                critic: "🔍 KRITIK",
                chief_editor: "🎖️ ŠÉFREDAKTOR",
            }[m.role]
            return `**${roleLabel}** [${m.action}]:\n${m.content}`
        }).join("\n\n---\n\n")}\n`
        : ""

    const isCarousel = captionData.slides?.length > 0
    const slidesBlock = isCarousel && captionData.slides
        ? `\nSlidy:\n${captionData.slides.map((s: any, i: number) => `  ${i + 1}. "${s.headline}" — ${s.subtext}`).join("\n")}`
        : ""

    return `
Jsi ŠÉFREDAKTOR (Chief Editor) pro značku "${config.name}" (${config.website}).
Rozhoduješ, zda se tento příspěvek PUBLIKUJE nebo SE VRÁTÍ k přepracování.

## BRAND IDENTITA
${config.brandVoice?.persona?.substring(0, 300) || ""}
Tón: ${config.brandVoice?.voiceTraits?.slice(0, 4).join(", ") || ""}
Anti-patterns: ${config.brandVoice?.antiPatterns?.slice(0, 5).join(", ") || ""}

## POST (typ: ${postTypeName}, kolo ${round}/${MAX_POST_ROUNDS})
**Hook:** "${captionData.hook}"
**Body:** "${captionData.body || ""}"${slidesBlock}
**CTA:** "${captionData.cta}"
**Hashtags:** ${(captionData.hashtags || []).join(", ")}

## HODNOCENÍ KRITIKA
Score: ${criticFeedback.score}/10
${criticFeedback.detail ? `Hook: ${criticFeedback.detail.hookScore}/3 | Body: ${criticFeedback.detail.bodyScore}/3 | CTA: ${criticFeedback.detail.ctaScore}/2 | Originalita: ${criticFeedback.detail.originalityScore}/2
${criticFeedback.detail.feedback?.keep?.length ? `✅ Zachovat: ${criticFeedback.detail.feedback.keep.join(", ")}` : ""}
${criticFeedback.detail.feedback?.fix?.length ? `🔧 Opravit: ${criticFeedback.detail.feedback.fix.join(", ")}` : ""}` : ""}
${historyBlock}
## TVOJE KRITÉRIA (jako šéfredaktor, ne robot):
1. **HOOK** — Zastaví scrollování? Je originální? Nepůsobí genericky?
2. **STORYTELLING** — Má body příběh? Nebo je to jen seznam generic facts?
3. **BRAND VOICE** — Zní to jako "${config.name}" nebo jako AI?
4. **CTA** — Je přirozené? Nemá to "odér reklamy"?
5. **CELKOVÝ DOJEM** — Přidal bys to na profil ${config.instagram}?

## INSTRUKCE
- Pokud Kritik dal 8+/10 A ty jsi spokojený → "approved"
- Pokud vidíš problémy → "revise" s PŘESNÝMI instrukcemi co změnit
- Neblokuj kvůli maličkostem (drobný wording) — zaměř se na ZÁSADNÍ problémy
- Pokud Copywriter pushbacknul a má pravdu, uznej to a schval
- Na posledním kole (${MAX_POST_ROUNDS}/${MAX_POST_ROUNDS}): buď tolerantnější — lepší publikovat OK post než žádný

Vrať POUZE validní JSON:
{
  "verdict": "approved" | "revise",
  "feedback": "Celkové hodnocení — CO je dobré a CO ne (2-3 věty)",
  "keepElements": ["prvky co se NESMÍ měnit"],
  "fixInstructions": ["přesný popis CO a JAK změnit — prázdné pokud approved"]
}
`.trim()
}

/**
 * Build Copywriter revision prompt — takes editor notes,
 * conversation history, and either fixes or pushes back.
 */
function buildCopywriterRevisionPrompt(
    config: ClientConfig,
    captionData: any,
    editorFeedback: string,
    keepElements: string[],
    fixInstructions: string[],
    megaPrompt: string,
    postTypeName: string,
    conversationHistory: EditorialMessage[],
): string {
    const isCarousel = captionData.slides?.length > 0
    const isReel = captionData.scenes?.length > 0

    return `
Jsi COPYWRITER pro značku "${config.name}".
Šéfredaktor ti vrátil příspěvek s poznámkami. Reaguj.

## AKTUÁLNÍ VERZE
Hook: "${captionData.hook}"
Body: "${captionData.body || ""}"
CTA: "${captionData.cta}"
${isCarousel && captionData.slides ? `Slides: ${captionData.slides.map((s: any) => `"${s.headline}"`).join(", ")}` : ""}

## ŠÉFREDAKTOROVY POZNÁMKY
${editorFeedback}

## ✅ ZACHOVAT (šéfredaktor schválil):
${keepElements.length > 0 ? keepElements.map(k => `- ${k}`).join("\n") : "- (nic specificky)"}

## 🔧 OPRAVIT:
${fixInstructions.map(f => `- ${f}`).join("\n")}

## BRAND VOICE (připomínka)
${config.brandVoice?.persona?.substring(0, 200) || ""}
Tón: ${config.brandVoice?.voiceTraits?.slice(0, 3).join(", ") || ""}

## INSTRUKCE
Pro KAŽDOU poznámku šéfredaktora buď:
1. **IMPLEMENTUJ** — přepracuj příslušnou část
2. **PUSHBACK** — pokud nesouhlasíš, vysvětli PROČ (s argumenty)

PRAVIDLA:
- ZACHOVEJ prvky co šéfredaktor schválil
- Pushback jen pokud máš SILNÝ argument (brand context, cílová skupina, logika)
- Nikdy nepushbackuj na VŠE
- Vrať KOMPLETNÍ přepracovaný JSON se VŠEMI poli

Vrať POUZE validní JSON:
{
  "action": "fix" | "pushback",
  "explanation": "Co jsi změnil a proč (max 2 věty)",
  "hook": "...",
  "body": "...",
  "cta": "...",
  "hashtags": ["..."],
  "imagePrompt": "...",
  "imageSubtext": "..."${isCarousel ? `,
  "slides": [{ "headline": "...", "subtext": "...", "imagePrompt": "..." }],
  "visualTheme": "..."` : ""}${isReel ? `,
  "scenes": [{ "timeRange": "...", "visual": "...", "camera": "...", "mood": "..." }],
  "videoScript": "...",
  "caption": "..."` : ""}
}
`.trim()
}

/**
 * Multi-round editorial review of a single post.
 * Called AFTER initial caption generation + critic scoring.
 */
export async function reviewPost(
    config: ClientConfig,
    captionData: any,
    postTypeName: string,
    criticResult: { score: number; feedback: string; detail?: any },
    megaPrompt: string,
    onProgress?: EditorialProgressCallback,
): Promise<EditorialPostResult> {
    const report = onProgress || (async () => {})
    const allMessages: EditorialMessage[] = []
    const rounds: EditorialRound[] = []
    let currentCaption = { ...captionData }
    let totalCost = 0
    let lastScore = criticResult.score

    // Initial copywriter proposal
    const copywriterProposal: EditorialMessage = {
        role: "copywriter",
        action: "propose",
        content: `Hook: "${currentCaption.hook}" | Body: "${(currentCaption.body || "").substring(0, 100)}..." | CTA: "${currentCaption.cta}"`,
        summary: `✍️ Copywriter navrhl: "${currentCaption.hook.substring(0, 50)}..."`,
    }
    allMessages.push(copywriterProposal)

    // Critic's initial assessment
    const criticMessage: EditorialMessage = {
        role: "critic",
        action: criticResult.score >= 8 ? "approve" : "revise",
        content: `Score: ${criticResult.score}/10 — ${criticResult.feedback}${criticResult.detail?.feedback?.keep?.length ? `\nZachovat: ${criticResult.detail.feedback.keep.join(", ")}` : ""}${criticResult.detail?.feedback?.fix?.length ? `\nOpravit: ${criticResult.detail.feedback.fix.join(", ")}` : ""}`,
        summary: `${criticResult.score >= 8 ? "✅" : "⚠️"} Kritik: ${criticResult.score}/10`,
    }
    allMessages.push(criticMessage)

    // If critic gave 9+ and no fixes, auto-approve (save tokens)
    if (criticResult.score >= 9 && (!criticResult.detail?.feedback?.fix?.length)) {
        console.log(`   🎖️ [Editorial] Score ${criticResult.score}/10 — auto-approved (no fixes needed)`)
        rounds.push({
            round: 0,
            messages: [copywriterProposal, criticMessage],
            verdict: "approved",
        })
        return {
            captionData: currentCaption,
            rounds,
            totalTokenCost: 0,
            approved: true,
            finalScore: criticResult.score,
        }
    }

    for (let round = 1; round <= MAX_POST_ROUNDS; round++) {
        await report(
            "chief_editor",
            45 + round * 5,
            `🎖️ Šéfredaktor reviewuje post (kolo ${round}/${MAX_POST_ROUNDS})...`,
            [...allMessages],
        )

        // Chief Editor reviews
        console.log(`\n🎖️ [Editorial] Post Review — Kolo ${round}/${MAX_POST_ROUNDS}`)
        const reviewPrompt = buildPostReviewPrompt(
            config,
            currentCaption,
            postTypeName,
            { score: lastScore, detail: criticResult.detail },
            allMessages,
            round,
        )
        const reviewRaw = await generateText(reviewPrompt, { model: "gemini-3.5-flash" })
        totalCost += COSTS.textGeneration

        let review: { verdict: string; feedback: string; keepElements?: string[]; fixInstructions?: string[] }
        try {
            const jsonMatch = reviewRaw.match(/\{[\s\S]*\}/)
            review = JSON.parse(jsonMatch?.[0] || reviewRaw)
        } catch {
            review = { verdict: "approved", feedback: "Review parse failed — auto-approve" }
        }

        const editorMessage: EditorialMessage = {
            role: "chief_editor",
            action: review.verdict === "approved" ? "approve" : "revise",
            content: `${review.feedback}${review.fixInstructions?.length ? `\n\n🔧 Opravit:\n${review.fixInstructions.map(f => `- ${f}`).join("\n")}` : ""}${review.keepElements?.length ? `\n\n✅ Zachovat:\n${review.keepElements.map(k => `- ${k}`).join("\n")}` : ""}`,
            summary: review.verdict === "approved"
                ? `✅ Šéfredaktor schválil post`
                : `🔄 Šéfredaktor: ${review.fixInstructions?.length || 0} úprav`,
        }
        allMessages.push(editorMessage)

        const emoji = review.verdict === "approved" ? "✅" : "🔄"
        console.log(`   ${emoji} Verdict: ${review.verdict} — ${review.feedback.substring(0, 100)}`)

        // If approved, we're done
        if (review.verdict === "approved") {
            rounds.push({
                round,
                messages: [editorMessage],
                verdict: "approved",
            })
            await report(
                "chief_editor",
                55,
                `✅ Post schválen šéfredaktorem (kolo ${round})`,
                [...allMessages],
            )
            break
        }

        // If last round, accept what we have
        if (round === MAX_POST_ROUNDS) {
            rounds.push({
                round,
                messages: [editorMessage],
                verdict: "revise",
            })
            console.log(`   ⏰ Max rounds reached — using current version`)
            await report(
                "chief_editor",
                55,
                `⏰ Max ${MAX_POST_ROUNDS} kol — používám aktuální verzi`,
                [...allMessages],
            )
            break
        }

        // Copywriter revises or pushes back
        await report(
            "copywriter",
            45 + round * 5 + 3,
            `✍️ Copywriter přepracovává post...`,
            [...allMessages],
        )

        const revisionPrompt = buildCopywriterRevisionPrompt(
            config,
            currentCaption,
            review.feedback,
            review.keepElements || [],
            review.fixInstructions || [],
            megaPrompt,
            postTypeName,
            allMessages,
        )
        const copywriterRevisionSchema = {
            type: "object",
            properties: {
                action: { type: "string", description: "fix or pushback" },
                explanation: { type: "string", description: "What changed and why (max 2 sentences)" },
                hook: { type: "string" },
                body: { type: "string" },
                cta: { type: "string" },
                hashtags: { type: "array", items: { type: "string" } },
                imagePrompt: { type: "string" },
                imageSubtext: { type: "string" },
            },
            required: ["action", "explanation", "hook", "body", "cta", "hashtags"],
        }
        const revisionRaw = await generateText(revisionPrompt, {
            model: "gemini-3.5-flash",
            responseSchema: copywriterRevisionSchema,
        })
        totalCost += COSTS.textGeneration

        let revision: any
        try {
            // generateText with responseSchema returns clean JSON
            const jsonMatch = revisionRaw.match(/\{[\s\S]*\}/)
            revision = JSON.parse(jsonMatch?.[0] || revisionRaw)
        } catch (parseErr: any) {
            console.warn(`   ⚠️ Copywriter revision parse error: ${parseErr?.message?.substring(0, 80)}`)
            console.warn(`   ⚠️ Raw response (first 200 chars): ${revisionRaw.substring(0, 200)}`)
            revision = { action: "fix", explanation: "Parse failed — keeping current", ...currentCaption }
        }

        const copywriterAction: EditorialAction = revision.action === "pushback" ? "pushback" : "fix"
        const copywriterMessage: EditorialMessage = {
            role: "copywriter",
            action: copywriterAction,
            content: revision.explanation || "Přepracováno dle poznámek.",
            summary: copywriterAction === "pushback"
                ? `💬 Copywriter nesouhlasí: ${(revision.explanation || "").substring(0, 80)}...`
                : `🔧 Copywriter přepracoval post`,
        }
        allMessages.push(copywriterMessage)

        console.log(`   ✍️ Copywriter: [${copywriterAction}] ${(revision.explanation || "").substring(0, 100)}`)

        // Update caption data with revisions (preserve fields not returned)
        if (revision.hook) currentCaption.hook = revision.hook
        if (revision.body) currentCaption.body = revision.body
        if (revision.cta) currentCaption.cta = revision.cta
        if (revision.hashtags) currentCaption.hashtags = revision.hashtags
        if (revision.imagePrompt) currentCaption.imagePrompt = revision.imagePrompt
        if (revision.imageSubtext) currentCaption.imageSubtext = revision.imageSubtext
        if (revision.accentWords) currentCaption.accentWords = revision.accentWords
        if (revision.slides) currentCaption.slides = revision.slides
        if (revision.visualTheme) currentCaption.visualTheme = revision.visualTheme
        if (revision.scenes) currentCaption.scenes = revision.scenes
        if (revision.videoScript) currentCaption.videoScript = revision.videoScript
        if (revision.caption) currentCaption.caption = revision.caption

        rounds.push({
            round,
            messages: [editorMessage, copywriterMessage],
            verdict: "revise",
        })
    }

    return {
        captionData: currentCaption,
        rounds,
        totalTokenCost: totalCost,
        approved: rounds[rounds.length - 1]?.verdict === "approved",
        finalScore: lastScore,
    }
}

// ============================================
// OVERLAY COMPOSITION CHECK — Vision-based
// ============================================

import { ai } from "./gemini-client"

export interface OverlayCheckResult {
    ok: boolean
    issues: string[]
    compositionHint?: string // instruction for image prompt if regeneration needed
}

/**
 * Use Gemini Vision to check if the text overlay covers important elements.
 * Returns ok:true if composition is acceptable, or issues + compositionHint for regen.
 * Cost: ~$0.025 per check (flash vision is cheap).
 */
export async function reviewOverlayComposition(
    finalImageBuffer: Buffer,
    overlayVariant: string,
    hookText: string,
): Promise<OverlayCheckResult> {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            inlineData: {
                                mimeType: "image/png",
                                data: finalImageBuffer.toString("base64"),
                            },
                        },
                        {
                            text: `You are a visual quality inspector for Instagram posts.

This image has TEXT OVERLAY added on top. The overlay text says: "${hookText}"

Check these CRITICAL issues:
1. Does the text overlay COVER a human FACE? (partially or fully)
2. Does the text overlay COVER a PRODUCT or brand logo that should be visible?
3. Is the text UNREADABLE because the background behind it is too busy/light/similar color?
4. Does the text cover any other important visual element that ruins the image?

IMPORTANT: A gradient darkens the area behind the text — this is INTENTIONAL and OK.
The text being at the ${overlayVariant === "top" || overlayVariant === "editorial" ? "top" : overlayVariant === "centered" ? "center" : "bottom"} of the image is INTENTIONAL.

Return ONLY valid JSON:
{
  "ok": true/false,
  "issues": ["list of specific problems, empty if ok"],
  "compositionHint": "if NOT ok — describe where the main subject should be placed instead (e.g. 'put face/product in upper half, leave bottom clean') — empty string if ok"
}`,
                        },
                    ],
                },
            ],
            config: {
                responseMimeType: "application/json",
            } as any,
        })

        const text = response.candidates?.[0]?.content?.parts?.[0]?.text
        if (!text) return { ok: true, issues: [] }

        const parsed = JSON.parse(text.replace(/```(?:json)?/g, "").trim())
        return {
            ok: !!parsed.ok,
            issues: parsed.issues || [],
            compositionHint: parsed.compositionHint || undefined,
        }
    } catch (err: any) {
        console.warn(`   ⚠️ Overlay vision check failed: ${err?.message?.substring(0, 80)}`)
        return { ok: true, issues: [] } // Fail open — don't block on vision errors
    }
}
