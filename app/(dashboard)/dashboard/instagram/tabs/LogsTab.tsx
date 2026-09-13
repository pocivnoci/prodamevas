"use client"

import { useEffect, useState } from "react"
import { getIGGenerationLogs } from "@/app/actions/admin-actions"
import { LoadingSpinner } from "./shared"
import { Check } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

export function LogsTab({ projectId }: { projectId: string }) {
    const t = useTranslations("adminOps.logs")
    const format = useFormatter()
    const [logs, setLogs] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!projectId) return
        setLoading(true)
        getIGGenerationLogs(50, projectId).then(data => {
            setLogs(data)
            setLoading(false)
        })
    }, [projectId])

    if (loading) return <LoadingSpinner />

    return (
        <div className="space-y-4">
            <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">{t("count", { count: logs.length })}</span>

            <div className="bg-[#0f0f0f] border border-white/10 rounded-sm overflow-hidden shadow-lg">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-white/10 bg-[#050505]">
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">{t("columns.model")}</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">{t("columns.tokens")}</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">{t("columns.time")}</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">{t("columns.post")}</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">{t("columns.error")}</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">{t("columns.date")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {logs.map(log => (
                                <tr key={log.id} className="hover:bg-white/5 transition-colors">
                                    <td className="px-5 py-4 text-[10px] text-white/70 font-mono tracking-widest">{log.model_used || "—"}</td>
                                    <td className="px-5 py-4 text-[10px] font-mono text-white/70 tracking-widest">{log.tokens_used || "—"}</td>
                                    <td className="px-5 py-4 text-[10px] font-mono text-white/70 tracking-widest">{log.generation_time_ms ? `${(log.generation_time_ms / 1000).toFixed(1)}s` : "—"}</td>
                                    <td className="px-5 py-4 text-[10px] text-white/50 max-w-[200px] truncate font-medium">
                                        {log.ig_posts?.caption?.substring(0, 50) || "—"}
                                    </td>
                                    <td className="px-5 py-4">
                                        {log.error ? (
                                            <span className="text-[10px] font-mono tracking-widest text-aisummit-cinnabar truncate max-w-[150px] block">{log.error}</span>
                                        ) : (
                                            <Check className="w-3 h-3 text-[10px] font-bold text-emerald-500" />
                                        )}
                                    </td>
                                    <td className="px-5 py-4 text-[10px] text-white/40 font-mono tracking-widest">
                                        {format.dateTime(new Date(log.created_at), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {logs.length === 0 && (
                    <div className="text-center py-12 text-[10px] font-bold uppercase tracking-widest text-white/40">{t("empty")}</div>
                )}
            </div>
        </div>
    )
}
