"use client"

import { useEffect, useState, useCallback, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { useFormatter, useTranslations } from "next-intl"
import { motion, AnimatePresence } from "framer-motion"
import { getClientConfig, updateClientConfig, rescanClientWebsite, deleteClient, uploadClientLogo, upsertPostFormat, removePostFormat, suggestPostFormat, recommendFeedPattern, suggestBrandFacts, previewVoice, type PostFormatInput } from "@/app/actions/config-actions"
import { syncConfigProductsToDb } from "@/app/actions/product-actions"
import { CatalogSection } from "./products/CatalogSection"
import { generateCategoryPrompt } from "@/app/actions/content-plan-actions"
import { getConnectionStatus, disconnectInstagram, syncUploadPostConnection, type ConnectionStatus } from "@/app/actions/ig-connection-actions"
import { SubscriptionSection } from "./SubscriptionSection"
import { BillingSection } from "./BillingSection"
import { isReelMedium } from "@/lib/reel-media"
import { ConsultationSection } from "./ConsultationSection"
import { FEED_PATTERNS, computeSlotIntent, type FeedPatternId } from "@/lib/feed-pattern"
import { PHOTO_POLICY_OPTIONS } from "@/lib/photo-policy"
import { VOICE_LIBRARY, findVoice } from "@/lib/voice-library"
import { SUBTITLE_PRESET_OPTIONS, SUBTITLE_POSITION_OPTIONS, SUBTITLE_SIZE_OPTIONS } from "@/lib/subtitle-presets"
import { getConfigBrandImages } from "@/instagram/configs/types"
import { Hint, useHints } from "./Hint"
import { FACT_CHECK_MODES, factCheckModeIndex } from "@/lib/fact-check-modes"
import { getPublishOutlook, armAutoPublishNow, type PublishOutlook } from "@/app/actions/calendar-actions"
import { cancelClientHandoff, getClientAccess, isCurrentUserSuperAdmin, transferClientToUser, type ClientAccessRow, type ClientPendingHandoff } from "@/app/actions/admin-actions"
import { useStudioNavigate } from "@/app/(dashboard)/StudioContext"
import { Ban, CalendarDays, Camera, ClipboardList, Copy, Hand, Hash, Handshake, Landmark, Megaphone, Mic, Palette, Puzzle, RefreshCw, Send, Settings, ShoppingBag, Trash2, TriangleAlert, User, Users } from "lucide-react"
import { languageOptions } from "@/instagram/language"

// ═══════════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════

export function SettingsTab({ projectId }: { projectId: string }) {
    const t = useTranslations("settings")
    const [config, setConfig] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [logoUploading, setLogoUploading] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
    // Otevírá se na Publikování — jediné místo, kde se rozhoduje, jestli z toho
    // všeho vůbec něco vyleze na Instagram.
    const [activeSection, setActiveSection] = useState<string>("publish")

    const loadData = useCallback(async () => {
        if (!projectId) return
        setLoading(true)
        setMessage(null)
        const data = await getClientConfig(projectId)
        if (data) {
            setConfig(data)
        } else {
            setMessage({ type: 'error', text: t("status.loadFailed") })
        }
        setLoading(false)
    }, [projectId, t])

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
            setMessage({ type: 'success', text: t("status.logoUploaded") })
            await loadData()
        } else {
            setMessage({ type: 'error', text: result.error || t("status.logoUploadFailed") })
        }
        setLogoUploading(false)
        e.target.value = ''
    }

    const handleSave = async () => {
        setSaving(true)
        setMessage(null)
        const result = await updateClientConfig(projectId, config)
        if (result.success) {
            setMessage({ type: 'success', text: t("status.saved") })
            setTimeout(() => setMessage(null), 3000)
        } else {
            setMessage({ type: 'error', text: result.error || t("status.saveFailed") })
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
                <p className="text-xs font-bold uppercase tracking-wider">{t("status.notFound")}</p>
            </div>
        )
    }

    // Ikona je komponenta, ne emoji: záložky nastavení jsou rozhraní, ne obsah.
    const TABS_MAIN = [
        // Publikování je první schválně: dokud není připojený účet, celý zbytek
        // konfigurace nemá kam vyústit. Dřív se schovávalo úplně vzadu ve „Správě",
        // takže nejdůležitější krok onboardingu byl ten nejhůř dosažitelný.
        { id: "publish", label: t("tabs.publish"), Icon: Send },
        { id: "basic", label: t("tabs.basic"), Icon: ClipboardList },
        { id: "voice", label: t("tabs.voice"), Icon: Mic },
        { id: "pillars", label: t("tabs.pillars"), Icon: Landmark },
        { id: "formats", label: t("tabs.formats"), Icon: Puzzle },
        { id: "visual", label: t("tabs.visual"), Icon: Palette },
        { id: "products", label: t("tabs.products"), Icon: ShoppingBag },
        { id: "manage", label: t("tabs.manage"), Icon: Settings },
    ]

    const TABS_ADVANCED = [
        { id: "audience", label: t("tabs.audience"), Icon: Users },
        { id: "hashtags", label: t("tabs.hashtags"), Icon: Hash },
        { id: "cta", label: t("tabs.cta"), Icon: Megaphone },
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
                    <p className="text-white/50 text-xs mt-1 tracking-wide">{t("header.subtitle")}</p>
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
                        {saving ? t("header.saving") : t("header.save")}
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
                                <tab.Icon className="w-3.5 h-3.5 shrink-0" />
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
                            <span className="whitespace-nowrap">{t("tabs.advanced")}</span>
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
                                <span className="px-3 py-2.5 text-[9px] text-white/20 font-bold uppercase tracking-widest">{t("tabs.advancedPrefix")}</span>
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
                                            <tab.Icon className="w-3.5 h-3.5 shrink-0" />
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
                    {activeSection === "publish" && (
                        <PublishSection projectId={projectId} />
                    )}
                    {activeSection === "basic" && (
                        <BasicSection config={config} updateField={updateField} />
                    )}
                    {activeSection === "voice" && (
                        <VoiceSection config={config} updateField={updateField} updateArrayField={updateArrayField} projectId={projectId} />
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
                        <ClientManagementSection projectId={projectId} config={config} setConfig={setConfig} onReload={loadData} />
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
    const t = useTranslations("settings")
    return (
        <SectionCard title={t("basic.title")} description={t("basic.description")}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <FieldLabel>{t("basic.name")}</FieldLabel>
                    <input value={config.name || ""} onChange={(e) => updateField(["name"], e.target.value)} className={inputClass} />
                </div>
                <div>
                    <FieldLabel>{t("basic.website")}</FieldLabel>
                    <input value={config.website || ""} onChange={(e) => updateField(["website"], e.target.value)} className={inputClass} />
                </div>
                <div>
                    <FieldLabel>{t("basic.instagram")}</FieldLabel>
                    <input value={config.instagram || ""} onChange={(e) => updateField(["instagram"], e.target.value)} placeholder={t("basic.instagramPlaceholder")} className={inputClass} />
                </div>
                <div>
                    <FieldLabel hint={t("basic.focusHint")}>{t("basic.focus")}</FieldLabel>
                    <input value={config.contentFocus || ""} onChange={(e) => updateField(["contentFocus"], e.target.value)}
                        placeholder={t("basic.focusPlaceholder")} className={inputClass} />
                </div>
                <div>
                    {/* Jazyk ZNAČKY, ne dashboardu: řídí texty postů, hashtagy, typografii
                        v obraze, voiceover i to, co si AI o značce ukládá. Onboarding ho
                        odhadl z webu; tady se dá přepnout. */}
                    <FieldLabel hint={t("basic.languageHint")}>{t("basic.language")}</FieldLabel>
                    <select value={config.language || "cs"} onChange={(e) => updateField(["language"], e.target.value)} className={inputClass}>
                        {languageOptions().map(o => (
                            <option key={o.code} value={o.code}>{o.nativeName} ({o.code})</option>
                        ))}
                    </select>
                </div>
            </div>
            <div>
                <FieldLabel hint={t("basic.characterHint")}>{t("basic.character")}</FieldLabel>
                <textarea value={config.characterDescription || ""} onChange={(e) => updateField(["characterDescription"], e.target.value)}
                    rows={3} placeholder={t("basic.characterPlaceholder")} className={textareaClass} />
            </div>
        </SectionCard>
    )
}

// ═══════════════════════════════════════════════════════════
// 2. BRAND VOICE
// ═══════════════════════════════════════════════════════════

function VoiceSection({ config, updateField, updateArrayField, projectId }: {
    config: any
    updateField: (p: string[], v: any) => void
    updateArrayField: (p: string[], v: string) => void
    projectId: string
}) {
    const t = useTranslations("settings")
    const hints = useHints()
    const voice = config.brandVoice || {}

    return (
        <div className="space-y-6">
            <SectionCard title={t("voice.persona.title")} description={t("voice.persona.description")} why={hints.tone}>
                <div>
                    <FieldLabel hint={t("voice.persona.hint")}>{t("voice.persona.label")}</FieldLabel>
                    <textarea value={voice.persona || ""} onChange={(e) => updateField(["brandVoice", "persona"], e.target.value)}
                        rows={4} placeholder={t("voice.persona.placeholder")} className={textareaClass} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <FieldLabel hint={t("voice.traits.hint")}>{t("voice.traits.label")}</FieldLabel>
                        <input value={(voice.voiceTraits || []).join(", ")}
                            onChange={(e) => updateArrayField(["brandVoice", "voiceTraits"], e.target.value)}
                            placeholder={t("voice.traits.placeholder")} className={inputClass} />
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
                        <FieldLabel hint={t("voice.values.hint")}>{t("voice.values.label")}</FieldLabel>
                        <input value={(voice.values || []).join(", ")}
                            onChange={(e) => updateArrayField(["brandVoice", "values"], e.target.value)}
                            placeholder={t("voice.values.placeholder")} className={inputClass} />
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
                    <FieldLabel hint={t("voice.antiPatterns.hint")}>{t("voice.antiPatterns.label")}</FieldLabel>
                    <input value={(voice.antiPatterns || []).join(", ")}
                        onChange={(e) => updateArrayField(["brandVoice", "antiPatterns"], e.target.value)}
                        placeholder={t("voice.antiPatterns.placeholder")} className={inputClass} />
                    {voice.antiPatterns?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {voice.antiPatterns.map((a: string, i: number) => (
                                <span key={i} className="px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-sm text-[9px] text-red-400/70 font-bold uppercase tracking-wider"><Ban className="w-3.5 h-3.5 shrink-0 inline-block align-[-2px] mr-1" />{a}</span>
                            ))}
                        </div>
                    )}
                </div>
            </SectionCard>

            <SectionCard title={t("voice.brandVoice.title")} description={t("voice.brandVoice.description")}>
                <BrandVoicePicker config={config} updateField={updateField} projectId={projectId} />
            </SectionCard>

            <SectionCard title={t("voice.cta.title")} description={t("voice.cta.description")}>
                <div>
                    <FieldLabel hint={t("voice.cta.hint")}>{t("voice.cta.label")}</FieldLabel>
                    <textarea value={(voice.ctaVariations || []).join("\n")}
                        onChange={(e) => updateField(["brandVoice", "ctaVariations"], e.target.value.split("\n").map((s: string) => s.trim()).filter(Boolean))}
                        rows={4} placeholder={t("voice.cta.placeholder")} className={textareaClass} />
                    <p className="text-[8px] text-white/20 mt-1">{t("voice.cta.eachLine")}</p>
                </div>
            </SectionCard>

            <SectionCard title={t("voice.factsTitle")} description={t("voice.factsDescription")} why={hints.facts}>
                <FactsEditor config={config} updateField={updateField} projectId={projectId} />
            </SectionCard>

            <SectionCard title={t("voice.hooksTitle")} description={t("voice.hooksDescription")}>
                <HookTemplatesEditor config={config} updateField={updateField} />
            </SectionCard>
        </div>
    )
}

/**
 * Výběr hlasu značky.
 *
 * Ukázka se přehrává až na kliknutí, ne na najetí: syntéza prvního poslechu stojí
 * volání TTS (pak už je v bucketu pro celou flotilu) a automatické spouštění zvuku
 * v aplikaci nikdo nechce. Vybraný hlas se ukládá společným tlačítkem „Uložit"
 * nahoře, stejně jako zbytek nastavení.
 */
function BrandVoicePicker({ config, updateField, projectId }: {
    config: any
    updateField: (p: string[], v: any) => void
    projectId: string
}) {
    const t = useTranslations("settings")
    const selectedId: string | undefined = config.voice?.voiceId
    const [playing, setPlaying] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const play = async (voiceId: string) => {
        setError(null)
        setPlaying(voiceId)
        try {
            const res = await previewVoice(projectId, voiceId)
            if (!res.success || !res.url) throw new Error(res.error || t("voice.brandVoice.previewFailed"))
            const audio = new Audio(res.url)
            audio.onended = () => setPlaying(null)
            audio.onerror = () => { setError(t("voice.brandVoice.playFailed")); setPlaying(null) }
            await audio.play()
        } catch (err: any) {
            setError(err?.message || String(err))
            setPlaying(null)
        }
    }

    return (
        <div className="space-y-3">
            <p className="text-[10px] text-white/40 leading-relaxed">{t("voice.brandVoice.intro")}</p>
            {error && (
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-400">{error}</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {VOICE_LIBRARY.map(v => {
                    const active = v.id === selectedId
                    return (
                        <div key={v.id}
                            className={`flex items-start gap-3 p-3 rounded-sm border transition-all ${
                                active ? "bg-emerald-500/10 border-emerald-500/30" : "bg-white/[0.02] border-white/5 hover:border-white/15"
                            }`}>
                            <button
                                onClick={() => updateField(["voice"], { ...(config.voice || {}), provider: v.provider, voiceId: v.id })}
                                className="flex-1 text-left cursor-pointer"
                            >
                                <span className={`block text-[11px] font-black uppercase tracking-widest ${active ? "text-emerald-400" : "text-white/80"}`}>
                                    {v.name ?? v.id}
                                    <span className="ml-2 text-[8px] font-bold tracking-widest text-white/30">{v.provider === "elevenlabs" ? "ElevenLabs" : "Gemini"}</span>
                                </span>
                                <span className="block text-[10px] text-white/40 mt-1 leading-snug">{t.has(`voice.library.${v.id}`) ? t(`voice.library.${v.id}`) : v.label}</span>
                            </button>
                            <button
                                onClick={() => play(v.id)}
                                disabled={playing !== null}
                                className="shrink-0 px-3 py-2 rounded-sm border border-white/10 bg-white/5 hover:bg-white/10 text-[9px] font-bold uppercase tracking-widest text-white/60 disabled:opacity-40 cursor-pointer"
                            >
                                {playing === v.id ? t("voice.brandVoice.playing") : t("voice.brandVoice.play")}
                            </button>
                        </div>
                    )
                })}
            </div>
            {selectedId && !findVoice(selectedId) && (
                <p className="text-[10px] text-amber-400/80">{t("voice.brandVoice.unknown", { id: selectedId })}</p>
            )}
        </div>
    )
}

/**
 * Editor ověřených faktů.
 *
 * Fakt je řádek, volitelně `tvrzení | zdroj`. Textarea, ne formulář s poli: seznam
 * se vyplňuje jednou při rozjezdu a pak se do něj málokdy sahá — a psát do řádků je
 * rychlejší než klikat „přidat".
 *
 * `verifiedAt` se razítkuje sám: fakta stárnou (ceny, otvíračka, počty) a nikdo si
 * nebude pamatovat, kdy je naposledy potvrdil. Nezměněný řádek si datum drží.
 */
function FactsEditor({ config, updateField, projectId }: { config: any; updateField: (p: string[], v: any) => void; projectId: string }) {
    const facts: { text: string; source?: string; verifiedAt?: string }[] = config.brandFacts || []
    const modeIndex = factCheckModeIndex(config.factCheckMode ?? (config.factCheck === false ? "off" : undefined))
    const publishFlagged = config.publishFlaggedPosts === true
    const t = useTranslations("settings")
    const [scanning, setScanning] = useState(false)
    const [scanMsg, setScanMsg] = useState<string | null>(null)

    // Sken webu jen NAVRHUJE. Zapsat se to musí do stejného pole jako ruční řádky
    // (a uložit tlačítkem výš) — jinak by se v Nastavení objevila tvrzení, která
    // nikdo nepotvrdil, a „ověřená fakta" by přestala být ověřená.
    const scanSite = async () => {
        setScanning(true)
        setScanMsg(null)
        try {
            const res = await suggestBrandFacts(projectId)
            if (!res.success) {
                setScanMsg(res.error || t("facts.scanReadFailed"))
            } else if (res.facts.length === 0) {
                setScanMsg(t("facts.scanNothing"))
            } else {
                const today = new Date().toISOString().slice(0, 10)
                updateField(["brandFacts"], [...facts, ...res.facts.map(f => ({ ...f, verifiedAt: today }))])
                setScanMsg(t("facts.scanAdded", { count: res.facts.length }))
            }
        } catch (e: any) {
            setScanMsg(e?.message || t("facts.scanFailed"))
        } finally {
            setScanning(false)
        }
    }

    const text = facts.map(f => (f.source ? `${f.text} | ${f.source}` : f.text)).join("\n")

    const parse = (raw: string) => {
        const today = new Date().toISOString().slice(0, 10)
        const next = raw.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
            const [claim, ...rest] = line.split("|")
            const fact: { text: string; source?: string; verifiedAt?: string } = { text: claim.trim() }
            const source = rest.join("|").trim()
            if (source) fact.source = source
            const previous = facts.find(f => f.text === fact.text)
            fact.verifiedAt = previous?.verifiedAt || today
            return fact
        })
        updateField(["brandFacts"], next)
    }

    return (
        <div className="space-y-5">
            <div>
                <FieldLabel hint={t("facts.hint")}>{t("facts.label")}</FieldLabel>
                <textarea
                    value={text}
                    onChange={(e) => parse(e.target.value)}
                    rows={7}
                    placeholder={t("facts.placeholder")}
                    className={textareaClass}
                />
                <p className="text-[8px] text-white/20 mt-1">{t("facts.note")}</p>
                <div className="flex items-center gap-3 mt-3">
                    <button
                        onClick={scanSite}
                        disabled={scanning}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-sm text-[9px] font-bold uppercase tracking-widest text-white/60 disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3 h-3 ${scanning ? "animate-spin" : ""}`} />
                        {scanning ? t("facts.scanning") : t("facts.scan")}
                    </button>
                    {scanMsg && <span className="text-[9px] text-white/40">{scanMsg}</span>}
                </div>
            </div>

            {facts.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {facts.slice(0, 12).map((f, i) => (
                        <span key={i} title={f.verifiedAt ? t("facts.verifiedAt", { date: f.verifiedAt }) : undefined}
                            className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-sm text-[9px] text-emerald-400/70 font-bold uppercase tracking-wider">
                            {f.text.length > 48 ? f.text.slice(0, 48) + "…" : f.text}
                        </span>
                    ))}
                </div>
            )}

            <div className="border-t border-white/10 pt-4">
                <FieldLabel hint={t("facts.checkHint")}>{t("facts.checkLabel")}</FieldLabel>
                <input
                    type="range"
                    min={0}
                    max={FACT_CHECK_MODES.length - 1}
                    step={1}
                    value={modeIndex}
                    onChange={(e) => updateField(["factCheckMode"], FACT_CHECK_MODES[Number(e.target.value)].value)}
                    aria-label={t("facts.checkLabel")}
                    className="w-full accent-emerald-400 mt-1"
                />
                <div className="flex justify-between mt-1">
                    {FACT_CHECK_MODES.map((m, i) => (
                        <button
                            key={m.value}
                            onClick={() => updateField(["factCheckMode"], m.value)}
                            className={`text-[8px] uppercase tracking-widest font-bold transition-colors ${i === modeIndex ? "text-emerald-400" : "text-white/25 hover:text-white/50"}`}
                        >{t(`facts.modes.${m.value}.label`)}</button>
                    ))}
                </div>
                <p className="text-[10px] text-white/50 mt-3 bg-white/5 border border-white/10 rounded-sm px-3 py-2">
                    {t(`facts.modes.${FACT_CHECK_MODES[modeIndex].value}.detail`)}
                </p>

                {/* Auto-publikování je bezobslužné: bez tohohle přepínače by označený
                    příspěvek odešel na Instagram dřív, než ho kdokoli uvidí. Default
                    je „počká na vás" — zapnout to jde, ale vědomě. */}
                <div className="flex items-center justify-between gap-4 mt-5">
                    <div>
                        <p className="text-xs text-white/70 font-bold">{t("facts.publishFlagged")}</p>
                        <p className="text-[9px] text-white/30 mt-0.5">{t("facts.publishFlaggedHint")}</p>
                    </div>
                    <button
                        onClick={() => updateField(["publishFlaggedPosts"], !publishFlagged)}
                        role="switch"
                        aria-checked={publishFlagged}
                        aria-label={t("facts.publishFlagged")}
                        className={`shrink-0 relative w-12 h-6 rounded-full transition-colors border ${publishFlagged ? "bg-amber-500/30 border-amber-500/50" : "bg-white/5 border-white/15"}`}
                    >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${publishFlagged ? "left-6 bg-amber-400" : "left-0.5 bg-white/40"}`} />
                    </button>
                </div>
            </div>
        </div>
    )
}

// Hook templates sub-editor
function HookTemplatesEditor({ config, updateField }: { config: any; updateField: (p: string[], v: any) => void }) {
    const t = useTranslations("settings")
    const templates = config.brandVoice?.hookTemplates || []
    const TRIGGERS = ["curiosity", "fear", "hope", "humor", "urgency", "empathy"] as const
    // Popisky spouští žijí v messages (`hooks.triggers.<id>`); tady zůstává jen emoji.
    const TRIGGER_EMOJI: Record<string, string> = {
        curiosity: "🤔",
        fear: "😰",
        hope: "✨",
        humor: "😄",
        urgency: "⚡",
        empathy: "💛",
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

    const postTypes: string[] = config.postTypes || []

    const toggleBestFor = (idx: number, postType: string) => {
        const current: string[] = templates[idx]?.bestFor || []
        updateTemplate(idx, "bestFor", current.includes(postType)
            ? current.filter(p => p !== postType)
            : [...current, postType])
    }

    return (
        <div className="space-y-4">
            {templates.length === 0 && (
                <p className="text-[10px] text-white/30 text-center py-4">{t("hooks.empty")}</p>
            )}
            {templates.map((t: any, idx: number) => (
                <div key={idx} className="bg-[#050505] border border-white/10 rounded-sm p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">{t("hooks.item", { n: idx + 1 })}</span>
                        <button onClick={() => removeTemplate(idx)} className="text-[9px] text-red-400/50 hover:text-red-400 transition-colors">{t("hooks.remove")}</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <FieldLabel hint={t("hooks.patternHint")}>{t("hooks.pattern")}</FieldLabel>
                            <input value={t.pattern || ""} onChange={(e) => updateTemplate(idx, "pattern", e.target.value)}
                                placeholder={t("hooks.patternPlaceholder")} className={inputClass} />
                        </div>
                        <div>
                            <FieldLabel>{t("hooks.example")}</FieldLabel>
                            <input value={t.example || ""} onChange={(e) => updateTemplate(idx, "example", e.target.value)}
                                placeholder={t("hooks.examplePlaceholder")} className={inputClass} />
                        </div>
                    </div>
                    <div>
                        <FieldLabel>{t("hooks.trigger")}</FieldLabel>
                        <div className="flex flex-wrap gap-1.5">
                            {TRIGGERS.map(tr => (
                                <button key={tr} onClick={() => updateTemplate(idx, "trigger", tr)}
                                    className={`px-3 py-1.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border transition-all ${
                                        t.trigger === tr
                                            ? "bg-white/10 border-white/20 text-white"
                                            : "border-white/5 text-white/30 hover:text-white/60"
                                    }`}>
                                    {TRIGGER_EMOJI[tr]} {t(`hooks.triggers.${tr}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* Pole `bestFor` se dřív vůbec nezobrazovalo, takže ručně přidaná
                        šablona měla prázdný seznam formátů a nešlo ho vyplnit. Prázdné
                        je v pořádku (= platí všude), ale musí to jít nastavit. */}
                    <div>
                        <FieldLabel hint={t("hooks.bestForHint")}>{t("hooks.bestFor")}</FieldLabel>
                        <div className="flex flex-wrap gap-1.5">
                            {postTypes.map((pt: string) => {
                                const on = (t.bestFor || []).includes(pt)
                                return (
                                    <button key={pt} onClick={() => toggleBestFor(idx, pt)}
                                        className={`px-2.5 py-1.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border transition-all ${
                                            on ? "bg-white/10 border-white/20 text-white" : "border-white/5 text-white/30 hover:text-white/60"
                                        }`}>
                                        {pt}
                                    </button>
                                )
                            })}
                            {/* Formáty, které už neexistují — ať se při uložení tiše neztratí. */}
                            {(t.bestFor || []).filter((b: string) => !postTypes.includes(b)).map((stale: string) => (
                                <button key={stale} onClick={() => toggleBestFor(idx, stale)}
                                    title={t("hooks.staleTitle")}
                                    className="px-2.5 py-1.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border border-amber-500/30 bg-amber-500/10 text-amber-300/70">
                                    {stale} ✕
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            ))}
            <button onClick={addTemplate}
                className="w-full py-3 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                {t("hooks.add")}
            </button>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// 3. CONTENT PILLARS
// ═══════════════════════════════════════════════════════════

function PillarsSection({ config, setConfig, projectId }: { config: any; setConfig: (fn: any) => void; projectId: string }) {
    const t = useTranslations("settings")
    const hints = useHints()
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
                [id]: { emoji: "📝", label: t("pillars.newLabel"), description: "", postTypes: [], ratio: 0.2, ctaStrategy: "soft", kpi: [] }
            }
        }))
    }

    const removePillar = (key: string) => {
        const owned: string[] = pillars[key]?.postTypes || []
        const remaining = Object.keys(pillars).filter(k => k !== key)
        if (owned.length > 0) {
            if (remaining.length === 0) {
                alert(t("pillars.lastPillar"))
                return
            }
            const firstLabel = pillars[remaining[0]]?.label || remaining[0]
            if (!confirm(t("pillars.removeConfirm", { count: owned.length, formats: owned.join(", "), target: firstLabel }))) return
        }
        setConfig((prev: any) => {
            const next = { ...prev.contentPillars }
            delete next[key]
            return { ...prev, contentPillars: next }
        })
    }

    const CTA_OPTIONS = [
        { value: "none", label: t("pillars.cta.none"), color: "text-white/30" },
        { value: "soft", label: t("pillars.cta.soft"), color: "text-blue-400" },
        { value: "medium", label: t("pillars.cta.medium"), color: "text-amber-400" },
        { value: "hard", label: t("pillars.cta.hard"), color: "text-red-400" },
    ]

    // Total ratio
    const totalRatio = pillarEntries.reduce((sum, [, p]) => sum + ((p as any).ratio || 0), 0)

    return (
        <div className="space-y-6">
            <SectionCard title={t("pillars.title")} description={t("pillars.description")} why={hints.pillars}>
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
                            <span>{t("pillars.sum", { sum: totalRatio.toFixed(2) })}</span>
                            <span className={totalRatio > 0.95 && totalRatio < 1.05 ? "text-emerald-400" : "text-amber-400"}>
                                {totalRatio > 0.95 && totalRatio < 1.05 ? t("pillars.sumOk") : t("pillars.sumWarn")}
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
                                    className="bg-transparent text-white font-black uppercase tracking-tight text-sm border-none focus:outline-none w-48" placeholder={t("pillars.namePlaceholder")} />
                                <p className="text-[8px] text-white/20 font-mono">{key}</p>
                            </div>
                        </div>
                        <button onClick={() => removePillar(key)} className="text-[9px] text-red-400/40 hover:text-red-400 transition-colors font-bold uppercase tracking-widest">
                            <span className="inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 shrink-0" />{t("common.remove")}</span>
                        </button>
                    </div>

                    <div>
                        <FieldLabel>{t("pillars.descriptionLabel")}</FieldLabel>
                        <textarea value={pillar.description || ""} onChange={(e) => updatePillar(key, "description", e.target.value)}
                            rows={2} placeholder={t("pillars.descriptionPlaceholder")} className={textareaClass} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <FieldLabel hint={t("pillars.ratioHint")}>{t("pillars.ratio")}</FieldLabel>
                            <div className="flex items-center gap-3">
                                <input type="range" min="0" max="1" step="0.05" value={pillar.ratio || 0}
                                    onChange={(e) => updatePillar(key, "ratio", parseFloat(e.target.value))}
                                    className="flex-1 accent-aisummit-cinnabar" />
                                <span className="text-xs text-white/60 font-bold w-12 text-right">{((pillar.ratio || 0) * 100).toFixed(0)}%</span>
                            </div>
                        </div>
                        <div>
                            <FieldLabel>{t("pillars.ctaLabel")}</FieldLabel>
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
                            <FieldLabel hint={t("pillars.kpiHint")}>{t("pillars.kpi")}</FieldLabel>
                            <input value={(pillar.kpi || []).join(", ")}
                                onChange={(e) => updatePillar(key, "kpi", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                                placeholder={t("pillars.kpiPlaceholder")} className={inputClass} />
                        </div>
                    </div>

                    {/* postTypes hidden — managed internally via categories */}

                    <div>
                        <FieldLabel hint={t("pillars.ideaPromptHint")}>{t("pillars.ideaPrompt")}</FieldLabel>
                        <textarea value={pillar.ideaPrompt || ""} onChange={(e) => updatePillar(key, "ideaPrompt", e.target.value)}
                            rows={2} placeholder={t("pillars.ideaPromptPlaceholder")} className={textareaClass} />
                    </div>

                    {/* Categories within pillar */}
                    <div className="border-t border-white/5 pt-4 mt-2">
                        <FieldLabel hint={t("pillars.categoriesHint")}>{t("pillars.categories")}</FieldLabel>
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
                                            }} placeholder={t("pillars.categoryIdPlaceholder")} className="w-28 px-2 py-1.5 bg-transparent border border-white/10 rounded-sm text-[9px] font-mono text-white/50 focus:outline-none focus:ring-1 focus:ring-white/30" />
                                            <input value={cat.label || ""} onChange={(e) => {
                                                const cats = [...(pillar.categories || [])]
                                                cats[catIdx] = { ...cats[catIdx], label: e.target.value }
                                                updatePillar(key, "categories", cats)
                                            }} placeholder={t("pillars.categoryNamePlaceholder")} className="flex-1 px-2 py-1.5 bg-transparent border border-white/10 rounded-sm text-xs text-white font-bold focus:outline-none focus:ring-1 focus:ring-white/30" />
                                        </div>
                                        <div className="flex gap-1.5 items-start">
                                            <input value={cat.prompt || ""} onChange={(e) => {
                                                const cats = [...(pillar.categories || [])]
                                                cats[catIdx] = { ...cats[catIdx], prompt: e.target.value }
                                                updatePillar(key, "categories", cats)
                                            }} placeholder={t("pillars.categoryPromptPlaceholder")} className="flex-1 px-2 py-1.5 bg-transparent border border-white/5 rounded-sm text-[10px] text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30" />
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
                                                title={t("pillars.categoryGenerateTitle")}
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
                                            }} className="flex-1 px-1.5 py-1 bg-[#050505] border border-white/5 rounded-sm text-[9px] text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30" title={t("pillars.mediumTitle")}>
                                                <option value="auto">{t("pillars.auto")}</option>
                                                <option value="image">{t("pillars.medium.image")}</option>
                                                <option value="carousel">{t("pillars.medium.carousel")}</option>
                                            </select>
                                            <select value={cat.overlayStyle || "auto"} onChange={(e) => {
                                                const cats = [...(pillar.categories || [])]
                                                cats[catIdx] = { ...cats[catIdx], overlayStyle: e.target.value }
                                                updatePillar(key, "categories", cats)
                                            }} className="flex-1 px-1.5 py-1 bg-[#050505] border border-white/5 rounded-sm text-[9px] text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30" title={t("pillars.overlayTitle")}>
                                                <option value="auto">{t("pillars.auto")}</option>
                                                <option value="default">{t("pillars.overlay.default")}</option>
                                                <option value="top">{t("pillars.overlay.top")}</option>
                                                <option value="cover">{t("pillars.overlay.cover")}</option>
                                                <option value="editorial">{t("pillars.overlay.editorial")}</option>
                                                <option value="centered">{t("pillars.overlay.centered")}</option>
                                                <option value="none">{t("pillars.overlay.none")}</option>
                                            </select>
                                            <select value={cat.aspectRatio || "auto"} onChange={(e) => {
                                                const cats = [...(pillar.categories || [])]
                                                cats[catIdx] = { ...cats[catIdx], aspectRatio: e.target.value }
                                                updatePillar(key, "categories", cats)
                                            }} className="flex-1 px-1.5 py-1 bg-[#050505] border border-white/5 rounded-sm text-[9px] text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30" title={t("pillars.aspectTitle")}>
                                                <option value="auto">{t("pillars.auto")}</option>
                                                <option value="1:1">{t("pillars.aspect.square")}</option>
                                                <option value="4:5">{t("pillars.aspect.feed")}</option>
                                                <option value="3:4">{t("pillars.aspect.portrait")}</option>
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
                                {t("pillars.addCategory")}
                            </button>
                        </div>
                    </div>
                </div>
            ))}

            <button onClick={addPillar}
                className="w-full py-4 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                {t("pillars.add")}
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

// Popisky médií a stylů textu žijí v messages (`formats.media.<id>`, `formats.overlays.<id>`).
const MEDIUM_OPTIONS = ["image", "story", "carousel", "reel", "reel_long"] as const
const RATIO_OPTIONS = ["1:1", "4:5", "3:4"] as const
/** Media pinned to 9:16 — mirrors VERTICAL_MEDIA in instagram/format-clamps.ts. */
const isVerticalMedium = (m: string) => isReelMedium(m) || m === "story"
// Static-media overlay styles (reels are always text-free "none").
const OVERLAY_OPTIONS = ["default", "top", "cover", "centered", "editorial", "split", "minimal", "full-typo", "step"] as const

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
    const t = useTranslations("settings")
    const hints = useHints()

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
        else setError(res.error || t("formats.suggestFailed"))
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
        if (!res.success) setError(res.error || t("formats.saveFailed"))
        else {
            setDrafts(prev => { const next = { ...prev }; delete next[key]; return next })
            if (key === "__add__") { setShowAdd(false); setAddDraft(emptyFormatDraft(pillarKeys)); setGenKeyword("") }
            await onReload()
        }
        setBusy(null)
    }

    const remove = async (name: string) => {
        if (!confirm(t("formats.removeConfirm", { name }))) return
        setBusy(name); setError(null)
        const res = await removePostFormat(projectId, name)
        if (!res.success) setError(res.error || t("formats.removeFailed"))
        else await onReload()
        setBusy(null)
    }

    const FormatFields = ({ value, onChange }: { value: PostFormatInput; onChange: (p: Partial<PostFormatInput>) => void }) => (
        <div className="space-y-3">
            <div className="flex items-start gap-3">
                <input value={value.emoji} onChange={e => onChange({ emoji: e.target.value })}
                    className="w-12 h-12 text-center text-2xl bg-[#050505] border border-white/10 rounded-sm focus:outline-none focus:ring-1 focus:ring-white/30" />
                <div className="flex-1">
                    <FieldLabel>{t("formats.name")}</FieldLabel>
                    <input value={value.display_name} onChange={e => onChange({ display_name: e.target.value })}
                        placeholder={t("formats.namePlaceholder")} className={inputClass} />
                </div>
            </div>
            <div>
                <FieldLabel hint={t("formats.descriptionHint")}>{t("formats.descriptionLabel")}</FieldLabel>
                <textarea value={value.description} onChange={e => onChange({ description: e.target.value })}
                    rows={3} placeholder={t("formats.descriptionPlaceholder")} className={textareaClass} />
            </div>
            <div>
                <FieldLabel hint={t("formats.structureHint")}>{t("formats.structure")}</FieldLabel>
                <textarea value={value.structure || ""} onChange={e => onChange({ structure: e.target.value })}
                    rows={3} placeholder={t("formats.structurePlaceholder")} className={textareaClass} />
            </div>
            <div>
                <FieldLabel hint={t("formats.visualStyleHint")}>{t("formats.visualStyle")}</FieldLabel>
                <textarea value={value.visualStyle || ""} onChange={e => onChange({ visualStyle: e.target.value })}
                    rows={2} placeholder={t("formats.visualStylePlaceholder")} className={textareaClass} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                    <FieldLabel>{t("formats.pillar")}</FieldLabel>
                    <select value={value.pillar} onChange={e => onChange({ pillar: e.target.value })} className={inputClass}>
                        {pillarKeys.map(k => <option key={k} value={k}>{pillars[k]?.emoji} {pillars[k]?.label || k}</option>)}
                    </select>
                </div>
                <div>
                    <FieldLabel>{t("formats.medium")}</FieldLabel>
                    <select value={value.medium} onChange={e => onChange({ medium: e.target.value as PostFormatInput["medium"] })} className={inputClass}>
                        {MEDIUM_OPTIONS.map(m => <option key={m} value={m}>{t(`formats.media.${m}`)}</option>)}
                    </select>
                </div>
                <div>
                    <FieldLabel>{t("formats.aspect")}</FieldLabel>
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
                        <span className="inline-flex items-center gap-1.5 text-[9px] text-white/50 font-bold uppercase tracking-widest"><ShoppingBag className="w-3 h-3 shrink-0" />{t("formats.withProduct")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={Boolean(value.manualOnly)} onChange={e => onChange({ manualOnly: e.target.checked })}
                            className="accent-amber-500" />
                        <span className="inline-flex items-center gap-1.5 text-[9px] text-white/50 font-bold uppercase tracking-widest"><Hand className="w-3 h-3 shrink-0" />{t("formats.manualOnly")}</span>
                    </label>
                </div>
            </div>
            {!isReelMedium(value.medium) && (
                <div className="max-w-[240px]">
                    <FieldLabel hint={t("formats.overlayHint")}>{t("formats.overlay")}</FieldLabel>
                    <select value={value.overlayStyle || (value.medium === "carousel" ? "cover" : "default")}
                        onChange={e => onChange({ overlayStyle: e.target.value as PostFormatInput["overlayStyle"] })} className={inputClass}>
                        {OVERLAY_OPTIONS.map(o => <option key={o} value={o}>{t(`formats.overlays.${o}`)}</option>)}
                    </select>
                </div>
            )}
        </div>
    )

    return (
        <div className="space-y-6">
            <SectionCard title={t("formats.title")} description={t("formats.description")} why={hints.formats}>
                {error && (
                    <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest">{error}</p>
                )}
                {defs.length === 0 && (
                    <p className="text-[10px] text-white/30 text-center py-4">{t("formats.empty")}</p>
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
                                {def.manualOnly && <span className="text-[8px] px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-sm text-amber-400/80 font-bold uppercase tracking-wider">{t("formats.badgeManual")}</span>}
                                {def.uses_product && <span className="text-[8px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded-sm text-white/40 font-bold uppercase tracking-wider">{t("formats.badgeProduct")}</span>}
                            </div>
                            <div className="flex items-center gap-3">
                                {dirty && (
                                    <button onClick={() => save({ ...value, name: def.name }, def.name)} disabled={busy !== null}
                                        className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 px-4 py-1.5 rounded-sm text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50">
                                        {busy === def.name ? t("formats.saving") : t("formats.save")}
                                    </button>
                                )}
                                <button onClick={() => remove(def.name)} disabled={busy !== null}
                                    className="text-[9px] text-red-400/40 hover:text-red-400 transition-colors font-bold uppercase tracking-widest disabled:opacity-50">
                                    <span className="inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 shrink-0" />{t("common.remove")}</span>
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
                        <span className="text-[10px] text-emerald-400/80 font-bold uppercase tracking-widest">{t("formats.new")}</span>
                        <button onClick={() => { setShowAdd(false); setError(null); setGenKeyword("") }}
                            className="text-[9px] text-white/30 hover:text-white/60 transition-colors font-bold uppercase tracking-widest">{t("formats.cancel")}</button>
                    </div>

                    {/* AI fast path: type a word ("soutěž", "giveaway", "zákulisí") → AI fills every field below. */}
                    <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-sm p-3 space-y-2">
                        <FieldLabel hint={t("formats.ai.hint")}>{t("formats.ai.label")}</FieldLabel>
                        <div className="flex gap-2">
                            <input value={genKeyword} onChange={e => setGenKeyword(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter" && !genBusy) { e.preventDefault(); suggest() } }}
                                placeholder={t("formats.ai.placeholder")}
                                className={`${inputClass} flex-1`} />
                            <button onClick={suggest} disabled={genBusy || !genKeyword.trim()}
                                className="whitespace-nowrap bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-sm text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40">
                                {genBusy ? t("formats.ai.thinking") : t("formats.ai.fill")}
                            </button>
                        </div>
                    </div>

                    <FormatFields value={addDraft} onChange={patch => setAddDraft(prev => ({ ...prev, ...patch }))} />
                    <button onClick={() => save(addDraft, "__add__")}
                        disabled={busy !== null || !addDraft.display_name.trim() || !addDraft.description.trim()}
                        className="w-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 py-3 rounded-sm text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40">
                        {busy === "__add__" ? t("formats.saving") : t("formats.create")}
                    </button>
                </div>
            ) : (
                <button onClick={() => setShowAdd(true)}
                    className="w-full py-4 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                    {t("formats.add")}
                </button>
            )}
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// 4. AUDIENCE PERSONAS
// ═══════════════════════════════════════════════════════════

function AudienceSection({ config, setConfig }: { config: any; setConfig: (fn: any) => void }) {
    const t = useTranslations("settings")
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
                label: t("audience.newLabel"), ageRange: "25-35", painPoints: [], triggers: [], ctaStyle: "soft"
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
            <SectionCard title={t("audience.title")} description={t("audience.description")}>
                {personas.length === 0 && (
                    <p className="text-[10px] text-white/30 text-center py-4">{t("audience.empty")}</p>
                )}
            </SectionCard>

            {personas.map((p, idx) => (
                <div key={idx} className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-4">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <div className="flex items-center gap-3">
                            <User className="w-6 h-6" />
                            <input value={p.label || ""} onChange={(e) => updatePersona(idx, "label", e.target.value)}
                                className="bg-transparent text-white font-black uppercase tracking-tight text-sm border-none focus:outline-none" placeholder={t("audience.namePlaceholder")} />
                        </div>
                        <button onClick={() => removePersona(idx)} className="text-[9px] text-red-400/40 hover:text-red-400 transition-colors font-bold uppercase tracking-widest">
                            <span className="inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 shrink-0" />{t("common.remove")}</span>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <FieldLabel>{t("audience.age")}</FieldLabel>
                            <input value={p.ageRange || ""} onChange={(e) => updatePersona(idx, "ageRange", e.target.value)}
                                placeholder="25-35" className={inputClass} />
                        </div>
                        <div>
                            <FieldLabel>{t("audience.ctaStyle")}</FieldLabel>
                            <div className="flex gap-1.5">
                                {(["soft", "medium", "hard"] as const).map(style => (
                                    <button key={style} onClick={() => updatePersona(idx, "ctaStyle", style)}
                                        className={`flex-1 py-2 rounded-sm text-[9px] font-bold uppercase tracking-widest border transition-all ${
                                            p.ctaStyle === style
                                                ? "bg-white/10 border-white/20 text-white"
                                                : "border-white/5 text-white/30 hover:text-white/60"
                                        }`}>
                                        {t(`audience.cta.${style}`)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div>
                        <FieldLabel hint={t("audience.painHint")}>{t("audience.pain")}</FieldLabel>
                        <input value={(p.painPoints || []).join(", ")}
                            onChange={(e) => updatePersona(idx, "painPoints", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                            placeholder={t("audience.painPlaceholder")} className={inputClass} />
                    </div>

                    <div>
                        <FieldLabel hint={t("audience.triggersHint")}>{t("audience.triggers")}</FieldLabel>
                        <input value={(p.triggers || []).join(", ")}
                            onChange={(e) => updatePersona(idx, "triggers", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                            placeholder={t("audience.triggersPlaceholder")} className={inputClass} />
                    </div>
                </div>
            ))}

            <button onClick={addPersona}
                className="w-full py-4 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                {t("audience.add")}
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
    const t = useTranslations("settings")
    const igHandle = String(config.instagram || "").replace(/^@+/, "").trim()
    // „Přednost mým fotkám" bez jediné nahrané fotky nemá čeho se chytit — a mlčet
    // o tom je horší než to říct: zákazník by čekal svoje fotky a dostal vymyšlené.
    const hasBrandPhotos = getConfigBrandImages(config).length > 0

    const handleAnalyzeFeed = async () => {
        setAnalyzing(true)
        setAnalyzeError(null)
        setRecommendation(null)
        try {
            const res = await recommendFeedPattern(projectId)
            if (!res.success || !res.patternId) {
                setAnalyzeError(res.error || t("visual.pattern.analyzeFailed"))
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
            <SectionCard title={t("visual.pattern.title")} description={t("visual.pattern.description")}>
                {/* Suggest a pattern from the brand's real IG — the same vision pass onboarding runs */}
                <div className="flex items-center justify-between gap-4 mb-4 p-3 rounded-sm border border-white/5 bg-[#0a0a0a]">
                    <div className="min-w-0">
                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest">{t("visual.pattern.suggestTitle")}</p>
                        <p className="text-[9px] text-white/25 mt-1 leading-relaxed">
                            {igHandle
                                ? t.rich("visual.pattern.suggestWithHandle", { handle: igHandle, em: chunks => <span className="text-white/40">{chunks}</span> })
                                : t("visual.pattern.suggestNoHandle")}
                        </p>
                    </div>
                    <button
                        onClick={handleAnalyzeFeed}
                        disabled={analyzing || !igHandle}
                        className={`shrink-0 px-4 py-2.5 rounded-sm text-[10px] font-bold uppercase tracking-widest border transition-all ${analyzing || !igHandle
                            ? "border-white/5 bg-white/5 text-white/25 cursor-not-allowed"
                            : "border-white/20 bg-white/5 text-white/70 hover:text-white hover:border-white/40"}`}
                    >
                        {analyzing ? t("visual.pattern.analyzing") : t("visual.pattern.analyze")}
                    </button>
                </div>

                {analyzeError && (
                    <div className="mb-4 p-3 rounded-sm border border-red-400/20 bg-red-400/5">
                        <p className="text-[10px] text-red-300/80 leading-relaxed"><TriangleAlert className="w-3.5 h-3.5 shrink-0 inline-block align-[-2px] mr-1" />{analyzeError}</p>
                    </div>
                )}

                {recommendation && (
                    <div className="mb-4 p-3 rounded-sm border border-emerald-400/20 bg-emerald-400/5">
                        <p className="text-[10px] text-emerald-300/90 font-bold uppercase tracking-widest">
                            {t("visual.pattern.recommended", { label: recommendation.label })}
                        </p>
                        {recommendation.summary && (
                            <p className="text-[9px] text-white/40 mt-1.5 leading-relaxed">{recommendation.summary}</p>
                        )}
                        {!!recommendation.archetypes?.length && (
                            <p className="text-[9px] text-white/25 mt-1.5 leading-relaxed">
                                {t("visual.pattern.basedOn", { list: recommendation.archetypes.join(", ") })}
                            </p>
                        )}
                        {recommendation.patternId === "none" && (
                            <p className="text-[9px] text-white/40 mt-1.5 leading-relaxed">
                                {t("visual.pattern.noneHint")}
                            </p>
                        )}
                        <p className="text-[8px] text-white/25 mt-2 uppercase tracking-widest font-bold">
                            {t("visual.pattern.selectedBelow")}
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
                                    {t(`visual.pattern.patterns.${p.id}.label`)}
                                </p>
                                <p className="text-[9px] text-white/30 mt-1 leading-relaxed">{t(`visual.pattern.patterns.${p.id}.description`)}</p>
                                {p.gridAligned && (
                                    <p className="inline-flex items-center gap-1.5 text-[8px] text-white/20 mt-1.5 uppercase tracking-widest font-bold"><TriangleAlert className="w-3 h-3 shrink-0" />{t("visual.pattern.gridAligned")}</p>
                                )}
                            </button>
                        )
                    })}
                </div>
                <p className="text-[9px] text-white/25 mt-3 leading-relaxed">
                    {t.rich("visual.pattern.note", { strong: chunks => <strong className="text-white/40">{chunks}</strong> })}
                </p>
            </SectionCard>

            <SectionCard
                title={t("visual.photos.title")}
                description={t("visual.photos.description")}
            >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {PHOTO_POLICY_OPTIONS.map(o => {
                        const active = (config.photoPolicy || "free") === o.id
                        return (
                            <button
                                key={o.id}
                                onClick={() => updateField(["photoPolicy"], o.id)}
                                className={`text-left p-4 rounded-sm border transition-all ${active
                                    ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10"
                                    : "border-white/5 bg-[#0a0a0a] hover:border-white/20"}`}
                            >
                                <p className={`text-[10px] font-bold uppercase tracking-widest ${active ? "text-aisummit-cinnabar" : "text-white/60"}`}>
                                    {t(`visual.photos.policies.${o.id}.label`)}
                                </p>
                                <p className="text-[9px] text-white/30 mt-1.5 leading-relaxed">{t(`visual.photos.policies.${o.id}.description`)}</p>
                            </button>
                        )
                    })}
                </div>
                <p className="text-[9px] text-white/25 mt-3 leading-relaxed">
                    {t.rich("visual.photos.note", { strong: chunks => <strong className="text-white/40">{chunks}</strong> })}
                    {(config.photoPolicy === "prefer-real" || config.photoPolicy === "only-real") && !hasBrandPhotos && (
                        <span className="block mt-2 text-amber-400/80 font-bold">
                            {t("visual.photos.noPhotos")}
                        </span>
                    )}
                </p>
            </SectionCard>

            <SectionCard
                title={t("visual.subtitles.title")}
                description={t("visual.subtitles.description")}
            >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {SUBTITLE_PRESET_OPTIONS.map(o => {
                        const active = (config.subtitleStyle?.preset || "pop") === o.id
                        return (
                            <button
                                key={o.id}
                                onClick={() => updateField(["subtitleStyle", "preset"], o.id)}
                                className={`text-left p-4 rounded-sm border transition-all ${active
                                    ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10"
                                    : "border-white/5 bg-[#0a0a0a] hover:border-white/20"}`}
                            >
                                <p className={`text-[10px] font-bold uppercase tracking-widest ${active ? "text-aisummit-cinnabar" : "text-white/60"}`}>
                                    {t(`visual.subtitles.presets.${o.id}.label`)}
                                </p>
                                <p className="text-[9px] text-white/30 mt-1.5 leading-relaxed">{t(`visual.subtitles.presets.${o.id}.description`)}</p>
                            </button>
                        )
                    })}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                        <FieldLabel hint={t("visual.subtitles.positionHint")}>{t("visual.subtitles.position")}</FieldLabel>
                        <select value={config.subtitleStyle?.position || "bottom"}
                            onChange={(e) => updateField(["subtitleStyle", "position"], e.target.value)}
                            className={inputClass}>
                            {SUBTITLE_POSITION_OPTIONS.map(o => <option key={o.id} value={o.id}>{t(`visual.subtitles.positions.${o.id}`)}</option>)}
                        </select>
                    </div>
                    <div>
                        <FieldLabel hint={t("visual.subtitles.sizeHint")}>{t("visual.subtitles.size")}</FieldLabel>
                        <select value={config.subtitleStyle?.size || "m"}
                            onChange={(e) => updateField(["subtitleStyle", "size"], e.target.value)}
                            className={inputClass}>
                            {SUBTITLE_SIZE_OPTIONS.map(o => <option key={o.id} value={o.id}>{t(`visual.subtitles.sizes.${o.id}`)}</option>)}
                        </select>
                    </div>
                </div>
                <label className="flex items-start gap-2.5 cursor-pointer mt-4 pt-4 border-t border-white/5">
                    <input
                        type="checkbox"
                        checked={(config.reelModes ?? ["voiceover", "text"]).includes("text")}
                        onChange={(e) => updateField(["reelModes"], e.target.checked ? ["voiceover", "text"] : ["voiceover"])}
                        className="mt-0.5 accent-emerald-500"
                    />
                    <span className="text-[10px] text-white/40 leading-relaxed">
                        {t("visual.subtitles.allowSilent")}
                        <span className="block text-white/25">
                            {t.rich("visual.subtitles.allowSilentNote", { strong: chunks => <strong className="text-white/40">{chunks}</strong> })}
                        </span>
                    </span>
                </label>
                <p className="text-[9px] text-white/25 mt-3 leading-relaxed">
                    {t.rich("visual.subtitles.note", { strong: chunks => <strong className="text-white/40">{chunks}</strong> })}
                </p>
            </SectionCard>

            <SectionCard title={t("visual.style.title")} description={t("visual.style.description")}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <FieldLabel hint={t("visual.style.typographyHint")}>{t("visual.style.typography")}</FieldLabel>
                        <input value={config.feedAesthetic?.typographyStyle || ""}
                            onChange={(e) => updateField(["feedAesthetic", "typographyStyle"], e.target.value)}
                            placeholder={t("visual.style.typographyPlaceholder")} className={inputClass} />
                    </div>
                    <div>
                        <FieldLabel hint={t("visual.style.logoPlacementHint")}>{t("visual.style.logoPlacement")}</FieldLabel>
                        <select value={config.feedAesthetic?.logoPlacement || "auto"}
                            onChange={(e) => updateField(["feedAesthetic", "logoPlacement"], e.target.value)}
                            className={inputClass}>
                            <option value="auto">{t("visual.style.logo.auto")}</option>
                            <option value="top-left">{t("visual.style.logo.top-left")}</option>
                            <option value="top-right">{t("visual.style.logo.top-right")}</option>
                            <option value="bottom-left">{t("visual.style.logo.bottom-left")}</option>
                            <option value="bottom-right">{t("visual.style.logo.bottom-right")}</option>
                        </select>
                    </div>
                </div>

            </SectionCard>

            <SectionCard title={t("visual.identity.title")} description={t("visual.identity.description")}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <FieldLabel hint={t("visual.identity.feelHint")}>{t("visual.identity.feel")}</FieldLabel>
                        <input value={config.feedAesthetic?.feel || ""} onChange={(e) => updateField(["feedAesthetic", "feel"], e.target.value)}
                            placeholder={t("visual.identity.feelPlaceholder")} className={inputClass} />
                    </div>
                    <div>
                        <FieldLabel hint={t("visual.identity.accentHint")}>{t("visual.identity.accent")}</FieldLabel>
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
                    <FieldLabel hint={t("visual.identity.customHint")}>{t("visual.identity.custom")}</FieldLabel>
                    <textarea value={config.feedAesthetic?.customInstructions || ""} onChange={(e) => updateField(["feedAesthetic", "customInstructions"], e.target.value)}
                        rows={2} placeholder={t("visual.identity.customPlaceholder")} className={textareaClass} />
                </div>

                {/* Per-post-type Image Instructions */}
                <div>
                    <FieldLabel hint={t("visual.identity.imageInstructionsHint")}>{t("visual.identity.imageInstructions")}</FieldLabel>
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
                                    placeholder={t("visual.identity.instructionPlaceholder")}
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
                            {t("visual.identity.addInstruction")}
                        </button>
                    </div>
                    {Object.keys(config.imageInstructions || {}).length === 0 && (
                        <p className="text-[9px] text-white/20 mt-1">{t("visual.identity.noInstructions")}</p>
                    )}
                </div>

                <div>
                    <FieldLabel hint={t("visual.identity.videoFocusHint")}>{t("visual.identity.videoFocus")}</FieldLabel>
                    <textarea value={config.videoFocus || ""} onChange={(e) => updateField(["videoFocus"], e.target.value)}
                        rows={2} placeholder={t("visual.identity.videoFocusPlaceholder")} className={textareaClass} />
                </div>
            </SectionCard>

            {/* Logo */}
            <SectionCard title={t("visual.logo.title")} description={t("visual.logo.description")}>
                {config.logoFile && (
                    <div className="flex items-center gap-3">
                        <img
                            src={`https://nyvbxpjkwhcuugwevobu.supabase.co/storage/v1/object/public/audit-screenshots/client-assets/${projectId}/logo.png?t=${Date.now()}`}
                            alt={t("visual.logo.alt")}
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
                    {logoUploading ? t("visual.logo.uploading") : config.logoFile ? t("visual.logo.replace") : t("visual.logo.upload")}
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={logoUploading} />
                </label>
                <p className="text-[9px] text-white/20">{t("visual.logo.note")}</p>
            </SectionCard>

        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// 6. HASHTAGS
// ═══════════════════════════════════════════════════════════

function HashtagsSection({ config, updateArrayField }: { config: any; updateArrayField: (p: string[], v: string) => void }) {
    const t = useTranslations("settings")
    const pools = config.hashtagPools || {}
    // Popisky skupin žijí v messages (`hashtags.pools.<key>`); tady zůstává jen klíč a emoji.
    const POOL_TYPES = [
        { key: "core", emoji: "🔹" },
        { key: "niche", emoji: "🎯" },
        { key: "broad", emoji: "🌍" },
        { key: "trending", emoji: "📈" },
        { key: "czech", emoji: "📍" },
    ]

    return (
        <SectionCard title={t("hashtags.title")} description={t("hashtags.description")}>
            <div className="space-y-5">
                {POOL_TYPES.map(pool => (
                    <div key={pool.key}>
                        <FieldLabel hint={t(`hashtags.pools.${pool.key}.description`)}>{pool.emoji} {t(`hashtags.pools.${pool.key}.label`)}</FieldLabel>
                        <textarea
                            value={(pools[pool.key] || []).join(", ")}
                            onChange={(e) => updateArrayField(["hashtagPools", pool.key], e.target.value)}
                            rows={2}
                            placeholder={t("hashtags.placeholder")}
                            className={textareaClass}
                        />
                        <div className="flex items-center justify-between mt-1">
                            <div className="flex flex-wrap gap-1 mt-1">
                                {(pools[pool.key] || []).slice(0, 8).map((h: string, i: number) => (
                                    <span key={i} className="text-[8px] text-blue-400/60 font-mono">{h.startsWith("#") ? h : `#${h}`}</span>
                                ))}
                                {(pools[pool.key] || []).length > 8 && (
                                    <span className="text-[8px] text-white/20">{t("hashtags.more", { count: (pools[pool.key] || []).length - 8 })}</span>
                                )}
                            </div>
                            <span className="text-[8px] text-white/20 font-bold">{t("hashtags.count", { count: (pools[pool.key] || []).length })}</span>
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
    const t = useTranslations("settings")
    const strategies = config.ctaStrategies || {}

    // Popisky i placeholdery žijí v messages (`cta.strategies.<key>`); tady zůstává klíč, emoji a barva.
    const STRATEGY_TYPES = [
        { key: "none", emoji: "🤫", color: "text-white/40" },
        { key: "soft", emoji: "🫶", color: "text-blue-400" },
        { key: "medium", emoji: "💪", color: "text-amber-400" },
        { key: "hard", emoji: "🔥", color: "text-red-400" },
    ]

    const updateStrategy = (key: string, value: string) => {
        const lines = value.split("\n").map(s => s.trim()).filter(Boolean)
        setConfig((prev: any) => ({
            ...prev,
            ctaStrategies: { ...(prev.ctaStrategies || {}), [key]: lines }
        }))
    }

    return (
        <SectionCard title={t("cta.title")} description={t("cta.description")}>
            <div className="space-y-5">
                {STRATEGY_TYPES.map(strat => (
                    <div key={strat.key} className="bg-[#050505] border border-white/10 rounded-sm p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-lg">{strat.emoji}</span>
                            <div>
                                <span className={`text-xs font-black uppercase tracking-wider ${strat.color}`}>{t(`cta.strategies.${strat.key}.label`)}</span>
                                <p className="text-[8px] text-white/20">{t(`cta.strategies.${strat.key}.description`)}</p>
                            </div>
                        </div>
                        <textarea
                            value={(strategies[strat.key] || []).join("\n")}
                            onChange={(e) => updateStrategy(strat.key, e.target.value)}
                            rows={3}
                            placeholder={t(`cta.strategies.${strat.key}.placeholder`)}
                            className={textareaClass}
                        />
                        <p className="text-[8px] text-white/20 mt-1">{t("cta.count", { count: (strategies[strat.key] || []).length })}</p>
                    </div>
                ))}
            </div>
        </SectionCard>
    )
}

// ═══════════════════════════════════════════════════════════
// 8. CLIENT MANAGEMENT (Rescan + Delete)
// ═══════════════════════════════════════════════════════════

/**
 * Publikování — první karta v Nastavení, protože dokud není připojený účet, nemá
 * zbytek konfigurace kam vyústit.
 *
 * Drží jen jeden kus stavu: „účet se právě připojil". Připojení totiž mění, co má
 * ukazovat karta POD ním (fronta se dá naostřit, termíny začnou platit), a bez
 * tohohle pojítka by po připojení zůstala viset na starých číslech, dokud by
 * člověk stránku nepřenačetl — přesně v ten okamžik, kdy chce vidět, že to jede.
 */
function PublishSection({ projectId }: { projectId: string }) {
    const [connectedTick, setConnectedTick] = useState(0)
    // Memoizované schválně: karta připojení si ho bere do závislostí efektu, který
    // poslouchá návrat do okna. Nová funkce při každém renderu = odhlásit a znovu
    // přihlásit posluchače pokaždé.
    const handleConnected = useCallback(() => setConnectedTick(t => t + 1), [])
    return (
        <>
            <InstagramConnectionSection projectId={projectId} onConnected={handleConnected} />
            <AutoPublishSection projectId={projectId} refreshKey={connectedTick} />
        </>
    )
}

/** Média pro `standalone` níž. Reference musí být stabilní, jinak se
 *  `useSyncExternalStore` odebírá znovu při každém renderu. */
const standaloneQuery = () => window.matchMedia("(display-mode: standalone)")

function subscribeStandalone(onChange: () => void): () => void {
    const mq = standaloneQuery()
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
}

function isStandalone(): boolean {
    // `navigator.standalone` je iOS-only a na appce přidané na plochu je jediné,
    // co tam spolehlivě sedí; `display-mode` pokrývá Android a desktop.
    if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true
    return standaloneQuery().matches
}

function InstagramConnectionSection({ projectId, onConnected }: { projectId: string; onConnected?: () => void }) {
    const [status, setStatus] = useState<ConnectionStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [disconnecting, setDisconnecting] = useState(false)
    const [connecting, setConnecting] = useState(false)
    // OAuth callback redirects back with ?ig=connected|denied|error — show a banner.
    const [flash, setFlash] = useState<string | null>(null)
    const t = useTranslations("settings")
    const hints = useHints()
    const format = useFormatter()
    /**
     * Běžíme jako appka přidaná na plochu (`display: standalone`)?
     *
     * iOS v tom režimu drží i odchozí navigaci ve svém WKWebView a Meta v embedded
     * prohlížečích přihlášení blokuje — uživatel dojde na stránku upload-postu,
     * klepne na Instagram a dostane „something went wrong". Ověřeno 2026-09-01:
     * tentýž účet stejným odkazem na desktopu projde. Když to víme dopředu, řekneme
     * to routě a ta poslední krok předá Safari (viz /api/ig-connect/bridge).
     *
     * `useSyncExternalStore`, ne stav v efektu: serverový snapshot je natvrdo
     * `false`, takže se hydratace nerozejde, a médium si React odebírá sám.
     */
    const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false)

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
            if (ig === "connected") {
                setFlash(t("connection.flash.connected"))
                // Návrat z našeho OAuth (transport `meta`) — stejný okamžik jako
                // dokončené připojení přes most, tak i stejná reakce.
                armAutoPublishNow(projectId).catch(() => null)
            }
            else if (ig === "denied") setFlash(t("connection.flash.denied"))
            // Návrat z mostu, kde účet ještě propojený nebyl — uživatel se vrátil dřív,
            // než to dokončil. To není chyba, jen nedodělek, a rada musí být jiná.
            else if (ig === "pending") setFlash(t("connection.flash.pending"))
            else if (ig === "limit") setFlash(t("connection.flash.limit"))
            else if (ig === "error") setFlash(t("connection.flash.error"))
        }
    }, [load, projectId, t])

    const isBridge = status?.transport === "uploadpost"

    /**
     * Co se má stát v okamžiku, kdy je účet konečně připojený.
     *
     * Naostření tady není kosmetika: klient, který si auto-publikování zapnul dřív,
     * než připojil účet (agent tehdy skončil na „no live Instagram connection"), by
     * jinak čekal na denní běh. Když je auto-publikování vypnuté, akce sama nic
     * neudělá — opt-in se kontroluje na serveru.
     */
    const afterConnect = useCallback(async () => {
        await armAutoPublishNow(projectId).catch(() => null)
        await load()
        onConnected?.()
    }, [projectId, load, onConnected])

    /**
     * The bridge authorizes on upload-post's own hosted page, so there is no redirect
     * back into the app to hook. Reconcile when the tab regains focus instead — that
     * is the moment the tenant has finished over there and come back.
     */
    useEffect(() => {
        if (!isBridge) return
        const reconcile = async () => {
            const res = await syncUploadPostConnection(projectId)
            if (res.connected) {
                setFlash(t("connection.flash.connected"))
                await afterConnect()
            }
        }
        // `visibilitychange` vedle `focus`: při návratu z jiné APLIKACE (Safari zpět
        // do appky na ploše) iOS `focus` na window spolehlivě nevystřelí, a to je
        // přesně cesta, kterou mobilní připojení chodí. Sesouhlasení je idempotentní,
        // takže dvojí spuštění nevadí.
        const onVisible = () => {
            if (document.visibilityState === "visible") void reconcile()
        }
        window.addEventListener("focus", reconcile)
        document.addEventListener("visibilitychange", onVisible)
        return () => {
            window.removeEventListener("focus", reconcile)
            document.removeEventListener("visibilitychange", onVisible)
        }
    }, [isBridge, projectId, afterConnect, t])

    const handleVerify = async () => {
        setConnecting(true)
        const res = await syncUploadPostConnection(projectId)
        setConnecting(false)
        // Selhání není „ještě nedokončeno": účet, který už publikuje za jinou značku,
        // by jinak tenant dokončoval donekonečna.
        setFlash(res.connected ? t("connection.flash.connected") : res.error || t("connection.flash.pendingWindow"))
        if (res.connected) await afterConnect()
        else await load()
    }

    const handleDisconnect = async () => {
        setDisconnecting(true)
        await disconnectInstagram(projectId)
        await load()
        setDisconnecting(false)
    }

    const expiry = status?.expiresAt ? format.dateTime(new Date(status.expiresAt), { day: "numeric", month: "numeric", year: "numeric" }) : null

    return (
        <SectionCard title={t("connection.title")} why={hints.instagram}>
            {flash && (
                <p className="text-[10px] text-white/60 bg-white/5 rounded-sm px-3 py-2 mb-3">{flash}</p>
            )}

            {loading ? (
                <p className="text-[10px] text-white/30">{t("common.loading")}</p>
            ) : status?.connected ? (
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs text-white/60 font-bold">
                            {t("connection.connected")} {status.username ? `· @${status.username}` : ""}
                        </p>
                        <p className="text-[9px] text-white/30 mt-0.5">
                            {isBridge
                                ? t("connection.bridgeInfo")
                                : t("connection.tokenInfo", { date: expiry || "—" })}
                        </p>
                    </div>
                    <button
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                        className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all border border-red-500/10 hover:border-red-500/20 whitespace-nowrap disabled:opacity-50"
                    >
                        {disconnecting ? t("connection.disconnecting") : t("connection.disconnect")}
                    </button>
                </div>
            ) : (
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs text-white/60 font-bold">
                            {status?.status === "expired" ? t("connection.expired") : t("connection.connectTitle")}
                        </p>
                        <p className="text-[9px] text-white/30 mt-0.5">
                            {status?.configured
                                ? t("connection.configured")
                                : t("connection.notConfigured")}
                        </p>
                    </div>
                    {isBridge ? (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleVerify}
                                disabled={!status?.configured || connecting}
                                className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm text-white/40 hover:text-white/70 hover:bg-white/5 transition-all border border-white/5 whitespace-nowrap disabled:opacity-40"
                            >
                                {t("connection.verify")}
                            </button>
                            {/* Odkaz, ne tlačítko s window.open(): adresu podepisuje upload-post
                                až po dvou voláních svého API, takže než by se okno otevřelo, je
                                uživatelské gesto promlčené a popup blocker ho zahodí — profil
                                vznikne, ale přihlašovací stránka se neukáže. Přesměrování dělá
                                /api/ig-connect/bridge, stejně jako u našeho vlastního OAuth. */}
                            <a
                                href={status?.configured ? `/api/ig-connect/bridge?slug=${encodeURIComponent(projectId)}${standalone ? "&external=1" : ""}` : undefined}
                                aria-disabled={!status?.configured}
                                className={`px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all border whitespace-nowrap ${
                                    status?.configured
                                        ? "bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 border-pink-500/20"
                                        : "bg-white/5 text-white/20 border-white/5 pointer-events-none"
                                }`}
                            >
                                <span className="inline-flex items-center gap-1.5"><Camera className="w-3.5 h-3.5 shrink-0" />{t("connection.connect")}</span>
                            </a>
                        </div>
                    ) : (
                        <a
                            href={status?.configured ? `/api/ig-connect/start?slug=${encodeURIComponent(projectId)}` : undefined}
                            aria-disabled={!status?.configured}
                            className={`px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all border whitespace-nowrap ${
                                status?.configured
                                    ? "bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 border-pink-500/20"
                                    : "bg-white/5 text-white/20 border-white/5 pointer-events-none"
                            }`}
                        >
                            <span className="inline-flex items-center gap-1.5"><Camera className="w-3.5 h-3.5 shrink-0" />{t("connection.connect")}</span>
                        </a>
                    )}
                </div>
            )}
        </SectionCard>
    )
}

/**
 * Auto-publikování — jediný přepínač: publikovat samo, nebo ne.
 *
 * Frekvence a časy tu BÝVALY (config.postsPerWeek + config.postingTimes) a byly to
 * druhé kormidlo vedle plánu: termín každého příspěvku vzniká jednou při generování
 * a od té chvíle žije v kalendáři, takže „jak často publikovat" v Nastavení nemělo
 * co řídit — jen tvrdilo něco jiného, než co uživatel viděl v plánu. Kadence patří
 * tam, kde plán vzniká (Tvořit → délka plánu), a čas patří konkrétnímu příspěvku.
 *
 * Zbývá tedy jedna otázka, na kterou plán odpovědět neumí: smí to ven bez klikání?
 * Zbytek karty jen ukazuje, co plán říká — přes getPublishOutlook.
 */
function AutoPublishSection({ projectId, refreshKey = 0 }: { projectId: string; refreshKey?: number }) {
    const [enabled, setEnabled] = useState(false)
    const [connected, setConnected] = useState(false)
    const [outlook, setOutlook] = useState<PublishOutlook | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState<string | null>(null)
    const navigate = useStudioNavigate()
    const t = useTranslations("settings")
    const hints = useHints()
    const format = useFormatter()

    useEffect(() => {
        let cancelled = false
        Promise.all([
            getClientConfig(projectId),
            getConnectionStatus(projectId),
            getPublishOutlook(projectId).catch(() => null),
        ])
            .then(([cfg, conn, out]) => {
                if (cancelled) return
                setEnabled(Boolean(cfg?.autoPublish))
                setConnected(Boolean(conn?.connected))
                setOutlook(out)
            })
            .catch(() => { /* leave defaults */ })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
        // refreshKey: karta nad námi právě připojila účet — čísla i varování se
        // musí přepočítat, jinak zůstane svítit „účet není připojený".
    }, [projectId, refreshKey])

    const save = async (next: boolean) => {
        setSaving(true); setMsg(null)
        setEnabled(next)
        const res = await updateClientConfig(projectId, { autoPublish: next })
        if (!res.success) {
            setSaving(false)
            // vrátit přepínač, když se uložení nepovedlo
            setEnabled(!next)
            setMsg(res.error || t("autoPublish.saveFailed"))
            return
        }

        // Zapnutí musí být VIDĚT hned. Denní agent by frontu naostřil až zítra ráno,
        // takže by se člověk po zapnutí koukal na nezměněná čísla a nevěděl, jestli
        // to vůbec něco udělalo.
        if (next) {
            await armAutoPublishNow(projectId).catch(() => null)
            setOutlook(await getPublishOutlook(projectId).catch(() => null))
        }
        setSaving(false)
        setMsg(next ? t("autoPublish.on") : t("autoPublish.off"))
    }

    const fmt = (iso: string) => format.dateTime(new Date(iso), {
        day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
    })

    return (
        <SectionCard
            title={t("autoPublish.title")}
            description={t("autoPublish.description")}
            why={hints.autoPublish}
        >
            {loading ? (
                <p className="text-[10px] text-white/30">{t("common.loading")}</p>
            ) : (
                <div className="space-y-5">
                    {/* On/off */}
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-xs text-white/70 font-bold">{t("autoPublish.toggle")}</p>
                            <p className="text-[9px] text-white/30 mt-0.5">{t("autoPublish.toggleHint")}</p>
                        </div>
                        <button
                            onClick={() => save(!enabled)}
                            disabled={saving}
                            role="switch"
                            aria-checked={enabled}
                            aria-label={t("autoPublish.toggle")}
                            className={`relative w-12 h-6 rounded-full transition-colors border disabled:opacity-50 ${enabled ? "bg-emerald-500/30 border-emerald-500/50" : "bg-white/5 border-white/15"}`}
                        >
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${enabled ? "left-6 bg-emerald-400" : "left-0.5 bg-white/40"}`} />
                        </button>
                    </div>

                    {msg && <p className="text-[10px] text-white/60">{msg}</p>}

                    {!connected && (
                        <p className="inline-flex items-center gap-1.5 text-[10px] text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-sm px-3 py-2"><TriangleAlert className="w-3 h-3 shrink-0" />{t("autoPublish.notConnected")}</p>
                    )}

                    {/* Co plán říká. Tohle je náhrada za bývalou volbu frekvence:
                        místo dalšího čísla k nastavení ukazujeme skutečný stav fronty. */}
                    <div className="border-t border-white/10 pt-4">
                        <label className="block text-[8px] text-white/40 font-bold uppercase tracking-widest mb-2">{t("autoPublish.byPlan")}</label>
                        {outlook ? (
                            <div className="space-y-1.5">
                                <p className="text-xs text-white/60">
                                    {outlook.next
                                        ? t.rich("autoPublish.next", { date: fmt(outlook.next.at), em: chunks => <span className="text-emerald-400 font-bold">{chunks}</span> })
                                        : t("autoPublish.none")}
                                </p>
                                <p className="text-[9px] text-white/30">
                                    {t("autoPublish.counts", { armed: outlook.armed, waiting: outlook.waiting, overdue: outlook.overdue })}
                                </p>
                                {outlook.overdue > 0 && (
                                    <p className="text-[9px] text-amber-400/70">{t("autoPublish.overdueNote")}</p>
                                )}
                                {outlook.lastPosted && (
                                    <p className="text-[9px] text-white/30">
                                        {t("autoPublish.lastPosted", { date: fmt(outlook.lastPosted.at) })}
                                        {outlook.lastPosted.permalink && (
                                            <> · <a href={outlook.lastPosted.permalink} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white/80 underline">{t("autoPublish.openOnInstagram")}</a></>
                                        )}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-[10px] text-white/30">{t("autoPublish.loadFailed")}</p>
                        )}
                        <button
                            onClick={() => navigate("plan")}
                            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80 transition-all"
                        >
                            <CalendarDays className="w-3 h-3 shrink-0" />
                            {t("autoPublish.openPlan")}
                        </button>
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
    const t = useTranslations("settings")

    const handleRescan = async () => {
        setRescanning(true)
        setRescanResult(null)
        const result = await rescanClientWebsite(projectId)
        if (result.success) {
            const parts = []
            if (result.foundUrls > 0) parts.push(t("manage.rescan.foundUrls", { count: result.foundUrls }))
            parts.push(t("manage.rescan.existing", { count: result.existingImages }))
            parts.push(t("manage.rescan.downloaded", { count: result.newImages }))
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
            alert(t("manage.delete.failed", { error: result.error ?? "" }))
        }
    }

    return (
        <div className="space-y-6">
        <SectionCard title={t("manage.title")}>
            {/* Re-onboarding */}
            <div className="flex items-center justify-between gap-4">
                <div>
                    <p className="text-xs text-white/60 font-bold">{t("manage.reonboard.title")}</p>
                    <p className="text-[9px] text-white/30 mt-0.5">
                        {t("manage.reonboard.description")}
                    </p>
                </div>
                <button
                    onClick={() => router.push(`/onboarding?reonboard=${projectId}`)}
                    className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all border border-amber-500/20 whitespace-nowrap"
                >
                    <span className="inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 shrink-0" />{t("manage.reonboard.button")}</span>
                </button>
            </div>

            <div className="border-t border-white/5 pt-4 mt-4" />

            {/* Re-scan */}
            <div className="flex items-center justify-between gap-4">
                <div>
                    <p className="text-xs text-white/60 font-bold">{t("manage.rescan.title")}</p>
                    <p className="text-[9px] text-white/30 mt-0.5">
                        {t("manage.rescan.description", { site: config?.website || t("manage.rescan.site") })}
                    </p>
                </div>
                <button
                    onClick={handleRescan}
                    disabled={rescanning}
                    className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/20 disabled:opacity-50 whitespace-nowrap"
                >
                    {rescanning ? t("manage.rescan.scanning") : t("manage.rescan.button")}
                </button>
            </div>
            {rescanResult && (
                <p className="text-[10px] text-white/50 bg-white/5 rounded-sm px-3 py-2">{rescanResult}</p>
            )}

            {/* Product sync */}
            <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-4 mt-4">
                <div>
                    <p className="text-xs text-white/60 font-bold">{t("manage.sync.title")}</p>
                    <p className="text-[9px] text-white/30 mt-0.5">
                        {t("manage.sync.description")}
                    </p>
                </div>
                <button
                    onClick={async () => {
                        setSyncing(true)
                        setSyncResult(null)
                        const res = await syncConfigProductsToDb()
                        if (res.success) {
                            setSyncResult(`✅ ${t("manage.sync.result", { synced: res.synced, skipped: res.skipped })}`)
                        } else {
                            setSyncResult(`❌ ${res.error}`)
                        }
                        setSyncing(false)
                    }}
                    disabled={syncing}
                    className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-all border border-purple-500/20 disabled:opacity-50 whitespace-nowrap"
                >
                    {syncing ? t("manage.sync.syncing") : t("manage.sync.button")}
                </button>
            </div>
            {syncResult && (
                <p className="text-[10px] text-white/50 bg-white/5 rounded-sm px-3 py-2">{syncResult}</p>
            )}

            {/* Danger zone */}
            <div className="border-t border-red-500/10 pt-4 mt-4">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs text-red-400/70 font-bold">{t("manage.delete.title")}</p>
                        <p className="text-[9px] text-white/30 mt-0.5">
                            {t("manage.delete.description")}
                        </p>
                    </div>
                    {!confirmDelete ? (
                        <button
                            onClick={() => setConfirmDelete(true)}
                            className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all border border-red-500/10 hover:border-red-500/20 whitespace-nowrap"
                        >
                            <span className="inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 shrink-0" />{t("common.remove")}</span>
                        </button>
                    ) : (
                        <div className="flex gap-2">
                            <button
                                onClick={() => setConfirmDelete(false)}
                                disabled={deleting}
                                className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm text-white/40 bg-white/5 hover:bg-white/10 border border-white/10 whitespace-nowrap"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-red-600/30 text-red-400 border border-red-500/30 hover:bg-red-600/50 transition-all whitespace-nowrap disabled:opacity-50"
                            >
                                {deleting ? t("manage.delete.deleting") : t("manage.delete.confirm")}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </SectionCard>

        {/* Předání je adminská věc, ale patří sem, ne do onboardingu: značka se
            předává týdny potom, co vznikla — typicky až zákazník řekne, na jaký
            e-mail ji chce. Komponenta se sama skryje, když se nedívá správce. */}
        <HandoffSection projectId={projectId} clientName={config?.name || projectId} />
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// PŘEDÁNÍ ZNAČKY (jen správce)
// ═══════════════════════════════════════════════════════════

/**
 * Komu značka patří — a jak ji dostat pod e-mail, který si zákazník řekl.
 *
 * Onboarding z adminu zapíše vlastníka podle toho, kdo průvodce spustil, takže
 * značka zůstane správci. Zákazník přitom ve chvíli onboardingu často ještě
 * nemá účet; proto se tady předává na **e-mail**, ne na existující účet:
 * když účet chybí, uloží se slib a vazba vznikne při prvním přihlášení.
 */
function HandoffSection({ projectId, clientName }: { projectId: string; clientName: string }) {
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
    const [owners, setOwners] = useState<ClientAccessRow[]>([])
    const [pending, setPending] = useState<ClientPendingHandoff[]>([])
    const [email, setEmail] = useState("")
    const [replaceOwners, setReplaceOwners] = useState(false)
    const [busy, setBusy] = useState(false)
    const [result, setResult] = useState<{ ok: boolean; text: string; inviteUrl?: string | null } | null>(null)
    const [copied, setCopied] = useState<string | null>(null)
    const t = useTranslations("settings")

    const load = useCallback(async () => {
        const access = await getClientAccess(projectId)
        setOwners(access.owners)
        setPending(access.pending)
    }, [projectId])

    useEffect(() => {
        let alive = true
        isCurrentUserSuperAdmin().then(admin => {
            if (!alive) return
            setIsAdmin(admin)
            if (admin) load()
        })
        return () => { alive = false }
    }, [load])

    if (!isAdmin) return null

    const handleTransfer = async () => {
        setBusy(true)
        setResult(null)
        try {
            const res = await transferClientToUser(projectId, email, { replaceOwners })
            setResult({
                ok: !!res.success,
                text: res.success ? (res.message || t("handoff.done")) : (res.error || t("handoff.failed")),
                inviteUrl: res.inviteUrl,
            })
            if (res.success) {
                setEmail("")
                await load()
            }
        } catch (err) {
            setResult({ ok: false, text: err instanceof Error ? err.message : t("handoff.failed") })
        } finally {
            setBusy(false)
        }
    }

    const handleCancel = async (id: string) => {
        setBusy(true)
        const res = await cancelClientHandoff(projectId, id)
        if (!res.success) setResult({ ok: false, text: res.error || t("handoff.cancelFailed") })
        await load()
        setBusy(false)
    }

    const copy = (text: string, key: string) => {
        navigator.clipboard.writeText(text)
        setCopied(key)
        setTimeout(() => setCopied(null), 2000)
    }

    return (
        <SectionCard
            title={t("handoff.title")}
            description={t("handoff.description", { name: clientName })}
        >
            {/* Kdo na značku dnes vidí */}
            <div>
                <FieldLabel hint={t("handoff.ownersHint")}>{t("handoff.owners")}</FieldLabel>
                {owners.length === 0 ? (
                    <p className="text-[10px] text-white/30 bg-white/5 rounded-sm px-3 py-2">
                        {t("handoff.noOwners")}
                    </p>
                ) : (
                    <div className="space-y-1.5">
                        {owners.map(o => (
                            <div key={o.userId} className="flex items-center justify-between gap-3 bg-white/5 rounded-sm px-3 py-2">
                                <span className="text-xs text-white/70 font-medium break-all">{o.email}</span>
                                <span className="text-[9px] uppercase tracking-widest font-bold text-white/30 shrink-0">
                                    {o.isYou ? t("handoff.you") : o.role}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Čekající sliby */}
            {pending.length > 0 && (
                <div>
                    <FieldLabel hint={t("handoff.pendingHint")}>{t("handoff.pending")}</FieldLabel>
                    <div className="space-y-2">
                        {pending.map(h => (
                            <div key={h.id} className="bg-amber-500/5 border border-amber-500/20 rounded-sm px-3 py-2.5 space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs text-amber-200/80 font-medium break-all">{h.email}</span>
                                    <button
                                        onClick={() => handleCancel(h.id)}
                                        disabled={busy}
                                        className="text-[9px] uppercase tracking-widest font-bold text-white/30 hover:text-red-400 transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                                    >
                                        {t("common.cancel")}
                                    </button>
                                </div>
                                {h.inviteUrl && (
                                    <button
                                        onClick={() => copy(h.inviteUrl!, h.id)}
                                        className="w-full flex items-center gap-2 text-[9px] uppercase tracking-widest font-bold text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                                    >
                                        <Copy className="w-3 h-3 shrink-0" />
                                        {copied === h.id ? t("handoff.copied") : t("handoff.copyInvite")}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Předání */}
            <div className="border-t border-white/5 pt-4 space-y-3">
                <div>
                    <FieldLabel hint={t("handoff.emailHint")}>{t("handoff.email")}</FieldLabel>
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder={t("handoff.emailPlaceholder")}
                        className={inputClass}
                    />
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={replaceOwners}
                        onChange={e => setReplaceOwners(e.target.checked)}
                        className="mt-0.5 accent-emerald-500"
                    />
                    <span className="text-[10px] text-white/40 leading-relaxed">
                        {t("handoff.replace")}
                        <span className="block text-white/25">{t("handoff.replaceNote")}</span>
                    </span>
                </label>

                <button
                    onClick={handleTransfer}
                    disabled={busy || !email.trim()}
                    className="w-full px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all border border-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                    <span className="inline-flex items-center gap-1.5">
                        <Handshake className="w-3.5 h-3.5 shrink-0" />
                        {busy ? t("handoff.transferring") : t("handoff.transfer")}
                    </span>
                </button>

                {result && (
                    <div className={`text-[10px] rounded-sm px-3 py-2 space-y-2 ${result.ok ? "bg-emerald-500/10 text-emerald-300/80" : "bg-red-500/10 text-red-300/80"}`}>
                        <p>{result.text}</p>
                        {result.inviteUrl && (
                            <button
                                onClick={() => copy(result.inviteUrl!, "result")}
                                className="inline-flex items-center gap-2 text-[9px] uppercase tracking-widest font-bold text-white/50 hover:text-white transition-colors cursor-pointer"
                            >
                                <Copy className="w-3 h-3 shrink-0" />
                                {copied === "result" ? t("handoff.copied") : t("handoff.copyInvite")}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </SectionCard>
    )
}
