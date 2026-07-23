/**
 * Approval-link tokens + lifecycle templates — pure checks (no DB, no network).
 *   npx tsx scripts/test-agent-approval-link.ts
 *
 * The one-click links can approve real outbound/spending actions, so the token
 * properties (roundtrip, tamper-resistance, expiry, decision binding) get
 * asserted here the same way feed-pattern math does.
 */

import { approvalLinkUrl, signApprovalLink, verifyApprovalLink } from "../lib/agent-approval-link"
import { buildLifecycleEmail, type LifecycleKind } from "../lib/agents/lifecycle"

let failures = 0
function check(name: string, ok: boolean, detail = "") {
    console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`)
    if (!ok) failures++
}

const actionId = "11111111-2222-3333-4444-555555555555"

// ── Token roundtrip ─────────────────────────────────────────────────────────
{
    const p = signApprovalLink(actionId, "approve")
    const v = verifyApprovalLink(p)
    check("roundtrip approve", v?.actionId === actionId && v?.decision === "approve")
}
{
    const p = signApprovalLink(actionId, "reject")
    const v = verifyApprovalLink(p)
    check("roundtrip reject", v?.decision === "reject")
}

// ── Tampering ───────────────────────────────────────────────────────────────
{
    const p = signApprovalLink(actionId, "reject")
    check("flipped decision fails", verifyApprovalLink({ ...p, d: "approve" }) === null)
}
{
    const p = signApprovalLink(actionId, "approve")
    check("swapped actionId fails", verifyApprovalLink({ ...p, a: "99999999-2222-3333-4444-555555555555" }) === null)
}
{
    const p = signApprovalLink(actionId, "approve")
    check("extended expiry fails", verifyApprovalLink({ ...p, x: String(Number(p.x) + 60_000) }) === null)
    check("corrupted sig fails", verifyApprovalLink({ ...p, s: p.s.replace(/^./, p.s[0] === "a" ? "b" : "a") }) === null)
    check("missing param fails", verifyApprovalLink({ ...p, s: null }) === null)
}

// ── True expiry (valid signature, past timestamp) ───────────────────────────
{
    const realNow = Date.now
    Date.now = () => realNow() - 8 * 24 * 60 * 60 * 1000 // sign 8 days in the past
    const p = signApprovalLink(actionId, "approve")
    Date.now = realNow
    check("expired token fails", verifyApprovalLink(p) === null)
}

// ── URL shape ───────────────────────────────────────────────────────────────
{
    const url = approvalLinkUrl("https://chrlit.cz", actionId, "approve")
    check("url shape", url.startsWith("https://chrlit.cz/api/agent-approval?a=") && url.includes("&d=approve&") && url.includes("&s="), url)
}

// ── Lifecycle templates ─────────────────────────────────────────────────────
for (const kind of ["activation_nudge", "credit_low", "winback", "waitlist_drip"] as LifecycleKind[]) {
    const { subject, body } = buildLifecycleEmail(kind, {
        clientName: "Testovací klient", clientId: actionId, creditsRemaining: 2, creditsTotal: 45,
    })
    check(`template ${kind}`, subject.length > 0 && body.length > 40, subject)
}
{
    const { body } = buildLifecycleEmail("credit_low", { creditsRemaining: 2, creditsTotal: 45 })
    check("credit_low carries numbers", body.includes("2") && body.includes("45"))
}

console.log(failures === 0 ? "\n🎉 Vše prošlo." : `\n💥 ${failures} selhání.`)
process.exit(failures === 0 ? 0 : 1)
