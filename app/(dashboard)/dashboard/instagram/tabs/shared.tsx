"use client"

import { useState } from "react"
import { updateIGPostMetrics } from "@/app/actions/admin-actions"
import type { IGPost } from "./types"

export function CopyButton({ onClick, copied, label }: { onClick: () => void; copied: boolean; label?: string }) {
    return (
        <button
            onClick={onClick}
            className={`text-[9px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-sm transition-all flex items-center gap-1.5 border ${copied
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white"
                }`}
        >
            {copied ? "✅ Zkopírováno" : label || "📋 Kopírovat"}
        </button>
    )
}

export function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { text: string; class: string }> = {
        draft: { text: "DRAFT", class: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
        ready: { text: "READY", class: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
        posted: { text: "POSTED", class: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
        archived: { text: "ARCHIVED", class: "bg-white/5 text-white/40 border-white/10" },
    }
    const badge = config[status] || config.draft
    return (
        <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm border ${badge.class}`}>
            {badge.text}
        </span>
    )
}

export function LoadingSpinner() {
    return (
        <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-[3px] border-white/10 border-t-aisummit-cinnabar rounded-full animate-spin shadow-sm" />
        </div>
    )
}

export function PillarBadge({ pillar }: { pillar: string }) {
    const config: Record<string, { emoji: string; label: string; color: string }> = {
        reach: { emoji: "🔥", label: "REACH", color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        value: { emoji: "📚", label: "VALUE", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
        convert: { emoji: "💰", label: "CONVERT", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
        connect: { emoji: "🤝", label: "CONNECT", color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
    }

    const badge = config[pillar]
    if (!badge) return null

    return (
        <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-sm border ${badge.color} flex items-center gap-1`}>
            <span>{badge.emoji}</span>
            <span>{badge.label}</span>
        </span>
    )
}

export function MetricInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return (
        <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">{label}</label>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-1.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium"
            />
        </div>
    )
}

export function MetricsInputForm({ post, onUpdate }: { post: IGPost; onUpdate: () => void }) {
    const [metrics, setMetrics] = useState({
        likes: post.likes || 0,
        comments: post.comments || 0,
        saves: post.saves || 0,
        reach: post.reach || 0,
        shares: post.shares || 0,
        profile_visits: post.profile_visits || 0,
        link_clicks: post.link_clicks || 0,
    })
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        setSaving(true)
        await updateIGPostMetrics(post.id, metrics)
        setSaving(false)
        onUpdate()
    }

    const reachScore = (metrics.saves * 5 + metrics.shares * 8 + metrics.reach * 0.01).toFixed(0)
    const conversionScore = (metrics.link_clicks * 10 + metrics.profile_visits * 3).toFixed(0)

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">📊 Metriky</span>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest rounded-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/20 disabled:opacity-50"
                >
                    {saving ? "Ukládám..." : "💾 Uložit"}
                </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {/* Engagement metrics */}
                <MetricInput label="❤️ Likes" value={metrics.likes} onChange={(v) => setMetrics({ ...metrics, likes: v })} />
                <MetricInput label="💬 Comments" value={metrics.comments} onChange={(v) => setMetrics({ ...metrics, comments: v })} />
                <MetricInput label="🔖 Saves" value={metrics.saves} onChange={(v) => setMetrics({ ...metrics, saves: v })} />

                {/* Growth Engine metrics */}
                <MetricInput label="👀 Reach" value={metrics.reach} onChange={(v) => setMetrics({ ...metrics, reach: v })} />
                <MetricInput label="↗️ Shares" value={metrics.shares} onChange={(v) => setMetrics({ ...metrics, shares: v })} />
                <MetricInput label="👤 Profile Visits" value={metrics.profile_visits} onChange={(v) => setMetrics({ ...metrics, profile_visits: v })} />
                <MetricInput label="🔗 Link Clicks" value={metrics.link_clicks} onChange={(v) => setMetrics({ ...metrics, link_clicks: v })} />
            </div>

            {/* Calculated scores */}
            <div className="flex gap-3 pt-4 border-t border-white/10 mt-4">
                <div className="flex-1 bg-amber-500/5 rounded-sm p-3 border border-amber-500/10">
                    <p className="text-[9px] text-amber-500/50 uppercase tracking-widest font-bold">Reach Score</p>
                    <p className="text-2xl font-black text-amber-500">{reachScore}</p>
                </div>
                <div className="flex-1 bg-emerald-500/5 rounded-sm p-3 border border-emerald-500/10">
                    <p className="text-[9px] text-emerald-500/50 uppercase tracking-widest font-bold">Conversion Score</p>
                    <p className="text-2xl font-black text-emerald-500">{conversionScore}</p>
                </div>
            </div>
        </div>
    )
}
