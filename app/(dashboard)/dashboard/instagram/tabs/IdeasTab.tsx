"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { getIGIdeasList, getIGCategories } from "@/app/actions/admin-actions"
import { addNewIdea, triggerAIIdeasGeneration } from "@/app/actions/ig-generate-action"
import { LoadingSpinner } from "./shared"

export function IdeasTab({ projectId }: { projectId: string }) {
    const [ideas, setIdeas] = useState<any[]>([])
    const [categories, setCategories] = useState<{ id: string; emoji: string; label: string }[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [newIdea, setNewIdea] = useState({ title: "", content: "", category: "tip", subcategory: "" })
    const [saving, setSaving] = useState(false)
    const [generatingAI, setGeneratingAI] = useState(false)

    const loadIdeas = async () => {
        if (!projectId) return
        setLoading(true)
        const data = await getIGIdeasList(projectId)
        setIdeas(data)
        setLoading(false)
    }

    useEffect(() => {
        if (!projectId) return
        loadIdeas()
        getIGCategories(projectId).then(setCategories)
    }, [projectId])

    const handleAddIdea = async () => {
        if (!newIdea.title || !newIdea.content) return
        setSaving(true)
        await addNewIdea({ ...newIdea, projectId })
        setNewIdea({ title: "", content: "", category: "tip", subcategory: "" })
        setShowForm(false)
        setSaving(false)
        loadIdeas()
    }

    const handleGenerateAIIdeas = async (pillarId: string) => {
        if (!pillarId) return
        setGeneratingAI(true)
        const res = await triggerAIIdeasGeneration({ configName: projectId, pillarId, count: 10 })
        if (res.success) {
            await loadIdeas()
        } else {
            alert("Chyba při generování nápadů: " + res.error)
        }
        setGeneratingAI(false)
    }

    if (loading) return <LoadingSpinner />

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/40 tracking-widest uppercase font-bold">{ideas.length} nápadů</span>
                <div className="flex items-center gap-3">
                    {/* Select for AI Generation Category */}
                    <div className="relative group">
                        <select
                            onChange={(e) => {
                                if (e.target.value) {
                                    handleGenerateAIIdeas(e.target.value)
                                    e.target.value = "" // reset select
                                }
                            }}
                            disabled={generatingAI}
                            className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-[0_0_15px_rgba(16,185,129,0.1)] appearance-none cursor-pointer pr-8 ${generatingAI ? 'opacity-50 cursor-not-allowed' : 'hover:bg-emerald-500/20'}`}
                        >
                            <option value="">{generatingAI ? "✨ Generuji..." : "✨ AI Nápady (10x)"}</option>
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.emoji} {cat.label}</option>
                            ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-emerald-500">
                            ▼
                        </div>
                    </div>

                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/50 border border-white/10 rounded-sm hover:text-white hover:bg-white/10 transition-colors"
                    >
                        + Přidat ručně
                    </button>
                </div>
            </div>

            {showForm && (
                <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-6 space-y-4 shadow-lg shrink-0">
                    <input
                        type="text"
                        placeholder="Název..."
                        value={newIdea.title}
                        onChange={(e) => setNewIdea(prev => ({ ...prev, title: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium"
                    />
                    <textarea
                        placeholder="Obsah nápadu..."
                        value={newIdea.content}
                        onChange={(e) => setNewIdea(prev => ({ ...prev, content: e.target.value }))}
                        rows={3}
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium resize-none"
                    />
                    <div className="flex gap-3">
                        <select
                            value={newIdea.category}
                            onChange={(e) => setNewIdea(prev => ({ ...prev, category: e.target.value }))}
                            className="px-4 py-2 bg-[#050505] border border-white/10 rounded-sm text-white/70 text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                        >
                            <option value="tip">Tip</option>
                            <option value="edukace">Edukace</option>
                            <option value="motivace">Motivace</option>
                            <option value="statistika">Statistika</option>
                        </select>
                        <button
                            onClick={handleAddIdea}
                            disabled={saving}
                            className="px-6 py-2.5 bg-aisummit-cinnabar text-white text-[10px] font-black uppercase tracking-widest rounded-sm border border-aisummit-cinnabar/30 hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_15px_rgba(229,83,63,0.3)]"
                        >
                            {saving ? "Ukládám..." : "Uložit"}
                        </button>
                    </div>
                </div>
            )}

            <motion.div
                className="space-y-2"
                initial="hidden"
                animate="visible"
                variants={{
                    hidden: { opacity: 0 },
                    visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
                }}
            >
                {ideas.map(idea => (
                    <motion.div
                        variants={{
                            hidden: { opacity: 0, x: -20 },
                            visible: { opacity: 1, x: 0 }
                        }}
                        key={idea.id}
                        className="bg-[#0a0a0a] border border-white/5 rounded-sm p-4 hover:border-white/10 transition-all hover:bg-white/5 shadow-sm"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h4 className="text-xs font-bold uppercase tracking-wider text-white">{idea.title}</h4>
                                <p className="text-xs text-white/50 mt-1.5 font-medium">{idea.content}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[9px] px-2 py-1 rounded-sm bg-white/5 text-white/50 uppercase tracking-widest font-bold border border-white/10">{idea.category}</span>
                                <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">×{idea.times_used || 0}</span>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </motion.div>

            {ideas.length === 0 && (
                <div className="text-center py-12 text-white/40">
                    <p className="text-4xl mb-3 grayscale opacity-30">💡</p>
                    <p className="text-[10px] uppercase font-bold tracking-widest">Žádné nápady</p>
                </div>
            )}
        </div>
    )
}
