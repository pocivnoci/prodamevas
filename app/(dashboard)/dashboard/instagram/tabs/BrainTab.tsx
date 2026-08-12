"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
    getBrandMemoriesList,
    createBrandMemory,
    updateBrandMemory,
    deleteBrandMemory,
} from "@/app/actions/memory-actions"

interface BrandMemory {
    id: string
    memory_type: "pattern" | "preference" | "avoid" | "visual"
    content: string
    confidence: number
    times_confirmed: number
    source_post_ids: string[]
    created_at: string
    updated_at?: string
}

const MEMORY_TYPES = {
    pattern: { label: "Co funguje", emoji: "✅", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    preference: { label: "Styl značky", emoji: "🎯", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
    avoid: { label: "Vyhnout se", emoji: "❌", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
    visual: { label: "Vizuální", emoji: "🖼️", color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
} as const

export function BrainTab({ projectId }: { projectId: string }) {
    const [memories, setMemories] = useState<BrandMemory[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<string>("all")
    const [showAddForm, setShowAddForm] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editContent, setEditContent] = useState("")
    const [editConfidence, setEditConfidence] = useState(0.5)

    // Add form state
    const [newType, setNewType] = useState<string>("pattern")
    const [newContent, setNewContent] = useState("")
    const [newConfidence, setNewConfidence] = useState(0.7)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        loadMemories()
    }, [projectId])

    async function loadMemories() {
        setLoading(true)
        const result = await getBrandMemoriesList(projectId)
        setMemories(result.memories as BrandMemory[])
        setLoading(false)
    }

    async function handleCreate() {
        if (!newContent.trim()) return
        setSaving(true)
        await createBrandMemory(projectId, {
            memory_type: newType,
            content: newContent.trim(),
            confidence: newConfidence,
        })
        setNewContent("")
        setNewConfidence(0.7)
        setShowAddForm(false)
        setSaving(false)
        await loadMemories()
    }

    async function handleUpdate(id: string) {
        setSaving(true)
        await updateBrandMemory(id, {
            content: editContent,
            confidence: editConfidence,
        })
        setEditingId(null)
        setSaving(false)
        await loadMemories()
    }

    async function handleDelete(id: string) {
        await deleteBrandMemory(id)
        await loadMemories()
    }

    function startEdit(mem: BrandMemory) {
        setEditingId(mem.id)
        setEditContent(mem.content)
        setEditConfidence(mem.confidence)
    }

    const filtered = filter === "all" ? memories : memories.filter(m => m.memory_type === filter)
    const counts = {
        all: memories.length,
        pattern: memories.filter(m => m.memory_type === "pattern").length,
        preference: memories.filter(m => m.memory_type === "preference").length,
        avoid: memories.filter(m => m.memory_type === "avoid").length,
        visual: memories.filter(m => m.memory_type === "visual").length,
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="text-xl">🧠</span> Paměť značky
                    </h2>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mt-1">
                        Naučené vzorce z reálného výkonu • {memories.length} pravidel
                    </p>
                </div>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold rounded bg-white/5 border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-all"
                >
                    {showAddForm ? "Zavřít" : "+ Přidat pravidlo"}
                </button>
            </div>

            {/* Add Form */}
            <AnimatePresence>
                {showAddForm && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 space-y-3">
                            <div className="flex gap-2">
                                {Object.entries(MEMORY_TYPES).map(([key, cfg]) => (
                                    <button
                                        key={key}
                                        onClick={() => setNewType(key)}
                                        className={`px-2.5 py-1 text-[9px] uppercase tracking-widest font-bold rounded border transition-all ${
                                            newType === key
                                                ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                                                : "bg-white/5 border-white/5 text-white/30 hover:text-white/50"
                                        }`}
                                    >
                                        {cfg.emoji} {cfg.label}
                                    </button>
                                ))}
                            </div>
                            <textarea
                                value={newContent}
                                onChange={e => setNewContent(e.target.value)}
                                placeholder="Pravidlo česky, např. 'Otázky v hooky mají 2× vyšší engagement než tvrzení'"
                                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-sm text-white/80 placeholder:text-white/20 resize-none focus:outline-none focus:border-white/20"
                                rows={2}
                            />
                            <div className="flex items-center gap-4">
                                <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold">
                                    Jistota: {(newConfidence * 100).toFixed(0)}%
                                </label>
                                <input
                                    type="range"
                                    min={0.1}
                                    max={1}
                                    step={0.05}
                                    value={newConfidence}
                                    onChange={e => setNewConfidence(parseFloat(e.target.value))}
                                    className="flex-1 h-1 accent-aisummit-cinnabar"
                                />
                                <button
                                    onClick={handleCreate}
                                    disabled={saving || !newContent.trim()}
                                    className="px-4 py-1.5 text-[10px] uppercase tracking-widest font-bold rounded bg-aisummit-cinnabar/20 border border-aisummit-cinnabar/30 text-aisummit-cinnabar hover:bg-aisummit-cinnabar/30 transition-all disabled:opacity-30"
                                >
                                    {saving ? "..." : "Uložit"}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Filter tabs */}
            <div className="flex gap-1.5 flex-wrap">
                {[{ key: "all", label: "Vše", emoji: "📋" }, ...Object.entries(MEMORY_TYPES).map(([key, cfg]) => ({ key, label: cfg.label, emoji: cfg.emoji }))].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setFilter(tab.key)}
                        className={`px-2.5 py-1 text-[9px] uppercase tracking-widest font-bold rounded border transition-all ${
                            filter === tab.key
                                ? "bg-white/10 border-white/20 text-white"
                                : "bg-white/5 border-white/5 text-white/30 hover:text-white/50"
                        }`}
                    >
                        {tab.emoji} {tab.label} ({counts[tab.key as keyof typeof counts] || 0})
                    </button>
                ))}
            </div>

            {/* Memory cards */}
            {loading ? (
                <div className="text-center py-12 text-white/20 text-xs uppercase tracking-widest">Načítám...</div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-12">
                    <p className="text-white/20 text-xs uppercase tracking-widest">
                        {memories.length === 0
                            ? "Žádné naučené vzorce — systém se naučí po zadání metrik u 3+ postů"
                            : "Žádné vzorce v této kategorii"}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    <AnimatePresence mode="popLayout">
                        {filtered.map(mem => {
                            const cfg = MEMORY_TYPES[mem.memory_type as keyof typeof MEMORY_TYPES] || MEMORY_TYPES.pattern
                            const isEditing = editingId === mem.id
                            const ageInDays = Math.floor((Date.now() - new Date(mem.created_at).getTime()) / 86400000)

                            return (
                                <motion.div
                                    key={mem.id}
                                    layout
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className={`${cfg.bg} border ${cfg.border} rounded-lg p-3 group`}
                                >
                                    {isEditing ? (
                                        <div className="space-y-2">
                                            <textarea
                                                value={editContent}
                                                onChange={e => setEditContent(e.target.value)}
                                                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-sm text-white/80 resize-none focus:outline-none focus:border-white/20"
                                                rows={2}
                                            />
                                            <div className="flex items-center gap-3">
                                                <label className="text-[9px] uppercase tracking-widest text-white/30 font-bold whitespace-nowrap">
                                                    {(editConfidence * 100).toFixed(0)}%
                                                </label>
                                                <input
                                                    type="range"
                                                    min={0.1}
                                                    max={1}
                                                    step={0.05}
                                                    value={editConfidence}
                                                    onChange={e => setEditConfidence(parseFloat(e.target.value))}
                                                    className="flex-1 h-1 accent-aisummit-cinnabar"
                                                />
                                                <button
                                                    onClick={() => handleUpdate(mem.id)}
                                                    disabled={saving}
                                                    className="px-3 py-1 text-[9px] uppercase tracking-widest font-bold rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-all"
                                                >
                                                    Uložit
                                                </button>
                                                <button
                                                    onClick={() => setEditingId(null)}
                                                    className="px-3 py-1 text-[9px] uppercase tracking-widest font-bold rounded bg-white/5 border border-white/10 text-white/40 hover:text-white/60 transition-all"
                                                >
                                                    Zrušit
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-start gap-3">
                                            <span className="text-base mt-0.5">{cfg.emoji}</span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-white/80 leading-relaxed">{mem.content}</p>
                                                <div className="flex items-center gap-3 mt-1.5">
                                                    {/* Confidence bar */}
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-16 h-1 bg-white/5 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all ${
                                                                    mem.confidence >= 0.7 ? "bg-emerald-500" :
                                                                    mem.confidence >= 0.4 ? "bg-yellow-500" : "bg-red-500"
                                                                }`}
                                                                style={{ width: `${mem.confidence * 100}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-[9px] text-white/25 font-mono">
                                                            {(mem.confidence * 100).toFixed(0)}%
                                                        </span>
                                                    </div>
                                                    <span className="text-[9px] text-white/15">
                                                        {mem.times_confirmed}× potvrzeno
                                                    </span>
                                                    <span className="text-[9px] text-white/15">
                                                        {ageInDays}d staré
                                                    </span>
                                                    {mem.source_post_ids?.length > 0 && (
                                                        <span className="text-[9px] text-white/15">
                                                            {mem.source_post_ids.length} zdrojů
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {/* Na dotyku vždy vidět — najetí myší tam neexistuje,
                                                takže úpravy i mazání byly nedosažitelné. */}
                                            <div className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => startEdit(mem)}
                                                    className="p-2 sm:p-1 text-white/40 sm:text-white/20 hover:text-white/60 transition-colors cursor-pointer"
                                                    title="Upravit"
                                                    aria-label="Upravit"
                                                >
                                                    <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                    </svg>
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(mem.id)}
                                                    className="p-2 sm:p-1 text-white/40 sm:text-white/20 hover:text-red-400 transition-colors cursor-pointer"
                                                    title="Smazat"
                                                    aria-label="Smazat"
                                                >
                                                    <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </motion.div>
                            )
                        })}
                    </AnimatePresence>
                </div>
            )}
        </div>
    )
}
