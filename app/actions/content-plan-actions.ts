"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"

// ─── Content Plan Preview (cheap text-only plan before expensive generation) ──

export interface ContentPlanItem {
    id: string
    postType: string
    postTypeEmoji: string
    postTypeLabel: string
    /** Effective medium for this post (reel kill-switch already applied) — UI shows single vs carousel */
    medium: "image" | "carousel" | "reel"
    pillar: string
    pillarEmoji: string
    hookPreview: string
    angle: string
    topic: string
    week?: number
    day?: number
    /** AI self-evaluation: 1-10 quality score for the hook */
    qualityScore?: number
    /** Linked product from ig_products */
    productId?: string
    productName?: string
    productImage?: string
    /** Planner: when this post should publish. Set at plan approval, editable. */
    scheduledDate?: string // "YYYY-MM-DD"
    scheduledTime?: string // "HH:MM"
    /** ig_post_ideas id when this item was sourced from the idea bank (Zásobník témat). */
    ideaId?: string
    /** Idea title for the 💡 badge in the plan preview. */
    ideaTitle?: string
}

/**
 * The brand's real posting cadence (posts per week), used by the planner UI to turn a chosen
 * duration (1 week / 2 weeks / month) into an honest post count. Seeded at onboarding from the
 * client's actual IG history; validateConfig guarantees a clamped 1–7 default of 4.
 */
export async function getPlanCadence(projectSlug: string): Promise<number> {
    try {
        await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)
        return config.postsPerWeek || 4
    } catch {
        return 4
    }
}

export async function generateContentPlan(
    projectSlug: string,
    count: number,
    userTopic?: string,
    category?: string,
    /** Client-generated UUID: lets the UI poll getPlanProgress() for live stage messages
     *  while this action runs (the deep pipeline takes ~1-2 min — a mute spinner won't do). */
    planRunId?: string
): Promise<{ success: boolean; plan?: ContentPlanItem[]; strategySummary?: string; error?: string }> {
    // ─── Durable observability: a breadcrumb row in ig_jobs proves the action started and
    // shows where it stops/fails. Instrumentation must NEVER break generation (all wrapped). ──
    const t0 = Date.now()
    let planJobId: string | null = null
    const planBreadcrumb = async (update: Record<string, any>) => {
        if (!planJobId) return
        try { await supabaseAdmin.from("ig_jobs").update(update).eq("id", planJobId) }
        catch (e: any) { console.warn(`📋 [content-plan] breadcrumb update failed: ${e?.message}`) }
    }
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { getModel } = await import("@/instagram/models")
        const planModel = getModel("planner")
        console.log(`📋 [content-plan] START client=${clientId} count=${count} topic="${userTopic || "-"}" cat="${category || "-"}" model=${planModel}`)
        try {
            const { data: jobRow } = await supabaseAdmin
                .from("ig_jobs")
                .insert({
                    // status must be one of the ig_jobs CHECK values — "running" violates the
                    // constraint and silently killed every content_plan breadcrumb insert
                    // (0/179 rows existed), so plan-stage failures were invisible.
                    client_id: clientId,
                    config: { kind: "content_plan", count, topic: userTopic || null, category: category || null, model: planModel, runId: planRunId || null },
                    status: "pending",
                    progress: 0,
                    agent_message: "📋 Plánuji obsah…",
                })
                .select("id")
                .single()
            planJobId = jobRow?.id || null
        } catch (e: any) {
            console.warn(`📋 [content-plan] breadcrumb insert failed: ${e?.message}`)
        }
        const { loadConfig } = await import("@/instagram/configs")
        const { buildSmartWeekPlan, getPostFormat } = await import("@/instagram/caption-generator")
        const { analyzePerformance } = await import("@/instagram/performance")
        const { setActiveProject, createPillarMapper, getPillarForType } = await import("@/instagram/service")

        const config = await loadConfig(projectSlug)
        setActiveProject(clientId)

        // Get strategic post type sequence
        const _getPillarForType = createPillarMapper(config)
        const performance = await analyzePerformance(config, _getPillarForType)
        const typeSequence = buildSmartWeekPlan(config, performance, count)

        // ─── Zásobník témat: the idea bank feeds the plan first — weighted (proven/fresh)
        // ideas become plan topics with ideaId attribution; the model invents the rest.
        // Read-only here: the preview must NEVER mutate the bank (deposit + markIdeaAsUsed
        // happen only at startCampaign / post generation). ──
        let bankIdeas: { id: string; title: string; content: string; performance_score?: number; times_used_with_metrics?: number }[] = []
        try {
            const { getWeightedIdeas } = await import("@/instagram/service")
            bankIdeas = await getWeightedIdeas(count)
        } catch (e: any) {
            console.warn(`📋 [content-plan] idea bank skipped: ${e?.message}`)
        }

        // Effective medium per post, precomputed once so the badge (item.medium) and the planner
        // prompt always read the exact same value. Two passes:
        //  1) Base format, with the reels kill-switch spreading clamped reels (~2/3 image, ~1/3
        //     carousel) so reels-off doesn't flood the plan with carousels.
        //  2) Hard cap: at most ¼ of the plan may be carousels. Walk in order, keep carousels until
        //     the cap is hit, then demote every further carousel to a single image. Reels (when
        //     enabled) and images are untouched.
        const carouselCap = Math.floor(count / 4)
        const effectiveMediums: ("image" | "carousel" | "reel")[] = (() => {
            let carouselsKept = 0
            return typeSequence.map((typeName, i) => {
                let m = getPostFormat(config, typeName).medium
                if (process.env.REELS_ENABLED !== "1" && m === "reel") {
                    m = i % 3 === 0 ? "carousel" : "image"
                }
                if (m === "carousel") {
                    if (carouselsKept >= carouselCap) m = "image"
                    else carouselsKept++
                }
                return m
            })
        })()
        const effectiveMedium = (_typeName: string, i: number): "image" | "carousel" | "reel" =>
            effectiveMediums[i] ?? "image"

        // Get post type metadata from DB
        const { data: dbPostTypes } = await supabaseAdmin
            .from("ig_post_types")
            .select("name, display_name, emoji, description")
            .eq("client_id", clientId)
            .eq("is_active", true)

        const ptMap = new Map((dbPostTypes || []).map(pt => [pt.name, pt]))

        // ─── Quality Context: top hooks + recent dedup ───
        const { data: topPosts } = await supabaseAdmin
            .from("ig_posts")
            .select("caption, engagement_score")
            .eq("client_id", clientId)
            .not("engagement_score", "is", null)
            .order("engagement_score", { ascending: false })
            .limit(5)

        const topHooks = (topPosts || [])
            .map(p => p.caption?.split("\n")[0]?.substring(0, 80))
            .filter(Boolean)

        const { data: recentPosts } = await supabaseAdmin
            .from("ig_posts")
            .select("caption")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(15)

        const recentHooks = (recentPosts || [])
            .map(p => p.caption?.split("\n")[0]?.substring(0, 60))
            .filter(Boolean)

        // Build context for Gemini — include the EFFECTIVE medium per post (reel kill-switch
        // applied) so the planner writes copy that matches the format and never promises a
        // "video"/"Reel" for something that will actually render as a carousel or single image.
        const typeList = typeSequence.map((typeName, i) => {
            const pt = ptMap.get(typeName)
            const pillar = getPillarForType(config, typeName)
            const pillarCfg = config.contentPillars[pillar]
            const medium = effectiveMedium(typeName, i)
            const formatLabel = medium === "carousel" ? "KARUSEL (statické obrázky/slidy — ŽÁDNÉ video)"
                : medium === "reel" ? "REEL (krátké video)"
                : "JEDEN STATICKÝ OBRÁZEK (ŽÁDNÉ video)"
            return `${i + 1}. Typ: "${typeName}" (${pt?.display_name || typeName}) | Formát: ${formatLabel} | Pilíř: ${pillarCfg?.label || pillar} | Popis: ${pt?.description || pillarCfg?.description || ""}`
        }).join("\n")

        const topicInstruction = userTopic
            ? `\n## 🎯 HLAVNÍ TÉMA KAMPANĚ: "${userTopic}"\nVšechny posty MUSÍ souviset s tímto tématem, ale každý z jiného úhlu.`
            : ""

        const topHooksSection = topHooks.length > 0
            ? `\n## ✅ PŘÍKLADY NEJLEPŠÍCH HOOKŮ (tyto fungovaly — inspiruj se stylem, NEkopíruj):\n${topHooks.map(h => `- "${h}"`).join("\n")}\n`
            : ""

        const deduplicationSection = recentHooks.length > 0
            ? `\n## 🚫 NEDÁVNÉ HOOKY (NEPOUŽÍVEJ podobné vzorce ani témata!):\n${recentHooks.map(h => `- "${h}"`).join("\n")}\n`
            : ""

        const ideaBankSection = bankIdeas.length > 0
            ? `\n## 💡 ZÁSOBNÍK TÉMAT ZNAČKY (použij přednostně!)
Schválené nápady klienta. Kde to dává smysl, postav post na nápadu ze seznamu a vrať jeho číslo jako "ideaIndex".
Nápad rozveď vlastním hookem a úhlem — jádro tématu ale MUSÍ odpovídat nápadu.
${bankIdeas.map((idea, i) => `${i + 1}. ${(idea.performance_score || 0) > 0 && (idea.times_used_with_metrics || 0) > 0 ? "[🔥 ověřený] " : ""}"${idea.title}" — ${String(idea.content || "").substring(0, 150)}`).join("\n")}
PRAVIDLA: Každý nápad použij MAXIMÁLNĚ jednou. Když se žádný nehodí, vymysli vlastní téma a "ideaIndex" vynech.\n`
            : ""

        // ─── Brand grounding: pipe in what onboarding learned from the client's REAL Instagram.
        // Crucial at cold start — a brand-new client has no posts of OURS yet (topHooks empty),
        // so without this the planner writes generic hooks blind to the brand's proven winners.
        // Proven patterns live in ig_brand_memory (seeded from igInsights.provenPatterns at
        // onboarding, confidence 0.45); the scraped baseline (content mix, hashtags) is on config. ──
        let brandGroundingSection = ""
        try {
            const { getBrandMemories, formatMemoriesForPrompt } = await import("@/instagram/memory-agent")
            const brandMemories = await getBrandMemories(15, clientId)
            const memorySection = formatMemoriesForPrompt(brandMemories)

            const baseline = config.igBaseline
            const baselineSection = baseline
                ? `\n## 📲 BASELINE Z REÁLNÉHO IG ÚČTU ZNAČKY (co už publikovali — stav na tom)\n${
                    baseline.contentMix && Object.keys(baseline.contentMix).length
                        ? `Ověřený mix obsahu: ${Object.entries(baseline.contentMix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(", ")}\n`
                        : ""
                }${
                    baseline.topHashtags?.length ? `Top hashtagy: ${baseline.topHashtags.slice(0, 10).join(" ")}\n` : ""
                }`
                : ""

            brandGroundingSection = `${memorySection}${baselineSection}`
        } catch (e: any) {
            console.warn(`📋 [content-plan] brand grounding skipped: ${e?.message}`)
        }

        // ─── Live product catalog (ig_products) — NOT config.products (frozen onboarding
        // snapshot): grounding the plan on the snapshot produced hooks naming deleted
        // products while the worker then picked a different live product at render time. ──
        let catalogProducts: { name: string; type: string; price?: string; description?: string }[] = []
        try {
            const { getCatalogProducts } = await import("@/instagram/service")
            catalogProducts = await getCatalogProducts(clientId, config.products)
        } catch (e) {
            console.warn(`📋 [content-plan] catalog read failed — falling back to config snapshot: ${(e as Error)?.message}`)
            catalogProducts = config.products || []
        }

        // ─── Deep plan pipeline (instagram/plan-pipeline.ts): strategist → concepts →
        // cross-family judge → targeted revision. All brand context is assembled here
        // (this file owns the DB queries); the pipeline treats it as an opaque block. ──
        const contextBlock = `## BRAND VOICE
${config.brandVoice.persona}
Tón: ${config.brandVoice.voiceTraits?.join(", ")}

## ANTI-PATTERNS (NEPOUŽÍVEJ)
${config.brandVoice.antiPatterns?.join(", ")}

${catalogProducts.length ? `## PRODUKTY ZNAČKY (${catalogProducts.length})\n${catalogProducts.slice(0, 10).map(p => `- **${p.name}** (${p.type})${p.price ? ` — ${p.price}` : ""}${p.description ? `: ${p.description.substring(0, 60)}` : ""}`).join("\n")}\n⚠️ Pro posty typu product_drop/produkt MUSÍŠ zmínit KONKRÉTNÍ produkt z tohoto seznamu v hooku!\n` : ""}
${config.audiencePersonas?.length ? `## CÍLOVÉ PERSONY\n${config.audiencePersonas.map(p => `- **${p.label}** (${p.ageRange} let): Pain points: ${p.painPoints.slice(0, 2).join(", ")}`).join("\n")}\n` : ""}
${brandGroundingSection}${ideaBankSection}${topHooksSection}${deduplicationSection}${topicInstruction}
${count > 14 ? "\n## STRUKTURA\nRozděl do týdnů — každý týden má vlastní mini-téma.\n" : ""}`

        const { runPlanPipeline } = await import("@/instagram/plan-pipeline")
        const pipelineResult = await runPlanPipeline({
            brandName: config.name,
            website: config.website,
            count,
            contextBlock,
            typeList,
            recentHooks,
            onStage: (progress, message) => planBreadcrumb({ progress, agent_message: message }),
        })
        const concepts: { hookPreview: string; angle: string; topic: string; qualityScore?: number; ideaIndex?: number }[] = pipelineResult.concepts
        const strategySummary = pipelineResult.strategySummary || undefined
        await planBreadcrumb({ progress: 92, agent_message: `📝 Plán: ${concepts.length}/${count}${pipelineResult.judged ? " · oponentura ✓" : ""}` })

        // Ensure we have exactly `count` concepts — AI sometimes returns fewer
        let retries = 0
        while (concepts.length < count && retries < 3) {
            console.warn(`   ⚠️ AI vrátila ${concepts.length}/${count} položek — doplňuji (pokus ${retries + 1})...`)

            // Retry for missing items
            const missing = count - concepts.length
            const missingTypes = typeSequence.slice(concepts.length, count)
            const existingHooks = concepts.map(c => c.hookPreview)

            const fillPrompt = `Jsi content planner pro "${config.name}". Potřebuji přesně ${missing} dalších postů do obsahového plánu.

${topHooksSection}
## EXISTUJÍCÍ HOOKY (neduplikuj):
${existingHooks.map(h => `- "${h}"`).join("\n")}

## CHYBĚJÍCÍ TYPY POSTŮ:
${missingTypes.map((t, i) => {
    const pt = ptMap.get(t)
    const pillar = getPillarForType(config, t)
    return `${i + 1}. Typ: "${t}" (${pt?.display_name || t}) | Pilíř: ${pillar}`
}).join("\n")}

Vrať POUZE validní JSON pole obsahující PŘESNĚ ${missing} položek s klíči: hookPreview, angle, topic, qualityScore.`

            try {
                // Same Pro ladder as the pipeline — a fill item is a real plan item, no flash.
                const { generateTextQuality } = await import("@/instagram/gemini-client")
                const { conceptSchema, plannerModels } = await import("@/instagram/plan-pipeline")
                const { getTemperature } = await import("@/instagram/models")
                const fillRaw = await generateTextQuality(fillPrompt, {
                    models: plannerModels(),
                    label: "plan-fill",
                    temperature: getTemperature("copywriter"),
                    responseSchema: conceptSchema,
                })
                const fillMatch = fillRaw.match(/\[[\s\S]*\]/)
                // Fill prompts have no bank section — strip any hallucinated ideaIndex
                const stripIdeaIndex = (arr: any[]) => arr.map(c => ({ ...c, ideaIndex: undefined }))
                if (fillMatch) {
                    const fillConcepts = JSON.parse(fillMatch[0])
                    if (Array.isArray(fillConcepts) && fillConcepts.length > 0) {
                        concepts.push(...stripIdeaIndex(fillConcepts))
                        console.log(`   ✅ Doplněno ${fillConcepts.length} položek (celkem ${concepts.length}/${count})`)
                    }
                } else {
                    // Try parsing as array directly if regex failed
                    const fillConcepts = JSON.parse(fillRaw)
                    if (Array.isArray(fillConcepts) && fillConcepts.length > 0) {
                        concepts.push(...stripIdeaIndex(fillConcepts))
                        console.log(`   ✅ Doplněno ${fillConcepts.length} položek (celkem ${concepts.length}/${count})`)
                    }
                }
            } catch (e) {
                console.warn(`   ⚠️ Fill retry failed: ${e}`)
            }
            retries++
        }

        // Final fallback: pad with generic items if still short after retries
        if (concepts.length < count) {
            console.warn(`   ⚠️ Doplňuji ${count - concepts.length} generických položek...`)
            while (concepts.length < count) {
                const idx = concepts.length
                const typeName = typeSequence[idx % typeSequence.length]
                const pt = ptMap.get(typeName)
                concepts.push({
                    hookPreview: pt?.display_name || typeName,
                    angle: "Automaticky doplněný post",
                    topic: typeName,
                    qualityScore: 5,
                })
            }
        }

        // Build plan items with metadata
        const usedIdeaIdx = new Set<number>()
        const plan: ContentPlanItem[] = typeSequence.slice(0, count).map((typeName, i) => {
            const pt = ptMap.get(typeName)
            const pillar = getPillarForType(config, typeName)
            const pillarCfg = config.contentPillars[pillar]
            const concept = concepts[i] || { hookPreview: "", angle: "", topic: "" }

            // Effective medium (reels-off split applied — see effectiveMedium above)
            const medium = effectiveMedium(typeName, i)

            // Map ideaIndex → ideaId with clamping — the model can hallucinate indexes
            // or reuse one twice; invalid/duplicate indexes silently become "invented".
            const ix = concept.ideaIndex
            let ideaId: string | undefined
            let ideaTitle: string | undefined
            if (typeof ix === "number" && Number.isInteger(ix) && ix >= 1 && ix <= bankIdeas.length && !usedIdeaIdx.has(ix)) {
                usedIdeaIdx.add(ix)
                ideaId = bankIdeas[ix - 1].id
                ideaTitle = bankIdeas[ix - 1].title
            }

            return {
                id: `plan_${Date.now()}_${i}`,
                postType: typeName,
                postTypeEmoji: pt?.emoji || "📝",
                postTypeLabel: pt?.display_name || typeName,
                medium,
                pillar,
                pillarEmoji: pillarCfg?.emoji || "📋",
                hookPreview: concept.hookPreview,
                angle: concept.angle,
                topic: concept.topic,
                qualityScore: concept.qualityScore || undefined,
                week: count > 14 ? Math.floor(i / 7) + 1 : undefined,
                day: i + 1,
                ideaId,
                ideaTitle,
            }
        })

        await planBreadcrumb({ status: "done", progress: 100, agent_message: "✅ Plán hotový", result: { planLength: plan.length, judged: pipelineResult.judged } })
        return { success: true, plan, strategySummary }
    } catch (err: any) {
        const msg = (err?.message || String(err)).substring(0, 500)
        console.error("generateContentPlan error:", msg)
        await planBreadcrumb({ status: "failed", agent_message: "❌ Plánování selhalo", error: msg })
        try {
            const Sentry = await import("@sentry/nextjs")
            Sentry.captureException(err, { tags: { route: "content-plan", planJobId: planJobId || "none" } })
        } catch { /* Sentry optional */ }
        return { success: false, error: err?.message || String(err) }
    } finally {
        console.log(`📋 [content-plan] END job=${planJobId || "none"} ${Date.now() - t0}ms`)
    }
}

/**
 * Live progress for a running generateContentPlan call — the UI polls this (~2s) with the
 * planRunId it generated, and shows the pipeline's stage messages (strategist / concepts /
 * judge / revision) instead of a mute spinner. Reads the ig_jobs breadcrumb row.
 */
export async function getPlanProgress(
    projectSlug: string,
    planRunId: string
): Promise<{ progress: number; message: string; status: string } | null> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { data } = await supabaseAdmin
            .from("ig_jobs")
            .select("progress, agent_message, status")
            .eq("client_id", clientId)
            .eq("config->>kind", "content_plan")
            .eq("config->>runId", planRunId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (!data) return null
        return { progress: data.progress || 0, message: data.agent_message || "", status: data.status || "pending" }
    } catch {
        return null
    }
}

/**
 * AI-generate a prompt hint for a pillar category based on its label + pillar context.
 */
export async function generateCategoryPrompt(
    projectSlug: string,
    categoryLabel: string,
    pillarLabel: string,
    pillarDescription: string
): Promise<{ success: boolean; prompt?: string; error?: string }> {
    try {
        await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        const { generateText } = await import("@/instagram/gemini-client")
        const config = await loadConfig(projectSlug)

        const raw = await generateText(`Jsi content stratég pro značku "${config.name}" (${config.website}).

## KONTEXT
Pilíř: "${pillarLabel}" — ${pillarDescription}
Kategorie: "${categoryLabel}"

## ÚKOL
Napiš STRUČNÝ prompt hint (1-2 věty, česky) pro tuto kategorii.
Prompt hint říká AI generátoru obsahu JAKÝ typ příspěvků a Z JAKÉHO ÚHLU má pro tuto kategorii tvořit.

## PRAVIDLA
- Max 2 věty, konkrétní a akční
- Zaměř se na: jaká témata, jaký tón, jaké formáty fungují
- Piš česky
- Vrať POUZE text promptu, nic jiného

Příklad pro kategorii "Tipy" v pilíři "Edukace":
"Praktické tipy a návody krok za krokem. Používej čísla v hooku, konkrétní příklady a řešení reálných problémů zákazníků."`)

        return { success: true, prompt: raw.trim().replace(/^["']|["']$/g, "") }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

export async function regeneratePlanItem(
    projectSlug: string,
    postType: string,
    existingHooks: string[],
    userTopic?: string,
    medium?: "image" | "carousel" | "reel"
): Promise<{ success: boolean; item?: { hookPreview: string; angle: string; topic: string }; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        const { getPillarForType, getCatalogProducts } = await import("@/instagram/service")
        const config = await loadConfig(projectSlug)

        // Build pillar context for this post type
        const pillar = getPillarForType(config, postType)
        const pillarCfg = config.contentPillars[pillar]
        const pillarSection = pillarCfg
            ? `## PILÍŘ: ${pillarCfg.emoji} ${pillarCfg.label}\n${pillarCfg.description || ""}\nCíl: ${pillarCfg.ctaStrategy === "hard" ? "PRODEJ" : pillarCfg.ctaStrategy === "medium" ? "HODNOTA" : pillarCfg.ctaStrategy === "soft" ? "DOSAH" : "KOMUNITA"}\n`
            : ""

        // Live catalog, not the frozen config.products snapshot (see generateContentPlan)
        const catalogProducts = await getCatalogProducts(clientId, config.products).catch(() => config.products || [])
        const productsSection = catalogProducts.length
            ? `## PRODUKTY (${catalogProducts.length})\n${catalogProducts.slice(0, 6).map(p => `- ${p.name} (${p.type})${p.price ? ` — ${p.price}` : ""}`).join("\n")}\n`
            : ""

        const prompt = `Jsi content stratég pro "${config.name}" (${config.website}).

## BRAND PERSONA
${config.brandVoice.persona || ""}

## VOICE TRAITS
${config.brandVoice.voiceTraits?.map((t: string) => `- ${t}`).join("\n") || ""}

## ZAKÁZÁNO
${config.brandVoice.antiPatterns?.slice(0, 5).map((p: string) => `- ${p}`).join("\n") || ""}

${productsSection}
${pillarSection}
## ÚKOL
Vygeneruj JEDEN nový koncept pro post typu "${postType}".
${userTopic ? `Téma kampaně: "${userTopic}" — hook MUSÍ souviset s tímto tématem.` : ""}
${medium ? `\n## FORMÁT POSTU: ${medium === "carousel" ? "KARUSEL (statické obrázky/slidy — ŽÁDNÉ video)" : medium === "reel" ? "REEL (krátké video)" : "JEDEN STATICKÝ OBRÁZEK (ŽÁDNÉ video)"}\n` : ""}

## NESMÍŠ OPAKOVAT tyto hooky:
${existingHooks.map(h => `- "${h}"`).join("\n")}

## PRAVIDLA:
- Hook musí zastavit scrollování — provokativní, překvapivý, specifický pro "${config.name}"
- ŽÁDNÉ emoji v hooku
- Hook max 12 slov, česky
- Angle musí být konkrétní — ne "zajímavý pohled" ale "srovnání cen s konkurencí"
- Topic: 3-5 slov shrnující o čem post bude
${medium && medium !== "reel" ? `- ⚠️ Tohle je ${medium === "carousel" ? "KARUSEL" : "JEDEN OBRÁZEK"} — hook ani angle NESMÍ slibovat "video", "Reel", "scénář" ani "za 60 sekund ti ukážu". Mluv o tom, co bude na obrázcích.` : ""}

Vrať POUZE validní JSON:
{ "hookPreview": "český hook max 12 slov BEZ emoji", "angle": "1 věta o přístupu", "topic": "3-5 slov" }`

        // Single-item regen goes through the same Pro ladder as the plan itself —
        // a regenerated hook must not be weaker than the plan it replaces an item of.
        const { generateTextQuality } = await import("@/instagram/gemini-client")
        const { plannerModels } = await import("@/instagram/plan-pipeline")
        const { getTemperature } = await import("@/instagram/models")
        const raw = await generateTextQuality(prompt, {
            models: plannerModels(),
            label: "plan-regen-item",
            temperature: getTemperature("copywriter"),
        })
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error("Invalid JSON response")
        const item = JSON.parse(jsonMatch[0])

        return { success: true, item }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

