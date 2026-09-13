import { actionTranslator } from "@/lib/i18n/actions"
import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { requireAuth } from "@/lib/auth-guard"
import { isSuperAdminEmail } from "@/lib/super-admins"
import { humanizeErrorWith } from "@/app/onboarding/types"

export const maxDuration = 5 // jen čtení jednoho řádku

const ONBOARDING_TYPES = ["onboarding_analyze", "onboarding_config_preview"]
const TERMINAL = ["done", "failed"]

/** Běžící úloha, o které není slyšet takhle dlouho, je mrtvá. Musí být VÍC než
 *  maxDuration běhu (800 s), aby se pomalá, ale živá práce neoznačila za mrtvou —
 *  lease se navíc tepe každou minutu, takže živý task je poznat spolehlivě. */
const STUCK_AFTER_MS = 15 * 60 * 1000

/**
 * GET /api/onboarding/task-status?id=<taskId>
 *
 * Stav dlouhé onboardingové práce. UI se ptá po dvou vteřinách, dokud task neskončí.
 * Zároveň hlídá zaseknuté úlohy: když je běžící task dlouho zticha, označí ho za
 * neúspěšný, aby uživatel nekoukal na točící se kolečko donekonečna.
 */
export async function GET(req: Request) {
    const t = await actionTranslator("api")
    const id = new URL(req.url).searchParams.get("id")
    if (!id) {
        return NextResponse.json({ error: t("common.missingId") }, { status: 400 })
    }

    // Auth PŘED hledáním úlohy: jinak by nepřihlášený rozeznal existující id od
    // neexistujícího podle toho, jestli dostane 404 nebo 401.
    let userId: string, email: string
    try {
        ({ userId, email } = await requireAuth())
    } catch {
        return NextResponse.json({ error: t("common.unauthorized") }, { status: 401 })
    }

    const { data: task } = await supabaseAdmin
        .from("agent_tasks")
        .select("id, type, status, progress, agent_message, result, error, requested_by, created_at, updated_at")
        .eq("id", id)
        .maybeSingle()

    if (!task) {
        return NextResponse.json({ error: t("task.notFound") }, { status: 404 })
    }
    // Fail closed: bez vlastníka (systémový task) se sem nikdo nedostane.
    if (task.requested_by !== userId && !isSuperAdminEmail(email)) {
        return NextResponse.json({ error: t("task.forbidden") }, { status: 403 })
    }

    let { status, error } = task
    // Reaper jen na onboardingové typy — cizí agenty ať si řeší jejich vlastní cesta.
    if (!TERMINAL.includes(status) && ONBOARDING_TYPES.includes(task.type)) {
        const lastActivity = new Date(task.updated_at || task.created_at).getTime()
        if (Date.now() - lastActivity > STUCK_AFTER_MS) {
            error = t("task.expired")
            status = "failed"
            await supabaseAdmin
                .from("agent_tasks")
                .update({ status: "failed", error, agent_message: t("task.expiredShort") })
                .eq("id", id)
                .not("status", "in", `(${TERMINAL.join(",")})`) // nepřepiš souběžné doběhnutí
        }
    }

    return NextResponse.json({
        taskId: task.id,
        status,
        progress: task.progress ?? 0,
        agentMessage: task.agent_message || null,
        result: status === "done" ? task.result : null,
        // Chyba z workera je technická (a v angličtině) — uživatel má vidět větu,
        // které rozumí. Stejný překlad jako u synchronní cesty.
        error: error ? humanizeErrorWith(new Error(error), await actionTranslator("onboarding")) : null,
        elapsed: Math.round((Date.now() - new Date(task.created_at).getTime()) / 1000),
    })
}
