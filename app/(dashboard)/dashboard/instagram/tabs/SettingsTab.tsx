"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { getClientConfig, updateClientConfig, rescanClientWebsite, deleteClient, uploadClientLogo, upsertPostFormat, removePostFormat, suggestPostFormat, recommendFeedPattern, type PostFormatInput } from "@/app/actions/config-actions"
import { syncConfigProductsToDb } from "@/app/actions/product-actions"
import { CatalogSection } from "./products/CatalogSection"
import { generateCategoryPrompt } from "@/app/actions/content-plan-actions"
import { getConnectionStatus, disconnectInstagram, type ConnectionStatus } from "@/app/actions/ig-connection-actions"
import { SubscriptionSection } from "./SubscriptionSection"
import { BillingSection } from "./BillingSection"
import { ConsultationSection } from "./ConsultationSection"
import { FEED_PATTERNS, computeSlotIntent, type FeedPatternId } from "@/lib/feed-pattern"
import { Hint, HINTS } from "./Hint"

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

    const [showAdvanced, setShowAdvanced] = useState(false)

    // Auto-expand advanced if user is already on an advanced tab
    useEffect(() => {
        if (["audience", "hashtags", "cta"].includes(activeSection)) {
            setShowAdvanced(true)
        }
    }, [])

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

    const TABS_MAIN = [
        { id: "basic", label: "Základní", icon: "📋" },
        { id: "voice", label: "Styl textu", icon: "🎤" },
        { id: "pillars", label: "Témata", icon: "🏛️" },
        { id: "formats", label: "Formáty", icon: "🧩" },
        { id: "visual", label: "Vizuál", icon: "🎨" },
        { id: "products", label: "Produkty", icon: "🛍️" },
        { id: "manage", label: "Správa", icon: "⚙️" },
    ]

    const TABS_ADVANCED = [
        { id: "audience", label: "Publikum", icon: "👥" },
        { id: "hashtags", label: "Hashtagy", icon: "#️⃣" },
        { id: "cta", label: "CTA", icon: "📣" },
    ]

    return (
        <div className="space-y-6 pb-12">
            {/* Sticky header */}
            <div className="flex items-center justify-between bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-sm p-5 shadow-sm sticky top-0 z-10">
                <div>
                    {/* The page header above already says "Nastavení"; repeating it here wasted
                        the one line of this sticky bar that stays on screen while you scroll.
                        Lead with the client instead — with the switcher scrolled out of view,
                        "which tenant am I editing?" is the question this bar should answer. */}
                    <h2 className="text-lg font-black uppercase tracking-tight text-white">{config.name}</h2>
                    <p className="text-white/50 text-xs mt-1 tracking-wide">Konfigurace značky</p>
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

            {/* Tab navigation */}
            <div className="space-y-2">
                <div className="flex sm:flex-wrap gap-1 overflow-x-auto scrollbar-hide bg-[#0a0a0a]/60 border border-white/10 rounded-sm p-1.5">
                    {TABS_MAIN.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveSection(tab.id)}
                            className={`relative shrink-0 min-h-[40px] px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all duration-200 cursor-pointer ${
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
                                <span className="whitespace-nowrap">{tab.label}</span>
                            </span>
                        </button>
                    ))}

                    {/* Advanced toggle */}
                    <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className={`relative px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all duration-200 ml-auto ${
                            showAdvanced ? "text-white/60" : "text-white/25 hover:text-white/50"
                        }`}
                    >
                        <span className="relative z-10 flex items-center gap-2">
                            <span>{showAdvanced ? "▼" : "▶"}</span>
                            <span className="whitespace-nowrap">Pokročilé</span>
                        </span>
                    </button>
                </div>

                {/* Advanced tabs - collapsed by default */}
                <AnimatePresence>
                    {showAdvanced && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                        >
                            <div className="flex flex-wrap gap-1 bg-[#0a0a0a]/40 border border-white/5 rounded-sm p-1.5">
                                <span className="px-3 py-2.5 text-[9px] text-white/20 font-bold uppercase tracking-widest">Pokročilé:</span>
                                {TABS_ADVANCED.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveSection(tab.id)}
                                        className={`relative shrink-0 min-h-[40px] px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all duration-200 cursor-pointer ${
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
                                            <span className="whitespace-nowrap">{tab.label}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
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
                        <PillarsSection config={config} setConfig={setConfig} projectId={projectId} />
                    )}
                    {activeSection === "formats" && (
                        <FormatsSection config={config} projectId={projectId} onReload={loadData} />
                    )}
                    {activeSection === "audience" && (
                        <AudienceSection config={config} setConfig={setConfig} />
                    )}
                    {/* Same component the Produkty tab mounts — one catalog, one
                        implementation. It stays reachable from Nastavení because the
                        Produkty studio is admin-only and clients still need CRUD. */}
                    {activeSection === "products" && (
                        <CatalogSection projectId={projectId} />
                    )}
                    {activeSection === "visual" && (
                        <VisualSection config={config} updateField={updateField} handleLogoUpload={handleLogoUpload} logoUploading={logoUploading} projectId={projectId} setConfig={setConfig} />
                    )}
                    {activeSection === "hashtags" && (
                        <HashtagsSection config={config} updateArrayField={updateArrayField} />
                    )}
                    {activeSection === "cta" && (
                        <CTASection config={config} setConfig={setConfig} />
                    )}
                    {activeSection === "manage" && (
                        <>
                            <InstagramConnectionSection projectId={projectId} />
                            <AutoPublishSection projectId={projectId} />
                            <ClientManagementSection projectId={projectId} config={config} setConfig={setConfig} onReload={loadData} />
                        </>
                    )}
                </motion.div>
            </AnimatePresence>

            {/* Subscription — deliberately BELOW the tab content.
                Above the tab bar, a client with no active plan got the full 5-card
                pricing table (~880px) injected between the page header and the tab
                bar, pushing this screen's own navigation to y≈1288 on a 900px window
                — 1.7 screens down. Someone opening Nastavení to fix their brand voice
                had to scroll past a sales page to discover the tabs even existed, and
                it only happened once the subscription query resolved, so the layout
                looked fine while loading and then broke. The pricing stays on the page
                (it is still a conversion surface, and the sidebar's "Vybrat plán" CTA
                is unaffected); it just no longer blocks the settings. */}
            {/* Schůzka sedí NAD ceníkem: kdo se rozmýšlí nad tarifem, má vidět, že
                si to může nechat nastavit — a že u 6 a 12 měsíců je to v ceně.
                Komponenta se sama skryje, dokud stav nedorazí, takže nic nepřeskakuje. */}
            <ConsultationSection projectId={projectId} />

            <SubscriptionSection projectId={projectId} />

            {/* Fakturační údaje + doklady patří pod předplatné: zákazník je hledá
                ve stejný okamžik, kdy řeší platbu. */}
            <BillingSection projectId={projectId} />
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// SHARED UI HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * `description` říká, CO sekce dělá. `why` říká, PROČ na ní záleží — a je
 * schované za kliknutím, protože se hodí jednou, při prvním nastavování.
 * Dává se jen tam, kde špatné nastavení stojí kredity nebo kvalitu; u ostatních
 * sekcí by to byl šum, který lidi naučí přestat vysvětlivky číst.
 */
function SectionCard({ title, description, why, children }: { title: string; description?: string; why?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-5">
            <div className="border-b border-white/10 pb-3 mb-2">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70">{title}</h3>
                {description && <p className="text-[10px] text-white/30 mt-1 font-medium">{description}</p>}
                {why && <div className="mt-2"><Hint>{why}</Hint></div>}
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
            <SectionCard title="Persona & Tón" description="Jak vaše značka mluví — co AI říká a jak to říká" why={HINTS.tone}>
                <div>
                    <FieldLabel hint="Detailní popis kdo jsme, jak mluvíme, jaký máme přístup k zákazníkům">Persona — kdo jsme, jak mluvíme</FieldLabel>
                    <textarea value={voice.persona || ""} onChange={(e) => updateField(["brandVoice", "persona"], e.target.value)}
                        rows={4} placeholder="Jsme přátelský penzion uprostřed přírody. Mluvíme jako kamarád, co doporučuje svůj oblíbený kout..." className={textareaClass} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <FieldLabel hint="Oddělené čárkou — určují styl textu">Tón komunikace</FieldLabel>
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
                    <FieldLabel hint="Oddělené čárkou — slova a fráze, které AI nikdy nepoužije">Co neříkáme</FieldLabel>
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

            <SectionCard title="Šablony úvodních vět" description="Vzory pro úvodní věty — {{topic}} se nahradí automaticky">
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
                <p className="text-[10px] text-white/30 text-center py-4">Žádné šablony. Přidejte první vzor pro lepší AI texty.</p>
            )}
            {templates.map((t: any, idx: number) => (
                <div key={idx} className="bg-[#050505] border border-white/10 rounded-sm p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">Hook #{idx + 1}</span>
                        <button onClick={() => removeTemplate(idx)} className="text-[9px] text-red-400/50 hover:text-red-400 transition-colors">✕ Smazat</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <FieldLabel hint="Vzor s {{topic}} zástupcem">Vzor</FieldLabel>
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
                        <FieldLabel>Emoční spoušť</FieldLabel>
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
                + Přidat šablonu
            </button>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// 3. CONTENT PILLARS
// ═══════════════════════════════════════════════════════════

function PillarsSection({ config, setConfig, projectId }: { config: any; setConfig: (fn: any) => void; projectId: string }) {
    const [generatingPrompt, setGeneratingPrompt] = useState<string | null>(null)
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
                [id]: { emoji: "📝", label: "Nové téma", description: "", postTypes: [], ratio: 0.2, ctaStrategy: "soft", kpi: [] }
            }
        }))
    }

    const removePillar = (key: string) => {
        const owned: string[] = pillars[key]?.postTypes || []
        const remaining = Object.keys(pillars).filter(k => k !== key)
        if (owned.length > 0) {
            if (remaining.length === 0) {
                alert("Toto je poslední téma — nelze smazat, formáty by neměly kam patřit.")
                return
            }
            const firstLabel = pillars[remaining[0]]?.label || remaining[0]
            if (!confirm(`Téma obsahuje ${owned.length} formát(ů): ${owned.join(", ")}.\nPo uložení se přesunou do tématu „${firstLabel}". Pokračovat?`)) return
        }
        setConfig((prev: any) => {
            const next = { ...prev.contentPillars }
            delete next[key]
            return { ...prev, contentPillars: next }
        })
    }

    const CTA_OPTIONS = [
        { value: "none", label: "Žádné CTA", color: "text-white/30" },
        { value: "soft", label: "Jemné", color: "text-blue-400" },
        { value: "medium", label: "Střední", color: "text-amber-400" },
        { value: "hard", label: "Přímý prodej", color: "text-red-400" },
    ]

    // Total ratio
    const totalRatio = pillarEntries.reduce((sum, [, p]) => sum + ((p as any).ratio || 0), 0)

    return (
        <div className="space-y-6">
            <SectionCard title="Témata obsahu" description="Tematické kategorie definují mix vašeho obsahu. Každé téma má poměr (ratio) — celkový součet by měl být ~1.0" why={HINTS.pillars}>
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
                                    className="bg-transparent text-white font-black uppercase tracking-tight text-sm border-none focus:outline-none w-48" placeholder="Název tématu" />
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
                            rows={2} placeholder="Co toto téma pokrývá, jaké téma..." className={textareaClass} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <FieldLabel hint="Poměr obsahu (0.0–1.0)">Poměr</FieldLabel>
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
                            <FieldLabel hint="Oddělené čárkou">Cílové metriky</FieldLabel>
                            <input value={(pillar.kpi || []).join(", ")}
                                onChange={(e) => updatePillar(key, "kpi", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                                placeholder="interakce, uložení, dosah" className={inputClass} />
                        </div>
                    </div>

                    {/* postTypes hidden — managed internally via categories */}

                    <div>
                        <FieldLabel hint="Specifické instrukce pro AI při generování nápadů v tomto tématu">Idea Prompt (pro AI)</FieldLabel>
                        <textarea value={pillar.ideaPrompt || ""} onChange={(e) => updatePillar(key, "ideaPrompt", e.target.value)}
                            rows={2} placeholder="Zaměř se na praktické tipy, používej čísla a statistiky..." className={textareaClass} />
                    </div>

                    {/* Categories within pillar */}
                    <div className="border-t border-white/5 pt-4 mt-2">
                        <FieldLabel hint="Tematické úhly — soutěž, edukace, tip, FAQ... AI generuje nápady per kategorie">Kategorie</FieldLabel>
                        <div className="space-y-2">
                            {(pillar.categories || []).map((cat: any, catIdx: number) => (
                                <div key={catIdx} className="flex items-start gap-2 bg-[#050505] border border-white/5 rounded-sm p-3">
                                    <input value={cat.emoji || "📌"} onChange={(e) => {
                                        const cats = [...(pillar.categories || [])]
                                        cats[catIdx] = { ...cats[catIdx], emoji: e.target.value }
                                        updatePillar(key, "categories", cats)
                                    }} className="w-9 h-9 text-center text-lg bg-transparent border border-white/10 rounded-sm focus:outline-none focus:ring-1 focus:ring-white/30" />
                                    <div className="flex-1 space-y-1.5">
                                        <div className="flex gap-2">
                                            <input value={cat.id || ""} onChange={(e) => {
                                                const cats = [...(pillar.categories || [])]
                                                cats[catIdx] = { ...cats[catIdx], id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_") }
                                                updatePillar(key, "categories", cats)
                                            }} placeholder="id (slug)" className="w-28 px-2 py-1.5 bg-transparent border border-white/10 rounded-sm text-[9px] font-mono text-white/50 focus:outline-none focus:ring-1 focus:ring-white/30" />
                                            <input value={cat.label || ""} onChange={(e) => {
                                                const cats = [...(pillar.categories || [])]
                                                cats[catIdx] = { ...cats[catIdx], label: e.target.value }
                                                updatePillar(key, "categories", cats)
                                            }} placeholder="Název" className="flex-1 px-2 py-1.5 bg-transparent border border-white/10 rounded-sm text-xs text-white font-bold focus:outline-none focus:ring-1 focus:ring-white/30" />
                                        </div>
                                        <div className="flex gap-1.5 items-start">
                                            <input value={cat.prompt || ""} onChange={(e) => {
                                                const cats = [...(pillar.categories || [])]
                                                cats[catIdx] = { ...cats[catIdx], prompt: e.target.value }
                                                updatePillar(key, "categories", cats)
                                            }} placeholder="AI prompt hint (volitelné)" className="flex-1 px-2 py-1.5 bg-transparent border border-white/5 rounded-sm text-[10px] text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30" />
                                            <button
                                                disabled={generatingPrompt === `${key}-${catIdx}` || !cat.label}
                                                onClick={async () => {
                                                    if (!cat.label) return
                                                    setGeneratingPrompt(`${key}-${catIdx}`)
                                                    const res = await generateCategoryPrompt(projectId, cat.label, pillar.label || key, pillar.description || "")
                                                    if (res.success && res.prompt) {
                                                        const cats = [...(pillar.categories || [])]
                                                        cats[catIdx] = { ...cats[catIdx], prompt: res.prompt }
                                                        updatePillar(key, "categories", cats)
                                                    }
                                                    setGeneratingPrompt(null)
                                                }}
                                                className={`shrink-0 px-2 py-1.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border transition-all ${
                                                    generatingPrompt === `${key}-${catIdx}`
                                                        ? "border-white/10 text-white/20 cursor-wait"
                                                        : !cat.label
                                                            ? "border-white/5 text-white/15 cursor-not-allowed"
                                                            : "border-white/10 text-amber-400/60 hover:text-amber-400 hover:border-amber-400/30"
                                                }`}
                                                title="AI vygeneruje prompt hint na základě názvu kategorie"
                                            >
                                                {generatingPrompt === `${key}-${catIdx}` ? "⏳" : "✨"}
                                            </button>
                                        </div>
                                        {/* Format preferences */}
                                        <div className="flex gap-1.5">
                                            <select value={cat.medium || "auto"} onChange={(e) => {
                                                const cats = [...(pillar.categories || [])]
                                                cats[catIdx] = { ...cats[catIdx], medium: e.target.value }
                                                updatePillar(key, "categories", cats)
                                            }} className="flex-1 px-1.5 py-1 bg-[#050505] border border-white/5 rounded-sm text-[9px] text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30" title="Formát">
                                                <option value="auto">📐 Auto</option>
                                                <option value="image">🖼️ Obrázek</option>
                                                <option value="carousel">📸 Carousel</option>
                                            </select>
                                            <select value={cat.overlayStyle || "auto"} onChange={(e) => {
                                                const cats = [...(pillar.categories || [])]
                                                cats[catIdx] = { ...cats[catIdx], overlayStyle: e.target.value }
                                                updatePillar(key, "categories", cats)
                                            }} className="flex-1 px-1.5 py-1 bg-[#050505] border border-white/5 rounded-sm text-[9px] text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30" title="Styl textu">
                                                <option value="auto">🎨 Auto</option>
                                                <option value="default">Klasický (dole)</option>
                                                <option value="top">Nahoře</option>
                                                <option value="cover">Přes celý</option>
                                                <option value="editorial">Editoriál</option>
                                                <option value="centered">Na střed</option>
                                                <option value="none">Bez textu</option>
                                            </select>
                                            <select value={cat.aspectRatio || "auto"} onChange={(e) => {
                                                const cats = [...(pillar.categories || [])]
                                                cats[catIdx] = { ...cats[catIdx], aspectRatio: e.target.value }
                                                updatePillar(key, "categories", cats)
                                            }} className="flex-1 px-1.5 py-1 bg-[#050505] border border-white/5 rounded-sm text-[9px] text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30" title="Poměr stran">
                                                <option value="auto">📏 Auto</option>
                                                <option value="1:1">1:1 Čtverec</option>
                                                <option value="4:5">4:5 IG Feed</option>
                                                <option value="3:4">3:4 Na výšku</option>
                                            </select>
                                        </div>
                                    </div>
                                    <button onClick={() => {
                                        const cats = (pillar.categories || []).filter((_: any, i: number) => i !== catIdx)
                                        updatePillar(key, "categories", cats)
                                    }} className="text-[9px] text-red-400/40 hover:text-red-400 transition-colors mt-1">✕</button>
                                </div>
                            ))}
                            <button onClick={() => {
                                const cats = [...(pillar.categories || []), { id: `cat_${Date.now()}`, label: "", emoji: "📌", prompt: "" }]
                                updatePillar(key, "categories", cats)
                            }} className="w-full py-2 border border-dashed border-white/10 rounded-sm text-[9px] text-white/30 font-bold uppercase tracking-widest hover:text-white/50 hover:border-white/20 transition-all">
                                + Přidat kategorii
                            </button>
                        </div>
                    </div>
                </div>
            ))}

            <button onClick={addPillar}
                className="w-full py-4 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                + Přidat nové téma
            </button>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// 3b. POST FORMATS
// ═══════════════════════════════════════════════════════════
//
// Formats are saved through their OWN server actions (upsertPostFormat /
// removePostFormat) — never through the global config save. A format lives in
// four synced places (postTypes, postTypeDefs, postFormats, pillar membership
// + ig_post_types row); the actions keep them consistent, a raw config write
// wouldn't. After every mutation the whole config reloads.

const MEDIUM_OPTIONS = [
    { value: "image", label: "🖼️ Obrázek" },
    { value: "story", label: "📱 Story" },
    { value: "carousel", label: "🎠 Karusel" },
    { value: "reel", label: "🎬 Reel" },
] as const
const RATIO_OPTIONS = ["1:1", "4:5", "3:4"] as const
/** Media pinned to 9:16 — mirrors VERTICAL_MEDIA in instagram/format-clamps.ts. */
const isVerticalMedium = (m: string) => m === "reel" || m === "story"
// Static-media overlay styles (reels are always text-free "none").
const OVERLAY_OPTIONS = [
    { value: "default", label: "Základní" },
    { value: "top", label: "Nahoře" },
    { value: "cover", label: "Cover (velký nadpis)" },
    { value: "centered", label: "Na střed" },
    { value: "editorial", label: "Editorial" },
    { value: "split", label: "Split" },
    { value: "minimal", label: "Minimal" },
    { value: "full-typo", label: "Typografie" },
    { value: "step", label: "Kroky" },
] as const

function emptyFormatDraft(pillarKeys: string[]): PostFormatInput {
    return {
        display_name: "",
        emoji: "🎁",
        description: "",
        pillar: pillarKeys[0] || "",
        medium: "image",
        aspectRatio: "4:5",
        uses_product: false,
        manualOnly: false,
    }
}

function FormatsSection({ config, projectId, onReload }: { config: any; projectId: string; onReload: () => Promise<void> }) {
    const pillars: Record<string, any> = config.contentPillars || {}
    const pillarKeys = Object.keys(pillars)
    const defs: any[] = config.postTypeDefs || []

    const [busy, setBusy] = useState<string | null>(null) // format name being saved/removed
    const [error, setError] = useState<string | null>(null)
    const [drafts, setDrafts] = useState<Record<string, PostFormatInput>>({})
    const [showAdd, setShowAdd] = useState(false)
    const [addDraft, setAddDraft] = useState<PostFormatInput>(() => emptyFormatDraft(pillarKeys))
    // "Write a word → AI fills the whole form" — the fast path for adding a format.
    const [genKeyword, setGenKeyword] = useState("")
    const [genBusy, setGenBusy] = useState(false)

    const suggest = async () => {
        if (!genKeyword.trim()) return
        setGenBusy(true); setError(null)
        const res = await suggestPostFormat(projectId, genKeyword.trim())
        if (res.success && res.draft) setAddDraft(res.draft)
        else setError(res.error || "AI návrh selhal")
        setGenBusy(false)
    }

    const draftFor = (def: any): PostFormatInput => drafts[def.name] ?? {
        name: def.name,
        display_name: def.display_name || "",
        emoji: def.emoji || "📝",
        description: def.description || "",
        structure: def.structure || "",
        visualStyle: def.visualStyle || "",
        pillar: def.pillar || pillarKeys[0] || "",
        medium: def.medium || "image",
        aspectRatio: def.aspectRatio || "4:5",
        uses_product: Boolean(def.uses_product),
        manualOnly: Boolean(def.manualOnly),
        overlayStyle: config.postFormats?.[def.name]?.overlayStyle,
    }

    const updateDraft = (name: string, def: any, patch: Partial<PostFormatInput>) => {
        setDrafts(prev => ({ ...prev, [name]: { ...draftFor(def), ...(prev[name] || {}), ...patch } }))
    }

    const save = async (input: PostFormatInput, key: string) => {
        setBusy(key); setError(null)
        const res = await upsertPostFormat(projectId, input)
        if (!res.success) setError(res.error || "Uložení formátu selhalo")
        else {
            setDrafts(prev => { const next = { ...prev }; delete next[key]; return next })
            if (key === "__add__") { setShowAdd(false); setAddDraft(emptyFormatDraft(pillarKeys)); setGenKeyword("") }
            await onReload()
        }
        setBusy(null)
    }

    const remove = async (name: string) => {
        if (!confirm(`Opravdu smazat formát "${name}"? Už vygenerované posty zůstanou.`)) return
        setBusy(name); setError(null)
        const res = await removePostFormat(projectId, name)
        if (!res.success) setError(res.error || "Smazání formátu selhalo")
        else await onReload()
        setBusy(null)
    }

    const FormatFields = ({ value, onChange }: { value: PostFormatInput; onChange: (p: Partial<PostFormatInput>) => void }) => (
        <div className="space-y-3">
            <div className="flex items-start gap-3">
                <input value={value.emoji} onChange={e => onChange({ emoji: e.target.value })}
                    className="w-12 h-12 text-center text-2xl bg-[#050505] border border-white/10 rounded-sm focus:outline-none focus:ring-1 focus:ring-white/30" />
                <div className="flex-1">
                    <FieldLabel>Název formátu</FieldLabel>
                    <input value={value.display_name} onChange={e => onChange({ display_name: e.target.value })}
                        placeholder="Soutěž o merch" className={inputClass} />
                </div>
            </div>
            <div>
                <FieldLabel hint="CO post ukazuje a PROČ funguje pro vaši značku — čte to AI copywriter">Popis (pro AI)</FieldLabel>
                <textarea value={value.description} onChange={e => onChange({ description: e.target.value })}
                    rows={3} placeholder="Soutěžní post: 1) dej like, 2) sleduj náš profil, 3) označ kámoše v komentáři — výherce získá produkt zdarma..." className={textareaClass} />
            </div>
            <div>
                <FieldLabel hint="Kostra obsahu — u karuselu osnova slidů, u reelu scény, u obrázku stavba textu. Prázdné = obecná šablona média">Struktura obsahu (volitelné)</FieldLabel>
                <textarea value={value.structure || ""} onChange={e => onChange({ structure: e.target.value })}
                    rows={3} placeholder="Slide 1 (COVER): otázka o výhře · Slide 2: podmínky soutěže · Slide 3: co vyhrajete · Slide 4: deadline + CTA" className={textareaClass} />
            </div>
            <div>
                <FieldLabel hint="Jak mají posty vypadat — kompozice, nálada, rekvizity. Řídí se tím AI designer při návrhu vizuálu">Vizuální styl (volitelné)</FieldLabel>
                <textarea value={value.visualStyle || ""} onChange={e => onChange({ visualStyle: e.target.value })}
                    rows={2} placeholder="Produkt na výrazném barevném pozadí, konfety, velká čísla, energická nálada..." className={textareaClass} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                    <FieldLabel>Téma</FieldLabel>
                    <select value={value.pillar} onChange={e => onChange({ pillar: e.target.value })} className={inputClass}>
                        {pillarKeys.map(k => <option key={k} value={k}>{pillars[k]?.emoji} {pillars[k]?.label || k}</option>)}
                    </select>
                </div>
                <div>
                    <FieldLabel>Médium</FieldLabel>
                    <select value={value.medium} onChange={e => onChange({ medium: e.target.value as PostFormatInput["medium"] })} className={inputClass}>
                        {MEDIUM_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                </div>
                <div>
                    <FieldLabel>Poměr stran</FieldLabel>
                    {/* Reels and stories are 9:16 only — the engine clamps anything else
                        (instagram/format-clamps.ts), so offering a choice would be a lie. */}
                    <select value={isVerticalMedium(value.medium) ? "9:16" : value.aspectRatio} disabled={isVerticalMedium(value.medium)}
                        onChange={e => onChange({ aspectRatio: e.target.value as PostFormatInput["aspectRatio"] })} className={inputClass}>
                        {isVerticalMedium(value.medium)
                            ? <option value="9:16">9:16</option>
                            : RATIO_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
                <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={value.uses_product} onChange={e => onChange({ uses_product: e.target.checked })}
                            className="accent-emerald-500" />
                        <span className="text-[9px] text-white/50 font-bold uppercase tracking-widest">🛍️ S produktem</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={Boolean(value.manualOnly)} onChange={e => onChange({ manualOnly: e.target.checked })}
                            className="accent-amber-500" />
                        <span className="text-[9px] text-white/50 font-bold uppercase tracking-widest">✋ Jen ručně</span>
                    </label>
                </div>
            </div>
            {value.medium !== "reel" && (
                <div className="max-w-[240px]">
                    <FieldLabel hint="Jak headline sedí na obrázku — rozložení textu ve vizuálu">Styl textu</FieldLabel>
                    <select value={value.overlayStyle || (value.medium === "carousel" ? "cover" : "default")}
                        onChange={e => onChange({ overlayStyle: e.target.value as PostFormatInput["overlayStyle"] })} className={inputClass}>
                        {OVERLAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
            )}
        </div>
    )

    return (
        <div className="space-y-6">
            <SectionCard title="Formáty příspěvků" description="Každý formát je jeden typ postu (šablona), který si vybíráte při generování. Formát „s produktem“ automaticky přikládá reálnou fotku produktu. „Jen ručně“ znamená, že ho AI nikdy nezvolí sama (soutěže, limitky) — vyberete ho jen vy v Tvorbě." why={HINTS.formats}>
                {error && (
                    <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest">{error}</p>
                )}
                {defs.length === 0 && (
                    <p className="text-[10px] text-white/30 text-center py-4">Žádné brand formáty — přidejte první níže.</p>
                )}
            </SectionCard>

            {defs.map((def: any) => {
                const value = draftFor(def)
                const dirty = Boolean(drafts[def.name])
                return (
                    <div key={def.name} className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-[8px] text-white/20 font-mono">{def.name}</span>
                                {def.manualOnly && <span className="text-[8px] px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-sm text-amber-400/80 font-bold uppercase tracking-wider">jen ručně</span>}
                                {def.uses_product && <span className="text-[8px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded-sm text-white/40 font-bold uppercase tracking-wider">produkt</span>}
                            </div>
                            <div className="flex items-center gap-3">
                                {dirty && (
                                    <button onClick={() => save({ ...value, name: def.name }, def.name)} disabled={busy !== null}
                                        className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 px-4 py-1.5 rounded-sm text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50">
                                        {busy === def.name ? "Ukládám..." : "💾 Uložit formát"}
                                    </button>
                                )}
                                <button onClick={() => remove(def.name)} disabled={busy !== null}
                                    className="text-[9px] text-red-400/40 hover:text-red-400 transition-colors font-bold uppercase tracking-widest disabled:opacity-50">
                                    🗑️ Smazat
                                </button>
                            </div>
                        </div>
                        <FormatFields value={value} onChange={patch => updateDraft(def.name, def, patch)} />
                    </div>
                )
            })}

            {showAdd ? (
                <div className="bg-[#0f0f0f] border border-emerald-500/20 rounded-sm p-6 space-y-4">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <span className="text-[10px] text-emerald-400/80 font-bold uppercase tracking-widest">Nový formát</span>
                        <button onClick={() => { setShowAdd(false); setError(null); setGenKeyword("") }}
                            className="text-[9px] text-white/30 hover:text-white/60 transition-colors font-bold uppercase tracking-widest">✕ Zrušit</button>
                    </div>

                    {/* AI fast path: type a word ("soutěž", "giveaway", "zákulisí") → AI fills every field below. */}
                    <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-sm p-3 space-y-2">
                        <FieldLabel hint="Napiš typ postu a AI vyplní zbytek formuláře — pak si ho zkontroluj a ulož">✨ Nech AI vyplnit</FieldLabel>
                        <div className="flex gap-2">
                            <input value={genKeyword} onChange={e => setGenKeyword(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter" && !genBusy) { e.preventDefault(); suggest() } }}
                                placeholder="např. soutěž, giveaway, zákulisí, návod…"
                                className={`${inputClass} flex-1`} />
                            <button onClick={suggest} disabled={genBusy || !genKeyword.trim()}
                                className="whitespace-nowrap bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-sm text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40">
                                {genBusy ? "AI přemýšlí…" : "✨ Vyplnit"}
                            </button>
                        </div>
                    </div>

                    <FormatFields value={addDraft} onChange={patch => setAddDraft(prev => ({ ...prev, ...patch }))} />
                    <button onClick={() => save(addDraft, "__add__")}
                        disabled={busy !== null || !addDraft.display_name.trim() || !addDraft.description.trim()}
                        className="w-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 py-3 rounded-sm text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40">
                        {busy === "__add__" ? "Ukládám..." : "💾 Vytvořit formát"}
                    </button>
                </div>
            ) : (
                <button onClick={() => setShowAdd(true)}
                    className="w-full py-4 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                    + Přidat nový formát
                </button>
            )}
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
                                        {style === "soft" ? "🫶 Jemné" : style === "medium" ? "💪 Střední" : "🔥 Přímý"}
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

/**
 * 3×3 preview of a feed pattern. Cells come from the real slot math (not a hand-drawn
 * mock-up), so the picker can never drift out of sync with what the engine actually does.
 */
function PatternMiniGrid({ patternId, accentColor }: { patternId: FeedPatternId; accentColor?: string }) {
    const TOTAL = 9
    // The grid reads newest-first, so cell 0 (top-left) is the NEWEST post: seq = TOTAL-1-pos.
    const cells = Array.from({ length: TOTAL }, (_, pos) =>
        computeSlotIntent(patternId, TOTAL - 1 - pos, TOTAL)?.visualMode ?? null
    )
    return (
        <div className="grid grid-cols-3 gap-0.5">
            {cells.map((mode, i) => {
                if (mode === "typography") {
                    return (
                        <div key={i} className="aspect-square bg-white/[0.06] border border-white/10 flex items-center justify-center">
                            <span className="text-[8px] font-black text-white/50">Aa</span>
                        </div>
                    )
                }
                if (mode === "graphic") {
                    return (
                        <div key={i} className="aspect-square border border-white/10"
                            style={{ backgroundColor: accentColor || "#e5533f", opacity: 0.7 }} />
                    )
                }
                // photo cell, and "none" (no pattern → every cell is just "a post")
                return <div key={i} className="aspect-square bg-white/[0.12] border border-white/10" />
            })}
        </div>
    )
}

function VisualSection({ config, updateField, handleLogoUpload, logoUploading, projectId, setConfig }: {
    config: any
    updateField: (p: string[], v: any) => void
    handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
    logoUploading: boolean
    projectId: string
    setConfig: (fn: any) => void
}) {
    // Feed-pattern recommendation, derived from the brand's REAL Instagram. The action is
    // read-only: it only fills the picker, and the user saves it like any other field.
    const [analyzing, setAnalyzing] = useState(false)
    const [recommendation, setRecommendation] = useState<
        { patternId: string; label: string; archetypes?: string[]; summary?: string } | null
    >(null)
    const [analyzeError, setAnalyzeError] = useState<string | null>(null)
    const igHandle = String(config.instagram || "").replace(/^@+/, "").trim()

    const handleAnalyzeFeed = async () => {
        setAnalyzing(true)
        setAnalyzeError(null)
        setRecommendation(null)
        try {
            const res = await recommendFeedPattern(projectId)
            if (!res.success || !res.patternId) {
                setAnalyzeError(res.error || "Analýza selhala.")
                return
            }
            setRecommendation({ patternId: res.patternId, label: res.label || res.patternId, archetypes: res.archetypes, summary: res.summary })
            // Fill the picker; the user still reviews and hits Uložit.
            updateField(["feedPattern"], res.patternId)
        } finally {
            setAnalyzing(false)
        }
    }

    return (
        <div className="space-y-6">
            <SectionCard title="Vzor feedu" description="Jaký tvar má vytvářet mřížka profilu, když si někdo otevře váš Instagram">
                {/* Suggest a pattern from the brand's real IG — the same vision pass onboarding runs */}
                <div className="flex items-center justify-between gap-4 mb-4 p-3 rounded-sm border border-white/5 bg-[#0a0a0a]">
                    <div className="min-w-0">
                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest">Nevíte, který vzor?</p>
                        <p className="text-[9px] text-white/25 mt-1 leading-relaxed">
                            {igHandle
                                ? <>AI se podívá na váš skutečný profil <span className="text-white/40">@{igHandle}</span> a doporučí vzor, který sedí k tomu, jak už vypadáte.</>
                                : "Doplňte Instagram účet v Základních údajích a AI vám vzor doporučí podle vašeho skutečného profilu."}
                        </p>
                    </div>
                    <button
                        onClick={handleAnalyzeFeed}
                        disabled={analyzing || !igHandle}
                        className={`shrink-0 px-4 py-2.5 rounded-sm text-[10px] font-bold uppercase tracking-widest border transition-all ${analyzing || !igHandle
                            ? "border-white/5 bg-white/5 text-white/25 cursor-not-allowed"
                            : "border-white/20 bg-white/5 text-white/70 hover:text-white hover:border-white/40"}`}
                    >
                        {analyzing ? "⏳ Analyzuji feed…" : "🔍 Analyzovat můj feed"}
                    </button>
                </div>

                {analyzeError && (
                    <div className="mb-4 p-3 rounded-sm border border-red-400/20 bg-red-400/5">
                        <p className="text-[10px] text-red-300/80 leading-relaxed">⚠️ {analyzeError}</p>
                    </div>
                )}

                {recommendation && (
                    <div className="mb-4 p-3 rounded-sm border border-emerald-400/20 bg-emerald-400/5">
                        <p className="text-[10px] text-emerald-300/90 font-bold uppercase tracking-widest">
                            ✓ Doporučeno: {recommendation.label}
                        </p>
                        {recommendation.summary && (
                            <p className="text-[9px] text-white/40 mt-1.5 leading-relaxed">{recommendation.summary}</p>
                        )}
                        {!!recommendation.archetypes?.length && (
                            <p className="text-[9px] text-white/25 mt-1.5 leading-relaxed">
                                Váš feed dnes staví na: {recommendation.archetypes.join(", ")}
                            </p>
                        )}
                        {recommendation.patternId === "none" && (
                            <p className="text-[9px] text-white/40 mt-1.5 leading-relaxed">
                                Z vašeho feedu se zatím nedá vyčíst dost na doporučení — vyberte vzor ručně, změnu uvidíte hned v Náhledu feedu.
                            </p>
                        )}
                        <p className="text-[8px] text-white/25 mt-2 uppercase tracking-widest font-bold">
                            Vybráno níže — nezapomeňte uložit
                        </p>
                    </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {FEED_PATTERNS.map(p => {
                        const active = (config.feedPattern || "none") === p.id
                        return (
                            <button
                                key={p.id}
                                onClick={() => updateField(["feedPattern"], p.id)}
                                className={`text-left p-3 rounded-sm border transition-all ${active
                                    ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10"
                                    : "border-white/5 bg-[#0a0a0a] hover:border-white/20"}`}
                            >
                                <PatternMiniGrid patternId={p.id} accentColor={config.feedAesthetic?.accentColor} />
                                <p className={`mt-2 text-[10px] font-bold uppercase tracking-widest ${active ? "text-aisummit-cinnabar" : "text-white/60"}`}>
                                    {p.label}
                                </p>
                                <p className="text-[9px] text-white/30 mt-1 leading-relaxed">{p.description}</p>
                                {p.gridAligned && (
                                    <p className="text-[8px] text-white/20 mt-1.5 uppercase tracking-widest font-bold">
                                        ⚠ Publikujte po řádcích (3)
                                    </p>
                                )}
                            </button>
                        )
                    })}
                </div>
                <p className="text-[9px] text-white/25 mt-3 leading-relaxed">
                    Vzor určuje jen <strong className="text-white/40">rodinu</strong> layoutu pro každou pozici v mřížce — uvnitř ní se posty
                    pořád liší kompozicí, výřezem i typografií. Nastavení platí pro všechny nové posty (kampaň i jednotlivé).
                </p>
            </SectionCard>

            <SectionCard title="Vizuální styl" description="Jak AI Designer renderuje obrázky postů (typografie, logo, video)">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <FieldLabel hint="Volný popis stylu písma — AI Designer se jím řídí (nejde o soubor fontu)">Styl typografie</FieldLabel>
                        <input value={config.feedAesthetic?.typographyStyle || ""}
                            onChange={(e) => updateField(["feedAesthetic", "typographyStyle"], e.target.value)}
                            placeholder="Bold condensed grotesk, uppercase / elegantní serif s vysokým kontrastem" className={inputClass} />
                    </div>
                    <div>
                        <FieldLabel hint="Auto = AI volí pozici a střídá ji mezi posty">Pozice loga</FieldLabel>
                        <select value={config.feedAesthetic?.logoPlacement || "auto"}
                            onChange={(e) => updateField(["feedAesthetic", "logoPlacement"], e.target.value)}
                            className={inputClass}>
                            <option value="auto">Auto — AI rozhodne (doporučeno)</option>
                            <option value="top-left">Vlevo nahoře</option>
                            <option value="top-right">Vpravo nahoře</option>
                            <option value="bottom-left">Vlevo dole</option>
                            <option value="bottom-right">Vpravo dole</option>
                        </select>
                    </div>
                </div>

                <div>
                    <FieldLabel hint="Kvalita/cena videa pro reels — Lite ~$0.06/s, Fast $0.15/s, Premium $0.40/s">Video kvalita (reels)</FieldLabel>
                    <select value={config.videoTier || "fast"}
                        onChange={(e) => updateField(["videoTier"], e.target.value)}
                        className={inputClass}>
                        <option value="lite">Lite — nejlevnější</option>
                        <option value="fast">Fast — doporučeno</option>
                        <option value="premium">Premium — nejvyšší kvalita</option>
                    </select>
                </div>
            </SectionCard>

            <SectionCard title="Vizuální Identita" description="Brand vstupy pro AI generování obrázků">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <FieldLabel hint="Popis atmosféry pro AI generování obrázků">Atmosféra & Styl fotek</FieldLabel>
                        <input value={config.feedAesthetic?.feel || ""} onChange={(e) => updateField(["feedAesthetic", "feel"], e.target.value)}
                            placeholder="Přírodní, hřejivý, denní světlo, rustikální" className={inputClass} />
                    </div>
                    <div>
                        <FieldLabel hint="Hex barva pro zvýrazněná klíčová slova v textu">Barva zvýraznění</FieldLabel>
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
                    <FieldLabel hint="Extra vizuální instrukce pro image prompt">Vlastní instrukce (pro AI)</FieldLabel>
                    <textarea value={config.feedAesthetic?.customInstructions || ""} onChange={(e) => updateField(["feedAesthetic", "customInstructions"], e.target.value)}
                        rows={2} placeholder="Vždy zahrnout zelené rostliny, dřevěné textury..." className={textareaClass} />
                </div>

                {/* Per-post-type Image Instructions */}
                <div>
                    <FieldLabel hint="Specifické instrukce pro obrázky dle typu postu — AI je použije v mega promptu">Instrukce pro obrázky (per typ)</FieldLabel>
                    <div className="space-y-2">
                        {Object.entries(config.imageInstructions || {}).map(([typeName, instruction]) => (
                            <div key={typeName} className="flex items-start gap-2 bg-[#050505] border border-white/5 rounded-sm p-2">
                                <input value={typeName} readOnly
                                    className="w-32 px-2 py-1.5 bg-transparent border border-white/10 rounded-sm text-[9px] font-mono text-white/50" />
                                <textarea
                                    value={(instruction as string) || ""}
                                    onChange={(e) => setConfig((prev: any) => ({
                                        ...prev,
                                        imageInstructions: { ...(prev.imageInstructions || {}), [typeName]: e.target.value }
                                    }))}
                                    rows={2}
                                    placeholder="Popis scény, co má být na obrázku..."
                                    className={`flex-1 ${textareaClass}`} />
                                <button onClick={() => setConfig((prev: any) => {
                                    const next = { ...(prev.imageInstructions || {}) }
                                    delete next[typeName]
                                    return { ...prev, imageInstructions: next }
                                })} className="text-[9px] text-red-400/40 hover:text-red-400 transition-colors mt-1 flex-shrink-0">✕</button>
                            </div>
                        ))}
                        <button
                            onClick={() => {
                                const newKey = `typ_${Date.now()}`
                                setConfig((prev: any) => ({
                                    ...prev,
                                    imageInstructions: { ...(prev.imageInstructions || {}), [newKey]: "" }
                                }))
                            }}
                            className="w-full py-2 border border-dashed border-white/10 rounded-sm text-[9px] text-white/30 font-bold uppercase tracking-widest hover:text-white/50 hover:border-white/20 transition-all"
                        >
                            + Přidat instrukci pro typ
                        </button>
                    </div>
                    {Object.keys(config.imageInstructions || {}).length === 0 && (
                        <p className="text-[9px] text-white/20 mt-1">Žádné instrukce — AI použije defaultní popis scény. Tip: přidej _default pro globální instrukci.</p>
                    )}
                </div>

                <div>
                    <FieldLabel hint="Instrukce pro video obsah">Zaměření videí</FieldLabel>
                    <textarea value={config.videoFocus || ""} onChange={(e) => updateField(["videoFocus"], e.target.value)}
                        rows={2} placeholder="Zaměřit na interiéry, pohled z první osoby, B-roll..." className={textareaClass} />
                </div>
            </SectionCard>

            {/* Logo */}
            <SectionCard title="Logo" description="Vodoznak na obrázcích">
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
        <SectionCard title="Skupiny hashtagů" description="AI vybírá mix hashtagů z těchto skupin pro každý post">
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
        { key: "soft", label: "Jemné CTA", description: "Jemné pobídnutí — ulož, sdílej, přemýšlej", emoji: "🫶", color: "text-blue-400" },
        { key: "medium", label: "Střední CTA", description: "Jasná výzva — komentuj, pošli kamarádovi", emoji: "💪", color: "text-amber-400" },
        { key: "hard", label: "Přímý prodej", description: "Přímý prodej — kup, objednej, rezervuj", emoji: "🔥", color: "text-red-400" },
    ]

    const updateStrategy = (key: string, value: string) => {
        const lines = value.split("\n").map(s => s.trim()).filter(Boolean)
        setConfig((prev: any) => ({
            ...prev,
            ctaStrategies: { ...(prev.ctaStrategies || {}), [key]: lines }
        }))
    }

    return (
        <SectionCard title="CTA Strategie" description="Výzvy k akci podle intenzity — AI vybírá na základě tématu a persony">
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

function InstagramConnectionSection({ projectId }: { projectId: string }) {
    const [status, setStatus] = useState<ConnectionStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [disconnecting, setDisconnecting] = useState(false)
    // OAuth callback redirects back with ?ig=connected|denied|error — show a banner.
    const [flash, setFlash] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            setStatus(await getConnectionStatus(projectId))
        } catch {
            setStatus(null)
        }
        setLoading(false)
    }, [projectId])

    useEffect(() => {
        load()
        if (typeof window !== "undefined") {
            const ig = new URLSearchParams(window.location.search).get("ig")
            if (ig === "connected") setFlash("✅ Instagram úspěšně připojen")
            else if (ig === "denied") setFlash("⚠️ Připojení zrušeno na straně Instagramu")
            else if (ig === "error") setFlash("❌ Připojení se nezdařilo, zkus to znovu")
        }
    }, [load])

    const handleDisconnect = async () => {
        setDisconnecting(true)
        await disconnectInstagram(projectId)
        await load()
        setDisconnecting(false)
    }

    const expiry = status?.expiresAt ? new Date(status.expiresAt).toLocaleDateString("cs-CZ") : null

    return (
        <SectionCard title="Instagram účet" why={HINTS.instagram}>
            {flash && (
                <p className="text-[10px] text-white/60 bg-white/5 rounded-sm px-3 py-2 mb-3">{flash}</p>
            )}

            {loading ? (
                <p className="text-[10px] text-white/30">Načítám…</p>
            ) : status?.connected ? (
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs text-white/60 font-bold">
                            Připojeno {status.username ? `· @${status.username}` : ""}
                        </p>
                        <p className="text-[9px] text-white/30 mt-0.5">
                            Token platí do {expiry || "—"} · obnovuje se automaticky
                        </p>
                    </div>
                    <button
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                        className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all border border-red-500/10 hover:border-red-500/20 whitespace-nowrap disabled:opacity-50"
                    >
                        {disconnecting ? "Odpojuji…" : "Odpojit"}
                    </button>
                </div>
            ) : (
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs text-white/60 font-bold">
                            {status?.status === "expired" ? "Připojení vypršelo" : "Připojit Instagram"}
                        </p>
                        <p className="text-[9px] text-white/30 mt-0.5">
                            {status?.configured
                                ? "Propojí tvůj Instagram Business účet pro metriky a publikování"
                                : "Instagram propojení zatím není v této instalaci nakonfigurováno"}
                        </p>
                    </div>
                    <a
                        href={status?.configured ? `/api/ig-connect/start?slug=${encodeURIComponent(projectId)}` : undefined}
                        aria-disabled={!status?.configured}
                        className={`px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all border whitespace-nowrap ${
                            status?.configured
                                ? "bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 border-pink-500/20"
                                : "bg-white/5 text-white/20 border-white/5 pointer-events-none"
                        }`}
                    >
                        📸 Připojit
                    </a>
                </div>
            )}
        </SectionCard>
    )
}

// Frequency presets → posts/week. 7 = daily, 14 = 2×/day (see distributeSchedule).
const AUTOPUB_CADENCES = [
    { v: 3, label: "3× týdně" },
    { v: 5, label: "5× týdně" },
    { v: 7, label: "Denně" },
    { v: 14, label: "2× denně" },
] as const
const DEFAULT_POST_TIMES = ["09:00", "17:00", "19:00"]

/**
 * Auto-publikování — per-client self-service for the auto-publish flywheel:
 * on/off (config.autoPublish), cadence (config.postsPerWeek) and posting times
 * (config.postingTimes). Saves via updateClientConfig; the daily auto_publish_arm
 * agent + distributeSchedule read these straight from the config. No DB poking.
 */
function AutoPublishSection({ projectId }: { projectId: string }) {
    const [enabled, setEnabled] = useState(false)
    const [cadence, setCadence] = useState(4)
    const [times, setTimes] = useState<string[]>(DEFAULT_POST_TIMES)
    const [connected, setConnected] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        Promise.all([getClientConfig(projectId), getConnectionStatus(projectId)])
            .then(([cfg, conn]) => {
                if (cancelled) return
                setEnabled(Boolean(cfg?.autoPublish))
                setCadence(Math.min(14, Math.max(1, Number(cfg?.postsPerWeek) || 4)))
                if (Array.isArray(cfg?.postingTimes) && cfg.postingTimes.length > 0) setTimes(cfg.postingTimes)
                setConnected(Boolean(conn?.connected))
            })
            .catch(() => { /* leave defaults */ })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [projectId])

    // How many posts/day this cadence implies, and therefore how many distinct times matter.
    const perDay = Math.max(1, Math.ceil(cadence / 7))
    const usedTimes = Math.min(perDay, times.length)

    const setTimeAt = (i: number, val: string) => setTimes(prev => prev.map((t, j) => j === i ? val : t))

    const save = async () => {
        setSaving(true); setMsg(null)
        const clean = times.map(t => t.trim()).filter(Boolean)
        // 2×/day needs ≥2 distinct times; fall back to defaults if the user cleared too many.
        const finalTimes = clean.length >= perDay ? clean : DEFAULT_POST_TIMES.slice(0, Math.max(perDay, clean.length || 1))
        const res = await updateClientConfig(projectId, {
            autoPublish: enabled,
            postsPerWeek: cadence,
            postingTimes: finalTimes,
        })
        setSaving(false)
        setMsg(res.success ? "✅ Uloženo" : (res.error || "Uložení selhalo"))
        if (res.success) setTimes(finalTimes)
    }

    return (
        <SectionCard title="Auto-publikování" description="Ať účet postuje sám v čase — obsah se vydává postupně podle zvolené frekvence a časů (český čas)." why={HINTS.autoPublish}>
            {loading ? (
                <p className="text-[10px] text-white/30">Načítám…</p>
            ) : (
                <div className="space-y-5">
                    {/* On/off */}
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-xs text-white/70 font-bold">Publikovat automaticky</p>
                            <p className="text-[9px] text-white/30 mt-0.5">Hotové příspěvky se samy naplánují a vydají — bez klikání.</p>
                        </div>
                        <button
                            onClick={() => setEnabled(v => !v)}
                            role="switch"
                            aria-checked={enabled}
                            className={`relative w-12 h-6 rounded-full transition-colors border ${enabled ? "bg-emerald-500/30 border-emerald-500/50" : "bg-white/5 border-white/15"}`}
                        >
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${enabled ? "left-6 bg-emerald-400" : "left-0.5 bg-white/40"}`} />
                        </button>
                    </div>

                    {!connected && (
                        <p className="text-[10px] text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-sm px-3 py-2">
                            ⚠️ Účet zatím není připojený — nastavení se uloží, ale publikovat se začne až po připojení Instagramu (sekce výše).
                        </p>
                    )}

                    {/* Frequency */}
                    <div>
                        <label className="block text-[8px] text-white/40 font-bold uppercase tracking-widest mb-2">Frekvence</label>
                        <div className="mb-2"><Hint label="kolik to stojí">{HINTS.cadence}</Hint></div>
                        <div className="flex flex-wrap gap-2">
                            {AUTOPUB_CADENCES.map(c => (
                                <button
                                    key={c.v}
                                    onClick={() => setCadence(c.v)}
                                    className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm border transition-all ${cadence === c.v ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}
                                >
                                    {c.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[9px] text-white/30 mt-2">
                            {cadence >= 8 ? `${perDay}× denně` : `${cadence}× týdně`} · drží se ~2 týdny naplánováno dopředu.
                        </p>
                    </div>

                    {/* Times */}
                    <div>
                        <label className="block text-[8px] text-white/40 font-bold uppercase tracking-widest mb-2">
                            Časy (ČR) {perDay > 1 ? `— první ${perDay} = posty dne` : "— střídají se"}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {times.map((t, i) => (
                                <input
                                    key={i}
                                    type="time"
                                    value={t}
                                    onChange={e => setTimeAt(i, e.target.value)}
                                    className={`px-3 py-1.5 bg-[#050505] border rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50 ${i < usedTimes ? "border-emerald-500/30" : "border-white/15 opacity-50"}`}
                                />
                            ))}
                        </div>
                        <p className="text-[9px] text-white/30 mt-2">Zelené časy se použijí pro zvolenou frekvenci. Mimo pracovní špičku doporučeno (9:00 / 17:00 / 19:00).</p>
                    </div>

                    <div className="flex items-center gap-3 pt-2 border-t border-white/10">
                        <button
                            onClick={save}
                            disabled={saving}
                            className="px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                        >
                            {saving ? "Ukládám…" : "Uložit"}
                        </button>
                        {msg && <span className="text-[10px] text-white/60">{msg}</span>}
                    </div>
                </div>
            )}
        </SectionCard>
    )
}

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
            {/* Re-onboarding */}
            <div className="flex items-center justify-between gap-4">
                <div>
                    <p className="text-xs text-white/60 font-bold">Kompletní re-onboarding</p>
                    <p className="text-[9px] text-white/30 mt-0.5">
                        Znovu analyzuje web, položí nové otázky a přegeneruje celý config od základu
                    </p>
                </div>
                <button
                    onClick={() => router.push(`/onboarding?reonboard=${projectId}`)}
                    className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all border border-amber-500/20 whitespace-nowrap"
                >
                    🔄 Re-onboarding
                </button>
            </div>

            <div className="border-t border-white/5 pt-4 mt-4" />

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
