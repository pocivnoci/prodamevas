"use client"

import { useEffect, useState } from "react"
import { getIGReviewsList, updateIGReviewApproval } from "@/app/actions/admin-actions"
import { addNewReview, triggerAIReviewsGeneration } from "@/app/actions/ig-generate-action"
import { LoadingSpinner } from "./shared"

export function ReviewsTab({ projectId }: { projectId: string }) {
    const [reviews, setReviews] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [newReview, setNewReview] = useState({ quote: "", customer_initials: "", rating: 5 })
    const [saving, setSaving] = useState(false)
    const [generatingAI, setGeneratingAI] = useState(false)

    const loadReviews = async () => {
        setLoading(true)
        const data = await getIGReviewsList()
        setReviews(data)
        setLoading(false)
    }

    useEffect(() => { loadReviews() }, [])

    const handleApproval = async (id: string, approved: boolean) => {
        await updateIGReviewApproval(id, approved)
        loadReviews()
    }

    const handleAddReview = async () => {
        if (!newReview.quote) return
        setSaving(true)
        await addNewReview({ ...newReview, projectId })
        setNewReview({ quote: "", customer_initials: "", rating: 5 })
        setShowForm(false)
        setSaving(false)
        loadReviews()
    }

    const handleGenerateAIReviews = async () => {
        setGeneratingAI(true)
        const res = await triggerAIReviewsGeneration({ configName: projectId, count: 5 })
        if (res.success) {
            await loadReviews()
        } else {
            alert("Chyba při generování recenzí: " + res.error)
        }
        setGeneratingAI(false)
    }

    if (loading) return <LoadingSpinner />

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-widest uppercase text-white/40">{reviews.length} recenzí</span>
                <div className="flex gap-3">
                    <button
                        onClick={handleGenerateAIReviews}
                        disabled={generatingAI}
                        className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-[0_0_15px_rgba(16,185,129,0.1)] ${generatingAI ? 'opacity-50 cursor-not-allowed' : 'hover:bg-emerald-500/20'}`}
                    >
                        {generatingAI ? "✨ Generuji..." : "✨ AI Recenze (5x)"}
                    </button>
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/50 border border-white/10 rounded-sm hover:text-white hover:bg-white/10 transition-colors"
                    >
                        + Přidat manuálně
                    </button>
                </div>
            </div>

            {showForm && (
                <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-6 space-y-4 shadow-lg shrink-0">
                    <textarea
                        placeholder="Text recenze..."
                        value={newReview.quote}
                        onChange={(e) => setNewReview(prev => ({ ...prev, quote: e.target.value }))}
                        rows={2}
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium resize-none"
                    />
                    <div className="flex gap-3">
                        <input
                            type="text"
                            placeholder="Iniciály (J.D.)"
                            value={newReview.customer_initials}
                            onChange={(e) => setNewReview(prev => ({ ...prev, customer_initials: e.target.value }))}
                            className="px-4 py-2 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium w-32"
                        />
                        <button
                            onClick={handleAddReview}
                            disabled={saving}
                            className="px-6 py-2.5 bg-aisummit-cinnabar text-white text-[10px] font-black uppercase tracking-widest rounded-sm border border-aisummit-cinnabar/30 hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_15px_rgba(229,83,63,0.3)]"
                        >
                            {saving ? "Ukládám..." : "Uložit"}
                        </button>
                    </div>
                </div>
            )}

            <div className="space-y-2">
                {reviews.map(review => (
                    <div key={review.id} className="bg-[#0a0a0a] border border-white/5 rounded-sm p-4 hover:border-white/10 transition-all hover:bg-white/5 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-xs text-white/70 italic font-medium">&ldquo;{review.quote}&rdquo;</p>
                                <p className="text-[10px] text-white/40 mt-1.5 font-bold uppercase tracking-widest">— {review.customer_initials || "Anonym"} • {"⭐".repeat(review.rating || 5)}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {review.is_approved ? (
                                    <span className="text-[9px] px-2 py-1 rounded-sm bg-emerald-500/10 text-emerald-400 uppercase tracking-widest font-bold border border-emerald-500/20">✓ Schváleno</span>
                                ) : (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => handleApproval(review.id, true)}
                                            className="text-[9px] px-2 py-1 rounded-sm bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 uppercase tracking-widest font-bold border border-emerald-500/20 transition-colors"
                                        >
                                            ✓
                                        </button>
                                        <button
                                            onClick={() => handleApproval(review.id, false)}
                                            className="text-[9px] px-2 py-1 rounded-sm bg-aisummit-cinnabar/10 text-aisummit-cinnabar hover:bg-aisummit-cinnabar/20 uppercase tracking-widest font-bold border border-aisummit-cinnabar/20 transition-colors"
                                        >
                                            ✗
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {reviews.length === 0 && (
                <div className="text-center py-12 text-white/40">
                    <p className="text-4xl mb-3 grayscale opacity-30">📝</p>
                    <p className="text-[10px] uppercase font-bold tracking-widest">Žádné recenze</p>
                </div>
            )}
        </div>
    )
}
