/**
 * Reaper zaseklých generačních jobů — jedna logika pro dvě cesty.
 * ================================================================
 * Job v `ig_jobs`, který se přes STUCK_AFTER_MS nepohnul z ne-koncového stavu
 * (pending / copywriter / designer / video …), je mrtvá lambda: 800s strop,
 * OOM, redeploy uprostřed renderu. Zákazníkovi za něj byl stržen kredit a nikdo
 * mu ho nevrátí, dokud se job neoznačí za selhaný.
 *
 * Do 9/2026 tohle uměl jen `/api/ig-job-status` — tedy jen tehdy, když měl
 * zákazník otevřený tab a prohlížeč job polloval. Job dokončovaný cronem
 * (`job-resume`), job po zavření tabu nebo job z jiného zařízení visel týdny;
 * `lib/agents/health-check.ts` ho ranním briefem jen HLÁSIL („job visí uprostřed
 * pipeline"), kredit zůstal stržený a náprava byla ruční. Sweep v `job-resume`
 * cronu (1×/min) teď sáhne na tytéž joby bez ohledu na to, kdo se dívá.
 *
 * Invarianty:
 *  - ZÁBĚR JE PODMÍNĚNÝ CLAIM (CLAUDE.md): `UPDATE … WHERE id=? AND status NOT IN
 *    (done, failed)`. Když nevrátí řádek, job mezitím doběhl nebo ho zabral
 *    druhý reaper — a pak se NESMÍ vracet kredit. Refund jde jen za claimem.
 *  - Kampaňové joby (`config.campaignId`) se NEREAPUJÍ: campaign-worker si je
 *    v dalším ticku sám znovu zvedne z checkpointu a jejich platbu vědomě drží
 *    (viz komentář u „ghost job" v campaign-worker). Kdyby je reaper vrátil
 *    a worker pak post dokončil, vznikl by post zdarma.
 *  - Zaparkovaný job (`status='failed'` + `retry_after`) je koncový stav, takže
 *    se ho filtr na ne-koncové stavy netýká — parkování kredit drží schválně.
 */

import supabaseAdmin from "@/supabase/admin"

/** Stavy, ve kterých job skončil — reaper se jich nikdy nedotkne. */
export const TERMINAL_STATUSES = ["done", "failed"] as const

/**
 * Po jaké době ticha je běžící job mrtvý. MUSÍ přesahovat maxDuration běhu
 * (800 s na Vercel Pro), jinak reaper označí živý, jen pomalý render za mrtvý
 * a vrátí kredit za post, který vzápětí dojede.
 */
export const STUCK_AFTER_MS = 15 * 60 * 1000

/** Text pro zákazníka — musí říct, že má zkusit znovu a že o nic nepřišel. */
export const STUCK_MESSAGE = "Generování vypršelo (timeout) — kredit jsme vrátili, zkuste to prosím znovu."

export interface ReapableJob {
    id: string
    client_id: string
    status: string
    config: Record<string, unknown> | null
    created_at: string
    updated_at: string | null
}

/** Je job po lhůtě ticha v ne-koncovém stavu? Čistá funkce kvůli testům. */
export function isStuck(job: Pick<ReapableJob, "status" | "created_at" | "updated_at">, now = Date.now()): boolean {
    if ((TERMINAL_STATUSES as readonly string[]).includes(job.status)) return false
    const lastActivity = new Date(job.updated_at || job.created_at).getTime()
    return now - lastActivity > STUCK_AFTER_MS
}

/** Kampaňový job patří campaign-workeru, ne reaperu. */
export function isCampaignJob(job: Pick<ReapableJob, "config">): boolean {
    return !!(job.config as { campaignId?: unknown } | null)?.campaignId
}

/**
 * Označí jeden zaseklý job za selhaný a vrátí kredit. Claim → refund, v tomhle
 * pořadí, a refund jen když claim vrátil řádek.
 * @returns true, když tenhle běh job skutečně zabral (a vrátil kredit).
 */
export async function reapStuckJob(job: ReapableJob): Promise<boolean> {
    const { data: claimed } = await supabaseAdmin
        .from("ig_jobs")
        .update({ status: "failed", agent_message: "⏱️ Timeout", error: STUCK_MESSAGE, retry_after: null })
        .eq("id", job.id)
        .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`) // nepřepsat souběžné dokončení
        .select("id")

    if (!claimed || claimed.length === 0) return false

    try {
        const { refundJobCharge } = await import("@/lib/subscription")
        const cfg = (job.config ?? {}) as { charged?: "plan" | "credits" | "none"; chargedCredits?: number }
        await refundJobCharge(job.client_id, job.id, cfg.charged, cfg.chargedCredits)
    } catch (err: any) {
        // Refund je idempotentní přes unikátní index credit_transactions(action, reference_id);
        // selhání tady znamená DB problém, ne dvojí vrácení. Musí být vidět.
        console.error(`🚨 reaper: job ${job.id} označen za selhaný, ale vrácení kreditu selhalo: ${err?.message}`)
    }
    return true
}

/**
 * Sweep pro cron: najde všechny zaseklé samostatné joby a zavře je.
 * Lehký dotaz (limit, jen potřebné sloupce), běží každou minutu vedle
 * resume odložených zakázek. Kampaňové joby přeskakuje — viz hlavička.
 */
export async function sweepStuckJobs(limit = 20): Promise<{ scanned: number; reaped: number }> {
    const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString()
    const { data, error } = await supabaseAdmin
        .from("ig_jobs")
        .select("id, client_id, status, config, created_at, updated_at")
        .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
        .lt("updated_at", cutoff)
        .order("updated_at", { ascending: true })
        .limit(limit)

    if (error) {
        console.error(`⚠️ reaper: sken zaseklých jobů selhal: ${error.message}`)
        return { scanned: 0, reaped: 0 }
    }

    let reaped = 0
    for (const job of (data ?? []) as ReapableJob[]) {
        if (isCampaignJob(job)) continue
        if (!isStuck(job)) continue // updated_at má trigger, ale pojistka proti hodinám je zadarmo
        if (await reapStuckJob(job)) {
            reaped++
            console.warn(`⏱️ reaper: job ${job.id} (klient ${job.client_id.slice(0, 8)}…) visel ve stavu '${job.status}' — selhání + vrácení kreditu`)
        }
    }
    return { scanned: data?.length ?? 0, reaped }
}
