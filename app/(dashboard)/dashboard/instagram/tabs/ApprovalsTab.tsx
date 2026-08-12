"use client"

import { useEffect, useState, useCallback } from "react"
import { getPendingApprovals, approveAgentAction, rejectAgentAction, type PendingApprovalDTO } from "@/app/actions/approval-actions"
import { X } from "lucide-react"

const RISK_LABELS: Record<string, { label: string; cls: string }> = {
    outbound: { label: "Odchozí (zákazník)", cls: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
    spending: { label: "Utrácí peníze", cls: "text-red-400 border-red-500/30 bg-red-500/10" },
    irreversible: { label: "Nevratné", cls: "text-red-400 border-red-500/30 bg-red-500/10" },
    internal: { label: "Interní", cls: "text-white/50 border-white/15 bg-white/5" },
    reversible: { label: "Vratné", cls: "text-white/50 border-white/15 bg-white/5" },
}

export function ApprovalsTab() {
    const [items, setItems] = useState<PendingApprovalDTO[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState<string | null>(null)

    const load = useCallback(async () => {
        // No synchronous setState here — initial `loading` is already true; reloads
        // update after the await (avoids cascading-render lint + a refresh flicker).
        try { setItems(await getPendingApprovals()) } catch { setItems([]) }
        setLoading(false)
    }, [])

    useEffect(() => { load() }, [load])

    const decide = async (id: string, approve: boolean) => {
        setBusy(id)
        const res = approve ? await approveAgentAction(id) : await rejectAgentAction(id)
        if (!res.ok) alert(res.error || "Nepodařilo se")
        await load()
        setBusy(null)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
            </div>
        )
    }

    if (items.length === 0) {
        return (
            <div className="text-center py-20">
                <p className="text-4xl mb-3 opacity-30">✅</p>
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Nic nečeká na schválení</p>
                <p className="text-[10px] text-white/25 mt-1">Akce agentů, které utrácí peníze nebo míří na zákazníky, se objeví tady</p>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <p className="text-[10px] text-white/40 leading-relaxed mb-4">
                Tyto akce navrhl agent, ale jsou rizikové (odchozí / utrácí / nevratné), takže nic neproběhne bez vašeho souhlasu.
            </p>
            {items.map(item => {
                const risk = RISK_LABELS[item.riskTier] || { label: item.riskTier, cls: "text-white/50 border-white/15 bg-white/5" }
                return (
                    <div key={item.id} className="bg-[#0a0a0a] border border-white/10 rounded-sm p-5">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-[8px] px-2 py-0.5 rounded-sm border font-bold uppercase tracking-widest text-white/50 border-white/10 bg-white/5">{item.agentType}</span>
                            <span className={`text-[8px] px-2 py-0.5 rounded-sm border font-bold uppercase tracking-widest ${risk.cls}`}>{risk.label}</span>
                            <span className={`text-[8px] px-2 py-0.5 rounded-sm border font-bold uppercase tracking-widest ${item.clientLabel ? "text-sky-400/70 border-sky-500/20 bg-sky-500/10" : "text-purple-400/70 border-purple-500/20 bg-purple-500/10"}`}>
                                {item.clientLabel || "OPS · celý systém"}
                            </span>
                            <span className="text-[9px] text-white/25 ml-auto">{new Date(item.createdAt).toLocaleString("cs-CZ")}</span>
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
                                {busy === item.id ? "…" : "Schválit"}
                            </button>
                            <button
                                onClick={() => decide(item.id, false)}
                                disabled={busy === item.id}
                                className="px-5 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20 transition-all disabled:opacity-50"
                            >
                                <span className="inline-flex items-center gap-1.5"><X className="w-3.5 h-3.5 shrink-0" />Zamítnout</span>
                            </button>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
