"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"

// ─── Content Plan Preview (cheap text-only plan before expensive generation) ──

export interface ContentPlanItem {
    id: string
    postType: string
    postTypeEmoji: string
    postTypeLabel: string
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
}

export async function generateContentPlan(
    projectSlug: string,
    count: number,
    userTopic?: string,
    category?: string
): Promise<{ success: boolean; plan?: ContentPlanItem[]; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        const { buildSmartWeekPlan } = await import("@/instagram/caption-generator")
        const { analyzePerformance } = await import("@/instagram/performance")
        const { setActiveProject, createPillarMapper, getPillarForType } = await import("@/instagram/service")

        const config = await loadConfig(projectSlug)
        setActiveProject(clientId)

        // Get strategic post type sequence
        const _getPillarForType = createPillarMapper(config)
        const performance = await analyzePerformance(config, _getPillarForType)
        const typeSequence = buildSmartWeekPlan(config, performance, count)

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

        // Build context for Gemini
        const typeList = typeSequence.map((typeName, i) => {
            const pt = ptMap.get(typeName)
            const pillar = getPillarForType(config, typeName)
            const pillarCfg = config.contentPillars[pillar]
            return `${i + 1}. Typ: "${typeName}" (${pt?.display_name || typeName}) | Pilíř: ${pillarCfg?.label || pillar} | Popis: ${pt?.description || pillarCfg?.description || ""}`
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

        const prompt = `Jsi strategický content planner pro značku "${config.name}" (${config.website}).

## ÚKOL
Vytvoř content plan na ${count} postů. Pro každý post napiš:
- hookPreview: český hook (první věta postu, max 12 slov, poutavá, BEZ emoji)
- angle: 1 věta popisující úhel/přístup k tématu (česky)
- topic: krátké téma v 3-5 slovech (česky)
- qualityScore: 1-10 — ohodnoť kvalitu vlastního hooku (10 = zastaví scrollování, 1 = generické)

## BRAND VOICE
${config.brandVoice.persona}
Tón: ${config.brandVoice.voiceTraits?.join(", ")}

## ANTI-PATTERNS (NEPOUŽÍVEJ)
${config.brandVoice.antiPatterns?.join(", ")}

${config.products?.length ? `## PRODUKTY ZNAČKY (${config.products.length})\n${config.products.slice(0, 10).map(p => `- **${p.name}** (${p.type})${p.price ? ` — ${p.price}` : ""}${p.description ? `: ${p.description.substring(0, 60)}` : ""}`).join("\n")}\n⚠️ Pro posty typu product_drop/produkt MUSÍŠ zmínit KONKRÉTNÍ produkt z tohoto seznamu v hooku!\n` : ""}
${config.audiencePersonas?.length ? `## CÍLOVÉ PERSONY\n${config.audiencePersonas.map(p => `- **${p.label}** (${p.ageRange} let): Pain points: ${p.painPoints.slice(0, 2).join(", ")}`).join("\n")}\n` : ""}
${topHooksSection}${deduplicationSection}${topicInstruction}

## SEKVENCE POSTŮ (strategicky sestavená):
${typeList}

## PRAVIDLA KVALITY
- Každý hook MUSÍ mít qualityScore ≥ 7 — pokud nedokážeš vymyslet kvalitní hook, snaž se víc
- Hook musí zastavit scrollování — provokativní, překvapivý, kontroverzní, nebo extrémně specifický
- ZAKÁZÁNO: generické fráze ("Víte co...", "Dnes vám ukážu...", "Zajímavý fakt...")
- POVINNÉ: konkrétní čísla, jména, příklady kde to dává smysl
- Posty v sérii na sebe NAVAZUJÍ — budují příběh, ne náhodné izolované posty
- ${count > 14 ? "Rozděl do týdnů — každý týden má vlastní mini-téma" : "Posty by měly mít logický flow"}
- Pro product posty: hook MUSÍ zmínit konkrétní produkt/službu
- Piš česky, moderní hovorovou češtinou

## VÝSTUP
Vrať POUZE validní JSON pole:
[
  { "hookPreview": "...", "angle": "...", "topic": "...", "qualityScore": 8 },
  ...
]
Pole musí mít PŘESNĚ ${count} položek.`

        const { generateText } = await import("@/instagram/gemini-client")
        const { Type } = await import("@google/genai")
        const planSchema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    hookPreview: { type: Type.STRING },
                    angle: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    qualityScore: { type: Type.INTEGER }
                },
                required: ["hookPreview", "angle", "topic", "qualityScore"]
            }
        }
        
        const raw = await generateText(prompt, { model: "gemini-3.5-flash", responseSchema: planSchema })

        // Parse response
        const jsonMatch = raw.match(/\[[\s\S]*\]/)
        if (!jsonMatch) {
            throw new Error("AI nevrátila validní JSON pole")
        }
        const concepts: { hookPreview: string; angle: string; topic: string; qualityScore?: number }[] = JSON.parse(jsonMatch[0])

        // Auto-retry weak hooks (qualityScore < 6)
        const weakIndices = concepts
            .map((c, i) => ({ idx: i, score: c.qualityScore || 5 }))
            .filter(c => c.score < 6)
            .map(c => c.idx)

        if (weakIndices.length > 0 && weakIndices.length <= count) {
            console.log(`📊 Content plan: ${weakIndices.length} weak hooks detected, regenerating...`)
            const weakTypes = weakIndices.map(i => typeSequence[i] || "auto")
            const existingHooks = concepts.map(c => c.hookPreview)

            const retryPrompt = `Jsi content planner pro "${config.name}". Tyto hooky byly příliš slabé — přepiš je.
Nové hooky musí mít qualityScore ≥ 8 a musí být zcela odlišné. ZAKÁZANÁ SLOVA: "Dnes vám", "Zjistěte", "Víte že".

## PŘEDCHOZÍ (ZAMÍTNUTÉ) HOOKY:
${weakIndices.map(i => `- "${concepts[i].hookPreview}" (skóre: ${concepts[i].qualityScore})`).join("\n")}

## EXISTUJÍCÍ HOOKY V PLÁNU (neduplikuj):
${existingHooks.map(h => `- "${h}"`).join("\n")}

## TYPY POSTŮ PRO PŘEPSÁNÍ:
${weakTypes.map((t, i) => {
    const pt = ptMap.get(t)
    const pillar = getPillarForType(config, t)
    return `${i + 1}. Typ: "${t}" (${pt?.display_name || t}) | Pilíř: ${pillar}`
}).join("\n")}

Vrať POUZE validní JSON pole obsahující PŘESNĚ ${weakIndices.length} položek s klíči: hookPreview, angle, topic, qualityScore.`

            try {
                const retryRaw = await generateText(retryPrompt, { model: "gemini-3.5-flash", responseSchema: planSchema })
                const retryMatch = retryRaw.match(/\[[\s\S]*\]/)
                let retryConcepts: any[] = []
                if (retryMatch) {
                    retryConcepts = JSON.parse(retryMatch[0])
                } else {
                    retryConcepts = JSON.parse(retryRaw)
                }
                
                if (Array.isArray(retryConcepts) && retryConcepts.length > 0) {
                    weakIndices.forEach((origIdx, retryIdx) => {
                        if (retryConcepts[retryIdx]) {
                            concepts[origIdx] = retryConcepts[retryIdx]
                            console.log(`   ✅ Hook #${origIdx + 1} regenerated: "${retryConcepts[retryIdx].hookPreview}" (score: ${retryConcepts[retryIdx].qualityScore})`)
                        }
                    })
                }
            } catch {
                console.warn("   ⚠️ Hook retry failed — using original hooks")
            }
        }

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
                const fillRaw = await generateText(fillPrompt, { model: "gemini-3.5-flash", responseSchema: planSchema })
                const fillMatch = fillRaw.match(/\[[\s\S]*\]/)
                if (fillMatch) {
                    const fillConcepts = JSON.parse(fillMatch[0])
                    if (Array.isArray(fillConcepts) && fillConcepts.length > 0) {
                        concepts.push(...fillConcepts)
                        console.log(`   ✅ Doplněno ${fillConcepts.length} položek (celkem ${concepts.length}/${count})`)
                    }
                } else {
                    // Try parsing as array directly if regex failed
                    const fillConcepts = JSON.parse(fillRaw)
                    if (Array.isArray(fillConcepts) && fillConcepts.length > 0) {
                        concepts.push(...fillConcepts)
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
        const plan: ContentPlanItem[] = typeSequence.slice(0, count).map((typeName, i) => {
            const pt = ptMap.get(typeName)
            const pillar = getPillarForType(config, typeName)
            const pillarCfg = config.contentPillars[pillar]
            const concept = concepts[i] || { hookPreview: "", angle: "", topic: "" }

            return {
                id: `plan_${Date.now()}_${i}`,
                postType: typeName,
                postTypeEmoji: pt?.emoji || "📝",
                postTypeLabel: pt?.display_name || typeName,
                pillar,
                pillarEmoji: pillarCfg?.emoji || "📋",
                hookPreview: concept.hookPreview,
                angle: concept.angle,
                topic: concept.topic,
                qualityScore: concept.qualityScore || undefined,
                week: count > 14 ? Math.floor(i / 7) + 1 : undefined,
                day: i + 1,
            }
        })

        return { success: true, plan }
    } catch (err: any) {
        console.error("generateContentPlan error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
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
"Praktické tipy a návody krok za krokem. Používej čísla v hooku, konkrétní příklady a řešení reálných problémů zákazníků."`, { model: "gemini-3.5-flash" })

        return { success: true, prompt: raw.trim().replace(/^["']|["']$/g, "") }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

export async function regeneratePlanItem(
    projectSlug: string,
    postType: string,
    existingHooks: string[],
    userTopic?: string
): Promise<{ success: boolean; item?: { hookPreview: string; angle: string; topic: string }; error?: string }> {
    try {
        const { loadConfig } = await import("@/instagram/configs")
        const { getPillarForType } = await import("@/instagram/service")
        const config = await loadConfig(projectSlug)

        // Build pillar context for this post type
        const pillar = getPillarForType(config, postType)
        const pillarCfg = config.contentPillars[pillar]
        const pillarSection = pillarCfg
            ? `## PILÍŘ: ${pillarCfg.emoji} ${pillarCfg.label}\n${pillarCfg.description || ""}\nCíl: ${pillarCfg.ctaStrategy === "hard" ? "PRODEJ" : pillarCfg.ctaStrategy === "medium" ? "HODNOTA" : pillarCfg.ctaStrategy === "soft" ? "DOSAH" : "KOMUNITA"}\n`
            : ""

        const productsSection = config.products?.length
            ? `## PRODUKTY (${config.products.length})\n${config.products.slice(0, 6).map(p => `- ${p.name} (${p.type})${p.price ? ` — ${p.price}` : ""}`).join("\n")}\n`
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

## NESMÍŠ OPAKOVAT tyto hooky:
${existingHooks.map(h => `- "${h}"`).join("\n")}

## PRAVIDLA:
- Hook musí zastavit scrollování — provokativní, překvapivý, specifický pro "${config.name}"
- ŽÁDNÉ emoji v hooku
- Hook max 12 slov, česky
- Angle musí být konkrétní — ne "zajímavý pohled" ale "srovnání cen s konkurencí"
- Topic: 3-5 slov shrnující o čem post bude

Vrať POUZE validní JSON:
{ "hookPreview": "český hook max 12 slov BEZ emoji", "angle": "1 věta o přístupu", "topic": "3-5 slov" }`

        const { generateText } = await import("@/instagram/gemini-client")
        const raw = await generateText(prompt, { model: "gemini-3.5-flash" })
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error("Invalid JSON response")
        const item = JSON.parse(jsonMatch[0])

        return { success: true, item }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

