/**
 * Daily ops health check — "nothing breaks silently".
 * ====================================================
 * Scans the last 24 h for operational problems and returns a report.
 *
 * This module is a DETECTION LIBRARY, not a channel: it no longer owns an
 * e-mail. `lib/agents/daily-brief.ts` consumes buildHealthCheck() as its
 * `system` section, so the founder gets one morning brief instead of a mail
 * per agent. renderHealthAlert() is kept for the standalone script and for
 * anyone who wants the old shape.
 *
 * Defensive like weekly-report: each check is isolated, a broken source is
 * reported as a problem of its own rather than crashing the whole check.
 */

import supabaseAdmin from "@/supabase/admin"

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export interface HealthProblem {
    icon: string
    title: string
    detail: string
}

export interface HealthReport {
    healthy: boolean
    problems: HealthProblem[]
    checkedAt: string
}

type Check = () => Promise<HealthProblem | null>

/**
 * Wraps a check so its own failure surfaces as a problem instead of crashing the run.
 * Exported because the daily brief composes several independent scanners the same
 * way — one broken data source must never cost the founder the whole briefing.
 */
export async function safe(name: string, fn: Check): Promise<HealthProblem | null> {
    try {
        return await fn()
    } catch (err) {
        return { icon: "🧨", title: `Kontrola „${name}" selhala`, detail: (err as Error)?.message?.slice(0, 200) || "neznámá chyba" }
    }
}

export async function buildHealthCheck(): Promise<HealthReport> {
    const since24h = new Date(Date.now() - DAY_MS).toISOString()
    const staleHour = new Date(Date.now() - HOUR_MS).toISOString()

    const checks: Array<Promise<HealthProblem | null>> = [
        // Generation failures (single posts + campaign posts share ig_jobs).
        safe("selhané joby", async () => {
            const { count, error } = await supabaseAdmin.from("ig_jobs").select("id", { count: "exact", head: true })
                .eq("status", "failed").gte("created_at", since24h)
            if (error) throw new Error(error.message)
            return count && count > 0
                ? { icon: "⚠️", title: `${count}× selhaný generační job (24 h)`, detail: "Detail v ig_jobs / Sentry." }
                : null
        }),

        // A job stuck mid-pipeline (neither done nor failed) for hours means a
        // crashed run that never resolved. Windowed to 7 days so old debris
        // (pre-dating this check) doesn't alarm forever.
        safe("zaseklé joby", async () => {
            const { count, error } = await supabaseAdmin.from("ig_jobs").select("id", { count: "exact", head: true })
                .not("status", "in", "(done,failed)")
                .lt("created_at", new Date(Date.now() - 2 * HOUR_MS).toISOString())
                .gte("created_at", new Date(Date.now() - 7 * DAY_MS).toISOString())
            if (error) throw new Error(error.message)
            return count && count > 0
                ? { icon: "⚠️", title: `${count}× job visí uprostřed pipeline`, detail: "Přes 2 h v ne-koncovém stavu (pending/copywriter/…) — spadlý běh." }
                : null
        }),

        // A campaign stuck 'running' with an hour-dead lease means the worker
        // stopped reclaiming it — normally a stale lease is re-claimed within minutes.
        safe("zaseklé kampaně", async () => {
            // A running campaign is stuck if its lease is stale OR null — `.lt`
            // alone drops null rows, exactly the "lease was cleared / never set" case.
            const { count, error } = await supabaseAdmin.from("ig_campaigns").select("id", { count: "exact", head: true })
                .eq("status", "running").or(`worker_lease.is.null,worker_lease.lt.${staleHour}`)
            if (error) throw new Error(error.message)
            return count && count > 0
                ? { icon: "🛑", title: `${count}× kampaň visí ve stavu running`, detail: "worker_lease starší než hodina — campaign-worker ji nepřebírá." }
                : null
        }),

        // Pending campaigns older than an hour = the campaign-worker cron isn't draining.
        safe("nespuštěné kampaně", async () => {
            const { count, error } = await supabaseAdmin.from("ig_campaigns").select("id", { count: "exact", head: true })
                .eq("status", "pending").lt("created_at", staleHour)
            if (error) throw new Error(error.message)
            return count && count > 0
                ? { icon: "🛑", title: `${count}× kampaň čeká přes hodinu`, detail: "campaign-worker možná neběží (cron/Vercel)." }
                : null
        }),

        // Agent queue failures (terminal — retries exhausted).
        safe("selhané agent tasky", async () => {
            const { count, error } = await supabaseAdmin.from("agent_tasks").select("id", { count: "exact", head: true })
                .eq("status", "failed").gte("created_at", since24h)
            if (error) throw new Error(error.message)
            return count && count > 0
                ? { icon: "🤖", title: `${count}× selhaný agent task (24 h)`, detail: "Detail v agent_tasks.error." }
                : null
        }),

        // Dunning in progress — a customer's renewal is failing.
        safe("billing selhání", async () => {
            const { data, error } = await supabaseAdmin.from("subscriptions")
                .select("client_id, billing_failures")
                .eq("status", "active").gt("billing_failures", 0)
            if (error) throw new Error(error.message)
            return data && data.length > 0
                ? { icon: "💳", title: `${data.length}× předplatné v dunningu`, detail: `billing_failures: ${data.map(s => s.billing_failures).join(", ")} — billing-worker upomíná.` }
                : null
        }),

        // Approvals sitting unanswered — includes ops actions (client_id NULL),
        // which the client-scoped tab historically never showed.
        safe("čekající schválení", async () => {
            const { data, error } = await supabaseAdmin.from("agent_actions")
                .select("id, created_at")
                .eq("status", "proposed")
                .lt("created_at", since24h)
                .order("created_at", { ascending: true })
            if (error) throw new Error(error.message)
            if (!data || data.length === 0) return null
            const oldestDays = Math.floor((Date.now() - new Date(data[0].created_at).getTime()) / DAY_MS)
            return { icon: "⏳", title: `${data.length}× akce čeká na schválení déle než den`, detail: `Nejstarší ${oldestDays} d — dashboard → Schválení.` }
        }),

        // ── Připravenost na tržbu ────────────────────────────────────────────
        //
        // Tyhle dvě selhání nejsou vidět NIKDE: aplikace běží, stránky se načtou,
        // pokladna se otevře — a peníze nepřijdou, protože klíč je testovací.
        // Audit takovou věc najde jednou; tahle kontrola ji hlídá každý den.
        //
        // Běží jen v produkci. Lokálně a v preview jsou testovací klíče SPRÁVNĚ
        // a denní poplach by naučil všechny tuhle kontrolu ignorovat.
        safe("ostrý režim plateb", async () => {
            if (process.env.VERCEL_ENV !== "production") return null

            // ČISTÉ funkce nad předaným prostředím — schválně ne `payments/checkout`,
            // který je `server-only` a v samostatném skriptu se ani nenačte. Rozhodnutí
            // o bráně žije v gateway.ts právě proto, aby šlo číst i mimo request.
            const { chooseGateway, isSandboxKey, stripeCanComplete } = await import("@/lib/payments/gateway")
            const env = {
                PAYMENT_GATEWAY: process.env.PAYMENT_GATEWAY,
                STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
                STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
                COMGATE_MERCHANT_ID: process.env.COMGATE_MERCHANT_ID,
                COMGATE_SECRET: process.env.COMGATE_SECRET,
            }

            // Brána, která umí platbu ZAČÍT, ale ne DOKONČIT, vyrobí zaplaceného
            // a neaktivovaného zákazníka — horší stav než platba, která nezačne.
            if (env.STRIPE_SECRET_KEY && !stripeCanComplete(env)) {
                return {
                    icon: "🛑",
                    title: "Stripe neumí dokončit platbu",
                    detail: "Chybí STRIPE_WEBHOOK_SECRET — zákazník zaplatí a tarif se mu neaktivuje.",
                }
            }
            if (chooseGateway(env) === "stripe" && isSandboxKey(env.STRIPE_SECRET_KEY)) {
                return {
                    icon: "🛑",
                    title: "Platby běží na TESTOVACÍCH klíčích",
                    detail: "STRIPE_SECRET_KEY začíná sk_test — žádná platba v produkci není skutečná. Nasaď ostrý klíč a ostrý STRIPE_WEBHOOK_SECRET.",
                }
            }
            return null
        }),

        // Formát, který se prodává a je vypnutý, vyrobí stížnost dřív než obrat.
        // Landing i tarify text o reels schovávají, když je přepínač dole — ale to
        // znamená, že se tiše prodává MÉNĚ, než čím se tarify liší.
        safe("prodávané formáty", async () => {
            if (process.env.VERCEL_ENV !== "production") return null
            if (process.env.REELS_ENABLED === "1") return null

            // `allowed_media` žije uvnitř `features` JSONB, ne jako sloupec — filtrovat
            // se to dá až v paměti. Tarifů jsou jednotky, takže je to levné.
            const { data, error } = await supabaseAdmin.from("subscription_plans")
                .select("id, features")
                .eq("is_active", true)
            if (error) throw new Error(error.message)
            const count = (data || []).filter(p => {
                const media = (p.features as { allowed_media?: string[] } | null)?.allowed_media
                return Array.isArray(media) && media.includes("reel")
            }).length
            return count > 0
                ? {
                    icon: "⚠️",
                    title: `REELS_ENABLED není zapnuté, ale reels obsahuje ${count} ${count === 1 ? "tarif" : count < 5 ? "tarify" : "tarifů"}`,
                    detail: "Engine překlápí reel na carousel. Zapni REELS_ENABLED=1, nebo reels z tarifů odeber — teď se liší cenami za formát, který nevzniká.",
                }
                : null
        }),

        // Volné sloty na mostu. Strop profilů je tvrdá hranice růstu, kterou nejde
        // vidět v našich datech: dojde-li, další zákazník si Instagram nepřipojí a
        // dozvíme se to od NĚJ. Tarif upload-postu strop nehlásí, takže ho bere z
        // env — bez něj se kontrola neozve vůbec, radši ticho než falešný poplach.
        safe("sloty na mostu", async () => {
            const { isUploadPostConfigured } = await import("@/lib/channels/uploadpost-client")
            const limit = Number(process.env.UPLOADPOST_PROFILE_LIMIT || 0)
            if (!isUploadPostConfigured() || !Number.isFinite(limit) || limit <= 0) return null

            const { getProfileOccupancy } = await import("@/lib/channels/uploadpost-profiles")
            const { used } = await getProfileOccupancy()
            const free = limit - used
            if (free > 1) return null
            return free <= 0
                ? {
                    icon: "🛑",
                    title: `Most nemá volný profil (${used}/${limit})`,
                    detail: "Další zákazník si Instagram NEPŘIPOJÍ. Navyš tarif u upload-postu, nebo uvolni profil po odešlém zákazníkovi.",
                }
                : {
                    icon: "⚠️",
                    title: `Na mostu zbývá poslední profil (${used}/${limit})`,
                    detail: "Navyš tarif dřív, než na strop narazí zákazník při připojování.",
                }
        }),
    ]

    const problems = (await Promise.all(checks)).filter((p): p is HealthProblem => p !== null)
    return { healthy: problems.length === 0, problems, checkedAt: new Date().toISOString() }
}

export function renderHealthAlert(report: HealthReport): { subject: string; html: string; text: string } {
    const subject = `🚨 Chrlit health — ${report.problems.length} ${report.problems.length === 1 ? "problém" : report.problems.length < 5 ? "problémy" : "problémů"}`
    const rows = report.problems.map(p => `
      <div style="border:1px solid #1a1a1a;border-radius:4px;padding:14px;margin:0 0 10px;background:#0a0a0a">
        <p style="margin:0 0 4px;font-size:15px;font-weight:700">${p.icon} ${p.title}</p>
        <p style="margin:0;font-size:13px;color:#999">${p.detail}</p>
      </div>`).join("")
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#050505;color:#fff;padding:32px;max-width:560px;margin:0 auto">
        <h1 style="font-size:20px;text-transform:uppercase;letter-spacing:-0.5px;margin:0 0 4px">Chrlit — health check</h1>
        <p style="color:#888;font-size:12px;margin:0 0 24px">${new Date(report.checkedAt).toLocaleString("cs-CZ")}</p>
        ${rows}
        <p style="color:#555;font-size:11px;margin-top:24px">Denní kontrola od ops-agenta · chodí jen když něco nesedí</p>
      </div>`
    const text = `Chrlit health check\n\n` + report.problems.map(p => `${p.icon} ${p.title}\n   ${p.detail}`).join("\n")
    return { subject, html, text }
}
