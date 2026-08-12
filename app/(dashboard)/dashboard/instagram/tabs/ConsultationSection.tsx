"use client"

/**
 * Nastavení značky na míru — vstupní schůzka.
 *
 * Sedí hned nad ceníkem záměrně: kdo se rozmýšlí nad tarifem, má vidět, že
 * existuje způsob, jak si to nechat nastavit — a že u 6 a 12 měsíců je v ceně.
 *
 * O bráně tahle komponenta neví (stejně jako ceník): posílá se `planId` do
 * `/api/payments/create` a která brána za tím stojí, rozhoduje server.
 */

import { useEffect, useState } from "react"
import { getConsultationState, getBookingLink, type ConsultationState } from "@/app/actions/consultation-actions"
import { formatCzk } from "@/lib/pricing"

const CONSULTATION_PLAN_ID = "nastaveni-znacky"

export function ConsultationSection({ projectId }: { projectId: string }) {
    const [state, setState] = useState<ConsultationState | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        getConsultationState(projectId).then(setState).catch(() => setState(null))
    }, [projectId])

    if (!state) return null

    const book = async () => {
        setBusy(true); setError(null)
        try {
            const { url } = await getBookingLink(projectId)
            window.open(url, "_blank")
        } catch {
            setError("Odkaz na rezervaci se nepodařilo připravit.")
        } finally {
            setBusy(false)
        }
    }

    const buy = async () => {
        setBusy(true); setError(null)
        try {
            const resp = await fetch("/api/payments/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId: CONSULTATION_PLAN_ID, clientSlug: projectId }),
            })
            const data = await resp.json()
            if (data.redirectUrl) window.open(data.redirectUrl, "_blank")
            else setError(data.error || "Platbu se nepodařilo založit.")
        } catch {
            setError("Platbu se nepodařilo založit.")
        } finally {
            setBusy(false)
        }
    }

    // Termín je domluvený — nic se neprodává, jen se připomíná.
    if (state.status === "booked" && state.scheduledAt) {
        const when = new Date(state.scheduledAt)
        return (
            <Card>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <Title />
                        <p className="text-xs text-emerald-400 font-bold mt-2">
                            Termín potvrzen: {when.toLocaleString("cs-CZ", { dateStyle: "long", timeStyle: "short" })}
                        </p>
                        <p className="text-[10px] text-white/30 mt-1">
                            Odkaz na video hovor máte v e-mailu s potvrzením. Připravovat se nemusíte — projdeme si vaši značku předem.
                        </p>
                    </div>
                    {state.bookingUrl && (
                        <a
                            href={state.bookingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 px-4 py-2.5 rounded-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-500/25 transition-all"
                        >
                            Otevřít hovor
                        </a>
                    )}
                </div>
            </Card>
        )
    }

    // Zaplaceno nebo v ceně, ale bez termínu — jediná akce je vybrat si ho.
    if (state.status === "paid" || state.status === "entitled") {
        return (
            <Card highlight>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <Title badge={state.included ? "V ceně předplatného" : "Zaplaceno"} />
                        <p className="text-[10px] text-white/40 mt-2 leading-relaxed max-w-md">
                            {state.bookingReady
                                ? `Zbývá vybrat termín. Schůzka trvá ${state.durationMinutes} minut a je online.`
                                : "Ozveme se vám sami e-mailem a domluvíme termín."}
                        </p>
                    </div>
                    {state.bookingReady && (
                        <button
                            onClick={book}
                            disabled={busy}
                            className="shrink-0 px-4 py-2.5 rounded-sm bg-aisummit-cinnabar text-white text-[9px] font-bold uppercase tracking-widest hover:bg-aisummit-cinnabar/90 transition-all disabled:opacity-50"
                        >
                            {busy ? "Otevírám…" : "Vybrat termín"}
                        </button>
                    )}
                </div>
                {error && <p className="text-[10px] text-red-400 mt-3">{error}</p>}
            </Card>
        )
    }

    // Nemá nic — nabídka.
    return (
        <Card>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <Title />
                    <p className="text-[10px] text-white/40 mt-2 leading-relaxed max-w-md">
                        {state.durationMinutes} minut online s člověkem, který Chrlit staví. Projdeme vaši značku,
                        doladíme tón i pilíře a odejdete s nastaveným profilem a prvním měsícem obsahu.
                        Připravovat se nemusíte — návrh máme hotový předem.
                    </p>
                    <p className="text-[9px] text-emerald-400/70 font-bold uppercase tracking-widest mt-2">
                        U předplatného na 6 a 12 měsíců v ceně
                    </p>
                </div>
                <div className="shrink-0 text-right">
                    <p className="text-xl font-black text-white">{formatCzk(state.priceHaleru)}</p>
                    <button
                        onClick={buy}
                        disabled={busy}
                        className="mt-2 px-4 py-2.5 rounded-sm bg-white/5 text-white/80 border border-white/10 text-[9px] font-bold uppercase tracking-widest hover:bg-white/10 transition-all disabled:opacity-50"
                    >
                        {busy ? "Zpracování…" : "Objednat"}
                    </button>
                </div>
            </div>
            {error && <p className="text-[10px] text-red-400 mt-3">{error}</p>}
        </Card>
    )
}

function Card({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
    return (
        <div className={`rounded-sm p-5 border ${highlight ? "border-aisummit-cinnabar/30 bg-aisummit-cinnabar/5" : "border-white/10 bg-[#080808]"}`}>
            {children}
        </div>
    )
}

function Title({ badge }: { badge?: string }) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-xs font-black uppercase tracking-widest text-white">Nastavení značky na míru</h4>
            {badge && (
                <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">
                    {badge}
                </span>
            )}
        </div>
    )
}
