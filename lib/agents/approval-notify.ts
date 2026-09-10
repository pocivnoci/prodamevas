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
import { policyLabel } from "@/lib/agent-policy"
import { escapeHtml, siteUrl } from "@/lib/notifications"
import { footnote, heading, raw } from "@/lib/mail/blocks"
import { renderEmail } from "@/lib/mail/layout"
import { COLOR } from "@/lib/mail/tokens"

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
    /** Druh akce pro stálý souhlas — bez něj se třetí tlačítko nenabídne. */
    policyKey?: string | null
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

/**
 * Buttons + detail block for one pending action — also reused by digest e-mails.
 *
 * Tlačítka jsou tři, ne dvě. „Schválit a příště se neptat" je tu proto, že za
 * čtyři měsíce provozu bylo navrženo 27 akcí a schváleno nula: rozhodovat
 * jednotlivé e-maily každé ráno je smyčka, která se nikdy nezavře. Třetí
 * tlačítko z ní dělá jednorázové nastavení — uloží stálý souhlas s DRUHEM akce
 * (`lib/agent-policy.ts`) a systém se pak ptá jen na to, co souhlas nemá.
 *
 * Nabízí se jen u akce, která druh má (`policyKey`). U ostatních by to byl slib,
 * který se nedá splnit.
 */
export function renderApprovalItem(input: ApprovalNotifyInput, label: string): string {
    const approve = approvalLinkUrl(siteUrl(), input.actionId, "approve")
    const reject = approvalLinkUrl(siteUrl(), input.actionId, "reject")
    const always = input.policyKey ? approvalLinkUrl(siteUrl(), input.actionId, "approve_always") : null
    const payloadPreview = input.payload && Object.keys(input.payload).length > 0
        ? `<pre style="background:#f7f7f7;border:1px solid ${COLOR.hairline};border-radius:2px;padding:10px;font-size:11px;color:${COLOR.muted};white-space:pre-wrap;word-break:break-word;margin:10px 0 0">${esc(JSON.stringify(input.payload, null, 2).slice(0, 800))}</pre>`
        : ""
    return `
      <div style="border:1px solid ${COLOR.hairline};border-radius:2px;padding:16px;margin:0 0 12px">
        <p style="margin:0 0 4px;font-size:11px;color:#7a5510;text-transform:uppercase;letter-spacing:1px">${RISK_LABELS[input.riskTier] || input.riskTier} · ${esc(input.agentType)}</p>
        <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:${COLOR.ink}">${esc(input.action)}</p>
        <p style="margin:0;font-size:12px;color:${COLOR.muted}">Klient: ${esc(label)}</p>
        ${payloadPreview}
        <p style="margin:14px 0 0">
          <a href="${approve}" style="display:inline-block;background:#1c6b45;color:#fff;text-decoration:none;font-weight:bold;font-size:13px;padding:10px 18px;border-radius:2px;margin-right:8px">✓ Schválit</a>
          <a href="${reject}" style="display:inline-block;background:#fff;border:1px solid ${COLOR.ink};color:${COLOR.ink};text-decoration:none;font-weight:bold;font-size:13px;padding:10px 18px;border-radius:2px">✕ Zamítnout</a>
        </p>
        ${always ? `<p style="margin:10px 0 0">
          <a href="${always}" style="font-size:12px;color:${COLOR.muted};text-decoration:underline">✓✓ Schválit a příště se neptat (${esc(policyLabel(input.policyKey!))})</a>
        </p>` : ""}
      </div>`
}

/**
 * Ops zprávy jedou tou samou slupkou jako zákaznické, jen ve `variant: "ops"` —
 * bez identifikace podnikatele a bez odhlašovacího odkazu (zakladatel se ze
 * svého monitoringu neodhlašuje). Dřív tu byla vlastní tmavá slupka; tři kopie
 * znamenaly tři různé e-maily od jednoho odesílatele.
 */
export function wrapOpsEmail(title: string, subtitle: string, innerHtml: string): string {
    return renderEmail({
        subject: title,
        eyebrow: subtitle,
        kind: "transactional",
        variant: "ops",
        blocks: [
            heading(title),
            raw(innerHtml),
            footnote("Odkazy platí 7 dní · vše najdeš i v dashboardu → Schválení"),
        ],
    }).html
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
