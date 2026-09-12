/**
 * Idea-bank auto-replenishment agent — the bank never silently runs dry.
 * ======================================================================
 * The idea bank (ig_post_ideas) is seeded once at onboarding and then only grows
 * when a plan deposits invented topics back (startCampaign) or the user clicks AI
 * generation in the Nápady tab. At a 2×/day cadence the available pool (active,
 * off-cooldown) drains faster than it refills — weighted selection then recycles
 * the same few ideas every cooldown cycle (repetitive feed) or the plan draws
 * from an empty bank. Nobody is told. This agent tops each client's bank up to a
 * cadence-derived runway before that happens, so fresh in-season ideas are
 * already waiting when the next plan runs.
 *
 * Safety by construction:
 *  - free: no creditGuard — system maintenance like seedIdeaBank, never charged
 *    (a background action a user didn't click must never move their balance)
 *  - bounded: at most MAX_BATCHES_PER_RUN batches × MAX_BATCH ideas per client
 *    per daily run, and only up to the runway target — token cost is capped by
 *    construction, a prompt gone weird can't flood the bank
 *  - threshold-gated: a full bank no-ops; clients with no generated post in
 *    ACTIVITY_WINDOW_DAYS are skipped entirely (churned tenants burn no tokens)
 *  - opt-out: config.autoReplenishIdeas === false disables per client
 *  - isolated per client: one broken tenant never blocks the rest
 *  - inert output: new ideas just sit in the bank (visible + deactivatable in
 *    the Nápady tab) until a plan picks them — nothing publishes, nothing is
 *    charged downstream
 */

import supabaseAdmin from "@/supabase/admin"
import { NOT_SHOWCASE } from "@/lib/audience"
import { MAX_POSTS_PER_WEEK } from "@/lib/schedule-planner"
import { DEFAULT_IDEA_COOLDOWN_DAYS } from "@/instagram/service"
import { findMiscategorized, categoryKeySet, type PillarCategoryMap } from "@/instagram/idea-rules"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Kolik týdnů kadence má dostupná zásoba pokrýt.
 *
 * Původní 2 týdny byly matematicky pod hranicí udržitelnosti. Použitý nápad je
 * `DEFAULT_IDEA_COOLDOWN_DAYS` (30) dní nedostupný, takže aby se banka nevyčerpala,
 * musí pokrýt CELÉ cooldown okno:
 *
 *     potřeba = postsPerWeek × (cooldown / 7)
 *
 * Při 30denním cooldownu je to ~4,3 týdne kadence — víc než dvojnásobek toho, co
 * cíl počítal. Klient s kadencí 14×/týden potřebuje ~60 nápadů na jedno okno,
 * ale cíl mu jich držel 28. Vážený výběr pak recykloval tu hrstku, co zrovna
 * vypadla z cooldownu, a feed se opakoval.
 *
 * Rezerva navíc: bez ní má výběr na konci okna jediného kandidáta a „vážená
 * selekce" přestane vybírat — vezme, co zbylo.
 */
export const RUNWAY_WEEKS = (DEFAULT_IDEA_COOLDOWN_DAYS / 7) * 1.5
/** Floor for the runway target — even a 1×/week client keeps a varied pool. */
export const MIN_TARGET = 10
/** Skip refills smaller than this — daily 1–2 idea dribbles aren't worth a run. */
export const MIN_REFILL = 4
/** Per-pillar generation batch cap (one generateAIIdeas call). */
export const MAX_BATCH = 8
/** Max generation batches per client per daily run. */
export const MAX_BATCHES_PER_RUN = 2
/** Clients with no generated post in this window are skipped as dormant. */
export const ACTIVITY_WINDOW_DAYS = 60

export interface PillarState {
    id: string
    ratio: number
    available: number
}

export interface ReplenishBatch {
    pillarId: string
    count: number
}

export interface ReplenishPlan {
    target: number
    available: number
    need: number
    batches: ReplenishBatch[]
}

/**
 * Pure planning math (tested by scripts/test-idea-replenish.ts).
 * Target = cadence-derived runway; refill goes to the most starved pillars —
 * starvation measured against each pillar's ratio-fair share of the target, so
 * a 50%-ratio pillar with 2 ideas is hungrier than a 10% pillar with 2.
 * `extraAvailable` = available ideas outside the current pillars (retired
 * pillar ids): they still count toward the runway (getWeightedIdeas serves
 * them), but generation can only target pillars that exist in the config.
 */
export function computeReplenishPlan(perWeek: number, pillars: PillarState[], extraAvailable = 0): ReplenishPlan {
    const cadence = Math.min(MAX_POSTS_PER_WEEK, Math.max(1, Math.round(perWeek || 4)))
    const target = Math.max(MIN_TARGET, Math.ceil(cadence * RUNWAY_WEEKS))
    const available = pillars.reduce((s, p) => s + p.available, 0) + extraAvailable
    const need = target - available

    if (need < MIN_REFILL || pillars.length === 0) {
        return { target, available, need: Math.max(0, need), batches: [] }
    }

    const totalRatio = pillars.reduce((s, p) => s + (p.ratio || 0), 0)
    const starved = pillars
        .map(p => ({
            id: p.id,
            // Fair share of the target by pillar ratio; equal shares if ratios are unset.
            deficit: (totalRatio > 0 ? (target * (p.ratio || 0)) / totalRatio : target / pillars.length) - p.available,
        }))
        .sort((a, b) => b.deficit - a.deficit)

    const batches: ReplenishBatch[] = []
    let remaining = need
    for (const p of starved.slice(0, MAX_BATCHES_PER_RUN)) {
        if (remaining <= 0) break
        const count = Math.min(MAX_BATCH, remaining)
        batches.push({ pillarId: p.id, count })
        remaining -= count
    }
    return { target, available, need, batches }
}

export interface ReplenishResult {
    clientId: string
    slug: string
    added: number
    available: number
    target: number
    /** Kolik nápadů bez platné kategorie dostalo kategorii (úklid před doplněním). */
    classified?: number
    skipped?: string
}

/** Same off-cooldown rule as getWeightedIdeas — an idea on cooldown is not available. */
function offCooldown(idea: { last_used_at: string | null; cooldown_days: number | null }, now: number): boolean {
    if (!idea.last_used_at) return true
    // Jediný zdroj pravdy — agent musí považovat za dostupné přesně to, co
    // getWeightedIdeas při generování, jinak by doplňoval do banky, která se
    // z pohledu enginu tváří plná (nebo naopak).
    const cooldownDays = idea.cooldown_days ?? DEFAULT_IDEA_COOLDOWN_DAYS
    return now - new Date(idea.last_used_at).getTime() > cooldownDays * DAY_MS
}

/**
 * Replenish one client's bank if it's below the runway target.
 *
 * Exportované, protože od 9/2026 je tohle jednotka rozeslané práce: úloha
 * `idea_replenish_client` volá právě tuhle funkci pro jednoho klienta. Všechny
 * pojistky (opt-out, spící klient, strop dávek, práh) zůstávají TADY, ne
 * v plánovači — plánovačův filtr je jen optimalizace, aby se nezakládaly úlohy,
 * které stejně nic neudělají. Kdyby se filtry přesunuly nahoru, stačilo by
 * zavolat úlohu jinudy a pojistky by zmizely.
 */
export async function replenishClient(clientId: string, slug: string, raw: Record<string, unknown>): Promise<ReplenishResult> {
    if (raw.autoReplenishIdeas === false) {
        return { clientId, slug, added: 0, available: 0, target: 0, skipped: "opt-out (autoReplenishIdeas)" }
    }

    // Úklid před doplněním: nápady bez platné kategorie (vklad z plánu před #131,
    // přegenerované pilíře s novými id) zařadit, ať jsou v záložce Nápady pod svým
    // čipem a plán je umí nabídnout správnému slotu. Jedno levné volání, a jen když
    // je co zařazovat. Běží PŘED kontrolou spícího klienta: sem se posílá i klient,
    // který si právě přepsal kategorie v Nastavení, a ten chce zařazení hned.
    let classified = 0
    try {
        const { data: catRows, error: cErr } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("id, category, subcategory")
            .eq("client_id", clientId)
            .eq("is_active", true)
        if (cErr) throw new Error(cErr.message)
        if (findMiscategorized(catRows || [], (raw.contentPillars || {}) as PillarCategoryMap).length > 0) {
            const { loadConfig } = await import("@/instagram/configs")
            const { classifyUncategorizedIdeas } = await import("@/instagram/idea-generator")
            classified = (await classifyUncategorizedIdeas(await loadConfig(slug), clientId)).assigned
        }
    } catch (err) {
        // Nahlas, ale nefatálně — doplnění zásobníku nesmí padnout na úklidu.
        console.warn(`💡 idea-replenish (${slug}): zařazení nápadů selhalo: ${(err as Error)?.message?.slice(0, 160)}`)
    }

    // Dormant tenant → no token spend. Any generated post in the window counts.
    const activitySince = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * DAY_MS).toISOString()
    const { count: recentPosts, error: aErr } = await supabaseAdmin
        .from("ig_posts")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .gte("created_at", activitySince)
    if (aErr) throw new Error(`activity read (${slug}): ${aErr.message}`)
    if (!recentPosts) {
        return { clientId, slug, added: 0, available: 0, target: 0, classified, skipped: `no post in ${ACTIVITY_WINDOW_DAYS} d` }
    }

    const { data: ideas, error: iErr } = await supabaseAdmin
        .from("ig_post_ideas")
        .select("category, last_used_at, cooldown_days")
        .eq("client_id", clientId)
        .eq("is_active", true)
    if (iErr) throw new Error(`bank read (${slug}): ${iErr.message}`)

    const now = Date.now()
    const availableByPillar = new Map<string, number>()
    for (const idea of ideas ?? []) {
        if (!offCooldown(idea, now)) continue
        availableByPillar.set(idea.category, (availableByPillar.get(idea.category) || 0) + 1)
    }

    const pillarDefs = (raw.contentPillars || {}) as Record<string, { ratio?: number }>
    const pillarIds = Object.keys(pillarDefs)
    if (pillarIds.length === 0) {
        return { clientId, slug, added: 0, available: 0, target: 0, classified, skipped: "no content pillars in config" }
    }
    const orphanAvailable = [...availableByPillar.entries()]
        .filter(([id]) => !pillarDefs[id])
        .reduce((s, [, n]) => s + n, 0)
    const pillars: PillarState[] = pillarIds.map(id => ({
        id,
        ratio: pillarDefs[id]?.ratio || 0,
        available: availableByPillar.get(id) || 0,
    }))

    const perWeek = Number(raw.postsPerWeek) || 4
    const plan = computeReplenishPlan(perWeek, pillars, orphanAvailable)
    if (plan.batches.length === 0) {
        return { clientId, slug, added: 0, available: plan.available, target: plan.target, classified }
    }

    const { loadConfig } = await import("@/instagram/configs")
    const { withActiveProject } = await import("@/instagram/service")
    const { generateAIIdeas } = await import("@/instagram/idea-generator")
    const config = await loadConfig(slug)

    let added = 0
    for (const batch of plan.batches) {
        // withActiveProject: getBrandMemories() inside the generator needs the
        // tenant scope (same as seedIdeaBank — there is no session in a cron).
        const rows = await withActiveProject(clientId, () => generateAIIdeas(config, batch.pillarId, batch.count))
        added += rows?.length || 0
    }

    console.log(`💡 idea-replenish: +${added} nápadů pro ${slug} (available ${plan.available}/${plan.target}${classified ? `, zařazeno ${classified}` : ""})`)
    return { clientId, slug, added, available: plan.available, target: plan.target, classified }
}

/**
 * Po uložení konfigurace: když se změnila množina kategorií pilířů (přegenerování,
 * přejmenování id), nápady v zásobníku zůstanou s id, které už nic neznamená — a
 * v záložce Nápady spadnou pod „bez kategorie". Zařazení dělá `idea_replenish_client`
 * (classifyUncategorizedIdeas); sem patří jen fronta, ať uložení nečeká na model.
 * Nikdy nehází — uložení configu se kvůli frontě nesmí rozbít.
 */
export async function enqueueReclassifyIfCategoriesChanged(clientId: string, slug: string, before: unknown, after: unknown): Promise<boolean> {
    try {
        const a = categoryKeySet((before || {}) as PillarCategoryMap)
        const b = categoryKeySet((after || {}) as PillarCategoryMap)
        const changed = a.size !== b.size || [...b].some(k => !a.has(k))
        if (!changed) return false
        const { fanOutPerClient } = await import("./fan-out")
        const out = await fanOutPerClient("idea_replenish_client", [clientId])
        console.log(`🗂️ Kategorie pilířů ${slug} změněny → úloha na zařazení nápadů (${out.enqueued ? "zařazena" : out.skipped ? "už ve frontě" : "selhala"})`)
        return true
    } catch (e) {
        console.warn(`🗂️ Fronta na zařazení nápadů (${slug}) selhala: ${(e as Error)?.message?.slice(0, 160)}`)
        return false
    }
}

/**
 * Top up the idea bank of every active, non-dormant client below its runway.
 * Isolated per client so one broken tenant never blocks the rest. Called by the
 * daily-ops cron via the `idea_replenish` handler.
 */
export async function replenishIdeaBanks(): Promise<ReplenishResult[]> {
    // Výloha ne. Přeskočení „spícího" klienta ji chytí až po pár dnech ticha,
    // takže po každém přeseedování portfolia se deset demo značek zásobovalo
    // nápady, které nikdo nepřečte — a platí se za ně tokeny.
    const { data: clients, error } = await supabaseAdmin
        .from("clients")
        .select("id, slug, config")
        .eq("is_active", true)
        .or(NOT_SHOWCASE)
    if (error) throw new Error(`idea-replenish client scan: ${error.message}`)

    // Rotované pořadí + časový rozpočet — viz lib/agents/client-sweep.ts. Bez toho
    // by zabitý běh pokaždé odřízl tytéž klienty na konci seznamu.
    const { sweepClients } = await import("./client-sweep")
    const { results } = await sweepClients(
        (clients || []) as { id: string; slug: string; config: unknown }[],
        c => replenishClient(c.id, c.slug, (c.config || {}) as Record<string, unknown>),
        (c, err) => ({ clientId: c.id, slug: c.slug, added: 0, available: 0, target: 0, skipped: err.message?.slice(0, 200) }),
    )
    return results
}

/**
 * Plánovač: zjistí, komu má smysl zásobník doplnit, a rozešle práci po klientech.
 *
 * Nahrazuje `replenishIdeaBanks()` v denním běhu. Rozdíl je v tom, kde se čas
 * tráví: sweep dělal VŠECHNU práci v jedné úloze s rozpočtem 600 s (~20 klientů
 * s voláním modelu), tenhle plánovač jen čte a zapisuje — a generování se pak
 * rozloží mezi překrývající se běhy workeru. Viz `lib/agents/fan-out.ts`.
 *
 * Naměřeno proti produkci 11. 9. 2026: **13 klientů za 8,5 s**, z toho většina
 * jsou sekvenční zápisy úloh (~340 ms na kolo). Lineárně to dává ~100 s pro
 * 300 klientů — pořád hluboko pod rozpočtem úlohy (700 s), ale není to zadarmo.
 * Až to začne vadit, další krok je zápis úloh po dávkách, ne další optimalizace
 * dotazů: ty jsou dva bez ohledu na počet klientů.
 *
 * Filtry jsou schválně jen ty, které jdou udělat MNOŽINOVĚ, jedním dotazem:
 *
 *   - neaktivní klient a výloha — přímo v dotazu
 *   - výslovný opt-out v configu — v paměti nad týmž výsledkem
 *   - spící klient (bez příspěvku za `ACTIVITY_WINDOW_DAYS`) — jeden dotaz na
 *     všechny naráz, ne jeden na klienta
 *
 * Práh zásobníku se tu ZÁMĚRNĚ nekontroluje: to je dotaz na klienta a dělat ho
 * v plánovači by vrátilo přesně ten problém, kvůli kterému plánovač vznikl.
 * Úloha si ho zkontroluje sama a levně no-opne.
 */
export async function planIdeaReplenish(): Promise<{ candidates: number; enqueued: number; skipped: number; failed: number }> {
    const { data: clients, error } = await supabaseAdmin
        .from("clients")
        .select("id, config")
        .eq("is_active", true)
        .or(NOT_SHOWCASE)
    if (error) throw new Error(`idea-replenish plan scan: ${error.message}`)

    const eligible = (clients || []).filter(c =>
        (c.config as { autoReplenishIdeas?: unknown } | null)?.autoReplenishIdeas !== false)
    if (eligible.length === 0) return { candidates: 0, enqueued: 0, skipped: 0, failed: 0 }

    // Živí klienti jedním dotazem. `ig_posts` se čte bez agregace schválně:
    // PostgREST neumí `group by`, a množina id je i při stovkách klientů malá.
    const activitySince = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * DAY_MS).toISOString()
    const { data: recent, error: aErr } = await supabaseAdmin
        .from("ig_posts")
        .select("client_id")
        .gte("created_at", activitySince)
        .in("client_id", eligible.map(c => c.id))
    if (aErr) throw new Error(`idea-replenish activity scan: ${aErr.message}`)

    const live = new Set((recent || []).map(r => r.client_id as string))
    const targets = eligible.filter(c => live.has(c.id)).map(c => c.id)

    const { fanOutPerClient } = await import("./fan-out")
    const out = await fanOutPerClient("idea_replenish_client", targets)
    return { candidates: targets.length, enqueued: out.enqueued, skipped: out.skipped, failed: out.failed.length }
}
