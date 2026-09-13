"use client"

import { useEffect, useState, useCallback } from "react"
import { ExternalLink, ListPlus } from "lucide-react"
import { getCompanyOverview, type ClientHealthDTO, type CompanyOverview } from "@/app/actions/company-actions"
import { createTask, listTeam } from "@/app/actions/task-actions"
import { useStudio, useStudioNavigate } from "@/app/(dashboard)/StudioContext"
import { useFormatter, useTranslations } from "next-intl"

/**
 * Firma — cross-tenant přehled zdraví účtů.
 *
 * **Pořád read-only, pokud jde o zákazníka.** Zásah do jeho účtu patří do
 * briefu, kde po něm zůstane schvalovací záznam; dvě cesty k témuž rozhodnutí
 * by znamenaly, že jen jedna z nich je v auditu.
 *
 * Co tu naopak chybělo: z řádku „Selhává platba" se nedalo nikam jít. Proklik
 * do studia a založení úkolu nejsou akce nad zákazníkem — jsou to poznámky
 * pro nás, a bez nich se riziko přepsalo na papír vedle klávesnice.
 */

// Popisky rizik jsou v messages (`adminOps.company.row.risk.<riziko>`); tady jen barvy.
const RISK_STYLE: Record<string, string> = {
    dunning: "text-red-400 border-red-500/30 bg-red-500/10",
    credits_out: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    expiring: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    dormant: "text-orange-400 border-orange-500/30 bg-orange-500/10",
    ig_disconnected: "text-orange-400 border-orange-500/30 bg-orange-500/10",
    cancelled: "text-white/50 border-white/15 bg-white/5",
}

type CompanyTranslator = ReturnType<typeof useTranslations<"adminOps.company">>

/** „nikdy / dnes / včera / před X dny" — mimo komponentu, ať `Date.now()` neběží v renderu. */
function daysAgo(iso: string | null, t: CompanyTranslator): string {
    if (!iso) return t("row.lastContent.never")
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
    if (d <= 0) return t("row.lastContent.today")
    if (d === 1) return t("row.lastContent.yesterday")
    return t("row.lastContent.daysAgo", { count: d })
}

/** Filtr přehledu. Read-only — deaktivaci i úklid dělají skripty s auditní stopou. */
type Filtr = "aktivni" | "deaktivovane" | "vse"

export function CompanyTab() {
    const [data, setData] = useState<CompanyOverview | null>(null)
    const [loading, setLoading] = useState(true)
    const [filtr, setFiltr] = useState<Filtr>("aktivni")
    const [error, setError] = useState<string | null>(null)
    /** Kdo dostane úkol „ozvat se" — obchod, ne zakladatel. */
    const [managerEmail, setManagerEmail] = useState<string | null>(null)
    const t = useTranslations("adminOps.company")
    const format = useFormatter()

    const load = useCallback(async () => {
        // Prázdný seznam a rozbitý dotaz vypadaly stejně („Zatím žádní klienti").
        // Pro tab, který má hlásit rizika, je to nejhorší možná záměna.
        try { setData(await getCompanyOverview()); setError(null) }
        catch (err) { setData(null); setError((err as Error)?.message || t("errors.load")) }
        setLoading(false)
    }, [t])

    useEffect(() => { load() }, [load])
    useEffect(() => {
        listTeam()
            .then(team => setManagerEmail(team.find(m => m.active && m.role === "manager")?.email ?? null))
            .catch(() => setManagerEmail(null))
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="border border-red-500/20 bg-red-500/5 rounded-sm p-6 text-center space-y-3">
                <p className="text-[10px] text-red-300 uppercase font-bold tracking-widest">{t("errors.title")}</p>
                <p className="text-xs text-white/40">{error}</p>
                <button
                    onClick={() => { setLoading(true); void load() }}
                    className="px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/15 text-white/60 hover:text-white hover:bg-white/5 transition-all"
                >{t("errors.retry")}</button>
            </div>
        )
    }

    if (!data || data.clients.length === 0) {
        return (
            <div className="text-center py-20">
                <p className="text-4xl mb-3 opacity-30">🏢</p>
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">{t("empty")}</p>
            </div>
        )
    }

    const zobrazene = data.clients.filter(c =>
        filtr === "vse" ? true : filtr === "aktivni" ? c.isActive : !c.isActive)
    const filtrLabel: Record<Filtr, string> = {
        aktivni: t("filter.active"),
        deaktivovane: t("quarantine"),
        vse: t("filter.all"),
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap gap-3">
                <Stat label={t("stats.active")} value={String(data.clients.filter(c => c.isActive).length)} />
                <Stat label={t("stats.atRisk")} value={String(data.atRisk)} tone={data.atRisk > 0 ? "warn" : "ok"} />
                <Stat label={t("quarantine")} value={String(data.deactivated)} />
                <Stat label={t("stats.stalledOnboarding")} value={String(data.stalledOnboardings)} tone={data.stalledOnboardings > 0 ? "warn" : "ok"} />
            </div>

            <div className="flex flex-wrap gap-2">
                {(["aktivni", "deaktivovane", "vse"] as Filtr[]).map(f => (
                    <button
                        key={f}
                        onClick={() => setFiltr(f)}
                        className={`px-3 py-1.5 rounded-sm border text-[9px] uppercase tracking-widest font-bold transition-colors ${
                            filtr === f
                                ? "border-white/20 bg-white/10 text-white"
                                : "border-white/5 bg-[#080808] text-white/40 hover:text-white/70"
                        }`}
                    >
                        {filtrLabel[f]}
                    </button>
                ))}
            </div>

            <div className="overflow-x-auto border border-white/5 rounded-sm">
                <table className="w-full text-left min-w-[720px]">
                    <thead>
                        <tr className="border-b border-white/5">
                            {[t("columns.client"), t("columns.plan"), t("columns.risks"), t("columns.content14d"), t("columns.lastContent"), t("columns.credits"), t("columns.ig")].map(h => (
                                <th key={h} className="px-4 py-3 text-[9px] uppercase tracking-widest font-bold text-white/30">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {zobrazene.map(c => <Row key={c.clientId} c={c} managerEmail={managerEmail} />)}
                    </tbody>
                </table>
            </div>

            <p className="text-[9px] text-white/20 font-bold uppercase tracking-widest">
                {t("footer", { date: format.dateTime(new Date(data.generatedAt), { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }) })}
            </p>
        </div>
    )
}

function Row({ c, managerEmail }: { c: ClientHealthDTO; managerEmail: string | null }) {
    const { setProjectId } = useStudio()
    const navigate = useStudioNavigate()
    const [taskState, setTaskState] = useState<"idle" | "busy" | "done" | "error">("idle")
    const t = useTranslations("adminOps.company")
    const format = useFormatter()

    /**
     * Z rizika rovnou úkol. Název nese důvod, ne jen jméno — „Ozvat se: Pekárna
     * — Selhává platba" se dá po týdnu přečíst, samotné jméno ne.
     */
    const createFollowUp = async () => {
        setTaskState("busy")
        const res = await createTask({
            title: `Ozvat se: ${c.name} — ${c.risksLabel || "riziko"}`, // i18n-ignore: text úkolu je záznam v DB pro celý tým (jako výstup třídiče), risksLabel chodí ze serveru česky
            note: `Plán ${c.plan || "—"} · ${c.postsLast14d} příspěvků za 14 dní`, // i18n-ignore: tamtéž — poznámka úkolu jsou data, ne UI
            ownerEmail: managerEmail,
            priority: c.risks.includes("dunning") ? 1 : 2,
            clientId: c.clientId,
        })
        setTaskState(res.success ? "done" : "error")
    }

    return (
        <tr className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
            <td className="px-4 py-3">
                <button
                    onClick={() => { setProjectId(c.slug); navigate("dashboard") }}
                    title={t("row.openStudio")}
                    className={`inline-flex items-center gap-1.5 text-xs font-bold transition-colors ${c.isActive ? "text-white hover:text-white/70" : "text-white/40 hover:text-white/70"}`}
                >
                    {c.name}<ExternalLink className="w-3 h-3 shrink-0 opacity-40" />
                </button>
                <p className="text-[9px] text-white/25 font-bold">
                    {c.slug}
                    {!c.isActive && ` · ${t("row.quarantineSince", { date: c.deactivatedAt ? format.dateTime(new Date(c.deactivatedAt), { day: "numeric", month: "numeric", year: "numeric" }) : "?" })}`}
                </p>
            </td>
            <td className="px-4 py-3">
                <p className="text-[10px] text-white/60 font-bold">{c.plan || "—"}</p>
                <p className="text-[9px] text-white/25 font-bold">{c.status || t("row.noSubscription")}</p>
            </td>
            <td className="px-4 py-3">
                {c.risks.length === 0 ? (
                    <span className="text-[10px] text-emerald-400/70 font-bold">{t("row.ok")}</span>
                ) : (
                    <div className="flex flex-wrap items-center gap-1">
                        {c.risks.map(r => (
                            <span key={r} className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase ${RISK_STYLE[r] || "text-white/50 border-white/15 bg-white/5"}`}>
                                {t.has(`row.risk.${r}`) ? t(`row.risk.${r}`) : r}
                            </span>
                        ))}
                        <button
                            onClick={createFollowUp}
                            disabled={taskState === "busy" || taskState === "done"}
                            title={t("row.followUp.title")}
                            className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-white/35 hover:text-white transition-colors disabled:opacity-40"
                        >
                            <ListPlus className="w-3 h-3 shrink-0" />
                            {taskState === "done" ? t("row.followUp.done") : taskState === "error" ? t("row.followUp.error") : taskState === "busy" ? "…" : t("row.followUp.action")}
                        </button>
                    </div>
                )}
            </td>
            <td className="px-4 py-3">
                <span className={`text-xs font-bold ${c.postsLast14d === 0 ? "text-orange-400" : "text-white/70"}`}>{c.postsLast14d}</span>
            </td>
            <td className="px-4 py-3 text-[10px] text-white/40 font-bold">{daysAgo(c.lastContentAt, t)}</td>
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
