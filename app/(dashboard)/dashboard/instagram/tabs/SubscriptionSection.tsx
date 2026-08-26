"use client"

import { openCheckoutWindow } from "@/lib/open-checkout"
import { EmbeddedCheckoutModal, isEmbeddedCheckoutAvailable } from "@/app/(dashboard)/EmbeddedCheckoutModal"
import { useStudio, type SubscriptionState } from "@/app/(dashboard)/StudioContext"
import { activateFreePlan } from "@/app/actions/settings-actions"
import { hasBillingDetails, cancelSubscription, resumeSubscription } from "@/app/actions/billing-actions"
import { BillingModal } from "./BillingSection"
import { Hint, HINTS } from "./Hint"
import { CreditPacks } from "@/app/(dashboard)/CreditPacks"
import { CheckCircle2, Clock } from "lucide-react"
import { creditExample } from "@/lib/credits"
import { useEffect, useState } from "react"
import {
    BILLING_TERMS,
    DEFAULT_TERM_MONTHS,
    formatCzk,
    formatCzkAmount,
    getTerm,
    monthlyEquivalent,
    termLabel,
    termPrice,
    termSavings,
    planPriority,
    PRIORITY,
    type TermMonths,
} from "@/lib/pricing"

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
        priority: number | boolean
        highlight: boolean
        extra_credit_price: number
    }
}

/** Marketing one-liners per tier */
const PLAN_TAGLINES: Record<string, string> = {
    chrlit_start: "Nakopni profil",
    chrlit_rust: "Rosteme spolu",
    chrlit_dominance: "Ovládni svůj trh",
    chrlit_imperium: "Postav impérium",
}

/** `pending` = tarif to obsahuje, ale zatím to nejde použít (dnes jen reels). */
interface PlanFeatureItem {
    text: string
    pending?: boolean
}

function planFeatureList(p: PlanRow, reelsEnabled: boolean): PlanFeatureItem[] {
    const f = p.features
    const hasReels = !f.allowed_media || f.allowed_media.includes("reel")

    const items: PlanFeatureItem[] = [
        { text: `${f.credits_per_month} kreditů měsíčně` },
        // Váhy se sem nepíšou číslem — do teď tu stálo „obrázek 1 kredit · carousel 3"
        // ručně, zatímco skutečné váhy žijí v MEDIA_CREDITS. Dvě pravdy o ceně.
        { text: creditExample(f.credits_per_month, { reels: hasReels && reelsEnabled }) },
    ]

    // Reels se nezamlčují, jen se přiznají: vypínač REELS_ENABLED je potichu
    // překlápí na carousel, takže je nabídnout jako hotovou funkci by byl mis-sale.
    if (hasReels) items.push({ text: "Reels (AI video) — 5 kreditů", pending: !reelsEnabled })

    if (f.allowed_actions.includes("post_variant")) items.push({ text: "A/B varianty příspěvků" })
    if (f.allowed_actions.includes("idea_generate")) items.push({ text: "AI nápady na obsah" })
    if (f.growth_tracking) items.push({ text: "Růstový dashboard — sledování followerů" })
    if (f.allowed_actions.some(a => a.startsWith("product_"))) items.push({ text: "Product studio — vizualizace & mockupy" })
    items.push({ text: f.analytics === "full" ? "Plná analytika výkonu" : "Základní analytika" })

    // Dva stupně, ne jeden příznak — jinak by Impérium slibovalo „nejvyšší"
    // prioritu a dostalo přesně tu samou frontu jako Dominance.
    const prio = planPriority(f)
    if (prio >= PRIORITY.highest) items.push({ text: "Nejvyšší priorita ve frontě" })
    else if (prio > PRIORITY.none) items.push({ text: "Prioritní generování" })

    return items
}

export function SubscriptionSection({ projectId }: { projectId: string }) {
    const { subscription, subscriptionLoading, refreshSubscription } = useStudio()
    const [plans, setPlans] = useState<PlanRow[]>([])
    const [upgradingPlanId, setUpgradingPlanId] = useState<string | null>(null)
    /** Klíč vestavěné pokladny. Neprázdný = pokladna je otevřená nad studiem. */
    const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null)
    // Plán, který čeká na doplnění fakturačních údajů. Platba se spustí až po nich.
    const [billingGatePlanId, setBillingGatePlanId] = useState<string | null>(null)
    const [term, setTerm] = useState<TermMonths>(DEFAULT_TERM_MONTHS)

    useEffect(() => {
        fetch("/api/plans")
            .then(r => r.ok ? r.json() : { plans: [] })
            .then(d => setPlans(d.plans || []))
            .catch(() => setPlans([]))
    }, [])

    // Volba z ceníku na landingu dojede až sem (?tarif=…&obdobi=…) — kdo si
    // vybral před registrací, nemá se rozhodovat podruhé.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const wanted = params.get("obdobi")
        if (wanted) {
            const months = Number(wanted)
            if (months === 1 || months === 3 || months === 6 || months === 12) setTerm(months)
        }
    }, [])

    /**
     * Uprostřed předplaceného období se tarif nemění.
     *
     * Změna tarifu není proratovaná — nové období začíná ihned a zbytek starého
     * propadá. U měsíčního plánu to znamená pár dnů, u ročního jedenáct měsíců,
     * a to už není „bez proráce", to je vyvlastnění. Dokud proráci neumíme,
     * musí se to udělat ručně.
     */
    const lockedTerm = (subscription?.termMonths ?? 1) > 1
        && subscription?.status === "active"
        && !subscription?.isTrial

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

            // Bez fakturačních údajů by doklad vznikl s náhradními údaji —
            // vybrat je před platbou je jediný okamžik, kdy je zákazník ochotný.
            // Selhání kontroly platbu neblokuje: neprodat je horší než dovyplnit potom.
            const billingReady = await hasBillingDetails(projectId).catch(() => true)
            if (!billingReady) {
                setBillingGatePlanId(planId)
                return
            }

            await startPayment(planId)
        } catch (err) {
            alert("Nepodařilo se vytvořit platbu.")
        } finally {
            setUpgradingPlanId(null)
        }
    }

    const startPayment = async (planId: string) => {
        // Vestavěná pokladna nikam neodchází, takže odpadá celá třída selhání
        // kolem otevírání okna. Hostovaná zůstává jako záloha pro případ, že
        // chybí veřejný klíč nebo běží druhá brána — viz lib/open-checkout.ts.
        const wantEmbedded = isEmbeddedCheckoutAvailable()
        const checkout = wantEmbedded ? null : openCheckoutWindow()
        try {
            const resp = await fetch("/api/payments/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // projectId is the tenant SLUG — send as clientSlug (the API
                // resolves it). Sending it as clientId queried clients.id=<slug>
                // → "Client not found".
                body: JSON.stringify({ planId, clientSlug: projectId, termMonths: term, embedded: wantEmbedded }),
            })
            const data = await resp.json()
            if (data.clientSecret) {
                setCheckoutSecret(data.clientSecret)
            } else if (data.redirectUrl) {
                // Brána vestavěný režim nepodpořila (ComGate) — odcházíme.
                ;(checkout ?? openCheckoutWindow()).go(data.redirectUrl)
            } else {
                checkout?.abort()
                alert(data.error || "Platební bránu se nepodařilo otevřít.")
            }
        } catch (err) {
            checkout?.abort()
            throw err
        }
    }

    /** Údaje doplněny → pokračujeme přesně tam, kde platba skončila. */
    const handleBillingSaved = async () => {
        const planId = billingGatePlanId
        setBillingGatePlanId(null)
        if (!planId) return
        setUpgradingPlanId(planId)
        try {
            await startPayment(planId)
        } catch {
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
            {checkoutSecret && (
                <EmbeddedCheckoutModal
                    clientSecret={checkoutSecret}
                    // Zavření pokladnu neruší: PENDING řádek v `payments` zůstává
                    // a reconciler se brány doptá sám, takže zaplacená platba
                    // neuvízne jen proto, že uživatel zavřel okno.
                    onClose={() => { setCheckoutSecret(null); refreshSubscription() }}
                />
            )}
            {billingGatePlanId && (
                <BillingModal
                    projectId={projectId}
                    onDone={handleBillingSaved}
                    onClose={() => setBillingGatePlanId(null)}
                />
            )}

            <div className="border-b border-white/10 pb-2">
                <h3 className="text-sm font-black uppercase tracking-widest text-white/70">
                    Předplatné & Kredity
                </h3>
                <div className="mt-2"><Hint label="jak fungují kredity">{HINTS.credits}</Hint></div>
            </div>

            {/* Current plan status */}
            {subscription ? (
                <CurrentPlanCard sub={subscription} onRefresh={refreshSubscription} projectId={projectId} />
            ) : (
                <div className="bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm p-4">
                    <p className="text-white/60 text-xs">Nemáte aktivní předplatné.</p>
                </div>
            )}

            {/* Přepínač období — stejné pravidlo i ceny jako na ceníku (lib/pricing.ts) */}
            {plans.length > 0 && !lockedTerm && (
                <div className="flex justify-center">
                    <div className="grid grid-cols-2 sm:flex bg-[#080808] p-1 rounded-sm border border-white/10 gap-1">
                        {BILLING_TERMS.map(t => {
                            const active = t.months === term
                            return (
                                <button
                                    key={t.months}
                                    onClick={() => setTerm(t.months)}
                                    className={`px-3 sm:px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm transition-all flex items-center justify-center gap-1.5 ${
                                        active
                                            ? "bg-aisummit-cinnabar/20 text-aisummit-cinnabar border border-aisummit-cinnabar/30"
                                            : "text-white/40 hover:text-white border border-transparent"
                                    }`}
                                >
                                    {t.label}
                                    {t.badge && (
                                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold ${
                                            active ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-white/30"
                                        }`}>
                                            {t.badge}
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                    <div className="mt-3 flex justify-center"><Hint label="co znamená delší období">{HINTS.term}</Hint></div>
                </div>
            )}

            {lockedTerm && (
                <p className="text-center text-[9px] text-white/30 font-bold uppercase tracking-widest leading-relaxed">
                    Máte zaplaceno {termLabel((subscription?.termMonths ?? 1) as TermMonths)}
                    {subscription?.currentPeriodEnd ? ` do ${new Date(subscription.currentPeriodEnd).toLocaleDateString("cs-CZ")}` : ""}.
                    <br />Chcete vyšší tarif? Napište nám — zbývající období převedeme.
                </p>
            )}

            {/* Growth tier cards */}
            {plans.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {plans.map(plan => {
                        const isCurrent = subscription?.planId === plan.id && subscription?.status === "active"
                        // Switching tiers mid-period is NOT prorated — the new plan starts
                        // immediately and the rest of the paid period is forfeited. Say so
                        // at the button, not in a support e-mail afterwards.
                        const isTierChange = !isCurrent
                            && subscription?.status === "active"
                            && !subscription?.isTrial
                            && !!subscription?.currentPeriodEnd
                        const highlight = plan.features.highlight
                        // Uprostřed předplaceného období nesmí jít tarif změnit
                        // jedním klikem — propálilo by to zbytek zaplaceného roku.
                        const blockedByTerm = lockedTerm && !isCurrent
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
                                {/* `price_czk` je MĚSÍČNÍ cena; cenu období z ní počítá
                                    sdílené pravidlo, ať ceník a strh nikdy nemluví jinak. */}
                                <div className="mb-1">
                                    <span className="text-3xl font-black text-white">{formatCzkAmount(monthlyEquivalent(plan.price_czk, term))}</span>
                                    <span className="text-white/40 text-[10px] font-bold ml-1">Kč/měs</span>
                                </div>
                                <p className="text-[9px] text-white/30 font-bold mb-1">
                                    {term === 1
                                        ? getTerm(term).note
                                        : `${formatCzk(termPrice(plan.price_czk, term))} jednorázově ${termLabel(term)}`}
                                </p>
                                <p className="text-[9px] font-bold mb-3 h-3">
                                    {termSavings(plan.price_czk, term) > 0 && (
                                        <span className="text-emerald-400">Ušetříte {formatCzk(termSavings(plan.price_czk, term))}</span>
                                    )}
                                </p>
                                <ul className="space-y-1.5 mb-4 flex-1">
                                    {planFeatureList(plan, subscription?.reelsEnabled === true).map((f, i) => (
                                        <li
                                            key={i}
                                            className={`flex items-center gap-1.5 text-[10px] ${f.pending ? "text-white/25" : "text-white/50"}`}
                                        >
                                            {f.pending ? (
                                                <Clock className="w-3 h-3 text-white/20 shrink-0" />
                                            ) : (
                                                <CheckCircle2 className="w-3 h-3 text-aisummit-cinnabar/60 shrink-0" />
                                            )}
                                            {f.text}
                                            {f.pending && (
                                                <span className="text-[8px] uppercase tracking-widest font-bold text-white/35 border border-white/10 rounded-sm px-1 py-0.5 shrink-0">
                                                    připravujeme
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                                <button
                                    onClick={() => handleUpgrade(plan.id)}
                                    disabled={isCurrent || blockedByTerm || upgradingPlanId !== null}
                                    className={`w-full py-2.5 rounded-sm text-[9px] font-bold uppercase tracking-widest transition-all ${
                                        isCurrent || blockedByTerm
                                            ? "bg-white/5 text-white/30 cursor-default"
                                            : "bg-aisummit-cinnabar text-white hover:bg-aisummit-cinnabar/90"
                                    } ${upgradingPlanId === plan.id ? "opacity-50" : ""}`}
                                >
                                    {isCurrent
                                        ? "Aktivní"
                                        : blockedByTerm
                                            ? "Napište nám"
                                            : upgradingPlanId === plan.id ? "Zpracování..." : `Přejít na ${plan.name}`}
                                </button>
                                {isTierChange && !blockedByTerm && (
                                    <p className="mt-2 text-[8px] leading-relaxed text-white/25 font-bold uppercase tracking-widest">
                                        Nový plán začne platit ihned — nevyčerpaný zbytek stávajícího období se nepřevádí
                                    </p>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
function CurrentPlanCard({ sub, onRefresh, projectId }: { sub: SubscriptionState; onRefresh: () => void; projectId: string }) {
    const isTrial = sub.status === "trialing"
    // The v2 trial has NO monthly credits (credits_per_month=0) — its real quota is
    // "N free posts" tracked via plan_posts_unlocked/limit. Showing a "0/0 kreditů"
    // bar for it conflates two different quotas and reads as broken. So for a
    // content-gated trial we render the free-posts allotment instead of the credit bar.
    const planLimit = sub.planPostsLimit ?? 0
    const usePostQuota = isTrial && (sub.creditsTotal ?? 0) === 0 && planLimit > 0
    const usedUnits = usePostQuota ? (sub.planPostsUnlocked ?? 0) : (sub.creditsUsed ?? 0)
    const totalUnits = usePostQuota ? planLimit : (sub.creditsTotal ?? 0)
    const remainingUnits = usePostQuota ? Math.max(0, planLimit - (sub.planPostsUnlocked ?? 0)) : (sub.creditsRemaining ?? 0)
    const pct = totalUnits > 0 ? Math.min(100, (usedUnits / totalUnits) * 100) : 0
    const isLow = pct > 80
    // The v2 trial is content-gated (3 free posts), NOT time-gated — trialEndsAt is
    // only set on legacy time-limited trials. Without it, show the content gate.
    const trialDays = isTrial && sub.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(String(sub.trialEndsAt)).getTime() - Date.now()) / 86400000))
        : null
    // The credit bar resets on the CREDIT window (always monthly), not on the paid
    // period — on a yearly plan those are up to eleven months apart, and showing the
    // renewal date next to the credit bar would promise credits that arrive monthly.
    const creditResetAt = sub.creditPeriodEnd ? String(sub.creditPeriodEnd) : null
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
                    {sub.cancelAtPeriodEnd && sub.status !== "expired" && (
                        <span className="text-[9px] bg-white/10 text-white/60 px-3 py-1 rounded-full font-bold uppercase">
                            Končí {periodEnd ? new Date(periodEnd).toLocaleDateString("cs") : "koncem období"}
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
                    <span className="text-[10px] text-white/40 font-bold">
                        {usePostQuota ? "Příspěvky zdarma" : "Využité kredity"}
                    </span>
                    <span className="text-[10px] text-white/60 font-bold">
                        {usedUnits} / {totalUnits}
                        {!usePostQuota && (sub.creditsPurchased ?? 0) > 0 && (
                            <span className="text-emerald-400/70 ml-1">(+{sub.creditsPurchased} dokoupeno)</span>
                        )}
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
                        {usePostQuota
                            ? `${remainingUnits} ${remainingUnits === 1 ? "příspěvek zdarma zbývá" : remainingUnits >= 2 && remainingUnits <= 4 ? "příspěvky zdarma zbývají" : "příspěvků zdarma zbývá"}`
                            : `${remainingUnits} kreditů zbývá`}
                    </span>
                    {!usePostQuota && creditResetAt ? (
                        <span className="text-[9px] text-white/20 font-bold">
                            Kredity se obnoví {new Date(creditResetAt).toLocaleDateString("cs")}
                        </span>
                    ) : periodEnd ? (
                        <span className="text-[9px] text-white/20 font-bold">
                            Obnoví se {new Date(periodEnd).toLocaleDateString("cs")}
                        </span>
                    ) : null}
                </div>
                {/* Only a multi-month plan has two different dates — say which is which,
                    otherwise "obnoví se" would look like the credits arrive in a year. */}
                {periodEnd && creditResetAt && new Date(periodEnd).toDateString() !== new Date(creditResetAt).toDateString() && (
                    <p className="text-[9px] text-white/20 font-bold mt-1">
                        Platíte {termLabel((sub.termMonths ?? 1) as TermMonths)} · předplatné se obnovuje {new Date(periodEnd).toLocaleDateString("cs")}
                    </p>
                )}
            </div>

            {/* Dobití hned pod ukazatelem kreditů — tam se člověk dívá ve chvíli,
                kdy si říká „potřebuju víc". Ne o dvě obrazovky níž. */}
            {!isTrial && sub.status === "active" && (
                <div className="mt-5 pt-4 border-t border-white/5">
                    <p className="text-[9px] text-white/40 font-bold uppercase tracking-widest mb-2">Dobít kredity</p>
                    <CreditPacks />
                </div>
            )}

            {!isTrial && sub.status === "active" && (
                <CancelControl sub={sub} projectId={projectId} onRefresh={onRefresh} />
            )}
        </div>
    )
}

/**
 * Odchod bez volání a bez e-mailu.
 *
 * Zrušení nikdy nezabere přístup okamžitě — zaplacené období doběhne a teprve
 * pak předplatné skončí (server nastavuje `cancel_at_period_end`, ne `status`).
 * Proto je i text potvrzení o datu, ne o „ztratíte přístup".
 */
function CancelControl({ sub, projectId, onRefresh }: { sub: SubscriptionState; projectId: string; onRefresh: () => void }) {
    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const until = sub.currentPeriodEnd ? new Date(String(sub.currentPeriodEnd)).toLocaleDateString("cs") : null

    async function run(action: "cancel" | "resume") {
        setBusy(true)
        setError(null)
        try {
            const res = action === "cancel"
                ? await cancelSubscription(projectId)
                : await resumeSubscription(projectId)
            if (!res.success) setError(res.error || "Nepodařilo se to provést.")
            else { setConfirming(false); onRefresh() }
        } catch {
            setError("Nepodařilo se to provést. Zkuste to prosím znovu.")
        } finally {
            setBusy(false)
        }
    }

    if (sub.cancelAtPeriodEnd) {
        return (
            <div className="mt-5 pt-4 border-t border-white/5 flex flex-wrap items-center gap-3">
                <p className="text-[10px] text-white/40 font-bold">
                    Předplatné končí{until ? ` ${until}` : " koncem období"}. Do té doby funguje beze změny.
                </p>
                <button
                    onClick={() => run("resume")}
                    disabled={busy}
                    className="ml-auto text-[9px] font-bold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors"
                >
                    {busy ? "Obnovuji…" : "Obnovit předplatné"}
                </button>
                {error && <p className="w-full text-[10px] text-red-400">{error}</p>}
            </div>
        )
    }

    return (
        <div className="mt-5 pt-4 border-t border-white/5">
            {!confirming ? (
                <button
                    onClick={() => setConfirming(true)}
                    className="text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors"
                >
                    Zrušit předplatné
                </button>
            ) : (
                <div className="flex flex-wrap items-center gap-3">
                    <p className="text-[10px] text-white/50 font-bold">
                        Zrušit? Plán poběží{until ? ` do ${until}` : " do konce zaplaceného období"} a pak se neobnoví.
                    </p>
                    <div className="ml-auto flex items-center gap-3">
                        <button
                            onClick={() => setConfirming(false)}
                            disabled={busy}
                            className="text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 disabled:opacity-40 transition-colors"
                        >
                            Nechat běžet
                        </button>
                        <button
                            onClick={() => run("cancel")}
                            disabled={busy}
                            className="text-[9px] font-bold uppercase tracking-widest text-aisummit-cinnabar hover:opacity-80 disabled:opacity-40 transition-colors"
                        >
                            {busy ? "Ruším…" : "Ano, zrušit"}
                        </button>
                    </div>
                </div>
            )}
            {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
        </div>
    )
}
