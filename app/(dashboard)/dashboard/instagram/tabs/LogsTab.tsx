"use client"

import { useEffect, useState } from "react"
import { getIGGenerationLogs } from "@/app/actions/admin-actions"
import { LoadingSpinner } from "./shared"

export function LogsTab({ projectId }: { projectId: string }) {
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
            <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">{logs.length} záznamů</span>

            <div className="bg-[#0f0f0f] border border-white/10 rounded-sm overflow-hidden shadow-lg">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-white/10 bg-[#050505]">
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Model</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Tokeny</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Čas</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Post</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Error</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Datum</th>
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
                                            <span className="text-[10px] font-bold text-emerald-500">✓</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-4 text-[10px] text-white/40 font-mono tracking-widest">
                                        {new Date(log.created_at).toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {logs.length === 0 && (
                    <div className="text-center py-12 text-[10px] font-bold uppercase tracking-widest text-white/40">Žádné logy</div>
                )}
            </div>
        </div>
    )
}
