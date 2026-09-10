/**
 * One-click approve/reject for pending agent actions (from the founder e-mail).
 *
 *   GET  /api/agent-approval?a=<actionId>&d=<approve|reject|approve_always>&x=<exp>&s=<hmac>
 *        → renders a confirmation page (NO state change — mail scanners prefetch
 *          GET links, a prefetch must never decide anything)
 *   POST (form from that page, same signed params)
 *        → verifies the HMAC again and executes approveAction/rejectAction
 *
 * No requireAuth() — like /api/email/unsubscribe, the signed token IS the
 * capability (the link only ever goes to the founder e-mail, expires in 7 days,
 * and approve/reject are single-use: they act only on status='proposed').
 *
 * `approve_always` schválí akci a NAVÍC uloží stálý souhlas s jejím druhem
 * (`lib/agent-policy.ts`), takže se systém příště nezeptá. Je to jediné
 * rozhodnutí v celém systému, jehož dopad přesahuje jeden řádek — proto má
 * vlastní potvrzovací stránku, která říká, co přesně se tím zapíná, a proto
 * se uděluje jen tehdy, když samotné schválení projde (viz POST níž).
 */

import { NextRequest } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { verifyApprovalLink } from "@/lib/agent-approval-link"
import { escapeHtml } from "@/lib/notifications"

function page(title: string, message: string, formHtml = ""): Response {
    return new Response(
        `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
        <body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#050505;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px">
          <div style="text-align:center;max-width:440px">
            <h1 style="font-size:22px;text-transform:uppercase;letter-spacing:-0.5px;margin:0 0 12px">${title}</h1>
            <p style="color:#888;font-size:14px;line-height:1.6;margin:0">${message}</p>
            ${formHtml}
          </div>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    )
}

const esc = escapeHtml

const invalid = () => page("Neplatný odkaz", "Odkaz je neplatný, poškozený nebo vypršel (platí 7 dní). Akci najdeš v dashboardu → Schválení.")

async function loadAction(actionId: string) {
    const { data } = await supabaseAdmin
        .from("agent_actions")
        .select("id, status, agent_type, action, risk_tier, client_id, policy_key")
        .eq("id", actionId)
        .maybeSingle()
    return data
}

export async function GET(req: NextRequest) {
    const p = req.nextUrl.searchParams
    const token = verifyApprovalLink({ a: p.get("a"), d: p.get("d"), x: p.get("x"), s: p.get("s") })
    if (!token) return invalid()

    const action = await loadAction(token.actionId)
    if (!action) return invalid()
    if (action.status !== "proposed") {
        return page("Už rozhodnuto", `Akce „${esc(action.action)}" je ve stavu <strong>${esc(action.status)}</strong> — není co schvalovat.`)
    }

    // Souhlas navždy se nesmí nabídnout u akce, která nemá druh — nebylo by co
    // uložit a člověk by klikl na slib, který se nesplní.
    if (token.decision === "approve_always" && !action.policy_key) {
        return page(
            "Tohle nejde zapnout natrvalo",
            `Akce „${esc(action.action)}" nemá druh, pro který by šel uložit stálý souhlas. Rozhodni ji jednorázově v dashboardu → Schválení.`,
        )
    }

    const VERBS: Record<string, string> = { approve: "Schválit", reject: "Zamítnout", approve_always: "Schválit a příště se neptat" }
    const verb = VERBS[token.decision]
    const color = token.decision === "reject" ? "#b91c1c" : "#16a34a"
    const form = `
      <form method="POST" action="/api/agent-approval" style="margin-top:24px">
        <input type="hidden" name="a" value="${esc(p.get("a") || "")}" />
        <input type="hidden" name="d" value="${esc(p.get("d") || "")}" />
        <input type="hidden" name="x" value="${esc(p.get("x") || "")}" />
        <input type="hidden" name="s" value="${esc(p.get("s") || "")}" />
        <button type="submit" style="background:${color};color:#fff;border:0;font-weight:bold;font-size:15px;padding:14px 28px;border-radius:4px;cursor:pointer">${verb}</button>
      </form>`
    const detail = `Agent <strong>${esc(action.agent_type)}</strong> navrhuje: <strong>${esc(action.action)}</strong> (${esc(action.risk_tier)}).`
    if (token.decision === "approve_always") {
        const { policyLabel, DEFAULT_DAILY_CAP } = await import("@/lib/agent-policy")
        return page(
            "Schválit a příště se neptat?",
            `${detail}<br><br>Tímhle zapneš, že akce druhu <strong>${esc(policyLabel(action.policy_key!))}</strong> budu posílat sám, nejvýš ${DEFAULT_DAILY_CAP} za den. Ostatní druhy se budu ptát dál. Vypnout to jde kdykoli v dashboardu → Schválení.`,
            form,
        )
    }
    return page(`${verb} akci?`, detail, form)
}

export async function POST(req: NextRequest) {
    const form = await req.formData().catch(() => null)
    if (!form) return invalid()
    const get = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : null)
    const token = verifyApprovalLink({ a: get("a"), d: get("d"), x: get("x"), s: get("s") })
    if (!token) return invalid()

    const { approveAction, rejectAction } = await import("@/lib/agent-safety")

    if (token.decision === "reject") {
        const res = await rejectAction(token.actionId, "email-link")
        if (!res.ok) return page("Nepodařilo se", esc(res.error || "Akci nelze rozhodnout — nejspíš už byla rozhodnuta jinde."))
        return page("Zamítnuto ✓", "Akce se nespustí. Záznam zůstává v audit logu.")
    }

    // Schválení běží první i u „navždy": stálý souhlas se uděluje jen tehdy,
    // když se tahle konkrétní akce opravdu podařila schválit. Opačné pořadí by
    // z prokliku na už rozhodnutou akci udělalo trvalé zapnutí rozesílky.
    const res = await approveAction(token.actionId, "email-link")
    if (!res.ok) return page("Nepodařilo se", esc(res.error || "Akci nelze rozhodnout — nejspíš už byla rozhodnuta jinde."))

    if (token.decision === "approve_always" && res.policyKey) {
        const { grantPolicy, policyLabel, DEFAULT_DAILY_CAP } = await import("@/lib/agent-policy")
        const granted = await grantPolicy(res.policyKey, "email-link", { note: "schváleno z ranního briefu" })
        return granted.ok
            ? page(
                "Zapnuto ✓",
                `Akce se spustí do minuty. Napříště budu <strong>${esc(policyLabel(res.policyKey))}</strong> posílat sám, nejvýš ${DEFAULT_DAILY_CAP} za den — v ranním briefu uvidíš, co odešlo. Vypnout jde v dashboardu → Schválení.`,
            )
            // Akce prošla, souhlas ne. Říct to rovnou: tichý polovičatý výsledek
            // by znamenal, že se člověk příště zbytečně diví, proč se ptám dál.
            : page("Schváleno ✓, ale souhlas se neuložil", `Akce běží. Trvalé zapnutí se nepovedlo (${esc(granted.error || "neznámá chyba")}) — zkus to v dashboardu → Schválení.`)
    }

    return page("Schváleno ✓", "Akce se spustí do minuty (agent-worker). Detail najdeš v dashboardu.")
}
