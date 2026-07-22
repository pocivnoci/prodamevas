import crypto from "crypto"
import { emailSigningSecret } from "@/lib/email-sign"

/**
 * Signed one-click approve/reject links for pending agent actions.
 * ================================================================
 * The founder gets an e-mail when a high-risk agent action lands as 'proposed';
 * the links let them decide from the phone without opening the dashboard.
 *
 * Higher stakes than the unsubscribe link (an approval dispatches real work), so:
 *  - the token binds actionId + decision + expiry (7 days) under an HMAC
 *  - GET only renders a confirmation page; the state change happens on POST
 *    (mail scanners like Outlook SafeLinks prefetch GET links — a prefetch must
 *    never approve anything)
 *  - execution is single-use anyway: approveAction/rejectAction only act on
 *    status='proposed'.
 */

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Same signing secret as the unsubscribe link (lib/email-sign.ts) — one source so
// an env-precedence change can't desync approval links from the rest of our tokens.
const secret = emailSigningSecret

export type ApprovalDecision = "approve" | "reject"

function hmac(actionId: string, decision: ApprovalDecision, exp: number): string {
    return crypto.createHmac("sha256", secret()).update(`${actionId}.${decision}.${exp}`).digest("hex").slice(0, 32)
}

/** Query params for the one-click link (a=actionId, d=decision, x=expiry, s=sig). */
export function signApprovalLink(actionId: string, decision: ApprovalDecision): { a: string; d: string; x: string; s: string } {
    const exp = Date.now() + TOKEN_TTL_MS
    return { a: actionId, d: decision, x: String(exp), s: hmac(actionId, decision, exp) }
}

export function approvalLinkUrl(siteUrl: string, actionId: string, decision: ApprovalDecision): string {
    const p = signApprovalLink(actionId, decision)
    return `${siteUrl}/api/agent-approval?a=${encodeURIComponent(p.a)}&d=${p.d}&x=${p.x}&s=${p.s}`
}

/** Verify params; returns the decision or null when invalid/expired. */
export function verifyApprovalLink(params: { a?: string | null; d?: string | null; x?: string | null; s?: string | null }): { actionId: string; decision: ApprovalDecision } | null {
    const { a, d, x, s } = params
    if (!a || !d || !x || !s) return null
    if (d !== "approve" && d !== "reject") return null
    const exp = Number(x)
    if (!Number.isFinite(exp) || exp < Date.now()) return null
    const expected = hmac(a, d, exp)
    if (s.length !== expected.length) return null
    if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null
    return { actionId: a, decision: d }
}
