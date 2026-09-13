"use client"

import { useEffect, useState, useCallback } from "react"
import {
    getPendingApprovals, approveAgentAction, approveAgentActionAlways, rejectAgentAction,
    getAgentPolicies, revokeAgentPolicy,
    type PendingApprovalDTO, type AgentPolicyDTO,
} from "@/app/actions/approval-actions"
import { ExternalLink, X } from "lucide-react"
import { useStudio, useStudioNavigate } from "@/app/(dashboard)/StudioContext"
import { useFormatter, useTranslations } from "next-intl"

// Popisky stupňů rizika jsou v messages (`adminOps.approvals.risk.<stupeň>`); tady jen barvy.
const RISK_STYLE: Record<string, string> = {
    outbound: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    spending: "text-red-400 border-red-500/30 bg-red-500/10",
    irreversible: "text-red-400 border-red-500/30 bg-red-500/10",
    internal: "text-white/50 border-white/15 bg-white/5",
    reversible: "text-white/50 border-white/15 bg-white/5",
}

export function ApprovalsTab() {
    const [items, setItems] = useState<PendingApprovalDTO[]>([])
    const [policies, setPolicies] = useState<AgentPolicyDTO[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState<string | null>(null)
    // Chyba schválení patří k tlačítku, které selhalo. `alert()` ji vytrhl
    // z kontextu a po odkliknutí po ní nezbylo nic.
    const [error, setError] = useState<string | null>(null)
    const { setProjectId } = useStudio()
    const navigate = useStudioNavigate()
    const t = useTranslations("adminOps.approvals")
    const format = useFormatter()

    const load = useCallback(async () => {
        // No synchronous setState here — initial `loading` is already true; reloads
        // update after the await (avoids cascading-render lint + a refresh flicker).
        try { setItems(await getPendingApprovals()) } catch { setItems([]) }
        try { setPolicies(await getAgentPolicies()) } catch { setPolicies([]) }
        setLoading(false)
    }, [])

    useEffect(() => { load() }, [load])

    const decide = async (id: string, approve: boolean) => {
        setBusy(id)
        setError(null)
        const res = approve ? await approveAgentAction(id) : await rejectAgentAction(id)
        if (!res.ok) setError(res.error || t("errors.decide"))
        await load()
        setBusy(null)
    }

    // Zapnutí rozesílky natrvalo je jediné rozhodnutí v téhle záložce, jehož
    // dopad přesahuje jeden řádek — proto se na něj ptáme, i když se na
    // jednorázové schválení neptáme.
    const decideAlways = async (item: PendingApprovalDTO) => {
        if (!confirm(t("confirmAlways", { label: item.policyLabel ?? "" }))) return
        setBusy(item.id)
        const res = await approveAgentActionAlways(item.id)
        if (!res.ok) alert(res.error || t("errors.generic"))
        await load()
        setBusy(null)
    }

    const revoke = async (key: string, label: string) => {
        if (!confirm(t("policies.confirmRevoke", { label }))) return
        setBusy(key)
        const res = await revokeAgentPolicy(key)
        if (!res.ok) alert(res.error || t("errors.generic"))
        await load()
        setBusy(null)
    }

    /**
     * Přehled toho, co systém dělá sám. Vykresluje se i nad prázdnou frontou —
     * naopak především tam: prázdná fronta může znamenat „nic není potřeba"
     * i „všechno běží samo", a to jsou dost jiné zprávy.
     */
    const policiesBlock = policies.length === 0 ? null : (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-sm p-5 mb-6">
            <p className="text-[9px] text-white/40 uppercase font-bold tracking-widest mb-1">{t("policies.title")}</p>
            <p className="text-[10px] text-white/25 mb-3">{t("policies.body")}</p>
            <div className="space-y-2">
                {policies.map(p => (
                    <div key={p.key} className="flex items-center gap-3 flex-wrap border-t border-white/5 pt-2">
                        <span className="text-xs text-white/70 font-bold">{p.label}</span>
                        <span className="text-[9px] text-white/30">{t("policies.today", { used: p.usedToday, cap: p.dailyCap })}</span>
                        <span className="text-[9px] text-white/20">{p.decidedBy} · {format.dateTime(new Date(p.decidedAt), { day: "numeric", month: "numeric", year: "numeric" })}</span>
                        <button
                            onClick={() => revoke(p.key, p.label)}
                            disabled={busy === p.key}
                            className="ml-auto px-3 py-1 text-[9px] font-bold uppercase tracking-widest rounded-sm text-white/40 hover:text-red-400 border border-white/10 hover:border-red-500/20 transition-all disabled:opacity-50"
                        >
                            {busy === p.key ? "…" : t("policies.revoke")}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
            </div>
        )
    }

    if (items.length === 0) {
        return (
            <div>
                {policiesBlock}
                <div className="text-center py-20">
                <p className="text-4xl mb-3 opacity-30">✅</p>
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">{t("empty.title")}</p>
                <p className="text-[10px] text-white/25 mt-1">{t("empty.body")}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {policiesBlock}
            <p className="text-[10px] text-white/40 leading-relaxed mb-4">
                {t("intro")}
            </p>
            {error && <p className="text-[10px] text-red-400">❌ {error}</p>}
            {items.map(item => {
                const riskCls = RISK_STYLE[item.riskTier] || "text-white/50 border-white/15 bg-white/5"
                const riskLabel = t.has(`risk.${item.riskTier}`) ? t(`risk.${item.riskTier}`) : item.riskTier
                return (
                    <div key={item.id} className="bg-[#0a0a0a] border border-white/10 rounded-sm p-5">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-[8px] px-2 py-0.5 rounded-sm border font-bold uppercase tracking-widest text-white/50 border-white/10 bg-white/5">{item.agentType}</span>
                            <span className={`text-[8px] px-2 py-0.5 rounded-sm border font-bold uppercase tracking-widest ${riskCls}`}>{riskLabel}</span>
                            {/* Schválení se často rozhoduje podle toho, jak klient
                                vypadá — tak ať se tam dá jedním kliknutím. Slug je
                                v závorce za jménem (`Název (slug)`). */}
                            {item.clientLabel ? (
                                <button
                                    onClick={() => {
                                        const slug = item.clientLabel?.match(/\(([^)]+)\)$/)?.[1]
                                        if (!slug) return
                                        setProjectId(slug)
                                        navigate("dashboard")
                                    }}
                                    title={t("openStudio")}
                                    className="inline-flex items-center gap-1 text-[8px] px-2 py-0.5 rounded-sm border font-bold uppercase tracking-widest text-sky-400/70 border-sky-500/20 bg-sky-500/10 hover:text-sky-200 transition-colors"
                                >
                                    {item.clientLabel}<ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                </button>
                            ) : (
                                <span className="text-[8px] px-2 py-0.5 rounded-sm border font-bold uppercase tracking-widest text-purple-400/70 border-purple-500/20 bg-purple-500/10">
                                    {t("systemWide")}
                                </span>
                            )}
                            <span className="text-[9px] text-white/25 ml-auto">{format.dateTime(new Date(item.createdAt), { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })}</span>
                        </div>
                        <p className="text-white/80 text-sm font-bold mb-2">{item.action}</p>
                        {Object.keys(item.payload || {}).length > 0 && (
                            <pre className="text-[10px] text-white/40 bg-[#050505] border border-white/5 rounded-sm p-3 overflow-x-auto mb-3">{JSON.stringify(item.payload, null, 2)}</pre>
                        )}
                        <div className="flex gap-2">
                            <button
                                onClick={() => decide(item.id, true)}
                                disabled={busy === item.id}
                                className="px-5 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                            >
                                {busy === item.id ? "…" : t("approve")}
                            </button>
                            <button
                                onClick={() => decide(item.id, false)}
                                disabled={busy === item.id}
                                className="px-5 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20 transition-all disabled:opacity-50"
                            >
                                <span className="inline-flex items-center gap-1.5"><X className="w-3.5 h-3.5 shrink-0" />{t("reject")}</span>
                            </button>
                        </div>
                        {item.policyKey && (
                            <button
                                onClick={() => decideAlways(item)}
                                disabled={busy === item.id}
                                className="mt-2 text-[10px] text-white/30 hover:text-white/60 underline underline-offset-2 transition-all disabled:opacity-50"
                            >
                                {t("approveAlways", { label: item.policyLabel ?? "" })}
                            </button>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
