"use client"

import { useEffect, useState, useCallback } from "react"
import { getClientConfig, updateClientConfig } from "@/app/actions/admin-actions"

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

    useEffect(() => {
        loadData()
    }, [loadData])

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
            <div className="flex items-center justify-between bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-sm p-6 shadow-sm sticky top-0 z-10">
                <div>
                    <h2 className="text-lg font-black uppercase tracking-tight text-white">Nastavení Profilu</h2>
                    <p className="text-white/50 text-xs mt-1 tracking-wide">
                        Upravuj Brand Voice a vizuální identitu pro {config.name}.
                    </p>
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

            {/* Základní Info */}
            <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70 border-b border-white/10 pb-2 mb-4">Základní Informace</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Název klienta</label>
                        <input
                            value={config.name || ""}
                            onChange={(e) => updateField(["name"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                        />
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Web</label>
                        <input
                            value={config.website || ""}
                            onChange={(e) => updateField(["website"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                        />
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Instagram Handle</label>
                        <input
                            value={config.instagram || ""}
                            onChange={(e) => updateField(["instagram"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                        />
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Zaměření obsahu (Content Focus)</label>
                        <input
                            value={config.contentFocus || ""}
                            onChange={(e) => updateField(["contentFocus"], e.target.value)}
                            placeholder="Např. O TELEFONECH a screen time"
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Brand Voice */}
            <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70 border-b border-white/10 pb-2 mb-4">Brand Voice</h3>
                
                <div>
                    <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Persona</label>
                    <textarea
                        value={config.brandVoice?.persona || ""}
                        onChange={(e) => updateField(["brandVoice", "persona"], e.target.value)}
                        rows={3}
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all resize-y"
                    />
                </div>
                
                <div>
                    <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Tón komunikace (Voice Traits) — oddělené čárkou</label>
                    <input
                        value={(config.brandVoice?.voiceTraits || []).join(", ")}
                        onChange={(e) => updateArrayField(["brandVoice", "voiceTraits"], e.target.value)}
                        placeholder="Např. Přátelský, Moderní, Rychlý"
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                    />
                </div>

                <div>
                    <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Zakázaná slova (Anti-patterns) — oddělené čárkou</label>
                    <input
                        value={(config.brandVoice?.antiPatterns || []).join(", ")}
                        onChange={(e) => updateArrayField(["brandVoice", "antiPatterns"], e.target.value)}
                        placeholder="Např. Ahoj lidi, Zdravím"
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                    />
                </div>
            </div>

            {/* Vizuální identita */}
            <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70 border-b border-white/10 pb-2 mb-4">Vizuální identita (Aesthetic)</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Paleta barev</label>
                        <input
                            value={config.feedAesthetic?.colorPalette || ""}
                            onChange={(e) => updateField(["feedAesthetic", "colorPalette"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                        />
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Font</label>
                        <input
                            value={config.feedAesthetic?.font || ""}
                            onChange={(e) => updateField(["feedAesthetic", "font"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                        />
                    </div>
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Celkový vzhled (Feel)</label>
                        <input
                            value={config.feedAesthetic?.feel || ""}
                            onChange={(e) => updateField(["feedAesthetic", "feel"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                        />
                    </div>
                </div>

                <div className="mt-4 pt-4 border-t border-white/5">
                    <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Logo File (název souboru ve složce instagram/assets/)</label>
                    <input
                        value={config.logoFile || ""}
                        onChange={(e) => updateField(["logoFile"], e.target.value)}
                        className="w-full md:w-1/2 px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                    />
                </div>
            </div>
            
            {/* Overlay nastavení */}
            <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70 border-b border-white/10 pb-2 mb-4">Overlay & Typografie</h3>
                <p className="text-[9px] text-white/30 uppercase tracking-widest -mt-2">Nastavení textu a gradientu na generovaných obrázcích</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Font Override */}
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Font přes obrázky</label>
                        <select
                            value={config.feedAesthetic?.fontOverride || "Inter"}
                            onChange={(e) => updateField(["feedAesthetic", "fontOverride"], e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                        >
                            <option value="Inter">Inter — moderní, čistý</option>
                            <option value="BebasNeue">Bebas Neue — streetwear, bold</option>
                        </select>
                    </div>

                    {/* Overlay style */}
                    <div>
                        <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Výchozí styl overlay</label>
                        <select
                            value={config.defaultFormat?.overlayStyle || "default"}
                            onChange={(e) => {
                                setConfig((prev: any) => ({
                                    ...prev,
                                    defaultFormat: { ...(prev.defaultFormat || {}), overlayStyle: e.target.value }
                                }))
                            }}
                            className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
                        >
                            <option value="default">Default — text dole</option>
                            <option value="cover">Cover — velký text, silnější gradient</option>
                            <option value="minimal">Minimal — žádný gradient</option>
                            <option value="none">None — bez overlay</option>
                        </select>
                    </div>
                </div>

                {/* Gradient colors */}
                <div>
                    <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-3 block">Gradient overlay (barvy pozadí textu)</label>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="text-[8px] text-white/30 mb-1 block uppercase tracking-widest">Vrchní barva</label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="color"
                                    value={config.overlayGradient?.topColor || "#111111"}
                                    onChange={(e) => {
                                        setConfig((prev: any) => ({
                                            ...prev,
                                            overlayGradient: { ...(prev.overlayGradient || {}), topColor: e.target.value }
                                        }))
                                    }}
                                    className="w-10 h-10 rounded cursor-pointer border border-white/10 bg-transparent"
                                />
                                <input
                                    value={config.overlayGradient?.topColor || "#111111"}
                                    onChange={(e) => {
                                        setConfig((prev: any) => ({
                                            ...prev,
                                            overlayGradient: { ...(prev.overlayGradient || {}), topColor: e.target.value }
                                        }))
                                    }}
                                    className="flex-1 px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-white/30"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-[8px] text-white/30 mb-1 block uppercase tracking-widest">Střední barva</label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="color"
                                    value={config.overlayGradient?.midColor || "#111111"}
                                    onChange={(e) => {
                                        setConfig((prev: any) => ({
                                            ...prev,
                                            overlayGradient: { ...(prev.overlayGradient || {}), midColor: e.target.value }
                                        }))
                                    }}
                                    className="w-10 h-10 rounded cursor-pointer border border-white/10 bg-transparent"
                                />
                                <input
                                    value={config.overlayGradient?.midColor || "#111111"}
                                    onChange={(e) => {
                                        setConfig((prev: any) => ({
                                            ...prev,
                                            overlayGradient: { ...(prev.overlayGradient || {}), midColor: e.target.value }
                                        }))
                                    }}
                                    className="flex-1 px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-white/30"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-[8px] text-white/30 mb-1 block uppercase tracking-widest">Spodní barva</label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="color"
                                    value={config.overlayGradient?.bottomColor || "#111111"}
                                    onChange={(e) => {
                                        setConfig((prev: any) => ({
                                            ...prev,
                                            overlayGradient: { ...(prev.overlayGradient || {}), bottomColor: e.target.value }
                                        }))
                                    }}
                                    className="w-10 h-10 rounded cursor-pointer border border-white/10 bg-transparent"
                                />
                                <input
                                    value={config.overlayGradient?.bottomColor || "#111111"}
                                    onChange={(e) => {
                                        setConfig((prev: any) => ({
                                            ...prev,
                                            overlayGradient: { ...(prev.overlayGradient || {}), bottomColor: e.target.value }
                                        }))
                                    }}
                                    className="flex-1 px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-white/30"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Live gradient preview */}
                    <div
                        className="mt-3 h-12 rounded-sm border border-white/10"
                        style={{
                            background: `linear-gradient(to bottom, ${config.overlayGradient?.topColor || "#111111"}26, ${config.overlayGradient?.midColor || "#111111"}4D, ${config.overlayGradient?.bottomColor || "#111111"}E6)`
                        }}
                    >
                        <div className="flex items-end h-full px-3 pb-2">
                            <span className={`text-white text-xs font-bold ${config.feedAesthetic?.fontOverride === "BebasNeue" ? "uppercase tracking-widest" : ""}`}>
                                {config.feedAesthetic?.fontOverride === "BebasNeue" ? "NÁHLED TEXTU — BEBAS NEUE" : "Náhled textu — Inter Bold"}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="text-center text-white/20 text-[10px] tracking-widest uppercase">
                Obsahové pilíře a Post Formáty lze aktuálně měnit pouze v JSON konfiguraci.
            </div>

        </div>
    )
}
