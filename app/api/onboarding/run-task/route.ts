import { actionTranslator } from "@/lib/i18n/actions"
import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import "@/lib/agents/handlers" // side-effect: registruje handlery
import { runTaskById } from "@/lib/agent-runner"
import { requireAuth } from "@/lib/auth-guard"
import { isSuperAdminEmail } from "@/lib/super-admins"

export const maxDuration = 800 // Vercel Pro (Fluid Compute) — celý rozpočet pro AI pipeline

/**
 * POST /api/onboarding/run-task  { taskId }
 *
 * Šťouchnutí z prohlížeče: zařazený task se rozjede hned, místo aby čekal až minutu
 * na cron. Prohlížeč to volá a odpověď nečte — na výsledek se ptá pollem.
 *
 * Autorizace jde přes session cookie (requireAuth), NE přes CRON_SECRET: tajemství
 * cronu nemá co dělat na uživatelské cestě, a hlavně by se muselo pustit k
 * `drainTasks`, který nemá strop.
 *
 * Když request cestou umře, nevadí. Práce běží na serveru, stav je v DB a cron je
 * záchranná síť — právě proto tahle přestavba vznikla.
 */
export async function POST(req: Request) {
    const t = await actionTranslator("api")
    try {
        const { taskId } = await req.json()
        if (!taskId) {
            return NextResponse.json({ success: false, error: t("task.missingTaskId") }, { status: 400 })
        }

        // Auth PŘED hledáním úlohy, ať 404 vs 401 neprozradí, které id existuje.
        let userId: string, email: string
        try {
            ({ userId, email } = await requireAuth())
        } catch {
            return NextResponse.json({ success: false, error: t("common.unauthorized") }, { status: 401 })
        }

        const { data: task } = await supabaseAdmin
            .from("agent_tasks")
            .select("requested_by, type")
            .eq("id", taskId)
            .maybeSingle()

        if (!task) {
            return NextResponse.json({ success: false, error: t("task.notFound") }, { status: 404 })
        }
        // Fail closed: systémový task (requested_by NULL) se z prohlížeče spustit nedá.
        if (task.requested_by !== userId && !isSuperAdminEmail(email)) {
            return NextResponse.json({ success: false, error: t("task.forbidden") }, { status: 403 })
        }

        // Podmíněný claim uvnitř: prázdný claim znamená, že task už běží pod cronem —
        // normální výsledek, ne chyba. Volající tak jako tak pollu je.
        const result = await runTaskById(taskId)
        return NextResponse.json({ success: true, ...result })
    } catch (err) {
        const msg = (err as Error)?.message?.slice(0, 500) || t("common.unknownError")
        console.error("onboarding/run-task error:", msg)
        return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
}
