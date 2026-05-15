"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getClientConfig, updateClientConfig, rescanClientWebsite, deleteClient } from "@/app/actions/admin-actions"

export function SettingsTab({ projectId }: { projectId: string }) {
    const [config, setConfig] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    const loadData = useCallback(async () => {
        if (!projectId) return
        setLoading(true)
        setMessage(null)
        const data = await getClientConfig(projectId)
        if (data) {
            setConfig(data)
        } else {
            setMessage({ type: 'error', text: 'Nepodařilo se načíst konfiguraci.' })
        }
        setLoading(false)
    }, [projectId])

    useEffect(() => { loadData() }, [loadData])

    const handleSave = async () => {
        setSaving(true)
        setMessage(null)
        const result = await updateClientConfig(projectId, config)
        if (result.success) {
            setMessage({ type: 'success', text: 'Nastavení úspěšně uloženo.' })
            setTimeout(() => setMessage(null), 3000)
        } else {
            setMessage({ type: 'error', text: result.error || 'Uložení selhalo.' })
        }
        setSaving(false)
    }

    const updateField = (fieldPath: string[], value: string) => {
        setConfig((prev: any) => {
            const next = { ...prev }
            if (fieldPath.length === 1) {
                next[fieldPath[0]] = value
            } else if (fieldPath.length === 2) {
                if (!next[fieldPath[0]]) next[fieldPath[0]] = {}
                next[fieldPath[0]] = { ...next[fieldPath[0]], [fieldPath[1]]: value }
            }
            return next
        })
    }

    const updateArrayField = (fieldPath: string[], value: string) => {
        const arr = value.split(',').map(s => s.trim()).filter(Boolean)
        setConfig((prev: any) => {
            const next = { ...prev }
            if (fieldPath.length === 1) {
                next[fieldPath[0]] = arr
            } else if (fieldPath.length === 2) {
                if (!next[fieldPath[0]]) next[fieldPath[0]] = {}
                next[fieldPath[0]] = { ...next[fieldPath[0]], [fieldPath[1]]: arr }
            }
            return next
        })
    }

    const setGradientKey = (key: string, value: string) => {
        setConfig((prev: any) => ({
            ...prev,
            overlayGradient: { ...(prev.overlayGradient || {}), [key]: value }
        }))
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        )
    }

    if (!config) {
        return (
            <div className="text-center py-12 text-white/30">
                <p className="text-xs font-bold uppercase tracking-wider">Konfigurace nebyla nalezena</p>
            </div>
        )
    }

    return (
        <div className="space-y-8 pb-12">
            {/* Sticky header */}
            <div className="flex items-center justify-between bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-sm p-6 shadow-sm sticky top-0 z-10">
                <div>
                    <h2 className="text-lg font-black uppercase tracking-tight text-white">Nastavení</h2>
                    <p className="text-white/50 text-xs mt-1 tracking-wide">Brand Voice a vizuální identita — {config.name}</p>
                </div>
                <div className="flex items-center gap-4">
                    {message && (
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {message.text}
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 px-6 py-2.5 rounded-sm text-xs font-black uppercase tracking-widest transition-all shadow-sm disabled:opacity-50"
                    >
                        {saving ? "Ukládám..." : "💾 Uložit"}
                    </button>
                </div>
            </div>

            {/* ── Základní informace ── */}
            <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70 border-b border-white/10 pb-2 mb-4">Základní Informace</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Název klienta</label>
                        <input value={config.name || ""} onChange={(e) => updateField(["name"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all" />
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Web</label>
                        <input value={config.website || ""} onChange={(e) => updateField(["website"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all" />
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Instagram Handle</label>
                        <input value={config.instagram || ""} onChange={(e) => updateField(["instagram"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all" />
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">O čem tvoříme obsah</label>
                        <input value={config.contentFocus || ""} onChange={(e) => updateField(["contentFocus"], e.target.value)}
                            placeholder="Např. O penzionu a cestování do přírody"
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all" />
                    </div>
                </div>
            </div>

            {/* ── Brand Voice ── */}
            <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70 border-b border-white/10 pb-2 mb-4">Brand Voice</h3>

                <div>
                    <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Persona — kdo jsme, jak mluvíme</label>
                    <textarea value={config.brandVoice?.persona || ""} onChange={(e) => updateField(["brandVoice", "persona"], e.target.value)}
                        rows={3} className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all resize-y" />
                </div>

                <div>
                    <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Tón komunikace — oddělené čárkou</label>
                    <input value={(config.brandVoice?.voiceTraits || []).join(", ")}
                        onChange={(e) => updateArrayField(["brandVoice", "voiceTraits"], e.target.value)}
                        placeholder="Např. Přátelský, Neformální, Nápomocný"
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all" />
                </div>

                <div>
                    <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Slova a fráze které NEPOUŽÍVÁME — oddělené čárkou</label>
                    <input value={(config.brandVoice?.antiPatterns || []).join(", ")}
                        onChange={(e) => updateArrayField(["brandVoice", "antiPatterns"], e.target.value)}
                        placeholder="Např. Ahoj lidi, Korporátní jazyk"
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all" />
                </div>
            </div>

            {/* ── Vizuální identita & Overlay ── */}
            <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-6">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70 border-b border-white/10 pb-2 mb-4">Vizuální Identita & Overlay</h3>

                {/* AI popis */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Atmosféra & Styl fotek <span className="text-white/20">(pro AI)</span></label>
                        <input value={config.feedAesthetic?.feel || ""} onChange={(e) => updateField(["feedAesthetic", "feel"], e.target.value)}
                            placeholder="Např. Přírodní, hřejivý, denní světlo, rustikální"
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all" />
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Font přes obrázky</label>
                        <select value={config.feedAesthetic?.fontOverride || "Inter"}
                            onChange={(e) => updateField(["feedAesthetic", "fontOverride"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all">
                            <option value="Inter">Inter — moderní, čistý</option>
                            <option value="BebasNeue">Bebas Neue — streetwear, bold</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Styl overlay</label>
                        <select value={config.defaultFormat?.overlayStyle || "default"}
                            onChange={(e) => setConfig((prev: any) => ({ ...prev, defaultFormat: { ...(prev.defaultFormat || {}), overlayStyle: e.target.value } }))}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all">
                            <option value="default">Default — text dole</option>
                            <option value="cover">Cover — velký text, silnější gradient</option>
                            <option value="minimal">Minimal — žádný gradient</option>
                            <option value="none">None — bez overlay</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1 block">Logo soubor</label>
                        <p className="text-[9px] text-white/20 mb-1.5">PNG ve složce <code className="text-white/30">instagram/assets/</code></p>
                        <input value={config.logoFile || ""} onChange={(e) => updateField(["logoFile"], e.target.value)}
                            placeholder="logo-nazevklienta.png"
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-white/30 transition-all" />
                    </div>
                </div>

                {/* Gradient barvy */}
                <div className="pt-4 border-t border-white/5">
                    <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-3 block">Barvy gradientu (pozadí textu na obrázcích)</label>
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { key: "topColor", label: "Vrchní" },
                            { key: "midColor", label: "Střední" },
                            { key: "bottomColor", label: "Spodní" },
                        ].map(({ key, label }) => (
                            <div key={key}>
                                <label className="text-[8px] text-white/30 mb-1 block uppercase tracking-widest">{label}</label>
                                <div className="flex gap-2 items-center">
                                    <input type="color"
                                        value={(config.overlayGradient as any)?.[key] || "#111111"}
                                        onChange={(e) => setGradientKey(key, e.target.value)}
                                        className="w-10 h-10 rounded cursor-pointer border border-white/10 bg-transparent" />
                                    <input value={(config.overlayGradient as any)?.[key] || "#111111"}
                                        onChange={(e) => setGradientKey(key, e.target.value)}
                                        className="flex-1 px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-white/30" />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Live preview */}
                    <div className="mt-3 h-14 rounded-sm border border-white/10 overflow-hidden"
                        style={{ background: `linear-gradient(to bottom, ${config.overlayGradient?.topColor || "#111111"}26, ${config.overlayGradient?.midColor || "#111111"}4D, ${config.overlayGradient?.bottomColor || "#111111"}E6)` }}>
                        <div className="flex items-end h-full px-4 pb-3">
                            <span className={`text-white text-sm font-bold ${config.feedAesthetic?.fontOverride === "BebasNeue" ? "uppercase tracking-widest text-base" : ""}`}>
                                {config.name || "Náhled textu"}
                            </span>
                        </div>
                    </div>
                </div>
            </div>


            {/* ── Správa klienta ── */}
            <ClientManagementSection projectId={projectId} config={config} setConfig={setConfig} onReload={loadData} />

            <div className="text-center text-white/20 text-[10px] tracking-widest uppercase">
                Obsahové pilíře a Post Formáty lze měnit přes JSON konfiguraci v DB.
            </div>
        </div>
    )
}


// ─── Client Management (Rescan + Delete) ────────────────────────────

function ClientManagementSection({ projectId, config, setConfig, onReload }: {
    projectId: string
    config: any
    setConfig: (fn: (prev: any) => any) => void
    onReload: () => void
}) {
    const router = useRouter()
    const [rescanning, setRescanning] = useState(false)
    const [rescanResult, setRescanResult] = useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [deleting, setDeleting] = useState(false)

    const handleRescan = async () => {
        setRescanning(true)
        setRescanResult(null)
        const result = await rescanClientWebsite(projectId)
        if (result.success) {
            const parts = []
            if (result.foundUrls > 0) parts.push(`nalezeno ${result.foundUrls} URL na webu`)
            parts.push(`${result.existingImages} existujících fotek`)
            parts.push(`${result.newImages} nových staženo`)
            setRescanResult(`✅ ${parts.join(' · ')}`)
            onReload() // always reload to sync UI
        } else {
            setRescanResult(`❌ ${result.error}`)
        }
        setRescanning(false)
    }

    const handleDelete = async () => {
        setDeleting(true)
        const result = await deleteClient(projectId)
        if (result.success) {
            router.push("/dashboard/instagram")
        } else {
            setDeleting(false)
            setConfirmDelete(false)
            alert(`Smazání se nezdařilo: ${result.error}`)
        }
    }

    return (
        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
            <div className="border-b border-white/10 pb-2 mb-2">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70">
                    Správa klienta
                </h3>
            </div>

            {/* Re-scan */}
            <div className="flex items-center justify-between gap-4">
                <div>
                    <p className="text-xs text-white/60 font-bold">Re-skenovat web</p>
                    <p className="text-[9px] text-white/30 mt-0.5">
                        Znovu projde {config?.website || "web"} a stáhne nové fotky
                    </p>
                </div>
                <button
                    onClick={handleRescan}
                    disabled={rescanning}
                    className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/20 disabled:opacity-50 whitespace-nowrap"
                >
                    {rescanning ? "Skenuji…" : "🔍 Skenovat"}
                </button>
            </div>
            {rescanResult && (
                <p className="text-[10px] text-white/50 bg-white/5 rounded-sm px-3 py-2">{rescanResult}</p>
            )}

            {/* Danger zone */}
            <div className="border-t border-red-500/10 pt-4 mt-4">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs text-red-400/70 font-bold">Smazat klienta</p>
                        <p className="text-[9px] text-white/30 mt-0.5">
                            Odstraní klienta, všechny příspěvky i uložené fotky. Nelze vrátit!
                        </p>
                    </div>
                    {!confirmDelete ? (
                        <button
                            onClick={() => setConfirmDelete(true)}
                            className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all border border-red-500/10 hover:border-red-500/20 whitespace-nowrap"
                        >
                            🗑️ Smazat
                        </button>
                    ) : (
                        <div className="flex gap-2">
                            <button
                                onClick={() => setConfirmDelete(false)}
                                disabled={deleting}
                                className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm text-white/40 bg-white/5 hover:bg-white/10 border border-white/10 whitespace-nowrap"
                            >
                                Zrušit
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-red-600/30 text-red-400 border border-red-500/30 hover:bg-red-600/50 transition-all whitespace-nowrap disabled:opacity-50"
                            >
                                {deleting ? "Mažu…" : "⚠️ Opravdu smazat"}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
