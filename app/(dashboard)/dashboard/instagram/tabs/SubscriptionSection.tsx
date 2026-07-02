"use client"

import { useStudio, type SubscriptionState } from "@/app/(dashboard)/StudioContext"
import { activateFreePlan } from "@/app/actions/settings-actions"
import { CheckCircle2 } from "lucide-react"
import { useEffect, useState } from "react"

interface PlanRow {
    id: string
    name: string
    description: string | null
    price_czk: number
    features: {
        credits_per_month: number
        allowed_actions: string[]
        allowed_media?: string[]
        growth_tracking?: boolean
        analytics: "basic" | "full"
        priority: boolean
        highlight: boolean
        extra_credit_price: number
    }
}

/** Marketing one-liners per tier */
const PLAN_TAGLINES: Record<string, string> = {
    chrlit_start: "Nakopni profil",
    chrlit_rust: "Rosteme spolu",
    chrlit_dominance: "Ovládni svůj trh",
}

function planFeatureList(p: PlanRow): string[] {
    const f = p.features
    const items = [
        `${f.credits_per_month} kreditů měsíčně`,
        "AI posty — obrázek 1 kredit · carousel 3",
    ]
    if (!f.allowed_media || f.allowed_media.includes("reel")) items.push("Reels (AI video) — 5 kreditů")
    if (f.allowed_actions.includes("post_variant")) items.push("A/B varianty příspěvků")
    if (f.allowed_actions.includes("idea_generate")) items.push("AI nápady na obsah")
    if (f.growth_tracking) items.push("Růstový dashboard — sledování followerů")
    if (f.allowed_actions.some(a => a.startsWith("product_"))) items.push("Product studio — vizualizace & mockupy")
    items.push(f.analytics === "full" ? "Plná analytika výkonu" : "Základní analytika")
    if (f.priority) items.push("Prioritní generování")
    return items
}

export function SubscriptionSection({ projectId }: { projectId: string }) {
    const { subscription, subscriptionLoading, refreshSubscription } = useStudio()
    const [plans, setPlans] = useState<PlanRow[]>([])
    const [upgradingPlanId, setUpgradingPlanId] = useState<string | null>(null)

    useEffect(() => {
        fetch("/api/plans")
            .then(r => r.ok ? r.json() : { plans: [] })
            .then(d => setPlans(d.plans || []))
            .catch(() => setPlans([]))
    }, [])

    const handleUpgrade = async (planId: string) => {
        setUpgradingPlanId(planId)
        try {
            // Free plans (e.g. Beta Trial) activate directly — no payment gateway.
            const plan = plans.find(p => p.id === planId)
            if (plan && plan.price_czk === 0) {
                const res = await activateFreePlan(projectId, planId)
                if (res.success) {
                    refreshSubscription()
                } else {
                    alert(res.error || "Aktivace plánu selhala.")
                }
                return
            }

            const resp = await fetch("/api/payments/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // projectId is the tenant SLUG — send as clientSlug (the API
                // resolves it). Sending it as clientId queried clients.id=<slug>
                // → "Client not found".
                body: JSON.stringify({ planId, clientSlug: projectId }),
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
            setUpgradingPlanId(null)
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
                    <p className="text-white/60 text-xs">Nemáte aktivní předplatné.</p>
                </div>
            )}

            {/* Growth tier cards */}
            {plans.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {plans.map(plan => {
                        const isCurrent = subscription?.planId === plan.id && subscription?.status === "active"
                        const highlight = plan.features.highlight
                        return (
                            <div
                                key={plan.id}
                                className={`rounded-sm p-5 flex flex-col border-2 ${
                                    isCurrent
                                        ? "border-emerald-500/40 bg-emerald-500/5"
                                        : highlight
                                            ? "border-aisummit-cinnabar/40 bg-aisummit-cinnabar/5"
                                            : "border-white/10 bg-[#080808]"
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <h4 className="text-xs font-black uppercase tracking-widest text-white">{plan.name}</h4>
                                    {highlight && !isCurrent && (
                                        <span className="text-[8px] bg-aisummit-cinnabar/20 text-aisummit-cinnabar px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">
                                            Doporučeno
                                        </span>
                                    )}
                                    {isCurrent && (
                                        <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">
                                            Váš plán
                                        </span>
                                    )}
                                </div>
                                <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest mb-3">
                                    {PLAN_TAGLINES[plan.id] || plan.description || ""}
                                </p>
                                <div className="mb-3">
                                    <span className="text-3xl font-black text-white">{Math.round(plan.price_czk / 100)}</span>
                                    <span className="text-white/40 text-[10px] font-bold ml-1">Kč/měs</span>
                                </div>
                                <ul className="space-y-1.5 mb-4 flex-1">
                                    {planFeatureList(plan).map((f, i) => (
                                        <li key={i} className="flex items-center gap-1.5 text-[10px] text-white/50">
                                            <CheckCircle2 className="w-3 h-3 text-aisummit-cinnabar/60 shrink-0" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                                <button
                                    onClick={() => handleUpgrade(plan.id)}
                                    disabled={isCurrent || upgradingPlanId !== null}
                                    className={`w-full py-2.5 rounded-sm text-[9px] font-bold uppercase tracking-widest transition-all ${
                                        isCurrent
                                            ? "bg-white/5 text-white/30 cursor-default"
                                            : "bg-aisummit-cinnabar text-white hover:bg-aisummit-cinnabar/90"
                                    } ${upgradingPlanId === plan.id ? "opacity-50" : ""}`}
                                >
                                    {isCurrent ? "Aktivní" : upgradingPlanId === plan.id ? "Zpracování..." : `Přejít na ${plan.name}`}
                                </button>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
function CurrentPlanCard({ sub, onRefresh }: { sub: SubscriptionState; onRefresh: () => void }) {
    const pct = (sub.creditsTotal ?? 0) > 0
        ? Math.min(100, ((sub.creditsUsed ?? 0) / (sub.creditsTotal ?? 1)) * 100)
        : 0
    const isLow = pct > 80
    const isTrial = sub.status === "trialing"
    // The v2 trial is content-gated (3 free posts), NOT time-gated — trialEndsAt is
    // only set on legacy time-limited trials. Without it, show the content gate.
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
                            {trialDays !== null ? `Trial · ${trialDays}d zbývá` : "Trial · 3 příspěvky zdarma"}
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
