"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
    getMailingSegments, getMailingRecipients, getMailingTemplates, previewMail, sendBroadcast, sendTestEmail,
    type MailingSegment, type BroadcastResult, type MailingTemplateInfo, type MailPreview,
} from "@/app/actions/mailing-actions"

const DAILY_CAP = 100
/** Hodnota v pickeru pro starou cestu „napíšu si to sám". */
const CUSTOM = "__custom__"

const SEGMENTS: { id: MailingSegment; label: string; hint: string }[] = [
    { id: "waitlist", label: "Waitlist", hint: "Zájemci čekající na spuštění" },
    { id: "activeClients", label: "Aktivní klienti", hint: "Platící + trial" },
    { id: "expired", label: "Vypršelí", hint: "Předplatné doběhlo" },
]

export function MailingTab() {
    const [counts, setCounts] = useState<{ waitlist: number; activeClients: number; expired: number } | null>(null)
    const [segment, setSegment] = useState<MailingSegment>("waitlist")
    const [recipients, setRecipients] = useState<string[]>([])
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [loadingRecipients, setLoadingRecipients] = useState(false)
    const [subject, setSubject] = useState("")
    const [body, setBody] = useState("")
    const [confirming, setConfirming] = useState(false)
    const [sending, setSending] = useState(false)
    const [result, setResult] = useState<BroadcastResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    const [templates, setTemplates] = useState<MailingTemplateInfo[]>([])
    const [templateId, setTemplateId] = useState<string>(CUSTOM)
    const [vars, setVars] = useState<Record<string, string>>({})
    const [preview, setPreview] = useState<MailPreview | null>(null)
    const [testing, setTesting] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)

    const template = useMemo(
        () => templates.find(t => t.id === templateId) || null,
        [templates, templateId],
    )

    useEffect(() => {
        getMailingTemplates().then(setTemplates).catch(() => { })
    }, [])

    // Přepnutí šablony předvyplní ukázkovými daty — prázdný formulář o dvanácti
    // polích nikoho nenaučí, co ta šablona umí.
    const pickTemplate = (id: string) => {
        setTemplateId(id)
        setPreview(null)
        const t = templates.find(x => x.id === id)
        setVars(t ? { ...t.sample } : {})
    }

    /** Náhled renderuje server týmž kódem jako ostré odeslání. */
    const refreshPreview = useCallback(async () => {
        try {
            setPreview(await previewMail(
                template ? { templateId: template.id, vars } : { subject, body },
            ))
            setError(null)
        } catch (e: any) {
            setError(e?.message || "Náhled se nepodařilo vykreslit.")
        }
    }, [template, vars, subject, body])

    // Debounce — každý stisk klávesy je jinak jeden request na server.
    useEffect(() => {
        if (!template && !subject && !body) { setPreview(null); return }
        const id = setTimeout(refreshPreview, 400)
        return () => clearTimeout(id)
    }, [refreshPreview, template, subject, body])

    const doTest = async () => {
        setTesting(true); setError(null); setNotice(null)
        try {
            const to = await sendTestEmail(template ? { templateId: template.id, vars } : { subject, body })
            setNotice(`Testovací zpráva odeslána na ${to}.`)
        } catch (e: any) {
            setError(e?.message || "Testovací odeslání selhalo.")
        } finally {
            setTesting(false)
        }
    }

    useEffect(() => {
        getMailingSegments().then(setCounts).catch(() => setError("Nepodařilo se načíst segmenty (jen pro super-admina)."))
    }, [])

    // Load the individual addresses whenever the segment changes; default all checked.
    useEffect(() => {
        let cancelled = false
        setLoadingRecipients(true)
        getMailingRecipients(segment)
            .then(list => {
                if (cancelled) return
                setRecipients(list)
                setSelected(new Set(list))
            })
            .catch(() => { if (!cancelled) { setRecipients([]); setSelected(new Set()) } })
            .finally(() => { if (!cancelled) setLoadingRecipients(false) })
        return () => { cancelled = true }
    }, [segment])

    const toggleRecipient = (email: string) =>
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(email)) next.delete(email); else next.add(email)
            return next
        })

    const selectedCount = selected.size
    const contentReady = template
        ? template.fields.every(f => !f.required || (vars[f.key] || "").trim().length > 0)
        : subject.trim().length > 0 && body.trim().length > 0
    const canSend = contentReady && selectedCount > 0 && !sending

    const doSend = async () => {
        setConfirming(false)
        setSending(true)
        setError(null)
        setResult(null)
        try {
            const r = await sendBroadcast({
                segment,
                ...(template ? { template: { id: template.id, vars } } : { subject, body }),
                recipients: [...selected],
            })
            setResult(r)
            getMailingSegments().then(setCounts).catch(() => {})
        } catch (e: any) {
            setError(e?.message || "Odeslání selhalo.")
        } finally {
            setSending(false)
        }
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {error && (
                <div className="bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm p-4 text-sm text-aisummit-cinnabar font-bold">
                    ⚠️ {error}
                </div>
            )}

            {/* Segment picker */}
            <div>
                <label className="text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold">Komu</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {SEGMENTS.map(s => {
                        const n = counts ? counts[s.id] : null
                        const active = segment === s.id
                        return (
                            <button
                                key={s.id}
                                onClick={() => setSegment(s.id)}
                                className={`text-left p-4 rounded-sm border transition-all ${active
                                    ? "bg-aisummit-cinnabar/10 border-aisummit-cinnabar/30"
                                    : "bg-[#0a0a0a] border-white/10 hover:border-white/25"}`}
                            >
                                <div className="flex items-baseline justify-between">
                                    <span className={`text-xs font-black uppercase tracking-widest ${active ? "text-aisummit-cinnabar" : "text-white/70"}`}>{s.label}</span>
                                    <span className="text-lg font-black text-white/80">{n === null ? "…" : n}</span>
                                </div>
                                <p className="text-[9px] text-white/30 font-medium mt-1">{s.hint}</p>
                            </button>
                        )
                    })}
                </div>
                {selectedCount > DAILY_CAP && (
                    <p className="text-[10px] text-amber-400/80 font-bold mt-2">
                        ⚠️ Resend free tier posílá max {DAILY_CAP}/den — odešle se prvních {DAILY_CAP}, zbytek ({selectedCount - DAILY_CAP}) další den. Pro víc: placený Resend (~$20/měs → 50k).
                    </p>
                )}
            </div>

            {/* Per-recipient selection */}
            <div>
                <div className="flex items-baseline justify-between mb-2">
                    <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold">
                        Příjemci · {selectedCount}/{recipients.length}
                    </label>
                    <div className="flex gap-4">
                        <button
                            onClick={() => setSelected(new Set(recipients))}
                            disabled={recipients.length === 0 || selectedCount === recipients.length}
                            className="text-[10px] text-white/40 hover:text-white/80 uppercase tracking-widest font-bold transition-colors disabled:opacity-30 disabled:hover:text-white/40"
                        >
                            Vybrat vše
                        </button>
                        <button
                            onClick={() => setSelected(new Set())}
                            disabled={selectedCount === 0}
                            className="text-[10px] text-white/40 hover:text-white/80 uppercase tracking-widest font-bold transition-colors disabled:opacity-30 disabled:hover:text-white/40"
                        >
                            Zrušit výběr
                        </button>
                    </div>
                </div>
                <div className="bg-[#0a0a0a] border border-white/10 rounded-sm max-h-56 overflow-y-auto divide-y divide-white/5">
                    {loadingRecipients ? (
                        <p className="text-xs text-white/30 font-medium p-4">Načítám…</p>
                    ) : recipients.length === 0 ? (
                        <p className="text-xs text-white/30 font-medium p-4">V tomto segmentu nikdo není.</p>
                    ) : recipients.map(email => {
                        const checked = selected.has(email)
                        return (
                            <label key={email} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.02] transition-colors">
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleRecipient(email)}
                                    className="accent-aisummit-cinnabar w-3.5 h-3.5 shrink-0"
                                />
                                <span className={`text-xs font-medium truncate ${checked ? "text-white/80" : "text-white/35"}`}>{email}</span>
                            </label>
                        )
                    })}
                </div>
            </div>

            {/* Template picker */}
            <div>
                <label className="text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold">Šablona</label>
                <select
                    value={templateId}
                    onChange={e => pickTemplate(e.target.value)}
                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30"
                >
                    <option value={CUSTOM}>Vlastní text</option>
                    {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                </select>
            </div>

            {/* Schema-driven fields — nová šablona se tu objeví sama */}
            {template ? (
                <div className="space-y-4">
                    {template.fields.map(f => (
                        <div key={f.key}>
                            <label className="text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold">
                                {f.label}{f.required && <span className="text-aisummit-cinnabar"> *</span>}
                            </label>
                            {f.type === "textarea" ? (
                                <textarea
                                    value={vars[f.key] || ""}
                                    onChange={e => setVars(v => ({ ...v, [f.key]: e.target.value }))}
                                    rows={6}
                                    placeholder={f.placeholder}
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 resize-none leading-relaxed font-mono"
                                />
                            ) : (
                                <input
                                    value={vars[f.key] || ""}
                                    onChange={e => setVars(v => ({ ...v, [f.key]: e.target.value }))}
                                    placeholder={f.placeholder}
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30"
                                />
                            )}
                            {f.help && <p className="text-[9px] text-white/30 font-medium mt-1.5">{f.help}</p>}
                        </div>
                    ))}
                </div>
            ) : (
                <>
                    <div>
                        <label className="text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold">Předmět</label>
                        <input
                            value={subject}
                            onChange={e => setSubject(e.target.value)}
                            placeholder="Např. Chrlit spouštíme — máte přednostní přístup"
                            className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold">Text (prázdný řádek = nový odstavec)</label>
                        <textarea
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            rows={8}
                            placeholder={"Dobrý den,\n\nspouštíme Chrlit — AI, která vám vytvoří obsah na Instagram na celý měsíc...\n\nTým Chrlit"}
                            className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 resize-none leading-relaxed"
                        />
                    </div>
                </>
            )}

            {/* Preview — renderuje server, takže je to doslova to, co odejde */}
            {preview && (
                <div>
                    <div className="flex items-baseline justify-between mb-2">
                        <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold">
                            Náhled · {preview.subject}
                        </label>
                        <span className={`text-[9px] font-bold uppercase tracking-widest ${preview.kb > 90 ? "text-aisummit-cinnabar" : "text-white/30"}`}>
                            {Math.round(preview.kb)} KB
                        </span>
                    </div>
                    <iframe
                        title="Náhled e-mailu"
                        srcDoc={preview.html}
                        sandbox=""
                        loading="lazy"
                        className="w-full h-[520px] bg-white border border-white/10 rounded-sm"
                    />
                    <details className="mt-2">
                        <summary className="text-[10px] text-white/40 uppercase tracking-widest font-bold cursor-pointer hover:text-white/70">
                            Textová verze
                        </summary>
                        <pre className="mt-2 p-4 bg-[#050505] border border-white/10 rounded-sm text-[11px] text-white/50 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">{preview.text}</pre>
                    </details>
                </div>
            )}

            {notice && (
                <div className="bg-white/5 border border-white/10 rounded-sm p-4">
                    <p className="text-sm text-white/70 font-bold">✉️ {notice}</p>
                </div>
            )}

            {/* Result */}
            {result && (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-sm p-4">
                    <p className="text-sm text-emerald-400 font-bold">
                        ✅ Odesláno: {result.sent} · Selhalo: {result.failed}
                        {result.remaining > 0 && ` · Zbývá na příště: ${result.remaining}`}
                    </p>
                </div>
            )}

            {/* Send */}
            <div className="flex justify-end items-center gap-3">
                <button
                    disabled={!contentReady || testing}
                    onClick={doTest}
                    className="px-5 py-3 bg-white/5 border border-white/10 text-white/70 rounded-sm text-[10px] font-black uppercase tracking-widest hover:text-white hover:bg-white/10 transition-all disabled:opacity-30"
                >
                    {testing ? "Odesílám…" : "Poslat test sobě"}
                </button>
                <button
                    disabled={!canSend}
                    onClick={() => setConfirming(true)}
                    className="px-8 py-3 bg-gradient-to-r from-aisummit-cinnabar to-orange-600 text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-40 shadow-[0_0_20px_rgba(229,83,63,0.2)]"
                >
                    {sending ? "Odesílám…" : `Odeslat → ${selectedCount} příjemců`}
                </button>
            </div>

            {/* Confirm modal */}
            {confirming && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setConfirming(false)}>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        onClick={e => e.stopPropagation()}
                        className="bg-[#0a0a0a] border border-white/15 rounded-sm p-6 max-w-sm w-full"
                    >
                        <h3 className="text-sm font-black uppercase tracking-tight text-white mb-2">Opravdu odeslat?</h3>
                        <p className="text-xs text-white/50 leading-relaxed mb-5">
                            E-mail „{preview?.subject || subject}" půjde na <strong className="text-white/80">{Math.min(selectedCount, DAILY_CAP)}</strong> {selectedCount === 1 ? "vybraného příjemce" : "vybraných příjemců"}. Akce je nevratná.
                        </p>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setConfirming(false)} className="px-4 py-2 rounded-sm text-[10px] font-bold uppercase tracking-widest text-white/50 bg-white/5 border border-white/10 hover:text-white transition-all">Zrušit</button>
                            <button onClick={doSend} className="px-5 py-2 rounded-sm text-[10px] font-black uppercase tracking-widest bg-aisummit-cinnabar text-white hover:bg-aisummit-cinnabar/90 transition-all">Odeslat</button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    )
}
