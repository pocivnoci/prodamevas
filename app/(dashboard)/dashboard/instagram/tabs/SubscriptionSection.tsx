"use client"

import { useStudio, type SubscriptionState } from "@/app/(dashboard)/StudioContext"
import { CheckCircle2 } from "lucide-react"
import { useState } from "react"

const PLANS = [
    {
        id: "starter",
        name: "Starter",
        price: 490,
        credits: 20,
        projects: 1,
        features: ["Posty s AI obrázky", "AI captiony + hashtagy", "Základní analytika"],
        color: "white/30",
        highlight: false,
    },
    {
        id: "creator",
        name: "Creator",
        price: 990,
        credits: 50,
        projects: 2,
        features: ["Vše ze Starter", "Varianty příspěvků", "Produktové nápady AI", "Dobíjecí kredity"],
        color: "amber-500/60",
        highlight: false,
    },
    {
        id: "business",
        name: "Business",
        price: 1890,
        credits: 120,
        projects: 5,
        features: ["Vše z Creator", "Design + Mockupy", "Vizualizace produktů", "Business Brief PDF", "Plná analytika"],
        color: "red-500",
        highlight: true,
    },
    {
        id: "pro",
        name: "Pro",
        price: 3790,
        credits: 260,
        projects: 10,
        features: ["Vše z Business", "Prioritní generování ⚡", "260 kreditů", "Dobíjecí 3.5 Kč/ks"],
        color: "blue-400/60",
        highlight: false,
    },
    {
        id: "agency",
        name: "Agency",
        price: 7990,
        credits: 600,
        projects: 25,
        features: ["Vše z Pro", "600 kreditů", "Přednostní podpora", "Dobíjecí 3 Kč/ks"],
        color: "emerald-500",
        highlight: false,
    },
]

export function SubscriptionSection({ projectId }: { projectId: string }) {
    const { subscription, subscriptionLoading, refreshSubscription } = useStudio()
    const [upgrading, setUpgrading] = useState<string | null>(null)

    const handleUpgrade = async (planId: string) => {
        setUpgrading(planId)
        try {
            const resp = await fetch("/api/payments/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId, clientId: projectId }),
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
            setUpgrading(null)
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
                    <p className="text-white/60 text-xs">Nemáte aktivní předplatné. Vyberte plán níže.</p>
                </div>
            )}

            {/* Plan cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {PLANS.map((plan) => {
                    const isCurrent = subscription?.planId === plan.id
                    const isUpgrade = subscription
                        ? PLANS.findIndex(p => p.id === subscription.planId) < PLANS.findIndex(p => p.id === plan.id)
                        : true

                    return (
                        <div
                            key={plan.id}
                            className={`rounded-sm p-4 border flex flex-col ${
                                plan.highlight
                                    ? 'border-aisummit-cinnabar/40 bg-aisummit-cinnabar/5'
                                    : isCurrent
                                    ? 'border-emerald-500/30 bg-emerald-500/5'
                                    : 'border-white/5 bg-[#080808]'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-xs font-black uppercase tracking-widest text-white">
                                    {plan.name}
                                </h4>
                                {isCurrent && (
                                    <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase">
                                        Aktivní
                                    </span>
                                )}
                            </div>
                            <div className="mb-3">
                                <span className="text-2xl font-black text-white">{plan.price.toLocaleString("cs")}</span>
                                <span className="text-white/40 text-[10px] font-bold ml-1">Kč/měs</span>
                            </div>
                            <div className="bg-white/5 rounded-sm px-2 py-1.5 mb-3">
                                <span className="text-white font-black text-xs">{plan.credits}</span>
                                <span className="text-white/40 text-[9px] font-bold ml-1">kreditů</span>
                                <span className="text-white/20 text-[9px] block">{plan.projects} {plan.projects === 1 ? 'projekt' : plan.projects < 5 ? 'projekty' : 'projektů'}</span>
                            </div>
                            <ul className="space-y-1.5 mb-4 flex-1">
                                {plan.features.map((f, i) => (
                                    <li key={i} className="flex items-center gap-1.5 text-[10px] text-white/50">
                                        <CheckCircle2 className="w-3 h-3 text-white/20 shrink-0" />
                                        {f}
                                    </li>
                                ))}
                            </ul>
                            {isCurrent ? (
                                <div className="text-center py-2 text-[9px] text-emerald-400 font-bold uppercase tracking-widest">
                                    ✓ Váš plán
                                </div>
                            ) : isUpgrade ? (
                                <button
                                    onClick={() => handleUpgrade(plan.id)}
                                    disabled={upgrading === plan.id}
                                    className={`w-full py-2 rounded-sm text-[9px] font-bold uppercase tracking-widest transition-all ${
                                        plan.highlight
                                            ? 'bg-aisummit-cinnabar text-white hover:bg-aisummit-cinnabar/90'
                                            : 'border border-white/10 text-white/50 hover:bg-white/5 hover:text-white'
                                    } ${upgrading === plan.id ? 'opacity-50' : ''}`}
                                >
                                    {upgrading === plan.id ? "Zpracování..." : "Upgradovat"}
                                </button>
                            ) : (
                                <div className="text-center py-2 text-[9px] text-white/20 font-bold uppercase tracking-widest">
                                    Nižší plán
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function CurrentPlanCard({ sub, onRefresh }: { sub: SubscriptionState; onRefresh: () => void }) {
    const pct = sub.creditsTotal > 0
        ? Math.min(100, (sub.creditsUsed / sub.creditsTotal) * 100)
        : 0
    const isLow = pct > 80
    const isTrial = sub.status === "trialing"
    const trialDays = isTrial && sub.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400000))
        : null

    return (
        <div className={`rounded-sm p-5 border ${isLow ? 'bg-aisummit-cinnabar/5 border-aisummit-cinnabar/20' : 'bg-[#080808] border-white/5'}`}>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-white">{sub.planName}</span>
                    {isTrial && (
                        <span className="text-[9px] bg-amber-500/20 text-amber-400 px-3 py-1 rounded-full font-bold uppercase">
                            Trial · {trialDays}d zbývá
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
                        {sub.creditsUsed} / {sub.creditsTotal}
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
                        {sub.creditsRemaining} kreditů zbývá
                    </span>
                    {sub.currentPeriodEnd && (
                        <span className="text-[9px] text-white/20 font-bold">
                            Obnoví se {new Date(sub.currentPeriodEnd).toLocaleDateString("cs")}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}
