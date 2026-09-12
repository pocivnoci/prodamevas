"use client"

import { openCheckoutWindow } from "@/lib/open-checkout"
import { EmbeddedCheckoutModal, isEmbeddedCheckoutAvailable } from "@/app/(dashboard)/EmbeddedCheckoutModal"
import { useStudio, type SubscriptionState } from "@/app/(dashboard)/StudioContext"
import { activateFreePlan } from "@/app/actions/settings-actions"
import { hasBillingDetails, cancelSubscription, resumeSubscription, billingPortalUrl } from "@/app/actions/billing-actions"
import { giftPlan } from "@/app/actions/admin-actions"
import { BillingModal } from "./BillingSection"
import { Hint, useHints } from "./Hint"
import { CreditPacks } from "@/app/(dashboard)/CreditPacks"
import { LEGAL, VAT_RATE_PCT, vatNotice } from "@/lib/legal"

/** U plátce DPH nesmí cena v ceníku vypadat jako konečná. U neplátce se dodatek nevykreslí. */
const vatPayer = LEGAL.vatStatus === "payer"
import { CheckCircle2, Clock, Gift } from "lucide-react"
import { creditExample, MEDIA_CREDITS } from "@/lib/credits"
import { useEffect, useState } from "react"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import {
    BILLING_TERMS,
    DEFAULT_TERM_MONTHS,
    chargeableHaleru,
    formatCzk,
    formatCzkAmount,
    monthlyEquivalent,
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
        human_support?: boolean
    }
}

/** Texty tabu (`billing.subscription.*` v messages) — předává se pomocným funkcím mimo komponentu. */
type SubscriptionT = ReturnType<typeof useTranslations<"billing.subscription">>

/** Datum bez času v jazyce UI („12. 9. 2026"); next-intl nese locale i pražskou zónu. */
function dateOnly(format: ReturnType<typeof useFormatter>, iso: string): string {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? "" : format.dateTime(d, { dateStyle: "medium" })
}

/** `pending` = tarif to obsahuje, ale zatím to nejde použít (dnes jen reels). */
interface PlanFeatureItem {
    text: string
    pending?: boolean
}

function planFeatureList(p: PlanRow, reelsEnabled: boolean, t: SubscriptionT): PlanFeatureItem[] {
    const f = p.features
    const hasReels = !f.allowed_media || f.allowed_media.includes("reel")

    const items: PlanFeatureItem[] = [
        { text: t("plans.features.credits", { count: f.credits_per_month }) },
        // Váhy se sem nepíšou číslem — do teď tu stálo „obrázek 1 kredit · carousel 3"
        // ručně, zatímco skutečné váhy žijí v MEDIA_CREDITS. Dvě pravdy o ceně.
        { text: creditExample(f.credits_per_month, { reels: hasReels && reelsEnabled }) },
    ]

    // Reels se nezamlčují, jen se přiznají: vypínač REELS_ENABLED je potichu
    // překlápí na carousel, takže je nabídnout jako hotovou funkci by byl mis-sale.
    // Obě velikosti reelu; čísla jdou z MEDIA_CREDITS, nikdy ručně (aserce 13.11).
    if (hasReels) items.push({ text: t("plans.features.reels", { short: MEDIA_CREDITS.reel, long: MEDIA_CREDITS.reel_long }), pending: !reelsEnabled })

    // Ne „A/B varianty": netestuje se nic a zákazník to četl jako dva příspěvky
    // v ceně jednoho. `generatePostVariant` účtuje každou verzi jako plný
    // příspěvek podle média, takže cena musí být v odrážce, ne až v košíku.
    if (f.allowed_actions.includes("post_variant")) items.push({ text: t("plans.features.variants") })
    if (f.allowed_actions.includes("idea_generate")) items.push({ text: t("plans.features.ideas") })
    if (f.growth_tracking) items.push({ text: t("plans.features.growth") })
    if (f.allowed_actions.some(a => a.startsWith("product_"))) items.push({ text: t("plans.features.productStudio") })
    items.push({ text: f.analytics === "full" ? t("plans.features.analyticsFull") : t("plans.features.analyticsBasic") })

    // Dva stupně, ne jeden příznak — jinak by Impérium slibovalo „nejvyšší"
    // prioritu a dostalo přesně tu samou frontu jako Dominance.
    const prio = planPriority(f)
    if (prio >= PRIORITY.highest) items.push({ text: t("plans.features.priorityHighest") })
    else if (prio > PRIORITY.none) items.push({ text: t("plans.features.priorityHigh") })

    // Lidská část služby se čte z tarifu, ne z kopie — stejně jako priorita.
    if (f.human_support) {
        items.push({ text: t("plans.features.humanReview") })
        items.push({ text: t("plans.features.humanSupport") })
    }

    return items
}

export function SubscriptionSection({ projectId }: { projectId: string }) {
    const { subscription, subscriptionLoading, refreshSubscription } = useStudio()
    const t = useTranslations("billing.subscription")
    const hints = useHints()
    const format = useFormatter()
    const locale = useLocale()
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
        // Tarif zdarma nemá zaplacený zbytek, který by přechod propálil.
        && subscription?.provider !== "gift"

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
                    alert(res.error || t("errors.activate"))
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
            alert(t("errors.createPayment"))
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
                alert(data.error || t("errors.openGateway"))
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
            alert(t("errors.createPayment"))
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
                    {t("title")}
                </h3>
                <div className="mt-2"><Hint label={t("hints.credits")}>{hints.credits}</Hint></div>
            </div>

            {/* Current plan status */}
            {subscription ? (
                <CurrentPlanCard sub={subscription} onRefresh={refreshSubscription} projectId={projectId} />
            ) : (
                <div className="bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm p-4">
                    <p className="text-white/60 text-xs">{t("noSubscription")}</p>
                </div>
            )}

            {/* Jen správce: tarif zdarma. Zákazníkovi se nevykreslí nic. */}
            <GiftPlanControl projectId={projectId} plans={plans} subscription={subscription} onDone={refreshSubscription} />

            {/* Přepínač období — stejné pravidlo i ceny jako na ceníku (lib/pricing.ts) */}
            {plans.length > 0 && !lockedTerm && (
                <div className="flex justify-center">
                    <div className="grid grid-cols-2 sm:flex bg-[#080808] p-1 rounded-sm border border-white/10 gap-1">
                        {BILLING_TERMS.map(option => {
                            const active = option.months === term
                            return (
                                <button
                                    key={option.months}
                                    onClick={() => setTerm(option.months)}
                                    className={`px-3 sm:px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm transition-all flex items-center justify-center gap-1.5 ${
                                        active
                                            ? "bg-aisummit-cinnabar/20 text-aisummit-cinnabar border border-aisummit-cinnabar/30"
                                            : "text-white/40 hover:text-white border border-transparent"
                                    }`}
                                >
                                    {t(`term.${option.months}.label`)}
                                    {option.badge && (
                                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold ${
                                            active ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-white/30"
                                        }`}>
                                            {t(`term.${option.months}.badge`)}
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                    <div className="mt-3 flex justify-center"><Hint label={t("hints.term")}>{hints.term}</Hint></div>
                </div>
            )}

            {lockedTerm && (
                <p className="text-center text-[9px] text-white/30 font-bold uppercase tracking-widest leading-relaxed">
                    {t("locked.paid", {
                        term: t(`term.${(subscription?.termMonths ?? 1) as TermMonths}.short`),
                        until: subscription?.currentPeriodEnd ? dateOnly(format, subscription.currentPeriodEnd) : "none",
                    })}
                    <br />{t("locked.contact")}
                </p>
            )}

            {/* Growth tier cards */}
            {plans.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {plans.map(plan => {
                        const isYours = subscription?.planId === plan.id && subscription?.status === "active"
                        // Tarif zdarma jde zaplatit i během daru — kdo se rozhodl, nemá
                        // čekat na konec období před zamčeným tlačítkem. `isCurrent` proto
                        // znamená „tenhle tarif už má a znovu ho kupovat nemůže".
                        const payForGift = isYours && subscription?.provider === "gift"
                        const isCurrent = isYours && !payForGift
                        // Switching tiers mid-period is NOT prorated — the new plan starts
                        // immediately and the rest of the paid period is forfeited. Say so
                        // at the button, not in a support e-mail afterwards.
                        const isTierChange = !isYours
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
                                    isYours
                                        ? "border-emerald-500/40 bg-emerald-500/5"
                                        : highlight
                                            ? "border-aisummit-cinnabar/40 bg-aisummit-cinnabar/5"
                                            : "border-white/10 bg-[#080808]"
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <h4 className="text-xs font-black uppercase tracking-widest text-white">{plan.name}</h4>
                                    {highlight && !isYours && (
                                        <span className="text-[8px] bg-aisummit-cinnabar/20 text-aisummit-cinnabar px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">
                                            {t("plans.recommended")}
                                        </span>
                                    )}
                                    {isYours && (
                                        <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">
                                            {t("plans.yours")}
                                        </span>
                                    )}
                                </div>
                                {/* Marketingový slogan tarifu žije v messages (`plans.taglines.<id>`);
                                    tarif bez sloganu ukáže popis z DB. */}
                                <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest mb-3">
                                    {t.has(`plans.taglines.${plan.id}`) ? t(`plans.taglines.${plan.id}`) : plan.description || ""}
                                </p>
                                {/* `price_czk` je MĚSÍČNÍ cena; cenu období z ní počítá
                                    sdílené pravidlo, ať ceník a strh nikdy nemluví jinak. */}
                                <div className="mb-1">
                                    <span className="text-3xl font-black text-white">{formatCzkAmount(monthlyEquivalent(plan.price_czk, term))}</span>
                                    <span className="text-white/40 text-[10px] font-bold ml-1">{t("plans.perMonth", { vat: LEGAL.vatStatus })}</span>
                                </div>
                                <p className="text-[9px] text-white/30 font-bold mb-1">
                                    {term === 1
                                        ? t(`term.${term}.note`)
                                        : t("plans.oneOff", { amount: formatCzk(termPrice(plan.price_czk, term)), term: t(`term.${term}.short`) })}
                                </p>
                                {/* Kolik reálně odejde z karty. U plátce DPH musí být
                                    hrubá částka vidět TADY, u tlačítka — ne až na dokladu. */}
                                {vatPayer && (
                                    <p className="text-[9px] text-white/25 font-bold mb-1">
                                        {t("plans.gross", { amount: formatCzk(chargeableHaleru(termPrice(plan.price_czk, term))), months: term, term: t(`term.${term}.short`) })}
                                    </p>
                                )}
                                <p className="text-[9px] font-bold mb-3 h-3">
                                    {termSavings(plan.price_czk, term) > 0 && (
                                        <span className="text-emerald-400">{t("plans.savings", { amount: formatCzk(termSavings(plan.price_czk, term)) })}</span>
                                    )}
                                </p>
                                <ul className="space-y-1.5 mb-4 flex-1">
                                    {planFeatureList(plan, subscription?.reelsEnabled === true, t).map((f, i) => (
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
                                                    {t("plans.pending")}
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
                                        ? t("plans.button.active")
                                        : blockedByTerm
                                            ? t("plans.button.contact")
                                            : upgradingPlanId === plan.id
                                                ? t("plans.button.processing")
                                                : payForGift ? t("plans.button.payGift", { name: plan.name }) : t("plans.button.switch", { name: plan.name })}
                                </button>
                                {(isTierChange || payForGift) && !blockedByTerm && (
                                    <p className="mt-2 text-[8px] leading-relaxed text-white/25 font-bold uppercase tracking-widest">
                                        {payForGift
                                            ? t("plans.note.payGift")
                                            : t("plans.note.tierChange")}
                                    </p>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
            {/* Věta o DPH patří pod ceník, ne jen do obchodních podmínek: cena bez
                upřesnění vypadá u plátce jako konečná a zákazník pak na výpisu
                najde o pětinu víc. Česky ji dává lib/legal.ts (jediný zdroj i pro
                e-maily a podmínky); v jiném jazyce UI překlad podle režimu plátce. */}
            <p className="text-center mt-3 text-[9px] text-white/20 font-bold uppercase tracking-widest">
                {locale === "cs" ? vatNotice() : t(`vatNotice.${LEGAL.vatStatus}`, { rate: VAT_RATE_PCT })}
            </p>
        </div>
    )
}
/**
 * Odkaz do zákaznického portálu Stripu — karta, doklady, výpověď.
 *
 * Vykreslí se, až když server potvrdí, že portál pro tohohle klienta dává smysl
 * (živé Stripe předplatné + nakonfigurovaná brána). Ukázat tlačítko a teprve po
 * kliknutí zjistit, že nikam nevede, je horší než ho neukázat — proto se odkaz
 * načítá dopředu a při prázdné odpovědi se nevykreslí nic.
 */
function ManageBillingLink({ projectId }: { projectId: string }) {
    const t = useTranslations("billing.subscription")
    const [url, setUrl] = useState<string | null>(null)

    useEffect(() => {
        let alive = true
        void billingPortalUrl(projectId)
            .then(r => { if (alive && r.url) setUrl(r.url) })
            .catch(() => { /* portál je bonus, ne podmínka — mlčky přeskočit */ })
        return () => { alive = false }
    }, [projectId])

    if (!url) return null
    return (
        <a
            href={url}
            className="text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors"
        >
            {t("portal")}
        </a>
    )
}

/**
 * Tarif zdarma — jen pro správce.
 *
 * Obchod dává klientům tarif na vyzkoušení: jakýkoli z ceníku, na jakékoli období
 * z ceníku. Sedí přímo u karty tarifu, protože sem se správce dívá, když řeší
 * „co má klient zaplaceno", a výsledek po kliknutí vidí o kus výš. Pravidla (jen
 * placený tarif, ne nad živým předplatným) drží server v `giftPlan`.
 */
function GiftPlanControl({ projectId, plans, subscription, onDone }: {
    projectId: string
    plans: PlanRow[]
    subscription: SubscriptionState | null
    onDone: () => void
}) {
    const { isAdmin } = useStudio()
    const t = useTranslations("billing.subscription")
    const format = useFormatter()
    const [planId, setPlanId] = useState<string | null>(null)
    const [term, setTerm] = useState<TermMonths>(1)
    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState(false)
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

    const paidPlans = plans.filter(p => p.price_czk > 0)
    const selected = paidPlans.find(p => p.id === planId)
        ?? paidPlans.find(p => p.features.highlight)
        ?? paidPlans[0]

    if (!isAdmin || !selected) return null

    const live = subscription?.status === "active"
    const until = subscription?.currentPeriodEnd
        ? dateOnly(format, String(subscription.currentPeriodEnd))
        : null

    async function grant(plan: PlanRow) {
        setBusy(true)
        setResult(null)
        try {
            const res = await giftPlan(projectId, plan.id, term)
            setResult({ ok: res.success, text: res.success ? (res.message || t("gift.done")) : (res.error || t("gift.failed")) })
            if (res.success) {
                setConfirming(false)
                onDone()
            }
        } catch {
            setResult({ ok: false, text: t("gift.failedRetry") })
        } finally {
            setBusy(false)
        }
    }

    const selectClass = "px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-white/30"

    return (
        <div className="border border-dashed border-white/10 rounded-sm p-4 space-y-3">
            <div className="flex items-center gap-2">
                <Gift className="w-3.5 h-3.5 text-white/30 shrink-0" />
                <p className="text-[9px] text-white/40 font-bold uppercase tracking-widest">{t("gift.title")}</p>
            </div>

            {live ? (
                <p className="text-[10px] text-white/40 leading-relaxed">
                    {subscription?.provider === "gift"
                        ? t("gift.runningGift", { until: until ?? "none" })
                        : t("gift.runningPaid", { until: until ?? "none" })}
                </p>
            ) : !confirming ? (
                <div className="space-y-3">
                    <p className="text-[10px] text-white/40 leading-relaxed">
                        {t("gift.intro")}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        <select value={selected.id} onChange={e => setPlanId(e.target.value)} className={selectClass} aria-label={t("gift.planAria")}>
                            {paidPlans.map(p => (
                                <option key={p.id} value={p.id}>{t("gift.planOption", { name: p.name, count: p.features.credits_per_month })}</option>
                            ))}
                        </select>
                        <select value={term} onChange={e => setTerm(Number(e.target.value) as TermMonths)} className={selectClass} aria-label={t("gift.termAria")}>
                            {BILLING_TERMS.map(option => (
                                <option key={option.months} value={option.months}>{t("gift.months", { count: option.months })}</option>
                            ))}
                        </select>
                        <button
                            onClick={() => { setResult(null); setConfirming(true) }}
                            className="px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all cursor-pointer"
                        >
                            {t("gift.give")}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap items-center gap-3">
                    <p className="text-[10px] text-white/60 font-bold">
                        {t("gift.confirm", { name: selected.name, count: term })}
                    </p>
                    <div className="ml-auto flex items-center gap-3">
                        <button
                            onClick={() => setConfirming(false)}
                            disabled={busy}
                            className="text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 disabled:opacity-40 transition-colors"
                        >
                            {t("gift.back")}
                        </button>
                        <button
                            onClick={() => grant(selected)}
                            disabled={busy}
                            className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors"
                        >
                            {busy ? t("gift.giving") : t("gift.yes")}
                        </button>
                    </div>
                </div>
            )}

            {result && (
                <p className={`text-[10px] leading-relaxed ${result.ok ? "text-emerald-300/80" : "text-red-400"}`}>{result.text}</p>
            )}
        </div>
    )
}

function CurrentPlanCard({ sub, onRefresh, projectId }: { sub: SubscriptionState; onRefresh: () => void; projectId: string }) {
    const t = useTranslations("billing.subscription")
    const format = useFormatter()
    const isTrial = sub.status === "trialing"
    const isGift = sub.provider === "gift"
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
    // Poslední kreditové okno daru končí s darem — „kredity se obnoví" by slibovalo
    // něco, co nepřijde.
    const giftLastWindow = isGift && !!periodEnd && !!creditResetAt
        && new Date(periodEnd).toDateString() === new Date(creditResetAt).toDateString()

    return (
        <div className={`rounded-sm p-5 border ${isLow ? 'bg-aisummit-cinnabar/5 border-aisummit-cinnabar/20' : 'bg-[#080808] border-white/5'}`}>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-white">{String(sub.planName ?? "")}</span>
                    {isTrial && (
                        <span className="text-[9px] bg-amber-500/20 text-amber-400 px-3 py-1 rounded-full font-bold uppercase">
                            {trialDays !== null ? t("current.trialDays", { days: trialDays }) : t("current.trialPosts")}
                        </span>
                    )}
                    {sub.status === "active" && (
                        <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full font-bold uppercase">
                            {isGift ? t("current.gift") : t("current.active")}
                        </span>
                    )}
                    {sub.status === "expired" && (
                        <span className="text-[9px] bg-red-500/20 text-red-400 px-3 py-1 rounded-full font-bold uppercase">
                            {t("current.expired")}
                        </span>
                    )}
                    {sub.cancelAtPeriodEnd && sub.status !== "expired" && (
                        <span className="text-[9px] bg-white/10 text-white/60 px-3 py-1 rounded-full font-bold uppercase">
                            {t("current.ends", { until: periodEnd ? dateOnly(format, periodEnd) : "none" })}
                        </span>
                    )}
                </div>
                <button
                    onClick={onRefresh}
                    className="text-[9px] text-white/30 hover:text-white/60 font-bold uppercase tracking-widest transition-colors"
                >
                    ↻ {t("current.refresh")}
                </button>
            </div>

            {/* Credit bar */}
            <div className="mb-2">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-white/40 font-bold">
                        {usePostQuota ? t("current.freePosts") : t("current.usedCredits")}
                    </span>
                    <span className="text-[10px] text-white/60 font-bold">
                        {usedUnits} / {totalUnits}
                        {!usePostQuota && (sub.creditsPurchased ?? 0) > 0 && (
                            <span className="text-emerald-400/70 ml-1">{t("current.purchased", { count: sub.creditsPurchased ?? 0 })}</span>
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
                        {/* „Zbývá: N" místo „N zbývá" — sloveso by se muselo shodovat
                            s počtem („1 příspěvek zbývá" / „3 příspěvky zbývají"), takhle
                            se skloňuje jen podstatné jméno. */}
                        {usePostQuota
                            ? t("current.remainingPosts", { count: remainingUnits })
                            : t("current.remainingCredits", { count: remainingUnits })}
                    </span>
                    {!usePostQuota && creditResetAt && !giftLastWindow ? (
                        <span className="text-[9px] text-white/20 font-bold">
                            {t("current.creditsRenew", { date: dateOnly(format, creditResetAt) })}
                        </span>
                    ) : periodEnd && !isGift ? (
                        <span className="text-[9px] text-white/20 font-bold">
                            {t("current.renews", { date: dateOnly(format, periodEnd) })}
                        </span>
                    ) : null}
                </div>
                {/* Only a multi-month plan has two different dates — say which is which,
                    otherwise "obnoví se" would look like the credits arrive in a year. */}
                {periodEnd && creditResetAt && new Date(periodEnd).toDateString() !== new Date(creditResetAt).toDateString() && (
                    <p className="text-[9px] text-white/20 font-bold mt-1">
                        {isGift
                            ? t("current.giftUntil", { date: dateOnly(format, periodEnd) })
                            : t("current.termRenews", { term: t(`term.${(sub.termMonths ?? 1) as TermMonths}.short`), date: dateOnly(format, periodEnd) })}
                    </p>
                )}
            </div>

            {/* Dobití hned pod ukazatelem kreditů — tam se člověk dívá ve chvíli,
                kdy si říká „potřebuju víc". Ne o dvě obrazovky níž. */}
            {!isTrial && sub.status === "active" && (
                <div className="mt-5 pt-4 border-t border-white/5">
                    <p className="text-[9px] text-white/40 font-bold uppercase tracking-widest mb-2">{t("current.topUp")}</p>
                    <CreditPacks />
                </div>
            )}

            {!isTrial && sub.status === "active" && (isGift ? (
                <p className="mt-5 pt-4 border-t border-white/5 text-[10px] text-white/40 font-bold leading-relaxed">
                    {t("current.giftNote", { until: periodEnd ? dateOnly(format, periodEnd) : "none" })}
                </p>
            ) : (
                <CancelControl sub={sub} projectId={projectId} onRefresh={onRefresh} />
            ))}
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
    const t = useTranslations("billing.subscription")
    const format = useFormatter()
    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const until = sub.currentPeriodEnd ? dateOnly(format, String(sub.currentPeriodEnd)) : null

    async function run(action: "cancel" | "resume") {
        setBusy(true)
        setError(null)
        try {
            const res = action === "cancel"
                ? await cancelSubscription(projectId)
                : await resumeSubscription(projectId)
            if (!res.success) setError(res.error || t("cancel.failed"))
            else { setConfirming(false); onRefresh() }
        } catch {
            setError(t("cancel.failedRetry"))
        } finally {
            setBusy(false)
        }
    }

    if (sub.cancelAtPeriodEnd) {
        return (
            <div className="mt-5 pt-4 border-t border-white/5 flex flex-wrap items-center gap-3">
                <p className="text-[10px] text-white/40 font-bold">
                    {t("cancel.ending", { until: until ?? "none" })}
                </p>
                <button
                    onClick={() => run("resume")}
                    disabled={busy}
                    className="ml-auto text-[9px] font-bold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors"
                >
                    {busy ? t("cancel.resuming") : t("cancel.resume")}
                </button>
                {error && <p className="w-full text-[10px] text-red-400">{error}</p>}
            </div>
        )
    }

    return (
        <div className="mt-5 pt-4 border-t border-white/5">
            {!confirming ? (
                <div className="flex flex-wrap items-center gap-4">
                    <button
                        onClick={() => setConfirming(true)}
                        className="text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors"
                    >
                        {t("cancel.cancel")}
                    </button>
                    <ManageBillingLink projectId={projectId} />
                </div>
            ) : (
                <div className="flex flex-wrap items-center gap-3">
                    <p className="text-[10px] text-white/50 font-bold">
                        {t("cancel.confirm", { until: until ?? "none" })}
                    </p>
                    <div className="ml-auto flex items-center gap-3">
                        <button
                            onClick={() => setConfirming(false)}
                            disabled={busy}
                            className="text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 disabled:opacity-40 transition-colors"
                        >
                            {t("cancel.keep")}
                        </button>
                        <button
                            onClick={() => run("cancel")}
                            disabled={busy}
                            className="text-[9px] font-bold uppercase tracking-widest text-aisummit-cinnabar hover:opacity-80 disabled:opacity-40 transition-colors"
                        >
                            {busy ? t("cancel.cancelling") : t("cancel.yes")}
                        </button>
                    </div>
                </div>
            )}
            {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
        </div>
    )
}
