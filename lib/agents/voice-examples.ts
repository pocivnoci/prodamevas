/**
 * Zlaté příklady hlasu — jediné místo, kde se config učí sám ze sebe.
 * =====================================================================
 * `config.brandVoiceExamples` je podle komentáře u typu „the strongest single lever
 * for voice consistency" a má být *„seeded at onboarding … and grown by promoting
 * A/B winners / top performers"*. Ta druhá půlka nikdy nevznikla: příklady se zasely
 * při onboardingu z cizího IG feedu (a u většiny klientů ani to) a od té doby se
 * nehnuly. Naměřeno na produkci: **12 ze 13 klientů má nula příkladů**, přičemž
 * `chrlit` má 32 postů s metrikami — hotový materiál, který nikdo nepoužil.
 *
 * Širší souvislost: `clients.config` se doteď neměnil automaticky NIKDE. Učicí vrstva
 * uměla jen přepočítat váhy výběru za běhu (`perfFactor`, `buildSmartWeekPlan`) a po
 * doběhnutí je zahodit. Systém se tak nikdy nemohl zlepšit nad rámec onboardingu.
 * Tohle je první smyčka, která zpětnou vazbu povýší na trvalé pravidlo značky.
 *
 * Bezpečnost konstrukcí:
 *  - zdarma: žádné volání modelu, jen čtení metrik a jeden zápis
 *  - nikdy nedegraduje: příklad ze zasetí nahradí JEN post s reálně naměřeným
 *    výkonem. Dokud metriky nejsou, agent se nedotkne ničeho
 *  - ohraničené: nejvýš MAX_EXAMPLES položek, delší captiony se ořezávají
 *  - bez duplicit: dva příklady se stejným hookem nemají smysl (reuse isHookSimilar)
 *  - atomické: zápis jde přes RPC set_brand_voice_examples (jsonb_set), takže
 *    souběžná editace jiných polí v Nastavení se nepřepíše
 *  - izolované per klient: jeden rozbitý tenant nezastaví ostatní
 */

import supabaseAdmin from "@/supabase/admin"
import { isHookSimilar } from "@/instagram/service"
import type { BrandVoiceExample } from "@/instagram/configs/types"

/** Kolik zlatých příkladů se drží. Few-shot kotva, ne archiv — buildGoldExamplesSection
 *  jich stejně do promptu pouští nejvýš 4. */
export const MAX_EXAMPLES = 6
/** Pod tímhle počtem naměřených postů je „nejlepší" jen šum. */
export const MIN_MEASURED = 3
/**
 * Absolutní podlaha engagementu (likes + 3×comments + 5×saves).
 *
 * Bez ní agent povyšoval posty s engagementem 1 — tedy s jedním lajkem — a psal
 * k nim „Ověřeno výkonem". To je přesně tichá degradace kvality: kotva hlasu by
 * stála na šumu a tvářila se jako důkaz. Když nic nepřekročí podlahu, je správné
 * nepovýšit nic a nechat zasetou kotvu být.
 */
export const MIN_ENGAGEMENT = 10
/** Navíc musí post překonat průměr značky — stejná logika jako outliery
 *  v analyzeAndLearn (memory-agent.ts). Podlaha řeší malé účty, násobek velké. */
export const ABOVE_AVERAGE_FACTOR = 1.2
/** Kratší text není ukázka hlasu. */
export const MIN_CAPTION_LEN = 60
/** Ořez jednoho příkladu — prompt musí zůstat ohraničený. */
export const MAX_CAPTION_LEN = 600
/** Podle téhle značky v `note` agent pozná vlastní dřívější povýšení a umí ho
 *  vzít zpět. Zaseté kotvy z onboardingu ji nemají, a proto přežijí. */
export const PROMOTED_NOTE_PREFIX = "Ověřeno výkonem"

export interface VoicePromotionResult {
    slug: string
    promoted: number
    kept: number
    skipped?: string
}

/** Stejný vzorec jako propagateMetricsToSources a analyzePerformance. */
function engagement(p: { likes?: number | null; comments?: number | null; saves?: number | null }): number {
    return (p.likes || 0) + 3 * (p.comments || 0) + 5 * (p.saves || 0)
}

function firstLine(caption: string): string {
    return caption.split("\n")[0].trim()
}

/** Srovnatelný tvar seznamu — nezávislý na pořadí klíčů, které jsonb přerovnává.
 *  Pořadí PRVKŮ zůstává významné: je to žebříček podle výkonu. */
function canonical(list: BrandVoiceExample[]): string {
    return JSON.stringify(list.map(e => [e.caption ?? "", e.note ?? ""]))
}

export async function promoteVoiceExamples(): Promise<VoicePromotionResult[]> {
    const { data: clients, error } = await supabaseAdmin
        .from("clients")
        .select("id, slug, config")
        // Stejně jako idea-replenish a auto-publish: zrušený tenant nemá co
        // konzumovat běh denní údržby.
        .eq("is_active", true)
    if (error) throw new Error(`Nepodařilo se načíst klienty: ${error.message}`)

    // Rotované pořadí + časový rozpočet — viz lib/agents/client-sweep.ts.
    const { sweepClients } = await import("./client-sweep")
    const { results } = await sweepClients(
        (clients || []) as { id: string; slug: string; config: unknown }[],
        client => promoteForClient(client),
        (client, err) => ({ slug: client.slug, promoted: 0, kept: 0, skipped: `chyba: ${err.message}` }),
    )
    return results
}

async function promoteForClient(client: { id: string; slug: string; config: unknown }): Promise<VoicePromotionResult> {
            const config = (client.config || {}) as { brandVoiceExamples?: BrandVoiceExample[] }
            const existing = config.brandVoiceExamples || []

            const { data: posts } = await supabaseAdmin
                .from("ig_posts")
                .select("caption, likes, comments, saves, post_type_id")
                .eq("client_id", client.id)
                .not("likes", "is", null)
                .neq("status", "rejected")
                .not("caption", "is", null)

            const measured = (posts || []).filter(p => (p.caption || "").trim().length >= MIN_CAPTION_LEN)
            if (measured.length < MIN_MEASURED) {
                return { slug: client.slug, promoted: 0, kept: existing.length, skipped: `jen ${measured.length} naměřených postů` }
            }

            // Zlatý příklad musí být DŮKAZ, ne jen nejlepší z ničeho. Proto obojí:
            // absolutní podlaha (malé účty, kde je průměr sám o sobě šum) i překonání
            // průměru značky (velké účty, kde podlahu splní kdeco).
            const scored = measured.map(p => ({ caption: String(p.caption), score: engagement(p) }))
            const avg = scored.reduce((s, p) => s + p.score, 0) / scored.length
            const bar = Math.max(MIN_ENGAGEMENT, avg * ABOVE_AVERAGE_FACTOR)
            const ranked = scored.filter(p => p.score >= bar).sort((a, b) => b.score - a.score)

            // Naměřený výkon má přednost před zasetým odhadem; zasetá kotva ale zůstává,
            // dokud ji je čím nahradit — jinak by značka na chvíli přišla o hlas úplně.
            const next: BrandVoiceExample[] = []
            const takenHooks: string[] = []

            const tryAdd = (caption: string, note?: string): boolean => {
                if (next.length >= MAX_EXAMPLES) return false
                const hook = firstLine(caption)
                if (takenHooks.some(h => isHookSimilar(hook, h, 0.5))) return false
                takenHooks.push(hook)
                next.push({ caption: caption.slice(0, MAX_CAPTION_LEN), ...(note ? { note } : {}) })
                return true
            }

            // Množina se staví VŽDY znovu. Kdyby se jen přidávalo, zůstal by v configu
            // navěky viset příklad povýšený omylem nebo podle metrik, které se později
            // změnily — agent by neuměl vzít vlastní rozhodnutí zpět.
            let promoted = 0
            for (const r of ranked) if (tryAdd(r.caption, `${PROMOTED_NOTE_PREFIX}: engagement ${r.score} při průměru ${avg.toFixed(1)}`)) promoted++
            // Zaseté kotvy (onboarding, skripty) doplní zbytek. Vlastní dřívější
            // povýšení se nezachovávají — buď laťku splní znovu výš, nebo odejdou.
            let kept = 0
            for (const e of existing) {
                if (!e.caption || e.note?.startsWith(PROMOTED_NOTE_PREFIX)) continue
                if (tryAdd(e.caption, e.note)) kept++
            }

            // Porovnání MUSÍ být kanonické. PostgreSQL jsonb si klíče v objektu
            // přerovnává (kratší napřed), takže `{caption, note}` se vrátí jako
            // `{note, caption}` a prosté JSON.stringify by hlásilo změnu pokaždé —
            // agent by přepisoval config každý den nadarmo a hlásil falešná povýšení.
            if (canonical(next) === canonical(existing)) {
                return { slug: client.slug, promoted: 0, kept: existing.length, skipped: "beze změny" }
            }

            const { error: rpcErr } = await supabaseAdmin.rpc("set_brand_voice_examples", {
                p_client_id: client.id,
                p_examples: next,
            })
            if (rpcErr) throw new Error(rpcErr.message)

            const { invalidateConfigCache } = await import("@/instagram/configs")
            invalidateConfigCache(client.slug)

            console.log(`   ✓ ${client.slug}: ${promoted} ověřených + ${kept} zasetých zlatých příkladů`)
            return { slug: client.slug, promoted, kept }
}
