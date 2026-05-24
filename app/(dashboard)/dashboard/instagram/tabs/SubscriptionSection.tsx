"use client"

import { useStudio, type SubscriptionState } from "@/app/(dashboard)/StudioContext"
import { CheckCircle2 } from "lucide-react"
import { useState } from "react"

const PLAN = {
    id: "chrlit",
    name: "Chrlit",
    price: 490,
    credits: 30,
    extraCreditPrice: 15,
    features: [
        "AI posty s unikátními obrázky",
        "Captiony + hashtagy ve vašem stylu",
        "Carousel posty",
        "Varianty příspěvků",
        "AI nápady na obsah",
        "Produktové vizualizace",
        "Analytika výkonu",
        "Neomezené projekty",
    ],
}

export function SubscriptionSection({ projectId }: { projectId: string }) {
    const { subscription, subscriptionLoading, refreshSubscription } = useStudio()
    const [upgrading, setUpgrading] = useState(false)

    const handleUpgrade = async () => {
        setUpgrading(true)
        try {
            const resp = await fetch("/api/payments/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId: PLAN.id, clientId: projectId }),
            })
            const data = await resp.json()
            if (data.redirectUrl) {
                window.open(data.redirectUrl, "_blank")
            } else if (data.error) {
                alert(data.error)
            }
        } catch (err) {
            alert("Nepodařilo se vytvořit platbu.")
        } finally {
            setUpgrading(false)
        }
    }

    if (subscriptionLoading) {
        return (
            <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 animate-pulse">
                <div className="h-3 w-32 bg-white/10 rounded mb-4" />
                <div className="h-20 w-full bg-white/5 rounded" />
            </div>
        )
    }

    const isCurrent = subscription?.planId === PLAN.id || subscription?.status === "active"

    return (
        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-6 space-y-6">
            <h3 className="text-sm font-black uppercase tracking-widest text-white/70 border-b border-white/10 pb-2">
                Předplatné & Kredity
            </h3>

            {/* Current plan status */}
            {subscription ? (
                <CurrentPlanCard sub={subscription} onRefresh={refreshSubscription} />
            ) : (
                <div className="bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm p-4">
                    <p className="text-white/60 text-xs">Nemáte aktivní předplatné.</p>
                </div>
            )}

            {/* Single plan card */}
            {!isCurrent && (
                <div className="max-w-md mx-auto rounded-sm border-2 border-aisummit-cinnabar/40 bg-aisummit-cinnabar/5 p-6">
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-black uppercase tracking-widest text-white">{PLAN.name}</h4>
                    </div>
                    <div className="mb-2">
                        <span className="text-3xl font-black text-white">{PLAN.price}</span>
                        <span className="text-white/40 text-[10px] font-bold ml-1">Kč/měs</span>
                    </div>
                    <div className="bg-aisummit-cinnabar/10 rounded-sm px-3 py-2 mb-4 border border-aisummit-cinnabar/20">
                        <span className="text-white font-black text-xs">{PLAN.credits}</span>
                        <span className="text-white/40 text-[9px] font-bold ml-1">kreditů v ceně</span>
                        <span className="text-white/30 text-[9px] block">Dobíjecí za {PLAN.extraCreditPrice} Kč/ks</span>
                    </div>
                    <ul className="space-y-1.5 mb-4">
                        {PLAN.features.map((f, i) => (
                            <li key={i} className="flex items-center gap-1.5 text-[10px] text-white/50">
                                <CheckCircle2 className="w-3 h-3 text-aisummit-cinnabar/60 shrink-0" />
                                {f}
                            </li>
                        ))}
                    </ul>
                    <button
                        onClick={handleUpgrade}
                        disabled={upgrading}
                        className={`w-full py-2.5 rounded-sm text-[9px] font-bold uppercase tracking-widest transition-all bg-aisummit-cinnabar text-white hover:bg-aisummit-cinnabar/90 ${upgrading ? 'opacity-50' : ''}`}
                    >
                        {upgrading ? "Zpracování..." : "Předplatit"}
                    </button>
                </div>
            )}
        </div>
    )
}
function CurrentPlanCard({ sub, onRefresh }: { sub: SubscriptionState; onRefresh: () => void }) {
    // DEBUG: log subscription shape to find React #310 cause
    console.log("[SubscriptionSection] sub data:", JSON.stringify(sub))
    
    const pct = (sub.creditsTotal ?? 0) > 0
        ? Math.min(100, ((sub.creditsUsed ?? 0) / (sub.creditsTotal ?? 1)) * 100)
        : 0
    const isLow = pct > 80
    const isTrial = sub.status === "trialing"
    const trialDays = isTrial && sub.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(String(sub.trialEndsAt)).getTime() - Date.now()) / 86400000))
        : null
    const periodEnd = sub.currentPeriodEnd ? String(sub.currentPeriodEnd) : null

    return (
        <div className={`rounded-sm p-5 border ${isLow ? 'bg-aisummit-cinnabar/5 border-aisummit-cinnabar/20' : 'bg-[#080808] border-white/5'}`}>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-white">{String(sub.planName ?? "")}</span>
                    {isTrial && (
                        <span className="text-[9px] bg-amber-500/20 text-amber-400 px-3 py-1 rounded-full font-bold uppercase">
                            Trial · {trialDays ?? 0}d zbývá
                        </span>
                    )}
                    {sub.status === "active" && (
                        <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full font-bold uppercase">
                            Aktivní
                        </span>
                    )}
                    {sub.status === "expired" && (
                        <span className="text-[9px] bg-red-500/20 text-red-400 px-3 py-1 rounded-full font-bold uppercase">
                            Vypršel
                        </span>
                    )}
                </div>
                <button
                    onClick={onRefresh}
                    className="text-[9px] text-white/30 hover:text-white/60 font-bold uppercase tracking-widest transition-colors"
                >
                    ↻ Aktualizovat
                </button>
            </div>

            {/* Credit bar */}
            <div className="mb-2">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-white/40 font-bold">Využité kredity</span>
                    <span className="text-[10px] text-white/60 font-bold">
                        {sub.creditsUsed ?? 0} / {sub.creditsTotal ?? 0}
                    </span>
                </div>
                <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-700 ${isLow ? 'bg-aisummit-cinnabar' : 'bg-emerald-500'}`}
                        style={{ width: `${pct}%` }}
                    />
                </div>
                <div className="flex items-center justify-between mt-1">
                    <span className="text-[9px] text-white/20 font-bold">
                        {sub.creditsRemaining ?? 0} kreditů zbývá
                    </span>
                    {periodEnd && (
                        <span className="text-[9px] text-white/20 font-bold">
                            Obnoví se {new Date(periodEnd).toLocaleDateString("cs")}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}
