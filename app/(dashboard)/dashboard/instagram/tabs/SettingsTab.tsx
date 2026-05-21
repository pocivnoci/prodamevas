"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { getClientConfig, updateClientConfig, rescanClientWebsite, deleteClient, uploadClientLogo, getProducts, createProduct, updateProduct, deleteProduct, uploadProductImage, syncConfigProductsToDb, scrapeProductsFromWebsite } from "@/app/actions/admin-actions"
import { SubscriptionSection } from "./SubscriptionSection"

// ═══════════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════

export function SettingsTab({ projectId }: { projectId: string }) {
    const [config, setConfig] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [logoUploading, setLogoUploading] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
    const [activeSection, setActiveSection] = useState<string>("basic")

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

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setLogoUploading(true)
        setMessage(null)
        const fd = new FormData()
        fd.append('file', file)
        const result = await uploadClientLogo(projectId, fd)
        if (result.success) {
            setMessage({ type: 'success', text: 'Logo nahráno. Refresh stránky pro zobrazení.' })
            await loadData()
        } else {
            setMessage({ type: 'error', text: result.error || 'Upload loga selhal.' })
        }
        setLogoUploading(false)
        e.target.value = ''
    }

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

    const updateField = (fieldPath: string[], value: any) => {
        setConfig((prev: any) => {
            const next = { ...prev }
            if (fieldPath.length === 1) {
                next[fieldPath[0]] = value
            } else if (fieldPath.length === 2) {
                if (!next[fieldPath[0]]) next[fieldPath[0]] = {}
                next[fieldPath[0]] = { ...next[fieldPath[0]], [fieldPath[1]]: value }
            } else if (fieldPath.length === 3) {
                if (!next[fieldPath[0]]) next[fieldPath[0]] = {}
                if (!next[fieldPath[0]][fieldPath[1]]) next[fieldPath[0]][fieldPath[1]] = {}
                next[fieldPath[0]] = {
                    ...next[fieldPath[0]],
                    [fieldPath[1]]: {
                        ...next[fieldPath[0]][fieldPath[1]],
                        [fieldPath[2]]: value
                    }
                }
            }
            return next
        })
    }

    const updateArrayField = (fieldPath: string[], value: string) => {
        const arr = value.split(',').map(s => s.trim()).filter(Boolean)
        updateField(fieldPath, arr)
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

    const TABS = [
        { id: "basic", label: "Základní", icon: "📋" },
        { id: "voice", label: "Brand Voice", icon: "🎤" },
        { id: "pillars", label: "Pilíře", icon: "🏛️" },
        { id: "audience", label: "Publikum", icon: "👥" },
        { id: "products", label: "Produkty", icon: "🛍️" },
        { id: "visual", label: "Vizuál", icon: "🎨" },
        { id: "hashtags", label: "Hashtagy", icon: "#️⃣" },
        { id: "cta", label: "CTA", icon: "📣" },
        { id: "manage", label: "Správa", icon: "⚙️" },
    ]

    return (
        <div className="space-y-6 pb-12">
            {/* Sticky header */}
            <div className="flex items-center justify-between bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-sm p-5 shadow-sm sticky top-0 z-10">
                <div>
                    <h2 className="text-lg font-black uppercase tracking-tight text-white">Nastavení</h2>
                    <p className="text-white/50 text-xs mt-1 tracking-wide">{config.name}</p>
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

            {/* Subscription */}
            <SubscriptionSection projectId={projectId} />

            {/* Tab navigation */}
            <div className="flex flex-wrap gap-1 bg-[#0a0a0a]/60 border border-white/10 rounded-sm p-1.5">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveSection(tab.id)}
                        className={`relative px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all duration-200 ${
                            activeSection === tab.id
                                ? "text-white"
                                : "text-white/40 hover:text-white/70"
                        }`}
                    >
                        {activeSection === tab.id && (
                            <motion.div
                                layoutId="settingsTab"
                                className="absolute inset-0 bg-white/10 border border-white/10 rounded-sm"
                                initial={false}
                                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                            />
                        )}
                        <span className="relative z-10 flex items-center gap-2">
                            <span>{tab.icon}</span>
                            <span className="hidden sm:inline">{tab.label}</span>
                        </span>
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeSection}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                >
                    {activeSection === "basic" && (
                        <BasicSection config={config} updateField={updateField} />
                    )}
                    {activeSection === "voice" && (
                        <VoiceSection config={config} updateField={updateField} updateArrayField={updateArrayField} />
                    )}
                    {activeSection === "pillars" && (
                        <PillarsSection config={config} setConfig={setConfig} />
                    )}
                    {activeSection === "audience" && (
                        <AudienceSection config={config} setConfig={setConfig} />
                    )}
                    {activeSection === "products" && (
                        <ProductCatalogSection projectId={projectId} />
                    )}
                    {activeSection === "visual" && (
                        <VisualSection config={config} updateField={updateField} setGradientKey={setGradientKey} handleLogoUpload={handleLogoUpload} logoUploading={logoUploading} projectId={projectId} setConfig={setConfig} />
                    )}
                    {activeSection === "hashtags" && (
                        <HashtagsSection config={config} updateArrayField={updateArrayField} />
                    )}
                    {activeSection === "cta" && (
                        <CTASection config={config} setConfig={setConfig} />
                    )}
                    {activeSection === "manage" && (
                        <ClientManagementSection projectId={projectId} config={config} setConfig={setConfig} onReload={loadData} />
                    )}
                </motion.div>
            </AnimatePresence>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// SHARED UI HELPERS
// ═══════════════════════════════════════════════════════════

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return (
        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-5">
            <div className="border-b border-white/10 pb-3 mb-2">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70">{title}</h3>
                {description && <p className="text-[10px] text-white/30 mt-1 font-medium">{description}</p>}
            </div>
            {children}
        </div>
    )
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
    return (
        <div className="mb-1.5">
            <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 block">{children}</label>
            {hint && <p className="text-[8px] text-white/20 mt-0.5">{hint}</p>}
        </div>
    )
}

const inputClass = "w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30 transition-all"
const textareaClass = `${inputClass} resize-y`

// ═══════════════════════════════════════════════════════════
// 1. BASIC INFO
// ═══════════════════════════════════════════════════════════

function BasicSection({ config, updateField }: { config: any; updateField: (p: string[], v: any) => void }) {
    return (
        <SectionCard title="Základní Informace" description="Identita vaší značky a kontaktní údaje">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <FieldLabel>Název klienta</FieldLabel>
                    <input value={config.name || ""} onChange={(e) => updateField(["name"], e.target.value)} className={inputClass} />
                </div>
                <div>
                    <FieldLabel>Web</FieldLabel>
                    <input value={config.website || ""} onChange={(e) => updateField(["website"], e.target.value)} className={inputClass} />
                </div>
                <div>
                    <FieldLabel>Instagram Handle</FieldLabel>
                    <input value={config.instagram || ""} onChange={(e) => updateField(["instagram"], e.target.value)} placeholder="@handle" className={inputClass} />
                </div>
                <div>
                    <FieldLabel hint="Krátký popis zaměření obsahu">O čem tvoříme obsah</FieldLabel>
                    <input value={config.contentFocus || ""} onChange={(e) => updateField(["contentFocus"], e.target.value)}
                        placeholder="Např. O penzionu a cestování do přírody" className={inputClass} />
                </div>
            </div>
            <div>
                <FieldLabel hint="Popis hlavní postavy pro konzistentní vizuál v AI obrázcích">Popis postavy (Character Description)</FieldLabel>
                <textarea value={config.characterDescription || ""} onChange={(e) => updateField(["characterDescription"], e.target.value)}
                    rows={3} placeholder="Např. Muž 35 let, tmavé vlasy, vousy, nosí flanelovou košili..." className={textareaClass} />
            </div>
        </SectionCard>
    )
}

// ═══════════════════════════════════════════════════════════
// 2. BRAND VOICE
// ═══════════════════════════════════════════════════════════

function VoiceSection({ config, updateField, updateArrayField }: {
    config: any
    updateField: (p: string[], v: any) => void
    updateArrayField: (p: string[], v: string) => void
}) {
    const voice = config.brandVoice || {}

    return (
        <div className="space-y-6">
            <SectionCard title="Persona & Tón" description="Jak vaše značka mluví — co AI říká a jak to říká">
                <div>
                    <FieldLabel hint="Detailní popis kdo jsme, jak mluvíme, jaký máme přístup k zákazníkům">Persona — kdo jsme, jak mluvíme</FieldLabel>
                    <textarea value={voice.persona || ""} onChange={(e) => updateField(["brandVoice", "persona"], e.target.value)}
                        rows={4} placeholder="Jsme přátelský penzion uprostřed přírody. Mluvíme jako kamarád, co doporučuje svůj oblíbený kout..." className={textareaClass} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <FieldLabel hint="Oddělené čárkou — určují styl textu">Tón komunikace (Voice Traits)</FieldLabel>
                        <input value={(voice.voiceTraits || []).join(", ")}
                            onChange={(e) => updateArrayField(["brandVoice", "voiceTraits"], e.target.value)}
                            placeholder="Přátelský, Neformální, Nápomocný, Vtipný" className={inputClass} />
                        {/* Tag preview */}
                        {voice.voiceTraits?.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {voice.voiceTraits.map((t: string, i: number) => (
                                    <span key={i} className="px-2 py-1 bg-white/5 border border-white/10 rounded-sm text-[9px] text-white/50 font-bold uppercase tracking-wider">{t}</span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div>
                        <FieldLabel hint="Oddělené čárkou — core values značky">Hodnoty značky (Values)</FieldLabel>
                        <input value={(voice.values || []).join(", ")}
                            onChange={(e) => updateArrayField(["brandVoice", "values"], e.target.value)}
                            placeholder="Autenticita, Kvalita, Příroda" className={inputClass} />
                        {voice.values?.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {voice.values.map((v: string, i: number) => (
                                    <span key={i} className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-sm text-[9px] text-emerald-400/70 font-bold uppercase tracking-wider">{v}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <FieldLabel hint="Oddělené čárkou — slova a fráze, které AI nikdy nepoužije">Anti-Patterns — co NEŘÍKÁME</FieldLabel>
                    <input value={(voice.antiPatterns || []).join(", ")}
                        onChange={(e) => updateArrayField(["brandVoice", "antiPatterns"], e.target.value)}
                        placeholder="Ahoj lidi, Kupte si, Korporátní jazyk, Slevový nátlak" className={inputClass} />
                    {voice.antiPatterns?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {voice.antiPatterns.map((a: string, i: number) => (
                                <span key={i} className="px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-sm text-[9px] text-red-400/70 font-bold uppercase tracking-wider">🚫 {a}</span>
                            ))}
                        </div>
                    )}
                </div>
            </SectionCard>

            <SectionCard title="CTA Variace" description="Výzvy k akci které AI používá v příspěvcích">
                <div>
                    <FieldLabel hint="Oddělené čárkou — AI si vybírá podle kontextu">CTA fráze</FieldLabel>
                    <textarea value={(voice.ctaVariations || []).join("\n")}
                        onChange={(e) => updateField(["brandVoice", "ctaVariations"], e.target.value.split("\n").map((s: string) => s.trim()).filter(Boolean))}
                        rows={4} placeholder="Odkaz v bio 👆\nNapiš nám DM\nVíce na webu 🔗\nUlož si na později 📌" className={textareaClass} />
                    <p className="text-[8px] text-white/20 mt-1">Každá variace na novém řádku</p>
                </div>
            </SectionCard>

            <SectionCard title="Hook Templates" description="Vzory pro úvodní věty — {{topic}} se nahradí automaticky">
                <HookTemplatesEditor config={config} updateField={updateField} />
            </SectionCard>
        </div>
    )
}

// Hook templates sub-editor
function HookTemplatesEditor({ config, updateField }: { config: any; updateField: (p: string[], v: any) => void }) {
    const templates = config.brandVoice?.hookTemplates || []
    const TRIGGERS = ["curiosity", "fear", "hope", "humor", "urgency", "empathy"] as const
    const TRIGGER_LABELS: Record<string, { label: string; emoji: string }> = {
        curiosity: { label: "Zvědavost", emoji: "🤔" },
        fear: { label: "Obava", emoji: "😰" },
        hope: { label: "Naděje", emoji: "✨" },
        humor: { label: "Humor", emoji: "😄" },
        urgency: { label: "Urgence", emoji: "⚡" },
        empathy: { label: "Empatie", emoji: "💛" },
    }

    const addTemplate = () => {
        const next = [...templates, { pattern: "", example: "", bestFor: [], trigger: "curiosity" }]
        updateField(["brandVoice", "hookTemplates"], next)
    }

    const updateTemplate = (idx: number, key: string, value: any) => {
        const next = templates.map((t: any, i: number) => i === idx ? { ...t, [key]: value } : t)
        updateField(["brandVoice", "hookTemplates"], next)
    }

    const removeTemplate = (idx: number) => {
        updateField(["brandVoice", "hookTemplates"], templates.filter((_: any, i: number) => i !== idx))
    }

    return (
        <div className="space-y-4">
            {templates.length === 0 && (
                <p className="text-[10px] text-white/30 text-center py-4">Žádné hook templates. Přidejte první vzor pro lepší AI texty.</p>
            )}
            {templates.map((t: any, idx: number) => (
                <div key={idx} className="bg-[#050505] border border-white/10 rounded-sm p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">Hook #{idx + 1}</span>
                        <button onClick={() => removeTemplate(idx)} className="text-[9px] text-red-400/50 hover:text-red-400 transition-colors">✕ Smazat</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <FieldLabel hint="Vzor s {{topic}} zástupcem">Pattern</FieldLabel>
                            <input value={t.pattern || ""} onChange={(e) => updateTemplate(idx, "pattern", e.target.value)}
                                placeholder="Věděli jste, že {{topic}}?" className={inputClass} />
                        </div>
                        <div>
                            <FieldLabel>Příklad</FieldLabel>
                            <input value={t.example || ""} onChange={(e) => updateTemplate(idx, "example", e.target.value)}
                                placeholder="Věděli jste, že 73% lidí..." className={inputClass} />
                        </div>
                    </div>
                    <div>
                        <FieldLabel>Emocionální trigger</FieldLabel>
                        <div className="flex flex-wrap gap-1.5">
                            {TRIGGERS.map(tr => (
                                <button key={tr} onClick={() => updateTemplate(idx, "trigger", tr)}
                                    className={`px-3 py-1.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border transition-all ${
                                        t.trigger === tr
                                            ? "bg-white/10 border-white/20 text-white"
                                            : "border-white/5 text-white/30 hover:text-white/60"
                                    }`}>
                                    {TRIGGER_LABELS[tr].emoji} {TRIGGER_LABELS[tr].label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            ))}
            <button onClick={addTemplate}
                className="w-full py-3 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                + Přidat hook template
            </button>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// 3. CONTENT PILLARS
// ═══════════════════════════════════════════════════════════

function PillarsSection({ config, setConfig }: { config: any; setConfig: (fn: any) => void }) {
    const pillars: Record<string, any> = config.contentPillars || {}
    const pillarEntries = Object.entries(pillars)

    const updatePillar = (key: string, field: string, value: any) => {
        setConfig((prev: any) => ({
            ...prev,
            contentPillars: {
                ...prev.contentPillars,
                [key]: { ...(prev.contentPillars?.[key] || {}), [field]: value }
            }
        }))
    }

    const addPillar = () => {
        const id = `pillar_${Date.now()}`
        setConfig((prev: any) => ({
            ...prev,
            contentPillars: {
                ...prev.contentPillars,
                [id]: { emoji: "📝", label: "Nový pilíř", description: "", postTypes: [], ratio: 0.2, ctaStrategy: "soft", kpi: [] }
            }
        }))
    }

    const removePillar = (key: string) => {
        setConfig((prev: any) => {
            const next = { ...prev.contentPillars }
            delete next[key]
            return { ...prev, contentPillars: next }
        })
    }

    const CTA_OPTIONS = [
        { value: "none", label: "Žádné CTA", color: "text-white/30" },
        { value: "soft", label: "Soft", color: "text-blue-400" },
        { value: "medium", label: "Medium", color: "text-amber-400" },
        { value: "hard", label: "Hard sell", color: "text-red-400" },
    ]

    // Total ratio
    const totalRatio = pillarEntries.reduce((sum, [, p]) => sum + ((p as any).ratio || 0), 0)

    return (
        <div className="space-y-6">
            <SectionCard title="Content Pilíře" description="Tematické pilíře definují mix vašeho obsahu. Každý pilíř má poměr (ratio) — celkový součet by měl být ~1.0">
                {/* Ratio bar */}
                {pillarEntries.length > 0 && (
                    <div className="space-y-2">
                        <div className="flex h-3 rounded-sm overflow-hidden border border-white/10">
                            {pillarEntries.map(([key, p]: [string, any]) => {
                                const pct = totalRatio > 0 ? ((p.ratio || 0) / totalRatio * 100) : 0
                                return (
                                    <div key={key} className="h-full transition-all duration-300" style={{
                                        width: `${pct}%`,
                                        backgroundColor: `hsl(${(Object.keys(pillars).indexOf(key) * 60) % 360}, 50%, 45%)`
                                    }} title={`${p.label}: ${Math.round(pct)}%`} />
                                )
                            })}
                        </div>
                        <div className="flex justify-between text-[8px] text-white/20 font-bold">
                            <span>Součet ratios: {totalRatio.toFixed(2)}</span>
                            <span className={totalRatio > 0.95 && totalRatio < 1.05 ? "text-emerald-400" : "text-amber-400"}>
                                {totalRatio > 0.95 && totalRatio < 1.05 ? "✅ OK" : "⚠️ Měl by být ~1.0"}
                            </span>
                        </div>
                    </div>
                )}
            </SectionCard>

            {pillarEntries.map(([key, pillar]: [string, any]) => (
                <div key={key} className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <div className="flex items-center gap-3">
                            <input value={pillar.emoji || "📝"} onChange={(e) => updatePillar(key, "emoji", e.target.value)}
                                className="w-12 h-12 text-center text-2xl bg-[#050505] border border-white/10 rounded-sm focus:outline-none focus:ring-1 focus:ring-white/30" />
                            <div>
                                <input value={pillar.label || ""} onChange={(e) => updatePillar(key, "label", e.target.value)}
                                    className="bg-transparent text-white font-black uppercase tracking-tight text-sm border-none focus:outline-none w-48" placeholder="Název pilíře" />
                                <p className="text-[8px] text-white/20 font-mono">{key}</p>
                            </div>
                        </div>
                        <button onClick={() => removePillar(key)} className="text-[9px] text-red-400/40 hover:text-red-400 transition-colors font-bold uppercase tracking-widest">
                            🗑️ Smazat
                        </button>
                    </div>

                    <div>
                        <FieldLabel>Popis</FieldLabel>
                        <textarea value={pillar.description || ""} onChange={(e) => updatePillar(key, "description", e.target.value)}
                            rows={2} placeholder="Co tento pilíř pokrývá, jaké téma..." className={textareaClass} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <FieldLabel hint="Poměr obsahu (0.0–1.0)">Ratio</FieldLabel>
                            <div className="flex items-center gap-3">
                                <input type="range" min="0" max="1" step="0.05" value={pillar.ratio || 0}
                                    onChange={(e) => updatePillar(key, "ratio", parseFloat(e.target.value))}
                                    className="flex-1 accent-aisummit-cinnabar" />
                                <span className="text-xs text-white/60 font-bold w-12 text-right">{((pillar.ratio || 0) * 100).toFixed(0)}%</span>
                            </div>
                        </div>
                        <div>
                            <FieldLabel>CTA Strategie</FieldLabel>
                            <div className="flex gap-1.5">
                                {CTA_OPTIONS.map(opt => (
                                    <button key={opt.value} onClick={() => updatePillar(key, "ctaStrategy", opt.value)}
                                        className={`px-3 py-1.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border transition-all ${
                                            pillar.ctaStrategy === opt.value
                                                ? `bg-white/10 border-white/20 ${opt.color}`
                                                : "border-white/5 text-white/30 hover:text-white/60"
                                        }`}>
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <FieldLabel hint="Oddělené čárkou">KPI k optimalizaci</FieldLabel>
                            <input value={(pillar.kpi || []).join(", ")}
                                onChange={(e) => updatePillar(key, "kpi", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                                placeholder="engagement, saves, reach" className={inputClass} />
                        </div>
                    </div>

                    <div>
                        <FieldLabel hint="Oddělené čárkou — jaké typy postů patří pod tento pilíř">Post Types</FieldLabel>
                        <input value={(pillar.postTypes || []).join(", ")}
                            onChange={(e) => updatePillar(key, "postTypes", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                            placeholder="tip_nastaveni, statistika, hack" className={inputClass} />
                    </div>

                    <div>
                        <FieldLabel hint="Specifické instrukce pro AI při generování nápadů v tomto pilíři">Idea Prompt (pro AI)</FieldLabel>
                        <textarea value={pillar.ideaPrompt || ""} onChange={(e) => updatePillar(key, "ideaPrompt", e.target.value)}
                            rows={2} placeholder="Zaměř se na praktické tipy, používej čísla a statistiky..." className={textareaClass} />
                    </div>
                </div>
            ))}

            <button onClick={addPillar}
                className="w-full py-4 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                + Přidat nový pilíř
            </button>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// 4. AUDIENCE PERSONAS
// ═══════════════════════════════════════════════════════════

function AudienceSection({ config, setConfig }: { config: any; setConfig: (fn: any) => void }) {
    const personas: any[] = config.audiencePersonas || []

    const updatePersona = (idx: number, field: string, value: any) => {
        setConfig((prev: any) => ({
            ...prev,
            audiencePersonas: (prev.audiencePersonas || []).map((p: any, i: number) =>
                i === idx ? { ...p, [field]: value } : p
            )
        }))
    }

    const addPersona = () => {
        setConfig((prev: any) => ({
            ...prev,
            audiencePersonas: [...(prev.audiencePersonas || []), {
                label: "Nová persona", ageRange: "25-35", painPoints: [], triggers: [], ctaStyle: "soft"
            }]
        }))
    }

    const removePersona = (idx: number) => {
        setConfig((prev: any) => ({
            ...prev,
            audiencePersonas: (prev.audiencePersonas || []).filter((_: any, i: number) => i !== idx)
        }))
    }

    return (
        <div className="space-y-6">
            <SectionCard title="Cílové Publikum" description="Persony publika — AI přizpůsobí tón, hooky a CTA pro každou skupinu">
                {personas.length === 0 && (
                    <p className="text-[10px] text-white/30 text-center py-4">Žádné persony definovány. AI nebude personalizovat obsah.</p>
                )}
            </SectionCard>

            {personas.map((p, idx) => (
                <div key={idx} className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">👤</span>
                            <input value={p.label || ""} onChange={(e) => updatePersona(idx, "label", e.target.value)}
                                className="bg-transparent text-white font-black uppercase tracking-tight text-sm border-none focus:outline-none" placeholder="Název persony" />
                        </div>
                        <button onClick={() => removePersona(idx)} className="text-[9px] text-red-400/40 hover:text-red-400 transition-colors font-bold uppercase tracking-widest">
                            🗑️ Smazat
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <FieldLabel>Věkový rozsah</FieldLabel>
                            <input value={p.ageRange || ""} onChange={(e) => updatePersona(idx, "ageRange", e.target.value)}
                                placeholder="25-35" className={inputClass} />
                        </div>
                        <div>
                            <FieldLabel>CTA přístup</FieldLabel>
                            <div className="flex gap-1.5">
                                {(["soft", "medium", "hard"] as const).map(style => (
                                    <button key={style} onClick={() => updatePersona(idx, "ctaStyle", style)}
                                        className={`flex-1 py-2 rounded-sm text-[9px] font-bold uppercase tracking-widest border transition-all ${
                                            p.ctaStyle === style
                                                ? "bg-white/10 border-white/20 text-white"
                                                : "border-white/5 text-white/30 hover:text-white/60"
                                        }`}>
                                        {style === "soft" ? "🫶 Soft" : style === "medium" ? "💪 Medium" : "🔥 Hard"}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div>
                        <FieldLabel hint="Oddělené čárkou — s čím se tato persona trápí">Pain Points</FieldLabel>
                        <input value={(p.painPoints || []).join(", ")}
                            onChange={(e) => updatePersona(idx, "painPoints", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                            placeholder="Nemá čas, neví kde začít, je skeptický" className={inputClass} />
                    </div>

                    <div>
                        <FieldLabel hint="Oddělené čárkou — jaký obsah na ně funguje">Triggery</FieldLabel>
                        <input value={(p.triggers || []).join(", ")}
                            onChange={(e) => updatePersona(idx, "triggers", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                            placeholder="Čísla, příběhy, sociální důkaz" className={inputClass} />
                    </div>
                </div>
            ))}

            <button onClick={addPersona}
                className="w-full py-4 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                + Přidat personu
            </button>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// 5. VISUAL IDENTITY
// ═══════════════════════════════════════════════════════════

function VisualSection({ config, updateField, setGradientKey, handleLogoUpload, logoUploading, projectId, setConfig }: {
    config: any
    updateField: (p: string[], v: any) => void
    setGradientKey: (key: string, value: string) => void
    handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
    logoUploading: boolean
    projectId: string
    setConfig: (fn: any) => void
}) {
    return (
        <div className="space-y-6">
            <SectionCard title="Vizuální Identita" description="Jak vypadají obrázky, overlay texty a feed">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <FieldLabel hint="Popis atmosféry pro AI generování obrázků">Atmosféra & Styl fotek</FieldLabel>
                        <input value={config.feedAesthetic?.feel || ""} onChange={(e) => updateField(["feedAesthetic", "feel"], e.target.value)}
                            placeholder="Přírodní, hřejivý, denní světlo, rustikální" className={inputClass} />
                    </div>
                    <div>
                        <FieldLabel>Font přes obrázky</FieldLabel>
                        <select value={config.feedAesthetic?.fontOverride || "Inter"}
                            onChange={(e) => updateField(["feedAesthetic", "fontOverride"], e.target.value)}
                            className={inputClass}>
                            <option value="Inter">Inter — moderní, čistý</option>
                            <option value="BebasNeue">Bebas Neue — streetwear, bold</option>
                        </select>
                    </div>
                    <div>
                        <FieldLabel>Styl overlay</FieldLabel>
                        <select value={config.defaultFormat?.overlayStyle || "default"}
                            onChange={(e) => setConfig((prev: any) => ({ ...prev, defaultFormat: { ...(prev.defaultFormat || {}), overlayStyle: e.target.value } }))}
                            className={inputClass}>
                            <option value="default">Default — text dole</option>
                            <option value="cover">Cover — velký text, silnější gradient</option>
                            <option value="minimal">Minimal — žádný gradient</option>
                            <option value="none">None — bez overlay</option>
                        </select>
                    </div>
                    <div>
                        <FieldLabel hint="Hex barva pro zvýrazněná klíčová slova v textu">Accent Color</FieldLabel>
                        <div className="flex gap-2 items-center">
                            <input type="color"
                                value={config.feedAesthetic?.accentColor || "#e63946"}
                                onChange={(e) => updateField(["feedAesthetic", "accentColor"], e.target.value)}
                                className="w-10 h-10 rounded cursor-pointer border border-white/10 bg-transparent" />
                            <input value={config.feedAesthetic?.accentColor || "#e63946"}
                                onChange={(e) => updateField(["feedAesthetic", "accentColor"], e.target.value)}
                                className="flex-1 px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-white/30" />
                        </div>
                    </div>
                </div>

                <div>
                    <FieldLabel hint="Extra vizuální instrukce pro image prompt">Custom instrukce (pro AI)</FieldLabel>
                    <textarea value={config.feedAesthetic?.customInstructions || ""} onChange={(e) => updateField(["feedAesthetic", "customInstructions"], e.target.value)}
                        rows={2} placeholder="Vždy zahrnout zelené rostliny, dřevěné textury..." className={textareaClass} />
                </div>

                <div>
                    <FieldLabel hint="Instrukce pro video obsah">Video Focus</FieldLabel>
                    <textarea value={config.videoFocus || ""} onChange={(e) => updateField(["videoFocus"], e.target.value)}
                        rows={2} placeholder="Zaměřit na interiéry, pohled z první osoby, B-roll..." className={textareaClass} />
                </div>
            </SectionCard>

            {/* Logo */}
            <SectionCard title="Logo" description="Watermark logo na obrázcích">
                {config.logoFile && (
                    <div className="flex items-center gap-3">
                        <img
                            src={`https://nyvbxpjkwhcuugwevobu.supabase.co/storage/v1/object/public/audit-screenshots/client-assets/${projectId}/logo.png?t=${Date.now()}`}
                            alt="Logo"
                            className="h-12 object-contain bg-white/5 rounded px-3"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <span className="text-[9px] text-white/30 font-mono">{config.logoFile}</span>
                    </div>
                )}
                <label className={`flex items-center gap-2 px-3 py-2.5 border border-dashed border-white/20 rounded-sm cursor-pointer hover:border-white/40 transition-all text-[10px] text-white/40 hover:text-white/60 ${logoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {logoUploading ? 'Nahrávám...' : config.logoFile ? 'Nahradit logo' : 'Nahrát logo (PNG/JPG)'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={logoUploading} />
                </label>
                <p className="text-[9px] text-white/20">Max 5 MB. Doporučujeme PNG s průhledným pozadím.</p>
            </SectionCard>

            {/* Gradient */}
            <SectionCard title="Barvy gradientu" description="Pozadí textu na obrázcích">
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
                <div className="h-14 rounded-sm border border-white/10 overflow-hidden"
                    style={{ background: `linear-gradient(to bottom, ${config.overlayGradient?.topColor || "#111111"}26, ${config.overlayGradient?.midColor || "#111111"}4D, ${config.overlayGradient?.bottomColor || "#111111"}E6)` }}>
                    <div className="flex items-end h-full px-4 pb-3">
                        <span className={`text-white text-sm font-bold ${config.feedAesthetic?.fontOverride === "BebasNeue" ? "uppercase tracking-widest text-base" : ""}`}>
                            {config.name || "Náhled textu"}
                        </span>
                    </div>
                </div>
            </SectionCard>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// 6. HASHTAGS
// ═══════════════════════════════════════════════════════════

function HashtagsSection({ config, updateArrayField }: { config: any; updateArrayField: (p: string[], v: string) => void }) {
    const pools = config.hashtagPools || {}
    const POOL_TYPES = [
        { key: "core", label: "Core", description: "Základní hashtagy značky — vždy přidány", emoji: "🔹" },
        { key: "niche", label: "Niche", description: "Úzce cílené pro vaše publikum", emoji: "🎯" },
        { key: "broad", label: "Broad", description: "Široce dosahové hashtagy", emoji: "🌍" },
        { key: "trending", label: "Trending", description: "Aktuální trendy a sezónní", emoji: "📈" },
        { key: "czech", label: "České", description: "České a lokální hashtagy", emoji: "🇨🇿" },
    ]

    return (
        <SectionCard title="Hashtag Pools" description="AI vybírá mix hashtagů z těchto skupin pro každý post">
            <div className="space-y-5">
                {POOL_TYPES.map(pool => (
                    <div key={pool.key}>
                        <FieldLabel hint={pool.description}>{pool.emoji} {pool.label}</FieldLabel>
                        <textarea
                            value={(pools[pool.key] || []).join(", ")}
                            onChange={(e) => updateArrayField(["hashtagPools", pool.key], e.target.value)}
                            rows={2}
                            placeholder={`#hashtag1, #hashtag2, #hashtag3`}
                            className={textareaClass}
                        />
                        <div className="flex items-center justify-between mt-1">
                            <div className="flex flex-wrap gap-1 mt-1">
                                {(pools[pool.key] || []).slice(0, 8).map((h: string, i: number) => (
                                    <span key={i} className="text-[8px] text-blue-400/60 font-mono">{h.startsWith("#") ? h : `#${h}`}</span>
                                ))}
                                {(pools[pool.key] || []).length > 8 && (
                                    <span className="text-[8px] text-white/20">+{(pools[pool.key] || []).length - 8} dalších</span>
                                )}
                            </div>
                            <span className="text-[8px] text-white/20 font-bold">{(pools[pool.key] || []).length} hashtagů</span>
                        </div>
                    </div>
                ))}
            </div>
        </SectionCard>
    )
}

// ═══════════════════════════════════════════════════════════
// 7. CTA STRATEGIES
// ═══════════════════════════════════════════════════════════

function CTASection({ config, setConfig }: { config: any; setConfig: (fn: any) => void }) {
    const strategies = config.ctaStrategies || {}

    const STRATEGY_TYPES = [
        { key: "none", label: "Žádné CTA", description: "Čistý obsah bez výzvy k akci", emoji: "🤫", color: "text-white/40" },
        { key: "soft", label: "Soft CTA", description: "Jemné pobídnutí — ulož, sdílej, přemýšlej", emoji: "🫶", color: "text-blue-400" },
        { key: "medium", label: "Medium CTA", description: "Jasná výzva — komentuj, pošli kamarádovi", emoji: "💪", color: "text-amber-400" },
        { key: "hard", label: "Hard CTA", description: "Přímý prodej — kup, objednej, rezervuj", emoji: "🔥", color: "text-red-400" },
    ]

    const updateStrategy = (key: string, value: string) => {
        const lines = value.split("\n").map(s => s.trim()).filter(Boolean)
        setConfig((prev: any) => ({
            ...prev,
            ctaStrategies: { ...(prev.ctaStrategies || {}), [key]: lines }
        }))
    }

    return (
        <SectionCard title="CTA Strategie" description="Výzvy k akci podle intenzity — AI vybírá na základě pilíře a persony">
            <div className="space-y-5">
                {STRATEGY_TYPES.map(strat => (
                    <div key={strat.key} className="bg-[#050505] border border-white/10 rounded-sm p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-lg">{strat.emoji}</span>
                            <div>
                                <span className={`text-xs font-black uppercase tracking-wider ${strat.color}`}>{strat.label}</span>
                                <p className="text-[8px] text-white/20">{strat.description}</p>
                            </div>
                        </div>
                        <textarea
                            value={(strategies[strat.key] || []).join("\n")}
                            onChange={(e) => updateStrategy(strat.key, e.target.value)}
                            rows={3}
                            placeholder={strat.key === "soft"
                                ? "Ulož si na později 📌\nCo říkáte?\nDáte ❤️?"
                                : strat.key === "medium"
                                ? "Pošli kamarádovi 📲\nNapiš do komentáře\nKlikni na odkaz v bio"
                                : strat.key === "hard"
                                ? "Objednej na webu 🛒\nRezervuj si termín\nKupuj teď — limitovaná edice"
                                : "— žádné CTA v tomto stylu —"}
                            className={textareaClass}
                        />
                        <p className="text-[8px] text-white/20 mt-1">Každá variace na novém řádku • {(strategies[strat.key] || []).length} variací</p>
                    </div>
                ))}
            </div>
        </SectionCard>
    )
}

// ═══════════════════════════════════════════════════════════
// 8. CLIENT MANAGEMENT (Rescan + Delete)
// ═══════════════════════════════════════════════════════════

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
    const [syncing, setSyncing] = useState(false)
    const [syncResult, setSyncResult] = useState<string | null>(null)

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
            onReload()
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
        <SectionCard title="Správa klienta">
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

            {/* Product sync */}
            <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-4 mt-4">
                <div>
                    <p className="text-xs text-white/60 font-bold">Sync produktů</p>
                    <p className="text-[9px] text-white/30 mt-0.5">
                        Importuje produkty z konfigurace do katalogu (pro @ mention)
                    </p>
                </div>
                <button
                    onClick={async () => {
                        setSyncing(true)
                        setSyncResult(null)
                        const res = await syncConfigProductsToDb()
                        if (res.success) {
                            setSyncResult(`✅ ${res.synced} nových · ${res.skipped} přeskočeno`)
                        } else {
                            setSyncResult(`❌ ${res.error}`)
                        }
                        setSyncing(false)
                    }}
                    disabled={syncing}
                    className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-all border border-purple-500/20 disabled:opacity-50 whitespace-nowrap"
                >
                    {syncing ? "Syncuji…" : "🔄 Sync"}
                </button>
            </div>
            {syncResult && (
                <p className="text-[10px] text-white/50 bg-white/5 rounded-sm px-3 py-2">{syncResult}</p>
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
        </SectionCard>
    )
}

// ═══════════════════════════════════════════════════════════
// 9. PRODUCT CATALOG
// ═══════════════════════════════════════════════════════════

function ProductCatalogSection({ projectId }: { projectId: string }) {
    const [products, setProducts] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [uploading, setUploading] = useState<string | null>(null)
    const [scraping, setScraping] = useState(false)
    const [scrapeResult, setScrapeResult] = useState<string | null>(null)
    const [form, setForm] = useState({ name: "", type: "", slug: "", price: "", description: "" })

    const loadProducts = useCallback(async () => {
        setLoading(true)
        const data = await getProducts(projectId)
        setProducts(data)
        setLoading(false)
    }, [projectId])

    useEffect(() => { loadProducts() }, [loadProducts])

    const autoSlug = (name: string) =>
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

    const handleSubmit = async () => {
        if (!form.name || !form.slug) return
        setSaving(true)
        if (editingId) {
            await updateProduct(editingId, projectId, form)
        } else {
            await createProduct(projectId, form)
        }
        setForm({ name: "", type: "", slug: "", price: "", description: "" })
        setShowForm(false)
        setEditingId(null)
        setSaving(false)
        await loadProducts()
    }

    const handleEdit = (p: any) => {
        setForm({ name: p.name, type: p.type || "", slug: p.slug, price: p.price || "", description: p.description || "" })
        setEditingId(p.id)
        setShowForm(true)
    }

    const handleDelete = async (id: string) => {
        if (!confirm("Smazat produkt? Tato akce je nevratná.")) return
        await deleteProduct(id, projectId)
        await loadProducts()
    }

    const handleImageUpload = async (productId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setUploading(productId)
        const fd = new FormData()
        fd.append("file", file)
        await uploadProductImage(projectId, productId, fd)
        await loadProducts()
        setUploading(null)
        e.target.value = ""
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <SectionCard title="Produktový katalog" description="Produkty používané při generování obsahu. Přiřaďte je k postům přes @ mention v content planu.">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                        {products.length === 0 && !showForm && (
                            <p className="text-[10px] text-white/30">Žádné produkty. Načtěte z webu nebo přidejte ručně.</p>
                        )}
                        {products.length > 0 && (
                            <p className="text-[10px] text-white/30">{products.length} produkt{products.length === 1 ? '' : products.length < 5 ? 'y' : 'ů'} v katalogu</p>
                        )}
                        {scrapeResult && (
                            <p className="text-[10px] text-white/50 mt-1">{scrapeResult}</p>
                        )}
                    </div>
                    <button
                        onClick={async () => {
                            setScraping(true)
                            setScrapeResult(null)
                            const res = await scrapeProductsFromWebsite(projectId)
                            if (res.success) {
                                setScrapeResult(`✅ Nalezeno ${res.found} · vloženo ${res.inserted} nových · ${res.images} fotek staženo`)
                                await loadProducts()
                            } else {
                                setScrapeResult(`❌ ${res.error}`)
                            }
                            setScraping(false)
                        }}
                        disabled={scraping}
                        className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/20 disabled:opacity-50 whitespace-nowrap flex items-center gap-1.5"
                    >
                        {scraping ? (
                            <>
                                <div className="w-3 h-3 border border-blue-400/50 border-t-blue-400 rounded-full animate-spin" />
                                Scanuji web…
                            </>
                        ) : (
                            <>🌐 Načíst z webu</>
                        )}
                    </button>
                </div>
            </SectionCard>

            {/* Product list */}
            {products.map(p => (
                <div key={p.id} className="bg-[#0f0f0f] border border-white/5 rounded-sm p-5 hover:border-white/10 transition-all">
                    <div className="flex items-start gap-4">
                        {/* Thumbnail */}
                        <div className="w-16 h-16 flex-shrink-0 bg-[#050505] border border-white/10 rounded-sm overflow-hidden flex items-center justify-center">
                            {p.image_urls?.length > 0 ? (
                                <img src={p.image_urls[0]} alt={p.name} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-2xl opacity-30">📦</span>
                            )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-white font-bold text-sm">{p.name}</span>
                                {p.type && <span className="text-[8px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded-sm text-white/40 font-bold uppercase tracking-wider">{p.type}</span>}
                            </div>
                            {p.description && <p className="text-[10px] text-white/40 leading-relaxed line-clamp-2">{p.description}</p>}
                            <div className="flex items-center gap-3 mt-2">
                                {p.price && <span className="text-[10px] text-emerald-400/70 font-bold">{p.price}</span>}
                                <span className="text-[8px] text-white/20 font-mono">/{p.slug}</span>
                                <span className="text-[8px] text-white/20">{(p.image_urls || []).length} fotek</span>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <label className={`p-2 text-white/20 hover:text-blue-400/80 transition-colors cursor-pointer ${uploading === p.id ? 'animate-pulse' : ''}`} title="Nahrát obrázek">
                                <span className="text-[10px]">📷</span>
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(p.id, e)} disabled={uploading === p.id} />
                            </label>
                            <button onClick={() => handleEdit(p)} className="p-2 text-white/20 hover:text-white/60 transition-colors" title="Upravit">
                                <span className="text-[10px]">✏️</span>
                            </button>
                            <button onClick={() => handleDelete(p.id)} className="p-2 text-white/20 hover:text-red-400/80 transition-colors" title="Smazat">
                                <span className="text-[10px]">✕</span>
                            </button>
                        </div>
                    </div>

                    {/* Image gallery */}
                    {p.image_urls?.length > 1 && (
                        <div className="flex gap-2 mt-3 overflow-x-auto">
                            {p.image_urls.map((url: string, i: number) => (
                                <img key={i} src={url} alt={`${p.name} ${i + 1}`} className="w-12 h-12 object-cover rounded-sm border border-white/10 flex-shrink-0" />
                            ))}
                        </div>
                    )}
                </div>
            ))}

            {/* Add/Edit form */}
            {showForm && (
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-[#0f0f0f] border border-white/10 rounded-sm p-6 space-y-4"
                >
                    <div className="border-b border-white/10 pb-3">
                        <h4 className="text-sm font-black uppercase tracking-widest text-white/70">
                            {editingId ? "Upravit produkt" : "Nový produkt"}
                        </h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <FieldLabel>Název produktu</FieldLabel>
                            <input
                                value={form.name}
                                onChange={(e) => {
                                    const name = e.target.value
                                    setForm(f => ({ ...f, name, slug: editingId ? f.slug : autoSlug(name) }))
                                }}
                                placeholder="Balíček Starter"
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <FieldLabel hint="Automaticky z názvu">Slug (URL)</FieldLabel>
                            <input
                                value={form.slug}
                                onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
                                placeholder="balicek-starter"
                                className={`${inputClass} font-mono`}
                            />
                        </div>
                        <div>
                            <FieldLabel>Typ / kategorie</FieldLabel>
                            <input
                                value={form.type}
                                onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
                                placeholder="Balíček, Služba, Fyzický produkt..."
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <FieldLabel>Cena</FieldLabel>
                            <input
                                value={form.price}
                                onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                                placeholder="990 Kč"
                                className={inputClass}
                            />
                        </div>
                    </div>

                    <div>
                        <FieldLabel hint="Krátký popis pro AI — co produkt dělá, pro koho je">Popis</FieldLabel>
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                            rows={3}
                            placeholder="Ideální startovací balíček pro nové zákazníky. Obsahuje..."
                            className={textareaClass}
                        />
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                        <button
                            onClick={() => { setShowForm(false); setEditingId(null); setForm({ name: "", type: "", slug: "", price: "", description: "" }) }}
                            className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors"
                        >
                            Zrušit
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={saving || !form.name || !form.slug}
                            className="px-6 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-sm bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all disabled:opacity-40"
                        >
                            {saving ? "Ukládám..." : editingId ? "Uložit změny" : "Vytvořit produkt"}
                        </button>
                    </div>
                </motion.div>
            )}

            {!showForm && (
                <button
                    onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: "", type: "", slug: "", price: "", description: "" }) }}
                    className="w-full py-4 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all"
                >
                    + Přidat produkt
                </button>
            )}
        </div>
    )
}
