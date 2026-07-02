"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { getMailingSegments, sendBroadcast, type MailingSegment, type BroadcastResult } from "@/app/actions/mailing-actions"

const DAILY_CAP = 100

const SEGMENTS: { id: MailingSegment; label: string; hint: string }[] = [
    { id: "waitlist", label: "Waitlist", hint: "Zájemci čekající na spuštění" },
    { id: "activeClients", label: "Aktivní klienti", hint: "Platící + trial" },
    { id: "expired", label: "Vypršelí", hint: "Předplatné doběhlo" },
]

export function MailingTab() {
    const [counts, setCounts] = useState<{ waitlist: number; activeClients: number; expired: number } | null>(null)
    const [segment, setSegment] = useState<MailingSegment>("waitlist")
    const [subject, setSubject] = useState("")
    const [body, setBody] = useState("")
    const [confirming, setConfirming] = useState(false)
    const [sending, setSending] = useState(false)
    const [result, setResult] = useState<BroadcastResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        getMailingSegments().then(setCounts).catch(() => setError("Nepodařilo se načíst segmenty (jen pro super-admina)."))
    }, [])

    const count = counts ? counts[segment] : 0
    const canSend = subject.trim().length > 0 && body.trim().length > 0 && count > 0 && !sending

    const doSend = async () => {
        setConfirming(false)
        setSending(true)
        setError(null)
        setResult(null)
        try {
            const r = await sendBroadcast({ segment, subject, body })
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
                {count > DAILY_CAP && (
                    <p className="text-[10px] text-amber-400/80 font-bold mt-2">
                        ⚠️ Resend free tier posílá max {DAILY_CAP}/den — odešle se prvních {DAILY_CAP}, zbytek ({count - DAILY_CAP}) další den. Pro víc: placený Resend (~$20/měs → 50k).
                    </p>
                )}
            </div>

            {/* Subject */}
            <div>
                <label className="text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold">Předmět</label>
                <input
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="Např. Chrlit spouštíme — máte přednostní přístup"
                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30"
                />
            </div>

            {/* Body */}
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

            {/* Preview */}
            {(subject || body) && (
                <div>
                    <label className="text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold">Náhled</label>
                    <div className="bg-[#050505] border border-white/10 rounded-sm p-6">
                        <h3 className="text-base font-black uppercase tracking-tight text-white mb-4">{subject || "(bez předmětu)"}</h3>
                        <div className="text-sm text-white/70 space-y-3">
                            {body.split(/\n{2,}/).filter(Boolean).map((p, i) => (
                                <p key={i} className="leading-relaxed whitespace-pre-wrap">{p}</p>
                            ))}
                        </div>
                        <p className="text-[10px] text-white/25 mt-6 pt-4 border-t border-white/5">Chrlit · <span className="underline">Odhlásit odběr</span></p>
                    </div>
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
            <div className="flex justify-end">
                <button
                    disabled={!canSend}
                    onClick={() => setConfirming(true)}
                    className="px-8 py-3 bg-gradient-to-r from-aisummit-cinnabar to-orange-600 text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-40 shadow-[0_0_20px_rgba(229,83,63,0.2)]"
                >
                    {sending ? "Odesílám…" : `Odeslat → ${count} příjemců`}
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
                            E-mail „{subject}" půjde na <strong className="text-white/80">{Math.min(count, DAILY_CAP)}</strong> {segment === "waitlist" ? "adres z waitlistu" : "klientů"}. Akce je nevratná.
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
