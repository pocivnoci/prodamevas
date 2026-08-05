"use client"

import { useCallback, useEffect, useState } from "react"
import { FileText, ExternalLink, AlertTriangle, Check } from "lucide-react"
import {
    getBillingDetails,
    saveBillingDetails,
    recordInstantAccessConsent,
    listInvoices,
    type BillingDetailsInput,
    type BillingDetailsRecord,
    type InvoiceRecord,
} from "@/app/actions/billing-actions"

/**
 * Fakturační údaje + doklady.
 *
 * Formulář je zároveň branou k platbě: bez adresy nelze vystavit daňový doklad
 * a u spotřebitele bez zaznamenaného souhlasu se zahájením plnění nezaniká
 * právo na odstoupení do 14 dnů. Proto se otevírá i jako modál před platbou.
 */

const EMPTY: BillingDetailsInput = {
    customerType: "company",
    name: "",
    ico: "",
    dic: "",
    street: "",
    city: "",
    zip: "",
    countryCode: "CZ",
    email: "",
}

/** Přesné znění se ukládá do DB — v případném sporu se prokazuje ono, ne odkaz na komponentu. */
export const INSTANT_ACCESS_CONSENT_TEXT =
    "Souhlasím se zpřístupněním služby ihned po zaplacení a beru na vědomí, že tím ztrácím právo odstoupit od smlouvy do 14 dnů podle § 1837 občanského zákoníku."

const LABEL = "block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5"
const INPUT =
    "w-full bg-[#050505] border border-white/10 rounded-sm px-3 py-2 text-sm text-white placeholder-white/20 focus:border-white/30 focus:outline-none transition-colors"

export function BillingForm({
    projectId,
    requireConsent,
    onSaved,
    onCancel,
}: {
    projectId: string
    /** true v modálu před platbou — vyžádá souhlas se zahájením plnění. */
    requireConsent?: boolean
    onSaved?: () => void
    onCancel?: () => void
}) {
    const [form, setForm] = useState<BillingDetailsInput>(EMPTY)
    const [consentGiven, setConsentGiven] = useState(false)
    const [alreadyConsented, setAlreadyConsented] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [savedNote, setSavedNote] = useState(false)

    useEffect(() => {
        let cancelled = false
        getBillingDetails(projectId)
            .then((d: BillingDetailsRecord | null) => {
                if (cancelled) return
                if (d) {
                    setForm({
                        customerType: d.customerType,
                        name: d.name,
                        ico: d.ico || "",
                        dic: d.dic || "",
                        street: d.street,
                        city: d.city,
                        zip: d.zip,
                        countryCode: d.countryCode || "CZ",
                        email: d.email || "",
                    })
                    setAlreadyConsented(Boolean(d.instantAccessConsentAt))
                }
            })
            .catch(() => { /* prázdný formulář je legitimní výchozí stav */ })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [projectId])

    const set = (key: keyof BillingDetailsInput, value: string) =>
        setForm(prev => ({ ...prev, [key]: value }))

    const needsConsent = requireConsent && form.customerType === "consumer" && !alreadyConsented

    const handleSubmit = async () => {
        setError(null)
        if (needsConsent && !consentGiven) {
            setError("Bez souhlasu se zahájením plnění nelze službu zpřístupnit ihned.")
            return
        }
        setSaving(true)
        try {
            const res = await saveBillingDetails(projectId, form)
            if (!res.success) {
                setError(res.error || "Uložení selhalo.")
                return
            }
            if (needsConsent && consentGiven) {
                const consent = await recordInstantAccessConsent(projectId, INSTANT_ACCESS_CONSENT_TEXT)
                if (!consent.success) {
                    setError(consent.error || "Uložení souhlasu selhalo.")
                    return
                }
                setAlreadyConsented(true)
            }
            setSavedNote(true)
            setTimeout(() => setSavedNote(false), 2500)
            onSaved?.()
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return <div className="h-40 bg-white/5 rounded-sm animate-pulse" />
    }

    return (
        <div className="space-y-4">
            {/* Typ zákazníka řídí právní režim, ne jen vzhled formuláře. */}
            <div>
                <span className={LABEL}>Fakturuji jako</span>
                <div className="grid grid-cols-2 gap-2">
                    {([["company", "Firma / OSVČ"], ["consumer", "Nepodnikám"]] as const).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => set("customerType", value)}
                            className={`py-2 rounded-sm text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                                form.customerType === value
                                    ? "bg-white/10 border-white/30 text-white"
                                    : "bg-[#050505] border-white/10 text-white/40 hover:text-white/70"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <label className={LABEL}>{form.customerType === "company" ? "Název firmy" : "Jméno a příjmení"}</label>
                <input className={INPUT} value={form.name} onChange={e => set("name", e.target.value)} placeholder={form.customerType === "company" ? "Kavárna U Lípy s.r.o." : "Jan Novák"} />
            </div>

            {form.customerType === "company" && (
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL}>IČO</label>
                        <input className={INPUT} value={form.ico} onChange={e => set("ico", e.target.value)} placeholder="12345678" inputMode="numeric" />
                    </div>
                    <div>
                        <label className={LABEL}>DIČ <span className="text-white/20">(nepovinné)</span></label>
                        <input className={INPUT} value={form.dic} onChange={e => set("dic", e.target.value)} placeholder="CZ12345678" />
                    </div>
                </div>
            )}

            <div>
                <label className={LABEL}>Ulice a číslo popisné</label>
                <input className={INPUT} value={form.street} onChange={e => set("street", e.target.value)} placeholder="Dlouhá 12" />
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div>
                    <label className={LABEL}>PSČ</label>
                    <input className={INPUT} value={form.zip} onChange={e => set("zip", e.target.value)} placeholder="110 00" inputMode="numeric" />
                </div>
                <div className="col-span-2">
                    <label className={LABEL}>Město</label>
                    <input className={INPUT} value={form.city} onChange={e => set("city", e.target.value)} placeholder="Praha" />
                </div>
            </div>

            <div>
                <label className={LABEL}>E-mail pro faktury <span className="text-white/20">(nepovinné)</span></label>
                <input className={INPUT} value={form.email} onChange={e => set("email", e.target.value)} placeholder="ucetni@firma.cz" type="email" />
            </div>

            {needsConsent && (
                <label className="flex gap-3 items-start bg-white/[0.03] border border-white/10 rounded-sm p-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={consentGiven}
                        onChange={e => setConsentGiven(e.target.checked)}
                        className="mt-0.5 accent-white shrink-0"
                    />
                    <span className="text-[11px] text-white/60 leading-relaxed">{INSTANT_ACCESS_CONSENT_TEXT}</span>
                </label>
            )}

            {error && (
                <div className="flex gap-2 items-start bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm p-3">
                    <AlertTriangle className="w-3.5 h-3.5 text-aisummit-cinnabar shrink-0 mt-0.5" />
                    <p className="text-[11px] text-white/70">{error}</p>
                </div>
            )}

            <div className="flex gap-2 pt-1">
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={saving}
                    className="flex-1 bg-white text-black py-2.5 rounded-sm text-[10px] font-black uppercase tracking-widest hover:bg-white/90 disabled:opacity-40 transition-colors"
                >
                    {saving ? "Ukládám…" : savedNote ? "Uloženo ✓" : "Uložit údaje"}
                </button>
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-5 border border-white/10 rounded-sm text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors"
                    >
                        Zpět
                    </button>
                )}
            </div>
        </div>
    )
}

/** Modál před platbou — vynutí údaje i souhlas dřív, než odejde peníz. */
export function BillingModal({
    projectId,
    onDone,
    onClose,
}: {
    projectId: string
    onDone: () => void
    onClose: () => void
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto">
            <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-6 w-full max-w-md my-8">
                <h3 className="text-sm font-black uppercase tracking-widest text-white mb-1">Fakturační údaje</h3>
                <p className="text-[11px] text-white/40 mb-5 leading-relaxed">
                    Potřebujeme je k vystavení daňového dokladu. Vyplníte jednou.
                </p>
                <BillingForm projectId={projectId} requireConsent onSaved={onDone} onCancel={onClose} />
            </div>
        </div>
    )
}

/** Sekce v Nastavení: uložené údaje + seznam vystavených dokladů. */
export function BillingSection({ projectId }: { projectId: string }) {
    const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
    const [loadingInvoices, setLoadingInvoices] = useState(true)

    const reload = useCallback(() => {
        setLoadingInvoices(true)
        listInvoices(projectId)
            .then(setInvoices)
            .catch(() => setInvoices([]))
            .finally(() => setLoadingInvoices(false))
    }, [projectId])

    useEffect(() => { reload() }, [reload])

    return (
        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-6">
            <h3 className="text-sm font-black uppercase tracking-widest text-white/70 border-b border-white/10 pb-2">
                Fakturace
            </h3>

            <BillingForm projectId={projectId} />

            <div>
                <h4 className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-3">Vystavené doklady</h4>

                {loadingInvoices ? (
                    <div className="h-12 bg-white/5 rounded-sm animate-pulse" />
                ) : invoices.length === 0 ? (
                    <p className="text-[11px] text-white/30">Zatím žádné doklady. První vystavíme po první platbě.</p>
                ) : (
                    <ul className="divide-y divide-white/5 border border-white/5 rounded-sm">
                        {invoices.map(inv => (
                            <li key={inv.id} className="flex items-center gap-3 px-3 py-2.5">
                                <FileText className="w-3.5 h-3.5 text-white/25 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-white/80 truncate">
                                        {inv.number || "Připravuje se…"}
                                    </p>
                                    <p className="text-[10px] text-white/30">
                                        {inv.issuedAt
                                            ? new Date(inv.issuedAt).toLocaleDateString("cs-CZ")
                                            : new Date(inv.createdAt).toLocaleDateString("cs-CZ")}
                                        {inv.totalCzk != null && ` · ${(inv.totalCzk / 100).toLocaleString("cs-CZ")} Kč`}
                                    </p>
                                </div>
                                {inv.status === "issued" && inv.publicUrl ? (
                                    <a
                                        href={inv.publicUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-colors shrink-0"
                                    >
                                        Otevřít <ExternalLink className="w-3 h-3" />
                                    </a>
                                ) : inv.status === "issued" ? (
                                    <Check className="w-3.5 h-3.5 text-white/30 shrink-0" />
                                ) : (
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-aisummit-cinnabar/70 shrink-0">
                                        {inv.status === "failed" ? "Řešíme" : "Čeká"}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {invoices.some(i => i.status === "failed") && (
                    <p className="text-[10px] text-white/30 mt-3 leading-relaxed">
                        U některého dokladu se vystavení nezdařilo. Doklad vám doručíme dodatečně — platba je v pořádku a služba běží.
                    </p>
                )}
            </div>
        </div>
    )
}
