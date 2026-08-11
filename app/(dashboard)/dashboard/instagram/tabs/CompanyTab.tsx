"use client"

import { useEffect, useState, useCallback } from "react"
import { getCompanyOverview, type ClientHealthDTO, type CompanyOverview } from "@/app/actions/company-actions"

/**
 * Firma — cross-tenant přehled zdraví účtů.
 *
 * Read-only. Akce mají svoje místo v ranním briefu, kde po nich zůstane
 * schvalovací záznam; dvě cesty k témuž rozhodnutí by znamenaly, že jen
 * jedna z nich je v auditu.
 */

const RISK_STYLE: Record<string, string> = {
    dunning: "text-red-400 border-red-500/30 bg-red-500/10",
    credits_out: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    expiring: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    dormant: "text-orange-400 border-orange-500/30 bg-orange-500/10",
    ig_disconnected: "text-orange-400 border-orange-500/30 bg-orange-500/10",
    cancelled: "text-white/50 border-white/15 bg-white/5",
}

const RISK_LABEL: Record<string, string> = {
    dunning: "Selhává platba",
    credits_out: "Došly kredity",
    expiring: "Končí plán",
    dormant: "Spí",
    ig_disconnected: "Odpojený IG",
    cancelled: "Vypověděl",
}

function daysAgo(iso: string | null): string {
    if (!iso) return "nikdy"
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
    if (d <= 0) return "dnes"
    if (d === 1) return "včera"
    return `před ${d} dny`
}

export function CompanyTab() {
    const [data, setData] = useState<CompanyOverview | null>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        try { setData(await getCompanyOverview()) } catch { setData(null) }
        setLoading(false)
    }, [])

    useEffect(() => { load() }, [load])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
            </div>
        )
    }

    if (!data || data.clients.length === 0) {
        return (
            <div className="text-center py-20">
                <p className="text-4xl mb-3 opacity-30">🏢</p>
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Zatím žádní klienti</p>
            </div>
        )
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap gap-3">
                <Stat label="Klientů" value={String(data.clients.length)} />
                <Stat label="V riziku" value={String(data.atRisk)} tone={data.atRisk > 0 ? "warn" : "ok"} />
                <Stat label="Nedokončený onboarding" value={String(data.stalledOnboardings)} tone={data.stalledOnboardings > 0 ? "warn" : "ok"} />
            </div>

            <div className="overflow-x-auto border border-white/5 rounded-sm">
                <table className="w-full text-left min-w-[720px]">
                    <thead>
                        <tr className="border-b border-white/5">
                            {["Klient", "Plán", "Rizika", "Obsah 14 d", "Poslední obsah", "Kredity", "IG"].map(h => (
                                <th key={h} className="px-4 py-3 text-[9px] uppercase tracking-widest font-bold text-white/30">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.clients.map(c => <Row key={c.clientId} c={c} />)}
                    </tbody>
                </table>
            </div>

            <p className="text-[9px] text-white/20 font-bold uppercase tracking-widest">
                Sestaveno {new Date(data.generatedAt).toLocaleString("cs-CZ")} · stejná data pohánějí ranní brief
            </p>
        </div>
    )
}

function Row({ c }: { c: ClientHealthDTO }) {
    return (
        <tr className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
            <td className="px-4 py-3">
                <p className="text-xs font-bold text-white">{c.name}</p>
                <p className="text-[9px] text-white/25 font-bold">{c.slug}</p>
            </td>
            <td className="px-4 py-3">
                <p className="text-[10px] text-white/60 font-bold">{c.plan || "—"}</p>
                <p className="text-[9px] text-white/25 font-bold">{c.status || "bez předplatného"}</p>
            </td>
            <td className="px-4 py-3">
                {c.risks.length === 0 ? (
                    <span className="text-[10px] text-emerald-400/70 font-bold">v pořádku</span>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {c.risks.map(r => (
                            <span key={r} className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase ${RISK_STYLE[r] || "text-white/50 border-white/15 bg-white/5"}`}>
                                {RISK_LABEL[r] || r}
                            </span>
                        ))}
                    </div>
                )}
            </td>
            <td className="px-4 py-3">
                <span className={`text-xs font-bold ${c.postsLast14d === 0 ? "text-orange-400" : "text-white/70"}`}>{c.postsLast14d}</span>
            </td>
            <td className="px-4 py-3 text-[10px] text-white/40 font-bold">{daysAgo(c.lastContentAt)}</td>
            <td className="px-4 py-3 text-[10px] text-white/40 font-bold">
                {c.creditsTotal > 0 ? `${c.creditsRemaining}/${c.creditsTotal}` : "—"}
            </td>
            <td className="px-4 py-3 text-xs">{c.igConnected ? "✅" : "—"}</td>
        </tr>
    )
}

function Stat({ label, value, tone = "ok" }: { label: string; value: string; tone?: "ok" | "warn" }) {
    return (
        <div className={`px-4 py-3 rounded-sm border ${tone === "warn" ? "border-amber-500/20 bg-amber-500/5" : "border-white/5 bg-[#080808]"}`}>
            <p className="text-[9px] uppercase tracking-widest font-bold text-white/30">{label}</p>
            <p className={`text-lg font-black ${tone === "warn" ? "text-amber-400" : "text-white"}`}>{value}</p>
        </div>
    )
}
