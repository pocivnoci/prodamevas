/**
 * Content-plan pipeline — deep multi-stage planner.
 * =================================================
 * The plan preview used to be ONE flash call with self-graded hooks — fast but shallow
 * ("hotové za 5 s" and it read like it). The plan is the strategic backbone of a whole
 * campaign, so it now mirrors the post pipeline's quality architecture, scaled to planning:
 *
 *   1. STRATEGIST (Pro ladder)   — campaign arc + per-post focus from full brand context
 *   2. CONCEPTS   (Pro ladder)   — hooks/angles/topics written AGAINST the strategy
 *   3. JUDGE      (cross-family) — judgeText() scores every hook 1-10 + concrete fix notes
 *                                  (Claude when enabled: writer family ≠ judge family, so
 *                                  scores are honest — self-grading was systematically inflated)
 *   4. REVISION   (Pro ladder)   — hooks under threshold rewritten per fix notes, re-judged;
 *                                  the better of original vs revised wins (per judge score)
 *
 * Failure semantics (deliberate, mirrors judge.ts philosophy):
 *  - CONCEPTS is the core: if the Pro ladder is exhausted → QualityUnavailableError
 *    propagates. NEVER a flash fallback — flash plans are the thing this file kills.
 *  - STRATEGIST / JUDGE / REVISION are enhancers: a failure logs loudly and skips the
 *    stage; the plan still ships (with self-scores when the judge is down, `judged: false`).
 */

import { Type } from "@google/genai"
import { generateTextQuality } from "./gemini-client"
import { judgeText } from "./judge"
import { getModel, hasFallback, getTemperature } from "./models"

export interface PlanConcept {
    hookPreview: string
    angle: string
    topic: string
    qualityScore?: number
    ideaIndex?: number
    /** 1-based index into the numbered product list in contextBlock — which catalog
     *  product this post is actually built on. The action maps it to a real
     *  ig_products id; without it the product attached to a post is a coin flip. */
    productIndex?: number
}

export interface PlanPipelineInput {
    brandName: string
    website: string
    count: number
    /** Everything brand-shaped, pre-assembled by the action (voice, products, personas,
     *  grounding, idea bank, top hooks, dedup, campaign topic). Pipeline treats it opaquely. */
    contextBlock: string
    /** Strategic post sequence incl. per-post format labels — source of truth for count/format. */
    typeList: string
    /** Recent hooks for the judge's similarity penalty (subset of contextBlock, structured). */
    recentHooks: string[]
    onStage?: (progress: number, message: string) => void | Promise<void>
}

export interface PlanPipelineResult {
    concepts: PlanConcept[]
    /** Campaign arc from the strategist — shown in the plan preview UI. Null if stage skipped. */
    strategySummary: string | null
    /** True when the cross-family judge actually scored the hooks (false = self-scores). */
    judged: boolean
}

/** Judge threshold: hooks scored below this get a targeted rewrite (stage 4). */
const REVISE_BELOW = 7

export const plannerModels = (): string[] => {
    const models = [getModel("planner")]
    if (hasFallback("planner")) models.push(getModel("planner", "fallback"))
    return models
}

export const conceptSchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            hookPreview: { type: Type.STRING },
            angle: { type: Type.STRING },
            topic: { type: Type.STRING },
            qualityScore: { type: Type.INTEGER },
            // 1-based index into the idea bank when the post builds on a bank idea
            ideaIndex: { type: Type.INTEGER },
            // 1-based index into the brand's numbered product list when the post is
            // built on one of them (see productFocusSection / product catalog block)
            productIndex: { type: Type.INTEGER },
        },
        required: ["hookPreview", "angle", "topic", "qualityScore"],
    },
}

const parseJsonArray = <T>(raw: string): T[] => {
    const match = raw.match(/\[[\s\S]*\]/)
    const parsed = JSON.parse(match ? match[0] : raw)
    if (!Array.isArray(parsed)) throw new Error("expected JSON array")
    return parsed
}

// ─── Stage 1: Strategist ────────────────────────────────────────────────────

interface PlanStrategy {
    arc: string
    postFocus: string[]
}

async function runStrategist(input: PlanPipelineInput): Promise<PlanStrategy | null> {
    const prompt = `Jsi senior content stratég pro značku "${input.brandName}" (${input.website}).

${input.contextBlock}

## SEKVENCE POSTŮ (typy + formáty, v tomto pořadí):
${input.typeList}

## ÚKOL
NEPIŠEŠ posty. Navrhuješ STRATEGII kampaně o ${input.count} postech, podle které je pak napíše copywriter.
1. "arc" — kampaňová linka (2–4 věty česky): jaký příběh série vypráví, jak graduje, jak se střídá dosah/hodnota/prodej. Konkrétně pro tuhle značku, žádné obecné marketingové fráze.
2. "postFocus" — pole PŘESNĚ ${input.count} položek. Pro každý post v sekvenci jedna věta (max 15 slov): na co se má post zaměřit a jakou roli hraje v lince. Respektuj typ i formát postu. Kde dává smysl použít nápad ze zásobníku, napiš "(nápad N)".

## PRAVIDLA
- Posty na sebe NAVAZUJÍ — série buduje příběh, ne náhodné izolované posty.
- Ověřené nápady a vzorce (zásobník, top hooky, brand memory) nasaď tam, kde mají největší páku.
- Vyhni se tématům z nedávných hooků (viz kontext).

Vrať POUZE validní JSON: { "arc": "...", "postFocus": ["...", ...] }`

    try {
        const raw = await generateTextQuality(prompt, {
            models: plannerModels(),
            label: "plan-strategist",
            temperature: getTemperature("designer"),
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    arc: { type: Type.STRING },
                    postFocus: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["arc", "postFocus"],
            },
        })
        const match = raw.match(/\{[\s\S]*\}/)
        const parsed = JSON.parse(match ? match[0] : raw)
        if (typeof parsed?.arc !== "string" || !Array.isArray(parsed?.postFocus)) return null
        return { arc: parsed.arc, postFocus: parsed.postFocus.map(String) }
    } catch (e: any) {
        console.warn(`📋 [plan-pipeline] strategist skipped: ${String(e?.message || e).substring(0, 150)}`)
        return null
    }
}

// ─── Stage 3: Cross-family judge ────────────────────────────────────────────

interface JudgeVerdict {
    score: number
    fix: string
}

async function judgeConcepts(
    input: PlanPipelineInput,
    concepts: PlanConcept[],
    formatLines: string[],
    label: string,
): Promise<Map<number, JudgeVerdict> | null> {
    const prompt = `Jsi nesmlouvavý kritik Instagram hooků pro značku "${input.brandName}". Hodnotíš NÁVRHY hooků z content plánu — tvoje skóre rozhoduje, které se přepíšou.

${input.contextBlock}

## NEDÁVNÉ HOOKY ZNAČKY (podobnost = penalizace):
${input.recentHooks.map(h => `- "${h}"`).join("\n") || "- (žádné)"}

## HODNOCENÉ KONCEPTY:
${concepts.map((c, i) => `${i + 1}. [${formatLines[i] || "?"}] Hook: "${c.hookPreview}" | Úhel: ${c.angle} | Téma: ${c.topic}`).join("\n")}

## RUBRIKA (skóre 1–10)
- Zastaví hook scrollování? (provokace, překvapení, extrémní specificita)
- Specificita: konkrétní čísla/jména/příklady > obecné řeči
- Sedí brand voice? (viz kontext — persona, anti-patterns)
- Sedí FORMÁT? Hook pro obrázek/karusel NESMÍ slibovat video/Reel/"za 60 sekund"
- Podobnost s nedávnými hooky nebo s jiným konceptem v plánu = stržené body
- Generické fráze ("Víte co…", "Dnes vám ukážu…", "Zajímavý fakt…") = max 4

Buď přísný: 8+ jen za hook, který by reálně zastavil palec. Průměr plánu má být 6–7, ne 9.

Vrať POUZE validní JSON pole, PŘESNĚ ${concepts.length} položek:
[{ "index": 1, "score": 7, "fix": "co konkrétně zlepšit (prázdné když score >= ${REVISE_BELOW})" }, ...]`

    try {
        const raw = await judgeText(prompt, { label })
        const verdicts = parseJsonArray<{ index?: number; score?: number; fix?: string }>(raw)
        const map = new Map<number, JudgeVerdict>()
        for (const v of verdicts) {
            const idx = Number(v.index)
            const score = Number(v.score)
            if (Number.isInteger(idx) && idx >= 1 && idx <= concepts.length && Number.isFinite(score)) {
                map.set(idx - 1, { score: Math.max(1, Math.min(10, Math.round(score))), fix: String(v.fix || "") })
            }
        }
        return map.size > 0 ? map : null
    } catch (e: any) {
        console.warn(`📋 [plan-pipeline] ${label} skipped: ${String(e?.message || e).substring(0, 150)}`)
        return null
    }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export async function runPlanPipeline(input: PlanPipelineInput): Promise<PlanPipelineResult> {
    const stage = async (progress: number, message: string) => {
        try { await input.onStage?.(progress, message) } catch { /* progress must never break the plan */ }
    }

    // Per-post format labels for the judge (parsed from typeList lines: "N. Typ: ... | Formát: X | ...")
    const formatLines = input.typeList.split("\n").map(l => l.match(/Formát:\s*([^|]+)/)?.[1]?.trim() || "")

    // ── 1. Strategist ──
    await stage(15, "🧭 Stratég skládá kampaňovou linku…")
    const strategy = await runStrategist(input)
    if (strategy) console.log(`   🧭 plan-strategist: arc="${strategy.arc.substring(0, 100)}…"`)

    // ── 2. Concepts (CORE — quality ladder errors propagate, never flash) ──
    await stage(35, "✍️ Copywriter píše koncepty (Pro)…")
    const strategySection = strategy
        ? `\n## 🧭 STRATEGIE KAMPANĚ (drž se jí!)
Linka: ${strategy.arc}
Zaměření jednotlivých postů:
${strategy.postFocus.slice(0, input.count).map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`
        : ""

    const conceptPrompt = `Jsi strategický content planner pro značku "${input.brandName}" (${input.website}).

## ÚKOL
Vytvoř content plan na ${input.count} postů. Pro každý post napiš:
- hookPreview: český hook (první věta postu, max 12 slov, poutavá, BEZ emoji)
- angle: 1 věta popisující úhel/přístup k tématu (česky)
- topic: krátké téma v 3-5 slovech (česky)
- qualityScore: 1-10 — ohodnoť kvalitu vlastního hooku (10 = zastaví scrollování, 1 = generické)

${input.contextBlock}
${strategySection}
## SEKVENCE POSTŮ (strategicky sestavená):
${input.typeList}

## PRAVIDLA KVALITY
- Hook musí zastavit scrollování — provokativní, překvapivý, kontroverzní, nebo extrémně specifický
- ZAKÁZÁNO: generické fráze ("Víte co...", "Dnes vám ukážu...", "Zajímavý fakt...")
- POVINNÉ: konkrétní čísla, jména, příklady kde to dává smysl
- Posty v sérii na sebe NAVAZUJÍ — budují příběh podle strategie, ne náhodné izolované posty
- Pro product posty: hook MUSÍ zmínit konkrétní produkt/službu
- ⚠️ FORMÁT: hook a angle MUSÍ odpovídat formátu postu (viz "Formát:" u každého typu). Pokud je formát KARUSEL nebo JEDEN OBRÁZEK, je ZAKÁZÁNO slibovat "video", "Reel", "scénář", "za 60 sekund ti ukážu" apod. — mluv o tom, co bude na obrázcích/slidech.
- Piš česky, moderní hovorovou češtinou

## VÝSTUP
Vrať POUZE validní JSON pole s PŘESNĚ ${input.count} položkami:
[{ "hookPreview": "...", "angle": "...", "topic": "...", "qualityScore": 8 }, ...]`

    const rawConcepts = await generateTextQuality(conceptPrompt, {
        models: plannerModels(),
        label: "plan-concepts",
        temperature: getTemperature("copywriter"),
        responseSchema: conceptSchema,
    })
    const concepts = parseJsonArray<PlanConcept>(rawConcepts)

    // ── 3. Judge (cross-family) ──
    await stage(60, "⚖️ Nezávislý kritik hodnotí hooky…")
    const verdicts = await judgeConcepts(input, concepts, formatLines, "plan-judge")
    const judged = verdicts !== null
    if (judged) {
        for (const [i, v] of verdicts!) if (concepts[i]) concepts[i].qualityScore = v.score
        const avg = concepts.reduce((s, c) => s + (c.qualityScore || 0), 0) / (concepts.length || 1)
        console.log(`   ⚖️ plan-judge: avg=${avg.toFixed(1)} weak=${[...verdicts!.values()].filter(v => v.score < REVISE_BELOW).length}`)
    }

    // ── 4. Targeted revision of weak hooks (+ re-judge, keep the better) ──
    const weak = judged
        ? [...verdicts!.entries()].filter(([, v]) => v.score < REVISE_BELOW).map(([i, v]) => ({ i, ...v }))
        : []
    if (weak.length > 0) {
        await stage(78, `🔧 Přepisuji ${weak.length} slabých hooků podle kritiky…`)
        try {
            const revisePrompt = `Jsi content planner pro "${input.brandName}". Nezávislý kritik zamítl tyto hooky — přepiš je podle jeho výtek.

${input.contextBlock}
${strategy ? `## STRATEGIE KAMPANĚ\n${strategy.arc}\n` : ""}
## ZAMÍTNUTÉ KONCEPTY (přepiš KAŽDÝ, drž téma i formát):
${weak.map((w, k) => `${k + 1}. Formát postu: ${formatLines[w.i] || "?"}
   Hook: "${concepts[w.i].hookPreview}" (skóre ${w.score})
   Výtka kritika: ${w.fix || "málo specifické"}
   Téma (ZACHOVEJ): ${concepts[w.i].topic}`).join("\n")}

## EXISTUJÍCÍ HOOKY V PLÁNU (neduplikuj):
${concepts.map(c => `- "${c.hookPreview}"`).join("\n")}

## PRAVIDLA
- Nový hook musí přímo řešit výtku kritika, max 12 slov, BEZ emoji, česky
- Hook je ČISTÝ TEXT věty — NIKDY nezačínej hranatou závorkou, názvem formátu ani jiným prefixem
- Téma a podstata postu se NEMĚNÍ — přepisuješ znění, ne obsah
- Respektuj formát postu (obrázek/karusel nesmí slibovat video), ale formát do textu hooku NEPIŠ

Vrať POUZE validní JSON pole s PŘESNĚ ${weak.length} položkami:
[{ "hookPreview": "...", "angle": "...", "topic": "...", "qualityScore": 8 }, ...]`

            const rawRevised = await generateTextQuality(revisePrompt, {
                models: plannerModels(),
                label: "plan-revise",
                temperature: getTemperature("copywriter"),
                responseSchema: conceptSchema,
            })
            // Defensive: models sometimes echo the format tag into the hook ("[STATICKÝ
            // OBRÁZEK] Zbraň, co…") — strip any leading bracketed prefix.
            const revised = parseJsonArray<PlanConcept>(rawRevised).map(c => ({
                ...c,
                hookPreview: String(c.hookPreview || "").replace(/^\s*\[[^\]]*\]\s*/, ""),
            }))

            // Re-judge only the revised hooks; keep whichever version scores higher.
            // Keep the ORIGINAL ideaIndex — revision rewrites wording, not substance,
            // and the revise prompt has no bank (any ideaIndex would be hallucinated).
            const candidates = weak
                .map((w, k) => ({ orig: w, rev: revised[k] }))
                .filter(c => c.rev?.hookPreview)
            if (candidates.length > 0) {
                await stage(88, "⚖️ Kritik znovu hodnotí přepsané hooky…")
                const reVerdicts = await judgeConcepts(
                    input,
                    candidates.map(c => ({ ...c.rev, ideaIndex: undefined, productIndex: undefined })),
                    candidates.map(c => formatLines[c.orig.i] || ""),
                    "plan-rejudge",
                )
                candidates.forEach((c, k) => {
                    const newScore = reVerdicts?.get(k)?.score
                    // No re-verdict → trust the revision (it addressed a concrete fix note)
                    // but don't fabricate a score above the original.
                    const accept = newScore === undefined || newScore >= c.orig.score
                    if (accept) {
                        concepts[c.orig.i] = {
                            hookPreview: c.rev.hookPreview,
                            angle: c.rev.angle,
                            topic: c.rev.topic,
                            qualityScore: newScore ?? c.orig.score,
                            ideaIndex: concepts[c.orig.i].ideaIndex,
                            // Revision rewrites wording, not substance — the post is still
                            // about the same product. (If the rewrite happens to name a
                            // different one, the action's copy-level match overrides this.)
                            productIndex: concepts[c.orig.i].productIndex,
                        }
                        console.log(`   ✅ hook #${c.orig.i + 1} revised: ${c.orig.score} → ${newScore ?? "?"} "${c.rev.hookPreview}"`)
                    } else {
                        console.log(`   ↩️ hook #${c.orig.i + 1} revision scored lower (${newScore} < ${c.orig.score}) — keeping original`)
                    }
                })
            }
        } catch (e: any) {
            console.warn(`📋 [plan-pipeline] revision skipped: ${String(e?.message || e).substring(0, 150)}`)
        }
    }

    return { concepts, strategySummary: strategy?.arc ?? null, judged }
}
