/**
 * Founder notification for a pending agent action — the fast half of the
 * approval loop. One e-mail per proposed high-risk action with one-click
 * approve/reject links (signed, POST-confirmed; see lib/agent-approval-link.ts).
 * Best-effort: a failed e-mail must never break the flow that proposed the
 * action — the ApprovalsTab still shows everything.
 */

import supabaseAdmin from "@/supabase/admin"
import { getFounderEmail, sendEmail } from "@/lib/email"
import { approvalLinkUrl } from "@/lib/agent-approval-link"
import { escapeHtml, siteUrl } from "@/lib/notifications"

const RISK_LABELS: Record<string, string> = {
    outbound: "Odchozí (zákazník)",
    spending: "Utrácí peníze",
    irreversible: "Nevratné",
}

export interface ApprovalNotifyInput {
    actionId: string
    clientId?: string | null
    agentType: string
    action: string
    riskTier: string
    payload?: Record<string, unknown>
}

async function clientLabel(clientId: string | null | undefined): Promise<string> {
    if (!clientId) return "OPS (celý systém)"
    try {
        const { data } = await supabaseAdmin.from("clients").select("name, slug").eq("id", clientId).single()
        return data ? `${data.name} (${data.slug})` : clientId
    } catch {
        return clientId
    }
}

const esc = escapeHtml

/** Buttons + detail block for one pending action — also reused by digest e-mails. */
export function renderApprovalItem(input: ApprovalNotifyInput, label: string): string {
    const approve = approvalLinkUrl(siteUrl(), input.actionId, "approve")
    const reject = approvalLinkUrl(siteUrl(), input.actionId, "reject")
    const payloadPreview = input.payload && Object.keys(input.payload).length > 0
        ? `<pre style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:4px;padding:10px;font-size:11px;color:#999;white-space:pre-wrap;word-break:break-word;margin:10px 0 0">${esc(JSON.stringify(input.payload, null, 2).slice(0, 800))}</pre>`
        : ""
    return `
      <div style="border:1px solid #1a1a1a;border-radius:4px;padding:16px;margin:0 0 12px;background:#0a0a0a">
        <p style="margin:0 0 4px;font-size:11px;color:#f59e0b;text-transform:uppercase;letter-spacing:1px">${RISK_LABELS[input.riskTier] || input.riskTier} · ${esc(input.agentType)}</p>
        <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#fff">${esc(input.action)}</p>
        <p style="margin:0;font-size:12px;color:#888">Klient: ${esc(label)}</p>
        ${payloadPreview}
        <p style="margin:14px 0 0">
          <a href="${approve}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-weight:bold;font-size:13px;padding:10px 18px;border-radius:4px;margin-right:8px">✓ Schválit</a>
          <a href="${reject}" style="display:inline-block;background:#1a1a1a;border:1px solid #333;color:#ccc;text-decoration:none;font-weight:bold;font-size:13px;padding:10px 18px;border-radius:4px">✕ Zamítnout</a>
        </p>
      </div>`
}

export function wrapOpsEmail(title: string, subtitle: string, innerHtml: string): string {
    return `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#050505;color:#fff;padding:32px;max-width:560px;margin:0 auto">
        <h1 style="font-size:20px;text-transform:uppercase;letter-spacing:-0.5px;margin:0 0 4px">${title}</h1>
        <p style="color:#888;font-size:12px;margin:0 0 24px">${subtitle}</p>
        ${innerHtml}
        <p style="color:#555;font-size:11px;margin-top:24px">Odkazy platí 7 dní · vše najdeš i v dashboardu → Schválení</p>
      </div>`
}

export async function notifyPendingApproval(input: ApprovalNotifyInput): Promise<void> {
    const to = getFounderEmail()
    if (!to) return
    const label = await clientLabel(input.clientId)
    const html = wrapOpsEmail("Agent čeká na schválení", new Date().toLocaleString("cs-CZ"), renderApprovalItem(input, label))
    await sendEmail({
        to,
        subject: `🤖 Ke schválení: ${input.action}`,
        html,
        text: `Agent ${input.agentType} navrhuje: ${input.action} (${input.riskTier}) — klient: ${label}. Schval v dashboardu → Schválení.`,
    })
}
