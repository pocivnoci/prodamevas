"use client"

import { useEffect, useState, useMemo } from "react"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import { getIGIdeasList, getIGCategories } from "@/app/actions/admin-actions"
import { addNewIdea, triggerAIIdeasGeneration, deleteIdea, setIdeaActive } from "@/app/actions/ig-generate-action"
import { LoadingSpinner } from "./shared"
import { Flame, Lightbulb, Moon, X } from "lucide-react"

type PillarWithCategories = {
    id: string
    emoji: string
    label: string
    categories?: { id: string; emoji: string; label: string }[]
}

export function IdeasTab({ projectId }: { projectId: string }) {
    const [ideas, setIdeas] = useState<any[]>([])
    const [pillars, setPillars] = useState<PillarWithCategories[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [newIdea, setNewIdea] = useState({ title: "", content: "", category: "tip", subcategory: "" })
    const [saving, setSaving] = useState(false)
    const [generatingAI, setGeneratingAI] = useState(false)
    const [filterCategory, setFilterCategory] = useState<string>("all")
    const t = useTranslations("inspiration.ideas")
    const tc = useTranslations("common")

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
        getIGCategories(projectId).then(setPillars)
    }, [projectId])

    // Build flat list of all categories for filtering
    const allCategories = useMemo(() => {
        const cats: { id: string; emoji: string; label: string; pillarLabel: string }[] = []
        for (const p of pillars) {
            if (p.categories?.length) {
                for (const c of p.categories) {
                    cats.push({ ...c, pillarLabel: p.label })
                }
            }
        }
        return cats
    }, [pillars])

    // Category label lookup
    const categoryLabelMap = useMemo(() => {
        const map: Record<string, { emoji: string; label: string }> = {}
        for (const c of allCategories) {
            map[c.id] = { emoji: c.emoji, label: c.label }
        }
        return map
    }, [allCategories])

    // Pillar label lookup (idea.category holds the pillar id)
    const pillarLabelMap = useMemo(() => {
        const map: Record<string, { emoji: string; label: string }> = {}
        for (const p of pillars) {
            map[p.id] = { emoji: p.emoji, label: p.label }
        }
        return map
    }, [pillars])

    // Legacy rows carry values like "AI Generated" that match no category — collapse to null
    const normalizeSub = (sub: string | null | undefined): string | null =>
        sub && categoryLabelMap[sub] ? sub : null

    const hasUncategorized = useMemo(
        () => ideas.some(i => normalizeSub(i.subcategory) === null),
        [ideas, categoryLabelMap]
    )

    // Client average engagement across measured ideas — powers the 🔥 badge
    const avgScore = useMemo(() => {
        const measured = ideas.filter(i => (i.times_used_with_metrics || 0) > 0)
        if (!measured.length) return 0
        return measured.reduce((s, i) => s + (i.performance_score || 0), 0) / measured.length
    }, [ideas])

    // Filtered ideas
    const filteredIdeas = useMemo(() => {
        if (filterCategory === "all") return ideas
        if (filterCategory === "__none__") return ideas.filter(i => normalizeSub(i.subcategory) === null)
        return ideas.filter(i => normalizeSub(i.subcategory) === filterCategory)
    }, [ideas, filterCategory, categoryLabelMap])

    const handleAddIdea = async () => {
        if (!newIdea.title || !newIdea.content) return
        setSaving(true)
        await addNewIdea({ ...newIdea, projectId })
        setNewIdea({ title: "", content: "", category: "tip", subcategory: "" })
        setShowForm(false)
        setSaving(false)
        loadIdeas()
    }

    const handleGenerateAIIdeas = async (pillarId: string, categoryId?: string) => {
        if (!pillarId) return
        setGeneratingAI(true)
        const res = await triggerAIIdeasGeneration({
            configName: projectId,
            pillarId,
            count: 10,
            categoryId: categoryId || undefined,
        })
        if (res.success) {
            await loadIdeas()
            // Nové nápady rovnou pod jejich čipem — ať je vidět, že se zařadily.
            if (categoryId) setFilterCategory(categoryId)
        } else {
            alert(t("generateError", { error: res.error ?? "" }))
        }
        setGeneratingAI(false)
    }

    const handleToggleActive = async (idea: any) => {
        const res = await setIdeaActive(idea.id, projectId, !(idea.is_active !== false))
        if (!res.success) {
            alert(t("error", { error: res.error ?? "" }))
            return
        }
        loadIdeas()
    }

    const handleDelete = async (idea: any) => {
        if (!confirm(t("deleteConfirm"))) return
        const res = await deleteIdea(idea.id, projectId)
        if (!res.success) {
            alert(t("error", { error: res.error ?? "" }))
            return
        }
        loadIdeas()
    }

    if (loading) return <LoadingSpinner />

    return (
        <div className="space-y-4">
            {/* Explainer — what this bank actually does */}
            <div className="bg-[#0a0a0a] border border-white/5 rounded-sm p-4">
                <p className="inline-flex items-center gap-1.5 text-[9px] text-white/40 font-bold uppercase tracking-widest mb-1"><Lightbulb className="w-3 h-3 shrink-0" />{t("explainer.title")}</p>
                <p className="text-xs text-white/50">
                    {t("explainer.body")}
                </p>
            </div>

            <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/40 tracking-widest uppercase font-bold">
                    {filterCategory !== "all"
                        ? t("countFiltered", { shown: filteredIdeas.length, total: ideas.length })
                        : t("count", { count: filteredIdeas.length })}
                </span>
                <div className="flex items-center gap-3">
                    {/* AI Generation — 2-level dropdown (pillar → category) */}
                    <div className="relative group">
                        <select
                            onChange={(e) => {
                                const val = e.target.value
                                if (!val) return
                                // Value format: "pillarId" or "pillarId:categoryId"
                                const [pillarId, categoryId] = val.split(":")
                                handleGenerateAIIdeas(pillarId, categoryId)
                                e.target.value = "" // reset
                            }}
                            disabled={generatingAI}
                            className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-[0_0_15px_rgba(16,185,129,0.1)] appearance-none cursor-pointer pr-8 ${generatingAI ? 'opacity-50 cursor-not-allowed' : 'hover:bg-emerald-500/20'}`}
                        >
                            <option value="">{generatingAI ? t("generating") : t("generateAi")}</option>
                            {pillars.map(pillar => (
                                pillar.categories && pillar.categories.length > 0 ? (
                                    <optgroup key={pillar.id} label={`${pillar.emoji} ${pillar.label}`}>
                                        <option value={pillar.id}>
                                            {pillar.emoji} {t("allInPillar", { pillar: pillar.label })}
                                        </option>
                                        {pillar.categories.map(cat => (
                                            <option key={`${pillar.id}:${cat.id}`} value={`${pillar.id}:${cat.id}`}>
                                                {cat.emoji} {cat.label}
                                            </option>
                                        ))}
                                    </optgroup>
                                ) : (
                                    <option key={pillar.id} value={pillar.id}>
                                        {pillar.emoji} {pillar.label}
                                    </option>
                                )
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
                        {t("addManually")}
                    </button>
                </div>
            </div>

            {/* Category filter chips */}
            {allCategories.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    <button
                        onClick={() => setFilterCategory("all")}
                        className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest rounded-sm border transition-all ${
                            filterCategory === "all"
                                ? "bg-white/10 text-white border-white/20"
                                : "bg-white/3 text-white/40 border-white/5 hover:text-white/60 hover:border-white/10"
                        }`}
                    >
                        {t("all")}
                    </button>
                    {allCategories.map(cat => (
                        <button
                            key={cat.id}
                            title={t("pillarTitle", { pillar: cat.pillarLabel })}
                            onClick={() => setFilterCategory(cat.id === filterCategory ? "all" : cat.id)}
                            className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest rounded-sm border transition-all ${
                                filterCategory === cat.id
                                    ? "bg-white/10 text-white border-white/20"
                                    : "bg-white/3 text-white/40 border-white/5 hover:text-white/60 hover:border-white/10"
                            }`}
                        >
                            {cat.emoji} {cat.label}
                        </button>
                    ))}
                    {hasUncategorized && (
                        <button
                            onClick={() => setFilterCategory(filterCategory === "__none__" ? "all" : "__none__")}
                            className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest rounded-sm border transition-all ${
                                filterCategory === "__none__"
                                    ? "bg-white/10 text-white border-white/20"
                                    : "bg-white/3 text-white/40 border-white/5 hover:text-white/60 hover:border-white/10"
                            }`}
                        >
                            {t("uncategorized")}
                        </button>
                    )}
                </div>
            )}

            {showForm && (
                <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-6 space-y-4 shadow-lg shrink-0">
                    <input
                        type="text"
                        placeholder={t("form.titlePlaceholder")}
                        value={newIdea.title}
                        onChange={(e) => setNewIdea(prev => ({ ...prev, title: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium"
                    />
                    <textarea
                        placeholder={t("form.contentPlaceholder")}
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
                            {pillars.map(p => (
                                <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>
                            ))}
                        </select>
                        {/* Subcategory select — show only if pillar has categories */}
                        {(() => {
                            const selectedPillar = pillars.find(p => p.id === newIdea.category)
                            if (!selectedPillar?.categories?.length) return null
                            return (
                                <select
                                    value={newIdea.subcategory}
                                    onChange={(e) => setNewIdea(prev => ({ ...prev, subcategory: e.target.value }))}
                                    className="px-4 py-2 bg-[#050505] border border-white/10 rounded-sm text-white/70 text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                >
                                    <option value="">{t("form.categoryPlaceholder")}</option>
                                    {selectedPillar.categories.map(c => (
                                        <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
                                    ))}
                                </select>
                            )
                        })()}
                        <button
                            onClick={handleAddIdea}
                            disabled={saving}
                            className="px-6 py-2.5 bg-aisummit-cinnabar text-white text-[10px] font-black uppercase tracking-widest rounded-sm border border-aisummit-cinnabar/30 hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_15px_rgba(229,83,63,0.3)]"
                        >
                            {saving ? t("form.saving") : tc("save")}
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
                {filteredIdeas.map(idea => {
                    const catInfo = categoryLabelMap[normalizeSub(idea.subcategory) || ""]
                    const pillarInfo = pillarLabelMap[idea.category]
                    const isActive = idea.is_active !== false
                    const usedCount = idea.used_count || 0
                    const isProven = (idea.times_used_with_metrics || 0) > 0 && (idea.performance_score || 0) > avgScore
                    const cooldownMs = (idea.cooldown_days ?? 90) * 24 * 60 * 60 * 1000
                    const isResting = idea.last_used_at && Date.now() - new Date(idea.last_used_at).getTime() < cooldownMs
                    return (
                        <motion.div
                            variants={{
                                hidden: { opacity: 0, x: -20 },
                                visible: { opacity: 1, x: 0 }
                            }}
                            key={idea.id}
                            className={`bg-[#0a0a0a] border border-white/5 rounded-sm p-4 hover:border-white/10 transition-all hover:bg-white/5 shadow-sm ${isActive ? "" : "opacity-40"}`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-white">{idea.title}</h4>
                                    <p className="text-xs text-white/50 mt-1.5 font-medium">{idea.content}</p>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                                    {!isActive && (
                                        <span className="text-[9px] px-2 py-1 rounded-sm bg-amber-500/10 text-amber-400/80 uppercase tracking-widest font-bold border border-amber-500/20">
                                            {t("badges.off")}
                                        </span>
                                    )}
                                    {isProven && (
                                        <span className="inline-flex items-center gap-1.5 text-[9px] px-2 py-1 rounded-sm bg-emerald-500/10 text-emerald-400 uppercase tracking-widest font-bold border border-emerald-500/20"><Flame className="w-3 h-3 shrink-0" />{t("badges.proven")}</span>
                                    )}
                                    {isResting && (
                                        <span className="inline-flex items-center gap-1.5 text-[9px] px-2 py-1 rounded-sm bg-white/5 text-white/30 uppercase tracking-widest font-bold border border-white/10"><Moon className="w-3 h-3 shrink-0" />{t("badges.resting")}</span>
                                    )}
                                    {usedCount === 0 ? (
                                        <span className="text-[9px] px-2 py-1 rounded-sm bg-white/5 text-white/40 uppercase tracking-widest font-bold border border-white/10">
                                            {t("badges.new")}
                                        </span>
                                    ) : (
                                        <span className="text-[9px] px-2 py-1 rounded-sm bg-white/5 text-white/40 uppercase tracking-widest font-bold border border-white/10">
                                            {t("badges.used", { count: usedCount })}
                                        </span>
                                    )}
                                    {catInfo && (
                                        <span className="text-[9px] px-2 py-1 rounded-sm bg-emerald-500/10 text-emerald-400/80 uppercase tracking-widest font-bold border border-emerald-500/20">
                                            {catInfo.emoji} {catInfo.label}
                                        </span>
                                    )}
                                    <span className="text-[9px] px-2 py-1 rounded-sm bg-white/5 text-white/50 uppercase tracking-widest font-bold border border-white/10">
                                        {pillarInfo ? `${pillarInfo.emoji} ${pillarInfo.label}` : idea.category}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mt-3">
                                <button
                                    onClick={() => handleToggleActive(idea)}
                                    className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest rounded-sm bg-white/3 text-white/40 border border-white/5 hover:text-white/70 hover:border-white/10 transition-all"
                                >
                                    {isActive ? t("turnOff") : t("turnOn")}
                                </button>
                                <button
                                    onClick={() => handleDelete(idea)}
                                    className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest rounded-sm bg-white/3 text-white/40 border border-white/5 hover:text-red-400 hover:border-red-500/20 transition-all"
                                >
                                    <span className="inline-flex items-center gap-1.5"><X className="w-3.5 h-3.5 shrink-0" />{t("delete")}</span>
                                </button>
                            </div>
                        </motion.div>
                    )
                })}
            </motion.div>

            {filteredIdeas.length === 0 && (
                <div className="text-center py-12 text-white/40">
                    <p className="text-4xl mb-3 grayscale opacity-30">💡</p>
                    <p className="text-[10px] uppercase font-bold tracking-widest">
                        {filterCategory !== "all" ? t("emptyFiltered") : t("empty")}
                    </p>
                </div>
            )}
        </div>
    )
}
