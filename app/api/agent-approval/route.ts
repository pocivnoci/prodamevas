/**
 * One-click approve/reject for pending agent actions (from the founder e-mail).
 *
 *   GET  /api/agent-approval?a=<actionId>&d=<approve|reject>&x=<exp>&s=<hmac>
 *        → renders a confirmation page (NO state change — mail scanners prefetch
 *          GET links, a prefetch must never decide anything)
 *   POST (form from that page, same signed params)
 *        → verifies the HMAC again and executes approveAction/rejectAction
 *
 * No requireAuth() — like /api/email/unsubscribe, the signed token IS the
 * capability (the link only ever goes to the founder e-mail, expires in 7 days,
 * and approve/reject are single-use: they act only on status='proposed').
 */

import { NextRequest } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { verifyApprovalLink, type ApprovalDecision } from "@/lib/agent-approval-link"
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
        .select("id, status, agent_type, action, risk_tier, client_id")
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

    const verb = token.decision === "approve" ? "Schválit" : "Zamítnout"
    const color = token.decision === "approve" ? "#16a34a" : "#b91c1c"
    const form = `
      <form method="POST" action="/api/agent-approval" style="margin-top:24px">
        <input type="hidden" name="a" value="${esc(p.get("a") || "")}" />
        <input type="hidden" name="d" value="${esc(p.get("d") || "")}" />
        <input type="hidden" name="x" value="${esc(p.get("x") || "")}" />
        <input type="hidden" name="s" value="${esc(p.get("s") || "")}" />
        <button type="submit" style="background:${color};color:#fff;border:0;font-weight:bold;font-size:15px;padding:14px 28px;border-radius:4px;cursor:pointer">${verb}</button>
      </form>`
    return page(
        `${verb} akci?`,
        `Agent <strong>${esc(action.agent_type)}</strong> navrhuje: <strong>${esc(action.action)}</strong> (${esc(action.risk_tier)}).`,
        form,
    )
}

export async function POST(req: NextRequest) {
    const form = await req.formData().catch(() => null)
    if (!form) return invalid()
    const get = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : null)
    const token = verifyApprovalLink({ a: get("a"), d: get("d"), x: get("x"), s: get("s") })
    if (!token) return invalid()

    const { approveAction, rejectAction } = await import("@/lib/agent-safety")
    const decide = (d: ApprovalDecision) =>
        d === "approve" ? approveAction(token.actionId, "email-link") : rejectAction(token.actionId, "email-link")
    const res = await decide(token.decision)
    if (!res.ok) {
        return page("Nepodařilo se", esc(res.error || "Akci nelze rozhodnout — nejspíš už byla rozhodnuta jinde."))
    }
    return token.decision === "approve"
        ? page("Schváleno ✓", "Akce se spustí do minuty (agent-worker). Detail najdeš v dashboardu.")
        : page("Zamítnuto ✓", "Akce se nespustí. Záznam zůstává v audit logu.")
}
