"use client"

import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
    getIGPostTypes,
    getIGPostFormats,
    getIGCategories,
    getIGIdeasList,
    getIGReviewsList,
} from "@/app/actions/admin-actions"
import { generateContentPlan, regeneratePlanItem, getPlanCadence, savePlanCadence, getPlanProgress, getPlanDraft, savePlanDraft, discardPlanDraft, type ContentPlanItem, type CampaignGoal, type CarouselShare } from "@/app/actions/content-plan-actions"
import { startCampaign, getCampaignStatus } from "@/app/actions/campaign-actions"
import { schedulePostAction } from "@/app/actions/calendar-actions"
import { distributeSchedule } from "@/lib/schedule-planner"
import { MEDIA_CREDITS, type MediumType } from "@/lib/credits"
import { computeSlotIntents, VISUAL_MODE_LABELS, type FeedPatternId } from "@/lib/feed-pattern"
import { getProducts } from "@/app/actions/product-actions"
import { uploadCustomImage, type GenerateResult } from "@/app/actions/ig-generate-action"
import { canGenerate } from "@/app/actions/credit-guard"
import { useStudio } from "@/app/(dashboard)/StudioContext"
import { usePaywall } from "@/app/(dashboard)/PaywallProvider"
import { useCopyToClipboard } from "./hooks"
import type { IGPostType, IGCategory, IGPostFormat } from "./types"
import { creditsForMedia } from "@/lib/credits"
import { trackEvent } from "@/lib/analytics"
import { Award, Bot, CalendarDays, ChartColumn, Check, ClipboardList, Compass, Film, Lightbulb, MessageCircle, Package, PenLine, Pencil, Pin, RefreshCw, Rocket, Ruler, Search, Sparkles, Star, Trash2, TriangleAlert, X } from "lucide-react"

/**
 * What a batch actually costs in credits. The first `freeRemaining` posts fall
 * within the monthly plan allotment (plan posts → 0 credits, exactly like the
 * worker's gate); only the overflow is charged, weighted by medium. Used for BOTH
 * the pre-generation estimate and the final plan total so the two never disagree
 * — and so a trial's "3 free posts" reads as free, not as a phantom credit charge.
 */
function batchCreditCost(mediums: (string | null | undefined)[], freeRemaining: number): number {
    return mediums.reduce((sum, m, i) => sum + (i < freeRemaining ? 0 : creditsForMedia(m)), 0)
}

// Weekly cadence chips — the ONE frequency that drives post count, credit estimate
// AND the calendar spread. (config.postsPerWeek is clamped 1-14; 10/14 = multiple
// posts/day. Odd values snap to the nearest chip for the default only.)
const CADENCE_OPTIONS = [2, 3, 4, 5, 7, 10, 14] as const

function snapToChip(n: number): number {
    return CADENCE_OPTIONS.reduce((best, c) =>
        Math.abs(c - n) < Math.abs(best - n) ? c : best, CADENCE_OPTIONS[0] as number)
}

function pluralPosts(n: number): string {
    if (n === 1) return "příspěvek"
    if (n >= 2 && n <= 4) return "příspěvky"
    return "příspěvků"
}

/** "2026-07-18" → "18. 7." for the plan summary strip. */
function shortCzDate(dateStr: string): string {
    const [, m, d] = dateStr.split("-")
    return `${Number(d)}. ${Number(m)}.`
}

export function GenerateTab({ projectId }: { projectId: string }) {
    const { refreshSubscription, setActiveSection, subscription, generateIntent, setGenerateIntent } = useStudio()
    // A medium must pass BOTH gates: the plan allows it AND the engine can actually make
    // it. Offering one the engine will clamp away is a broken promise — a "reel" that
    // ships as a carousel. `?? false` on the flags: an older API response without them
    // means we can't prove the engine will honour it.
    const reelAllowed = (subscription?.allowedMedia?.includes("reel") ?? true) && (subscription?.reelsEnabled ?? false)
    const storyAllowed = (subscription?.allowedMedia?.includes("story") ?? true) && (subscription?.storiesEnabled ?? false)
    // Posts still free within this month's plan allotment (plan posts cost 0 credits).
    const freeRemaining = subscription
        ? Math.max(0, (subscription.planPostsLimit ?? 0) - (subscription.planPostsUnlocked ?? 0))
        : 0
    const { showPlanUnlockModal } = usePaywall()
    const [postTypes, setPostTypes] = useState<IGPostType[]>([])
    const [postFormats, setPostFormats] = useState<Record<string, IGPostFormat>>({})
    const [categories, setCategories] = useState<IGCategory[]>([])
    const [selectedType, setSelectedType] = useState("")
    const [topic, setTopic] = useState("")
    const [aspectRatio, setAspectRatio] = useState("")
    const [medium, setMedium] = useState("")
    const [category, setCategory] = useState("")
    const [selectedProductId, setSelectedProductId] = useState<string>("")
    const [creditError, setCreditError] = useState<string | null>(null)
    const [customImageFile, setCustomImageFile] = useState<File | null>(null)
    const [generating, setGenerating] = useState(false)
    const [agentStatus, setAgentStatus] = useState<{ stage: string; progress: number; message: string } | null>(null)
    const [editorialLog, setEditorialLog] = useState<{ role: string; action: string; summary: string }[]>([])
    const [result, setResult] = useState<GenerateResult | null>(null)
    const [batchCount, setBatchCount] = useState(3)
    // Plan length is chosen as a DURATION; the real post count derives from the brand's actual
    // posting cadence (postsPerWeek, seeded at onboarding). A "week" is postsPerWeek posts, not 7.
    const [postsPerWeek, setPostsPerWeek] = useState(4)
    const [planDuration, setPlanDuration] = useState<"trial" | "1w" | "2w" | "month">("trial")
    const [batchMode, setBatchMode] = useState(false)
    const [batchResult, setBatchResult] = useState<{ generated: number; errors: number; message: string } | null>(null)
    const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; successes: number; failures: number } | null>(null)
    // False while status polls are failing (e.g. transient 503s under load) — drives a
    // "reconnecting" hint so the UI never looks frozen while the server keeps working.
    const [pollHealthy, setPollHealthy] = useState(true)
    const [generationHistory, setGenerationHistory] = useState<GenerateResult[]>([])
    const [step, setStep] = useState(1)

    // Content Plan Preview (batch mode intermediate step)
    const [contentPlan, setContentPlan] = useState<ContentPlanItem[]>([])
    const [planGenerating, setPlanGenerating] = useState(false)
    // Live stage message from the deep plan pipeline (strategist → concepts → judge → revision).
    const [planProgress, setPlanProgress] = useState<{ progress: number; message: string } | null>(null)
    // Campaign arc from the strategist — shown above the plan preview in step 2, and carried
    // into the campaign so the worker can hand it to every post.
    const [planStrategy, setPlanStrategy] = useState<string | null>(null)
    // Server-side draft of the plan preview: a refresh used to throw away a 1-2 min Pro run.
    // Holding the id also makes approval a single-use claim (see startCampaign).
    const [draftId, setDraftId] = useState<string | null>(null)
    // Grid rhythm this plan was laid out against + where in the feed it starts, so slots can be
    // re-derived locally when the user adds/removes posts. seqBase is the live feed's post count
    // at plan time — it does NOT shift when plan items come and go.
    const [planPattern, setPlanPattern] = useState<{ id: FeedPatternId; seqBase: number } | null>(null)
    // Campaign brief knobs ("" = let the planner decide).
    const [goal, setGoal] = useState<CampaignGoal | "">("")
    const [carouselShare, setCarouselShare] = useState<CarouselShare>("auto")
    const [focusProductIds, setFocusProductIds] = useState<string[]>([])
    const [editingPlanItem, setEditingPlanItem] = useState<string | null>(null)
    const [regeneratingItem, setRegeneratingItem] = useState<string | null>(null)
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [pendingGenerate, setPendingGenerate] = useState(false)
    const [campaignId, setCampaignId] = useState<string | null>(null)

    // Planner: when the content-plan batch should publish. Defaults to spreading
    // from tomorrow at the weekly cadence; auto-distributed but every post is editable below.
    const [scheduleStart, setScheduleStart] = useState<string>(() => {
        const d = new Date(); d.setDate(d.getDate() + 1)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    })
    // Who last decided the cadence — async writers (config load, subscription-based
    // recommendation) only apply while the user hasn't clicked a chip themselves.
    const cadenceSourceRef = useRef<"default" | "config" | "user">("default")
    // The persisted config cadence, so we only save the user's choice when it differs.
    const configCadenceRef = useRef(4)

    // Single-post scheduling (on the generation result card)
    const [singleSchedDate, setSingleSchedDate] = useState("")
    const [singleSchedTime, setSingleSchedTime] = useState("09:00")
    const [singleScheduled, setSingleScheduled] = useState<string | null>(null)
    const [singleScheduling, setSingleScheduling] = useState(false)

    // Ideas & Reviews for topic pre-fill
    const [savedIdeas, setSavedIdeas] = useState<any[]>([])
    const [approvedReviews, setApprovedReviews] = useState<any[]>([])
    const [showIdeaPicker, setShowIdeaPicker] = useState(false)
    // Picked idea id — travels with the job so the idea gets marked used + metric feedback.
    // Cleared when the user edits the topic by hand (edited topic ≠ the idea).
    const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null)

    // Product catalog for @ mention picker
    const [catalogProducts, setCatalogProducts] = useState<any[]>([])
    const [productPickerItem, setProductPickerItem] = useState<string | null>(null)
    const [productSearch, setProductSearch] = useState("")
    const productPickerRef = useRef<HTMLDivElement>(null)
    // Set by whichever mount restore seeded a plan first, so the async server-draft restore
    // can't overwrite a plan the onboarding handoff already planted.
    const planSeededRef = useRef(false)

    // Reload post types + formats + categories when project changes
    useEffect(() => {
        if (!projectId) return
        getIGPostTypes(projectId).then(setPostTypes)
        getIGPostFormats(projectId).then(setPostFormats)
        cadenceSourceRef.current = "default"
        configCadenceRef.current = 4
        getPlanCadence(projectId).then(cadence => {
            configCadenceRef.current = cadence
            // Don't stomp a cadence the user already picked by hand.
            if (cadenceSourceRef.current === "default") {
                setPostsPerWeek(snapToChip(cadence))
                cadenceSourceRef.current = "config"
            }
        })
        getIGCategories(projectId).then(setCategories)
        getIGIdeasList(projectId).then(data => setSavedIdeas(data.filter((i: any) => i.is_active !== false)))
        getIGReviewsList(projectId).then(reviews => setApprovedReviews(reviews.filter((r: any) => r.is_approved)))
        getProducts(projectId).then(setCatalogProducts)
        setSelectedType("") // reset selection on project change
        setCategory("") // reset category on project change
        setSelectedIdeaId(null)
        setStep(1)
    }, [projectId])

    // Close product picker on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (productPickerRef.current && !productPickerRef.current.contains(e.target as Node)) {
                setProductPickerItem(null)
                setProductSearch("")
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    // Set product on content plan item
    const handleSetProduct = (itemId: string, product: any | null) => {
        setContentPlan(prev => prev.map(p =>
            p.id === itemId
                ? { ...p, productId: product?.id || undefined, productName: product?.name || undefined, productImage: product?.image_urls?.[0] || undefined }
                : p
        ))
        setProductPickerItem(null)
        setProductSearch("")
    }

    // Generation: POST blocks synchronously, but we extract jobId via a pre-flight call
    const triggerPostGeneration = async (options: any): Promise<any> => {
        let pollingActive = true
        const jobIdRef = { current: null as string | null }

        // Step 1: Create job only (fast, returns jobId immediately)
        const createRes = await fetch("/api/ig-create-job", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options)
        })
        if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({}))
            return { success: false, error: err.error || "Nepodařilo se vytvořit úlohu" }
        }
        const { jobId } = await createRes.json()
        jobIdRef.current = jobId

        // Step 2: Kick off actual generation (fire — we'll poll for result)
        const fetchPromise = fetch("/api/ig-run-job", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId })
        })

        // Step 3: Poll job status in parallel — we have jobId from step 1
        const pollLoop = async () => {
            await new Promise(r => setTimeout(r, 2000))

            while (pollingActive && jobIdRef.current) {
                try {
                    const statusRes = await fetch(`/api/ig-job-status?id=${jobIdRef.current}`)
                    const status = await statusRes.json()

                    if (status.agentMessage && status.status !== "done" && status.status !== "failed") {
                        setAgentStatus({
                            stage: status.status,
                            progress: status.progress || 0,
                            message: status.agentMessage,
                        })
                    }
                    // Capture editorial conversation log
                    if (status.editorialLog?.length > 0) {
                        setEditorialLog(status.editorialLog)
                    }
                } catch { /* ignore polling errors */ }

                await new Promise(r => setTimeout(r, 2000))
            }
        }
        pollLoop() // fire-and-forget

        try {
            const result = await fetchPromise
            pollingActive = false
            setAgentStatus(null)

            const data = await result.json()
            if (!result.ok || !data.success) {
                return { success: false, error: data.error || "Generování selhalo" }
            }

            // Final fetch of editorial log — ensures we always have it
            // (polling might miss it if editorial review was fast)
            if (jobIdRef.current) {
                try {
                    const finalStatus = await fetch(`/api/ig-job-status?id=${jobIdRef.current}`)
                    const finalData = await finalStatus.json()
                    if (finalData.editorialLog?.length > 0) {
                        setEditorialLog(finalData.editorialLog)
                    }
                } catch { /* non-fatal */ }
            }

            return data

        } catch (err: any) {
            pollingActive = false
            setAgentStatus(null)
            return { success: false, error: err.message || "Chyba sítě" }
        }
    }

    // Poll a server-side campaign until it reaches a terminal state. The campaign
    // runs server-side, so closing the tab mid-poll does NOT stop generation — the
    // mount effect below reconnects the UI on return.
    const pollCampaign = async (cid: string) => {
        let misses = 0
        // eslint-disable-next-line no-constant-condition
        while (true) {
            // A 503/network hiccup makes the server action THROW (not return {success:false}).
            // Catch it so a transient failure under load can't kill the poll loop and freeze
            // the UI — treat it exactly like a graceful miss: back off and retry.
            let res: Awaited<ReturnType<typeof getCampaignStatus>>
            try {
                res = await getCampaignStatus(projectId, cid)
            } catch {
                res = { success: false } as Awaited<ReturnType<typeof getCampaignStatus>>
            }
            if (!res.success || !res.campaign) {
                misses++
                setPollHealthy(false)
                if (misses > 15) { // ~1 min of failed polls — give up the UI poll; the worker keeps going regardless
                    setBatchResult({ generated: 0, errors: 0, message: res.error || "Ztracen kontakt s kampaní (běží dál na pozadí)", success: false } as any)
                    setCampaignId(null)
                    setPollHealthy(true)
                    return
                }
                await new Promise(r => setTimeout(r, Math.min(8000, 3000 + misses * 600)))
                continue
            }
            misses = 0
            setPollHealthy(true)
            const c = res.campaign
            setBatchProgress({ current: c.cursor, total: c.total, successes: c.successes, failures: c.failures })

            if (c.status === "done" || c.status === "partial" || c.status === "failed") {
                setBatchResult({
                    generated: c.successes,
                    errors: c.failures,
                    message: c.status === "done"
                        ? `Úspěšně vygenerováno ${c.successes} z ${c.total} postů`
                        : c.status === "failed"
                            ? (c.error || `Všech ${c.total} postů selhalo`)
                            : `Vygenerováno ${c.successes} z ${c.total}${c.error ? ` — ${c.error}` : ""}`,
                    success: c.successes > 0,
                } as any)
                setCampaignId(null)
                try { localStorage.removeItem(`ig_campaign_${projectId}`) } catch { /* ignore */ }
                refreshSubscription()
                return
            }
            await new Promise(r => setTimeout(r, 3000))
        }
    }

    // Reconnect to an in-flight campaign on mount (e.g. user closed the tab during
    // a long batch and came back) — durability's payoff.
    useEffect(() => {
        let cid: string | null = null
        try { cid = localStorage.getItem(`ig_campaign_${projectId}`) } catch { /* ignore */ }
        if (!cid) return
        let cancelled = false
        getCampaignStatus(projectId, cid).then(res => {
            if (cancelled || !res.success || !res.campaign) {
                if (!res?.success) { try { localStorage.removeItem(`ig_campaign_${projectId}`) } catch { /* ignore */ } }
                return
            }
            const c = res.campaign
            if (c.status === "pending" || c.status === "running") {
                setBatchMode(true)
                setCampaignId(cid)
                setGenerating(true)
                setStep(3)
                setBatchProgress({ current: c.cursor, total: c.total, successes: c.successes, failures: c.failures })
                pollCampaign(cid!).finally(() => { setBatchProgress(null); setGenerating(false) })
            } else {
                try { localStorage.removeItem(`ig_campaign_${projectId}`) } catch { /* ignore */ }
            }
        })
        return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId])

    // First-visit handoff: onboarding stashed a ready content plan in localStorage so the
    // user lands on an editable week instead of a blank tab. Consume it once. Declared after
    // the reset/reconnect effects so its setStep(2) wins on mount; skipped when a campaign is
    // already in flight (that reconnect takes precedence).
    useEffect(() => {
        let inFlight: string | null = null
        let raw: string | null = null
        try {
            inFlight = localStorage.getItem(`ig_campaign_${projectId}`)
            raw = localStorage.getItem(`ig_draft_plan_${projectId}`)
        } catch { /* ignore */ }
        if (!raw || inFlight) return
        try {
            const draft = JSON.parse(raw) as ContentPlanItem[]
            if (Array.isArray(draft) && draft.length > 0) {
                // Distribute posting slots like the normal plan path — without this the
                // onboarding plan had no dates and approval produced unscheduled drafts.
                setContentPlan(autoDistribute(draft, scheduleStart, postsPerWeek))
                setBatchMode(true)
                setStep(2)
                planSeededRef.current = true
            }
        } catch { /* malformed — ignore */ }
        try { localStorage.removeItem(`ig_draft_plan_${projectId}`) } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId])

    // Restore the server-side plan draft — the preview survives a refresh or a closed tab
    // instead of throwing away a 1-2 min Pro-ladder run. Lowest priority of the three mount
    // restores: an in-flight campaign and the onboarding handoff both outrank it.
    useEffect(() => {
        let inFlight: string | null = null
        try { inFlight = localStorage.getItem(`ig_campaign_${projectId}`) } catch { /* ignore */ }
        if (inFlight || planSeededRef.current) return
        let cancelled = false
        getPlanDraft(projectId).then(draft => {
            // Re-check the seed flag after the await: the synchronous onboarding handoff can
            // have planted a fresher plan while this request was in flight.
            if (cancelled || !draft || planSeededRef.current) return
            // No autoDistribute here — the draft already carries the schedule the user set.
            setContentPlan(draft.plan)
            setPlanStrategy(draft.strategySummary || null)
            setDraftId(draft.draftId)
            // The plan is self-describing: item 0's intent records both the pattern and the
            // feed anchor it was laid out from (restamping preserves that invariant), so the
            // rhythm survives a refresh without being persisted separately.
            const anchor = draft.plan[0]?.slotIntent
            setPlanPattern(anchor ? { id: anchor.patternId, seqBase: anchor.seqIndex } : null)
            setBatchMode(true)
            setStep(2)
            planSeededRef.current = true
        }).catch(() => { /* no draft is a normal state, not an error */ })
        return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId])

    // Autosave plan edits into the draft, debounced. Guarded on draftId, which is cleared the
    // moment the plan becomes a campaign — so a late save can never rewrite a plan the worker
    // is already draining (savePlanDraft is status-scoped server-side for the same reason).
    useEffect(() => {
        if (!draftId || contentPlan.length === 0 || generating) return
        const t = setTimeout(() => {
            savePlanDraft(projectId, draftId, contentPlan).catch(() => { /* autosave is best-effort */ })
        }, 2000)
        return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contentPlan, draftId, projectId, generating])

    const handleGenerate = async () => {
        setGenerating(true)
        setResult(null)
        setBatchResult(null)
        setBatchProgress(null)
        setCreditError(null)
        setEditorialLog([])

        const maxClientRetries = 1

        try {
            // Credit check before generation — media-weighted: pass each post's medium so
            // the pre-flight matches the server-side charge (a flat check let a carousel/
            // reel batch start and die on credits mid-campaign).
            const creditCheck = await canGenerate(
                projectId,
                batchMode ? (contentPlan.length || batchCount) : 1,
                batchMode
                    ? (contentPlan.length ? contentPlan.map(p => p.medium) : (medium ? [medium] : undefined))
                    : (medium ? [medium] : undefined),
            )
            if (!creditCheck.ok) {
                setCreditError(creditCheck.error || "Nedostatek kreditů")
                setGenerating(false)
                showPlanUnlockModal()
                return
            }

            if (batchMode) {
                // === DURABLE SERVER-SIDE CAMPAIGN ===
                // Persist the approved plan as an ig_campaigns row; a server worker
                // generates every post independent of this browser tab. The old
                // in-browser loop truncated when the tab closed ("asked for 7, got 4").
                const planToExecute = contentPlan.length > 0 ? contentPlan : []
                const totalPosts = planToExecute.length || batchCount
                setBatchProgress({ current: 0, total: totalPosts, successes: 0, failures: 0 })

                const startRes = await startCampaign(projectId, planToExecute, {
                    aspectRatio: aspectRatio || undefined,
                    medium: medium || undefined,
                    topic: topic || undefined,
                    // Approving the draft in place makes it a single-use claim: a second click
                    // finds it already 'pending' and is refused, instead of billing twice.
                    draftId: draftId || undefined,
                    strategySummary: planStrategy || undefined,
                    goal: goal || undefined,
                })

                if (!startRes.success || !startRes.campaignId) {
                    setBatchResult({
                        generated: 0,
                        errors: totalPosts,
                        message: startRes.error || "Nepodařilo se spustit kampaň",
                        success: false,
                    } as any)
                } else {
                    // The draft is now a live campaign — drop the id so the autosave effect
                    // can't write over a plan the worker is already draining.
                    setDraftId(null)
                    setCampaignId(startRes.campaignId)
                    try { localStorage.setItem(`ig_campaign_${projectId}`, startRes.campaignId) } catch { /* ignore */ }
                    await pollCampaign(startRes.campaignId)
                }
            } else {
                let finalImageUrl = undefined;
                if (customImageFile) {
                    const formData = new FormData()
                    formData.append("file", customImageFile)
                    const uploadRes = await uploadCustomImage(projectId, formData)
                    if (!uploadRes.success || !uploadRes.publicUrl) {
                        setResult({ success: false, error: uploadRes.error || "Při nahrávání obrázku došlo k chybě." })
                        setGenerating(false)
                        setStep(2)
                        return
                    }
                    finalImageUrl = uploadRes.publicUrl
                }

                let res = await triggerPostGeneration({
                    configName: projectId,
                    type: selectedType || undefined,
                    topic: topic || undefined,
                    ideaId: selectedIdeaId || undefined,
                    category: category !== "auto" ? category : undefined,
                    aspectRatio: aspectRatio || undefined,
                    medium: medium || undefined,
                    customImageUrl: finalImageUrl,
                    productId: selectedProductId || undefined,
                })
                // Auto-retry once on failure
                if (!res.success && maxClientRetries > 0) {
                    await new Promise(r => setTimeout(r, 3000))
                    res = await triggerPostGeneration({
                        configName: projectId,
                        type: selectedType || undefined,
                        topic: topic || undefined,
                        ideaId: selectedIdeaId || undefined,
                        category: category !== "auto" ? category : undefined,
                        aspectRatio: aspectRatio || undefined,
                        medium: medium || undefined,
                        customImageUrl: finalImageUrl,
                        productId: selectedProductId || undefined,
                    })
                }
                setResult(res)
                if (res.success) {
                    setGenerationHistory(prev => [res, ...prev].slice(0, 10))
                    trackEvent('post_generated', { mode: 'single', category: category || 'auto' })
                }
            }
        } catch (err: any) {
            const errorMsg = err?.message || "Neznámá chyba při generování"
            if (batchMode) {
                setBatchResult({
                    generated: 0,
                    errors: batchCount,
                    message: errorMsg,
                })
            } else {
                setResult({
                    success: false,
                    error: errorMsg,
                })
            }
        }

        setBatchProgress(null)
        setStep(batchMode ? 4 : 3)
        setGenerating(false)
        // Refresh credit display in sidebar/dashboard
        refreshSubscription()
    }

    // Content Plan: changing the post count invalidates any existing plan, so the
    // generated/approved plan can never desync from the selected count (the batch loop
    // runs contentPlan.length, not batchCount — a stale 3-item plan would ignore a new 7).
    const handleCountChange = (newCount: number) => {
        if (newCount !== batchCount && contentPlan.length > 0) {
            setContentPlan([])
        }
        setBatchCount(newCount)
    }

    // Duration-based plan length. A "week" is the brand's real cadence (postsPerWeek), not 7 days —
    // so the post count (and credit cost, and carousel cap denominator) all track reality. Trial is
    // a fixed small taste regardless of cadence.
    const PLAN_DURATIONS = [
        { key: "trial", label: "Zkouška", weeks: 0 },
        { key: "1w", label: "Týden", weeks: 1 },
        { key: "2w", label: "Dva týdny", weeks: 2 },
        { key: "month", label: "Měsíc", weeks: 4 },
    ] as const

    const CAMPAIGN_GOALS: { key: CampaignGoal; label: string; emoji: string; hint: string }[] = [
        { key: "reach", label: "Dosah", emoji: "📣", hint: "Zasáhnout nové lidi — sdílitelné, srozumitelné i bez znalosti značky" },
        { key: "engagement", label: "Komunita", emoji: "💬", hint: "Vyvolat reakce — otázky, názory, uložení" },
        { key: "sales", label: "Prodej", emoji: "🛒", hint: "Vést k nákupu — konkrétní produkt, konkrétní důvod jednat" },
        { key: "launch", label: "Novinka", emoji: "🚀", hint: "Uvést novinku — série se stoupajícím obloukem" },
    ]

    const CAROUSEL_SHARES: { key: CarouselShare; label: string; emoji: string; hint: string }[] = [
        { key: "low", label: "Víc fotek", emoji: "📷", hint: "levnější" },
        { key: "auto", label: "Vyvážené", emoji: "⚖️", hint: "doporučeno" },
        { key: "high", label: "Víc karuselů", emoji: "🎠", hint: "dražší" },
    ]

    const toggleFocusProduct = (id: string) => {
        setFocusProductIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
    }
    const durationToCount = (key: typeof planDuration, perWeek: number = postsPerWeek): number => {
        if (key === "trial") return 3
        const weeks = PLAN_DURATIONS.find(d => d.key === key)?.weeks ?? 1
        return Math.max(1, Math.round(weeks * perWeek))
    }
    const handleDurationChange = (key: typeof planDuration) => {
        setPlanDuration(key)
        handleCountChange(durationToCount(key))
    }
    // Cadence loads async after mount — re-derive the count for the active duration once it
    // arrives. Deliberately setBatchCount, NOT handleCountChange: a cadence tweak on the step-2
    // schedule bar must re-spread dates without wiping the generated plan.
    useEffect(() => {
        setBatchCount(durationToCount(planDuration))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [postsPerWeek])

    // What the currently selected duration would cost at a given cadence. Plan mode's format
    // mix is governed by carouselShare, so mirror the server's carousel cap (CAROUSEL_DIVISOR
    // in content-plan-actions.ts — keep in sync). Images listed first so the free plan-post
    // allotment eats the cheap posts: a conservative estimate that only undershoots in the
    // user's favor.
    const planMediums = (count: number): string[] => {
        const divisor = { low: 6, auto: 4, high: 2 }[carouselShare]
        const carousels = Math.floor(count / divisor)
        return [...Array<string>(count - carousels).fill("image"), ...Array<string>(carousels).fill("carousel")]
    }
    const planCost = (count: number) => batchCreditCost(planMediums(count), freeRemaining)

    // The cadence the subscription can actually afford for the selected duration: prefer the
    // largest chip fully covered by the plan allotment (cost 0), else the largest that fits the
    // remaining credits, else the smallest chip. Null = nothing to recommend (loading/trial).
    const durationWeeks = PLAN_DURATIONS.find(d => d.key === planDuration)?.weeks ?? 0
    const recommendedCadence: number | null = (() => {
        if (!subscription || planDuration === "trial") return null
        const fullyCovered = [...CADENCE_OPTIONS].reverse().find(c => planCost(durationWeeks * c) === 0)
        if (fullyCovered) return fullyCovered
        const affordable = [...CADENCE_OPTIONS].reverse().find(c => planCost(durationWeeks * c) <= (subscription.creditsRemaining ?? 0))
        return affordable ?? CADENCE_OPTIONS[0]
    })()

    // Apply the recommendation as a DEFAULT only: it may clamp the config cadence down to what
    // the tier affords, never push a deliberately slow brand up — and never override the user.
    // postsPerWeek is a dependency so a config cadence arriving AFTER the subscription still
    // gets clamped (min is idempotent, so this converges instead of looping).
    useEffect(() => {
        if (recommendedCadence == null || cadenceSourceRef.current === "user") return
        setPostsPerWeek(prev => Math.min(prev, recommendedCadence))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recommendedCadence, postsPerWeek])

    const handleCadenceChange = (c: number) => {
        cadenceSourceRef.current = "user"
        setPostsPerWeek(c)
        handleCountChange(durationToCount(planDuration, c))
    }

    // Deep-link intent from a dashboard/sidebar CTA (e.g. "Obsah na měsíc" → plan mode, Měsíc
    // preset). Applied once on arrival, then cleared so it doesn't re-fire on re-render.
    useEffect(() => {
        if (!generateIntent) return
        if (generateIntent.mode === "plan") {
            setBatchMode(true)
            handleDurationChange(generateIntent.duration ?? "month")
        } else {
            setBatchMode(false)
        }
        setStep(1)
        setGenerateIntent(null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generateIntent])

    // Planner: assign posting slots to every plan item from the schedule bar.
    // Overwrites all items (predictable re-distribution); per-item edits below
    // override a single slot afterward.
    const autoDistribute = (plan: ContentPlanItem[], start: string, perWeek: number): ContentPlanItem[] => {
        const slots = distributeSchedule(plan.length, { startDate: new Date(start), postsPerWeek: perWeek })
        return plan.map((p, i) => ({ ...p, scheduledDate: slots[i]?.date, scheduledTime: slots[i]?.time }))
    }

    // Re-distribute when the schedule bar changes.
    const handleScheduleChange = (start: string, perWeek: number) => {
        setScheduleStart(start)
        if (perWeek !== postsPerWeek) cadenceSourceRef.current = "user"
        setPostsPerWeek(perWeek)
        setContentPlan(prev => autoDistribute(prev, start, perWeek))
    }

    // Per-item manual override of a single post's date/time.
    const handleUpdatePlanSchedule = (itemId: string, date: string, time: string) => {
        setContentPlan(prev => prev.map(p => p.id === itemId ? { ...p, scheduledDate: date, scheduledTime: time } : p))
    }

    // Single post: schedule the just-generated post onto the calendar.
    const handleScheduleSingle = async () => {
        if (!result?.postId) return
        const date = singleSchedDate || scheduleStart
        setSingleScheduling(true)
        const r = await schedulePostAction(projectId, result.postId, date, singleSchedTime)
        setSingleScheduling(false)
        if (r.success) setSingleScheduled(`${date} ${singleSchedTime}`)
        else alert(r.error || "Plánování selhalo")
    }

    // Content Plan: generate plan preview. The deep pipeline runs ~1-2 min server-side, so we
    // poll its ig_jobs breadcrumb (via planRunId) and show live stage messages on the button.
    const handleGeneratePlan = async () => {
        setPlanGenerating(true)
        setPlanProgress({ progress: 5, message: "Připravuji kontext značky…" })
        const runId = crypto.randomUUID()
        const poll = setInterval(async () => {
            try {
                const p = await getPlanProgress(projectId, runId)
                if (p && p.status !== "done" && p.status !== "failed") setPlanProgress({ progress: p.progress, message: p.message })
            } catch { /* progress polling must never break the flow */ }
        }, 2500)
        try {
            const result = await generateContentPlan(projectId, {
                count: batchCount,
                topic: topic || undefined,
                goal: goal || undefined,
                carouselShare,
                productIds: focusProductIds.length > 0 ? focusProductIds : undefined,
                planRunId: runId,
            })
            if (result.success && result.plan) {
                // Persist commitment, not exploration: remember a hand-picked cadence only
                // once it produced a real plan, so next visit starts where the user left off.
                if (cadenceSourceRef.current === "user" && postsPerWeek !== configCadenceRef.current) {
                    configCadenceRef.current = postsPerWeek
                    savePlanCadence(projectId, postsPerWeek).catch(() => { /* best-effort */ })
                }
                setContentPlan(autoDistribute(result.plan, scheduleStart, postsPerWeek))
                setPlanStrategy(result.strategySummary || null)
                setDraftId(result.draftId || null)
                setPlanPattern(result.feedPattern || null)
                setStep(2)
            } else {
                alert(result.error || "Generování plánu selhalo")
            }
        } finally {
            clearInterval(poll)
            setPlanProgress(null)
            setPlanGenerating(false)
        }
    }

    // Content Plan: regenerate single item
    const handleRegenerateItem = async (itemId: string) => {
        setRegeneratingItem(itemId)
        const item = contentPlan.find(p => p.id === itemId)
        if (!item) return

        const existingHooks = contentPlan.map(p => p.hookPreview)
        const result = await regeneratePlanItem(projectId, item.postType, existingHooks, topic || undefined, item.medium)

        if (result.success && result.item) {
            setContentPlan(prev => prev.map(p =>
                p.id === itemId
                    // Regenerated concept no longer represents the bank idea — drop the link
                    ? { ...p, hookPreview: result.item!.hookPreview, angle: result.item!.angle, topic: result.item!.topic, ideaId: undefined, ideaTitle: undefined }
                    : p
            ))
        }
        setRegeneratingItem(null)
    }

    // Re-derive feed-pattern slots after the plan's length changed. Removing the 3rd post
    // shifts every later post one cell up the grid, so their visual modes must shift with it —
    // otherwise the approved plan no longer matches the rhythm the preview is showing.
    const restampSlots = (items: ContentPlanItem[]): ContentPlanItem[] => {
        if (!planPattern || planPattern.id === "none") return items
        const intents = computeSlotIntents(planPattern.id, planPattern.seqBase, items.length)
        return items.map((p, i) => ({ ...p, slotIntent: intents[i] ?? undefined }))
    }

    // Content Plan: remove item (re-distribute remaining slots)
    const handleRemovePlanItem = (itemId: string) => {
        setContentPlan(prev => restampSlots(autoDistribute(
            prev.filter(p => p.id !== itemId).map((p, i) => ({ ...p, day: i + 1 })),
            scheduleStart, postsPerWeek,
        )))
    }

    // Content Plan: update item topic inline. An edited topic no longer represents
    // the bank idea it came from — clear the link (mirrors single-post selectedIdeaId).
    const handleUpdatePlanTopic = (itemId: string, newTopic: string) => {
        setContentPlan(prev => prev.map(p => p.id === itemId ? { ...p, topic: newTopic, ideaId: undefined, ideaTitle: undefined } : p))
    }

    // Toggle a plan item's format: single image ⇄ carousel. Reel is excluded from the manual
    // toggle while reels are globally clamped to carousel — flipping to "reel" would just be
    // re-clamped at generation, so we don't offer a misleading option.
    const handleTogglePlanMedium = (itemId: string) => {
        setContentPlan(prev => prev.map(p => {
            if (p.id !== itemId || p.medium === "reel") return p
            return { ...p, medium: p.medium === "carousel" ? "image" : "carousel" }
        }))
    }

    // Content Plan: add a blank post slot
    const handleAddPlanItem = () => {
        const lastItem = contentPlan[contentPlan.length - 1]
        const newItem: ContentPlanItem = {
            id: `plan_${Date.now()}_add`,
            postType: lastItem?.postType || "auto",
            postTypeEmoji: lastItem?.postTypeEmoji || "📝",
            postTypeLabel: lastItem?.postTypeLabel || "Auto",
            medium: lastItem?.medium || "image",
            pillar: lastItem?.pillar || "content",
            pillarEmoji: lastItem?.pillarEmoji || "📋",
            hookPreview: "Nový post — klikni 🔄 pro vygenerování konceptu",
            angle: "",
            topic: topic || "volné téma",
            day: contentPlan.length + 1,
            week: contentPlan.length >= 14 ? Math.floor(contentPlan.length / 7) + 1 : undefined,
        }
        setContentPlan(prev => restampSlots(autoDistribute([...prev, newItem], scheduleStart, postsPerWeek)))
    }

    // Content Plan: start generation from approved plan
    const handleApproveAndGenerate = () => {
        setBatchCount(contentPlan.length)
        setStep(3)
        setPendingGenerate(true)
    }

    // Throw the saved preview away and start over from the brief.
    const handleDiscardPlan = async () => {
        if (!draftId) return
        if (!confirm("Zahodit vygenerovaný plán? Tuhle akci nelze vrátit.")) return
        const id = draftId
        // Clear locally first so the autosave effect can't immediately re-save the plan
        // we're deleting.
        setDraftId(null)
        setContentPlan([])
        setPlanStrategy(null)
        setStep(1)
        await discardPlanDraft(projectId, id).catch(() => { /* row already gone — fine */ })
    }

    // Trigger generation when pendingGenerate flag is set (after step render)
    useEffect(() => {
        if (pendingGenerate && step === 3 && !generating) {
            setPendingGenerate(false)
            handleGenerate()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingGenerate, step])

    const { copiedField, copyToClipboard } = useCopyToClipboard()

    // Simplified steps: Single = 2 steps, Plan = 3 steps
    const steps = batchMode
        ? [
            { id: 1, label: "Zadání" },
            { id: 2, label: "Plán" },
            { id: 3, label: "Výsledek" },
        ]
        : [
            { id: 1, label: "Zadání" },
            { id: 2, label: "Výsledek" },
        ]

    const resultStep = batchMode ? 3 : 2
    const hasResult = result || batchResult

    return (
        <div className="max-w-4xl mx-auto space-y-8 mt-2 pb-24">
            {/* Mode toggle + Step dots */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex bg-[#0a0a0a] p-1 rounded-sm border border-white/10">
                    <button
                        onClick={() => { setBatchMode(false); setStep(1) }}
                        className={`px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all ${!batchMode
                            ? "bg-white/10 text-white border border-white/20"
                            : "text-white/40 hover:text-white"
                        }`}
                    >
                        <span className="inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 shrink-0" />Jeden příspěvek</span>
                    </button>
                    <button
                        onClick={() => { setBatchMode(true); setStep(1) }}
                        className={`px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all ${batchMode
                            ? "bg-aisummit-cinnabar/20 text-aisummit-cinnabar border border-aisummit-cinnabar/30"
                            : "text-white/40 hover:text-white"
                        }`}
                    >
                        <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 shrink-0" />Obsahový plán</span>
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {steps.map((s, i) => (
                        <button
                            key={s.id}
                            onClick={() => {
                                if (generating) return
                                if (s.id === 2 && batchMode && contentPlan.length === 0) return
                                if (s.id === resultStep && !hasResult && !generating) return
                                setStep(s.id)
                            }}
                            disabled={generating && s.id !== step}
                            className="flex items-center gap-2"
                        >
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black transition-all ${
                                step === s.id ? "bg-white text-black"
                                : step > s.id ? "bg-white/20 text-white/60"
                                : "bg-white/5 text-white/20"
                            }`}>{s.id}</span>
                            <span className={`text-[10px] font-bold uppercase tracking-widest hidden sm:inline ${
                                step === s.id ? "text-white" : "text-white/30"
                            }`}>{s.label}</span>
                            {i < steps.length - 1 && <span className="w-6 h-px bg-white/10 mx-1" />}
                        </button>
                    ))}
                </div>
            </div>

            {/* Credit error */}
            {creditError && (
                <div className="bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm p-4 flex items-center gap-3">
                    <TriangleAlert className="w-5 h-5" />
                    <p className="text-sm text-aisummit-cinnabar font-bold">{creditError}</p>
                </div>
            )}

            <AnimatePresence mode="wait">
                {/* ═══ STEP 1: Unified Brief ═══ */}
                {step === 1 && (
                    <motion.div
                        key="brief"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-10 border border-white/10"
                    >
                        {!batchMode ? (
                            /* ── SINGLE POST ── */
                            <div className="max-w-2xl mx-auto space-y-8">
                                <div className="text-center">
                                    <h2 className="text-3xl font-black tracking-tighter uppercase text-white/90 mb-2">Nový příspěvek</h2>
                                    <p className="text-white/40 text-sm">Řekněte AI o čem má psát, nebo nechte vše na automatice.</p>
                                </div>

                                {/* Topic */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-[10px] text-white/50 uppercase tracking-widest font-bold">O čem?</label>
                                        {(savedIdeas.length > 0 || approvedReviews.length > 0) && (
                                            <button type="button" onClick={() => setShowIdeaPicker(!showIdeaPicker)}
                                                className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 transition-colors">
                                                {showIdeaPicker ? "Skrýt" : "Vybrat z nápadů"}
                                            </button>
                                        )}
                                    </div>
                                    {showIdeaPicker && (
                                        <div className="mb-3 bg-[#050505] border border-white/10 rounded-sm p-3 max-h-52 overflow-y-auto space-y-1">
                                            {savedIdeas.length > 0 && (
                                                <>
                                                    <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-white/30 block mb-1"><Lightbulb className="w-3 h-3 shrink-0" />Nápady</span>
                                                    {savedIdeas.slice(0, 10).map((idea: any) => (
                                                        <button key={idea.id} type="button"
                                                            onClick={() => { setTopic(`${idea.title}: ${idea.content}`); setSelectedIdeaId(idea.id); setShowIdeaPicker(false) }}
                                                            className="w-full text-left px-3 py-2 rounded-sm text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors truncate">
                                                            <span className="text-[9px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded-sm text-white/40 mr-2">{idea.category}</span>
                                                            {idea.title}
                                                        </button>
                                                    ))}
                                                </>
                                            )}
                                            {approvedReviews.length > 0 && (
                                                <>
                                                    <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-white/30 block mb-1 mt-2"><Star className="w-3 h-3 shrink-0" />Recenze</span>
                                                    {approvedReviews.slice(0, 5).map((review: any) => (
                                                        <button key={review.id} type="button"
                                                            onClick={() => {
                                                                setTopic(`Recenze zákazníka: "${review.quote}" — ${review.customer_initials || "Anonym"}`)
                                                                setSelectedIdeaId(null)
                                                                const reviewType = postTypes.find(pt => pt.name === "recenze" || pt.name === "review" || pt.name === "testimonial")
                                                                if (reviewType) setSelectedType(reviewType.name)
                                                                setShowIdeaPicker(false)
                                                            }}
                                                            className="w-full text-left px-3 py-2 rounded-sm text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors">
                                                            <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-sm text-amber-400 mr-2">{"⭐".repeat(review.rating || 5)}</span>
                                                            &ldquo;{review.quote?.substring(0, 80)}{review.quote?.length > 80 ? "..." : ""}&rdquo;
                                                        </button>
                                                    ))}
                                                </>
                                            )}
                                        </div>
                                    )}
                                    <textarea
                                        placeholder="Např. Jarní slevy, Nová kolekce, Péče o pleť... nebo nechte prázdné a AI vybere samo."
                                        value={topic} onChange={(e) => { setTopic(e.target.value); setSelectedIdeaId(null) }} rows={2}
                                        className="w-full px-5 py-4 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all shadow-sm resize-none"
                                    />
                                    {selectedIdeaId && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className="inline-flex items-center gap-1.5 text-[9px] px-2 py-1 rounded-sm bg-emerald-500/10 text-emerald-400/80 uppercase tracking-widest font-bold border border-emerald-500/20"><Lightbulb className="w-3 h-3 shrink-0" />Napojeno na nápad — příspěvek se započítá do jeho výkonu</span>
                                            <button type="button" onClick={() => setSelectedIdeaId(null)}
                                                className="text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors">
                                                ✕
                                            </button>
                                        </div>
                                    )}
                                </div>


                                {/* Advanced */}
                                <div>
                                    <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
                                        className="text-[10px] text-white/20 hover:text-white/40 font-bold uppercase tracking-widest transition-colors flex items-center gap-2 mb-3">
                                        <span>{showAdvanced ? "▼" : "▶"}</span> Pokročilé
                                    </button>
                                    {showAdvanced && (
                                        <div className="space-y-5 pl-4 border-l border-white/10">
                                            {/* Category pills */}
                                            <div>
                                                <label className="text-[10px] text-white/40 mb-3 block uppercase tracking-widest font-bold">Zaměření</label>
                                                <div className="flex flex-wrap gap-2">
                                                    <button onClick={() => setCategory("auto")}
                                                        className={`px-4 py-2.5 rounded-sm border text-xs font-bold transition-all flex items-center gap-2 ${category === "auto" || category === ""
                                                            ? "border-white/30 bg-white/10 text-white" : "border-white/5 bg-[#0a0a0a] text-white/40 hover:border-white/20 hover:text-white/70"}`}>
                                                        <Bot className="w-4 h-4 grayscale opacity-80" /> Automaticky
                                                    </button>
                                                    {categories.map(cat => (
                                                        <button key={cat.id} onClick={() => setCategory(cat.id)}
                                                            className={`px-4 py-2.5 rounded-sm border text-xs font-bold transition-all flex items-center gap-2 ${category === cat.id
                                                                ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10 text-aisummit-cinnabar" : "border-white/5 bg-[#0a0a0a] text-white/40 hover:border-white/20 hover:text-white/70"}`}>
                                                            {cat.emoji} {cat.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Product selector */}
                                            {catalogProducts.length > 0 && (
                                                <div>
                                                    <label className="inline-flex items-center gap-1.5 text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold"><Package className="w-3 h-3 shrink-0" />Produkt</label>
                                                    <select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}
                                                        className="w-full px-5 py-3.5 bg-[#050505] border border-white/10 rounded-sm text-white text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all">
                                                        <option value="">AI vybere automaticky</option>
                                                        {catalogProducts.map((p: any) => (
                                                            <option key={p.id} value={p.id}>{p.name}{p.price ? ` — ${p.price}` : ''}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}

                                            {/* Format selector */}
                                            <div>
                                                <label className="text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold">Formát</label>
                                                <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}
                                                    className="w-full px-5 py-3.5 bg-[#050505] border border-white/10 rounded-sm text-white text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all">
                                                    <option value="">AI vybere nejlepší formát</option>
                                                    {postTypes.filter(pt => pt.is_active).filter(pt => category === "auto" || category === "" || pt.pillarId === category)
                                                        .map(pt => (<option key={pt.id} value={pt.name}>{pt.display_name}</option>))}
                                                </select>
                                                {(() => {
                                                    const sel = postTypes.find(pt => pt.name === selectedType)
                                                    return sel?.description ? (
                                                        <p className="mt-2 text-[11px] text-white/40 leading-relaxed">{sel.description}</p>
                                                    ) : null
                                                })()}
                                            </div>
                                            <div>
                                                <label className="inline-flex items-center gap-1.5 text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold"><Ruler className="w-3 h-3 shrink-0" />Poměr stran</label>
                                                <div className="grid grid-cols-4 gap-2">
                                                    {[{ value: "", label: "Auto" }, { value: "1:1", label: "1:1" }, { value: "4:5", label: "4:5" }, { value: "3:4", label: "3:4" }].map(opt => (
                                                        <button key={opt.value} onClick={() => setAspectRatio(opt.value)}
                                                            className={`py-2.5 rounded-sm text-center transition-all border text-xs font-bold ${aspectRatio === opt.value
                                                                ? "bg-white/10 border-white/30 text-white" : "bg-[#050505] border-white/10 text-white/40 hover:text-white"}`}>
                                                            {opt.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="inline-flex items-center gap-1.5 text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold"><Film className="w-3 h-3 shrink-0" />Typ</label>
                                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                                    {[{ value: "", label: "Auto", emoji: "🎲" }, { value: "image", label: "Obrázek", emoji: "🖼️" }, { value: "story", label: "Story", emoji: "📱" }, { value: "carousel", label: "Carousel", emoji: "📸" }, { value: "reel", label: "Reel", emoji: "🎬" }].map(opt => {
                                                        const locked = (opt.value === "reel" && !reelAllowed) || (opt.value === "story" && !storyAllowed)
                                                        const lockNote = opt.value === "reel"
                                                            ? (subscription?.reelsEnabled === false ? "Reels připravujeme" : "Reels jsou dostupné od balíčku Růst")
                                                            : (subscription?.storiesEnabled === false ? "Stories připravujeme" : "Stories nejsou v tomto balíčku")
                                                        return (
                                                            <button key={opt.value} onClick={() => !locked && setMedium(opt.value)}
                                                                disabled={locked}
                                                                title={locked ? lockNote : undefined}
                                                                className={`py-2.5 rounded-sm text-center transition-all border text-xs font-bold ${locked
                                                                    ? "bg-[#050505] border-white/5 text-white/20 cursor-not-allowed"
                                                                    : medium === opt.value
                                                                        ? "bg-white/10 border-white/30 text-white" : "bg-[#050505] border-white/10 text-white/40 hover:text-white"}`}>
                                                                {locked ? "🔒" : opt.emoji} {opt.label}
                                                                {locked ? <span className="block text-[8px] text-white/25 font-bold uppercase tracking-widest mt-0.5">
                                                                    {lockNote.includes("připravujeme") ? "Brzy" : "Od Růst"}
                                                                </span> : (
                                                                    /* Cena formátu patří k VOLBĚ formátu. V Nastavení je pozdě —
                                                                       rozhodnutí „udělám reel za 5 kreditů" padá tady. */
                                                                    <span className="block text-[8px] font-bold uppercase tracking-widest mt-0.5 text-white/30">
                                                                        {opt.value === "" ? "dle typu" : `${MEDIA_CREDITS[opt.value as MediumType]} kr.`}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">Vlastní fotka</label>
                                                <input type="file" accept="image/png, image/jpeg, image/webp"
                                                    onChange={(e) => { const file = e.target.files?.[0]; if (file) setCustomImageFile(file); else setCustomImageFile(null) }}
                                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white/70 text-xs focus:outline-none file:mr-3 file:py-1.5 file:px-3 file:rounded-sm file:border-0 file:text-xs file:font-semibold file:bg-white/10 file:text-white cursor-pointer"
                                                />
                                                <p className="mt-2 text-[10px] text-white/30 leading-relaxed">
                                                    AI vaši fotku zakomponuje do designu příspěvku — použije ji celou nebo její část jako vizuální základ a doplní typografii, branding a logo. Text příspěvku se řídí zadaným tématem, ne fotkou.
                                                    {medium === "reel" && <span className="text-amber-400/60"> U reels se fotka nepoužije.</span>}
                                                    {medium === "story" && <span className="text-white/40"> U storky se fotka použije na prvním snímku.</span>}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Generate CTA */}
                                <button onClick={handleGenerate} disabled={generating}
                                    className={`w-full py-5 rounded-sm transition-all flex items-center justify-center gap-3 text-sm font-black tracking-wider uppercase ${generating
                                        ? "bg-white/5 text-white/30 cursor-wait border border-white/10"
                                        : "bg-aisummit-cinnabar text-white shadow-[0_0_20px_rgba(229,83,63,0.3)] hover:shadow-[0_0_30px_rgba(229,83,63,0.5)] hover:scale-[1.01] active:scale-[0.99]"}`}>
                                    {generating ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-transparent rounded-full animate-spin" /> Pracuji na tom...</>)
                                        : (<><Sparkles className="w-3.5 h-3.5 shrink-0" />Vytvořit příspěvek</>)}
                                </button>
                            </div>
                        ) : (
                            /* ── CONTENT PLAN ── */
                            <div className="max-w-2xl mx-auto space-y-8">
                                <div className="text-center">
                                    <h2 className="text-3xl font-black tracking-tighter uppercase text-white/90 mb-2">Obsahový plán</h2>
                                    <p className="text-white/40 text-sm">AI navrhne sérii příspěvků. Vy schválíte a spustíte.</p>
                                </div>

                                {/* Duration → derives post count from the brand's real cadence */}
                                <div>
                                    <label className="text-[10px] text-white/40 mb-3 block uppercase tracking-widest font-bold">Jak dlouhý plán?</label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                        {PLAN_DURATIONS.map(opt => {
                                            const c = durationToCount(opt.key)
                                            return (
                                                <button key={opt.key} onClick={() => handleDurationChange(opt.key)}
                                                    className={`py-4 rounded-sm transition-all border text-center ${planDuration === opt.key
                                                        ? "bg-aisummit-cinnabar/20 border-aisummit-cinnabar/30 text-aisummit-cinnabar" : "bg-[#050505] border-white/10 text-white/40 hover:text-white hover:border-white/30"}`}>
                                                    <span className="text-2xl font-black block">{c}</span>
                                                    <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">{opt.label}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* Weekly cadence — the single frequency behind post count, credit
                                    estimate AND calendar spread. Recommendation = what the
                                    subscription affords for the selected duration. */}
                                <div>
                                    <label className="text-[10px] text-white/40 mb-3 block uppercase tracking-widest font-bold">Příspěvků týdně</label>
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                        {CADENCE_OPTIONS.map(c => {
                                            const overBudget = planDuration !== "trial" && subscription != null
                                                && planCost(durationWeeks * c) > (subscription.creditsRemaining ?? 0)
                                            return (
                                                <button key={c} onClick={() => handleCadenceChange(c)}
                                                    className={`px-3 py-2.5 rounded-sm border text-[11px] font-bold transition-all ${postsPerWeek === c
                                                        ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10 text-aisummit-cinnabar" : "border-white/5 bg-[#0a0a0a] text-white/40 hover:border-white/20 hover:text-white/70"}`}>
                                                    {c}×
                                                    {recommendedCadence === c && (
                                                        <span className="block text-[8px] font-bold uppercase tracking-widest opacity-50 mt-0.5">Doporučeno</span>
                                                    )}
                                                    {overBudget && (
                                                        <span className="block text-[8px] font-bold uppercase tracking-widest text-amber-500/70 mt-0.5">Nad rámec kreditů</span>
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* Campaign goal — steers the planner prompt, and (once there's
                                    engagement data) tilts the pillar mix toward it. */}
                                <div>
                                    <label className="text-[10px] text-white/40 mb-3 block uppercase tracking-widest font-bold">Cíl kampaně</label>
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                        <button onClick={() => setGoal("")}
                                            className={`px-3 py-2.5 rounded-sm border text-[11px] font-bold transition-all ${goal === ""
                                                ? "border-white/30 bg-white/10 text-white" : "border-white/5 bg-[#0a0a0a] text-white/40 hover:border-white/20 hover:text-white/70"}`}>
                                            <span className="inline-flex items-center gap-1.5"><Bot className="w-3.5 h-3.5 shrink-0" />Auto</span>
                                        </button>
                                        {CAMPAIGN_GOALS.map(g => (
                                            <button key={g.key} onClick={() => setGoal(g.key)} title={g.hint}
                                                className={`px-3 py-2.5 rounded-sm border text-[11px] font-bold transition-all ${goal === g.key
                                                    ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10 text-aisummit-cinnabar" : "border-white/5 bg-[#0a0a0a] text-white/40 hover:border-white/20 hover:text-white/70"}`}>
                                                {g.emoji} {g.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Format mix — carousels cost more credits, so the share is the user's call */}
                                <div>
                                    <label className="text-[10px] text-white/40 mb-3 block uppercase tracking-widest font-bold">Mix formátů</label>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {CAROUSEL_SHARES.map(s => (
                                            <button key={s.key} onClick={() => setCarouselShare(s.key)}
                                                className={`px-3 py-2.5 rounded-sm border text-[11px] font-bold transition-all ${carouselShare === s.key
                                                    ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10 text-aisummit-cinnabar" : "border-white/5 bg-[#0a0a0a] text-white/40 hover:border-white/20 hover:text-white/70"}`}>
                                                {s.emoji} {s.label}
                                                <span className="block text-[8px] font-bold uppercase tracking-widest opacity-50 mt-0.5">{s.hint}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Product focus — the campaign revolves around these */}
                                {catalogProducts.length > 0 && (
                                    <div>
                                        <label className="inline-flex items-center gap-1.5 text-[10px] text-white/40 mb-3 block uppercase tracking-widest font-bold"><Package className="w-3 h-3 shrink-0" />Zaměřit na produkty (volitelné)</label>
                                        <div className="flex flex-wrap gap-2">
                                            {catalogProducts.map(p => {
                                                const on = focusProductIds.includes(p.id)
                                                return (
                                                    <button key={p.id} onClick={() => toggleFocusProduct(p.id)}
                                                        className={`px-3 py-2 rounded-sm border text-[11px] font-bold transition-all ${on
                                                            ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10 text-aisummit-cinnabar" : "border-white/5 bg-[#0a0a0a] text-white/40 hover:border-white/20 hover:text-white/70"}`}>
                                                        {on && <Check className="w-3 h-3 inline-block align-[-1px] mr-1" />}{p.name}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                        {focusProductIds.length > 0 && (
                                            <p className="text-[9px] text-white/25 mt-2 font-bold uppercase tracking-widest">
                                                Produkty se rozdělí mezi produktové posty v plánu
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Topic */}
                                <div>
                                    <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">Téma kampaně (volitelné)</label>
                                    <textarea placeholder="Např. Letní kolekce, Vánoční kampaň... nebo nechte prázdné."
                                        value={topic} onChange={(e) => setTopic(e.target.value)} rows={2}
                                        className="w-full px-5 py-4 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all shadow-sm resize-none"
                                    />
                                </div>

                                {/* Schedule — set up-front so the generated plan lands on real dates
                                    immediately (still editable per post in the preview). */}
                                <div>
                                    <label className="inline-flex items-center gap-1.5 text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold"><CalendarDays className="w-3 h-3 shrink-0" />Začít od</label>
                                    <input type="date" value={scheduleStart}
                                        onChange={(e) => handleScheduleChange(e.target.value, postsPerWeek)}
                                        className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30" />
                                </div>

                                {/* Live summary — one sentence that keeps count, cadence, real date
                                    range and cost visibly coherent before the user commits. */}
                                {(() => {
                                    const slots = distributeSchedule(batchCount, { startDate: new Date(scheduleStart), postsPerWeek })
                                    const range = slots.length > 0
                                        ? `${shortCzDate(slots[0].date)} – ${shortCzDate(slots[slots.length - 1].date)}`
                                        : null
                                    const est = planCost(batchCount)
                                    return (
                                        <div className="bg-[#050505] border border-white/10 rounded-sm px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-white/50 text-center">
                                            {batchCount} {pluralPosts(batchCount)} · {postsPerWeek}× týdně{range ? ` · ${range}` : ""} · {planDuration === "trial"
                                                ? "ochutnávka"
                                                : est === 0 ? "Zdarma — v rámci předplatného" : `Odhad: ~${est} kreditů`}
                                        </div>
                                    )
                                })()}

                                {/* Generate Plan CTA — during the deep pipeline run it streams stage messages */}
                                <button onClick={handleGeneratePlan} disabled={planGenerating}
                                    className={`w-full py-5 rounded-sm transition-all flex items-center justify-center gap-3 text-sm font-black tracking-wider uppercase ${planGenerating
                                        ? "bg-white/5 text-white/30 cursor-wait border border-white/10"
                                        : "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] hover:scale-[1.01] active:scale-[0.99]"}`}>
                                    {planGenerating ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-transparent rounded-full animate-spin" /> {planProgress?.message || "AI plánuje…"}</>)
                                        : (<><ClipboardList className="w-3.5 h-3.5 shrink-0" />Vytvořit plán</>)}
                                </button>
                                {planGenerating && (
                                    <div className="space-y-1.5">
                                        <div className="h-1 bg-white/5 rounded-sm overflow-hidden">
                                            <div className="h-full bg-emerald-500/60 transition-all duration-700"
                                                style={{ width: `${planProgress?.progress ?? 5}%` }} />
                                        </div>
                                        <p className="text-[9px] text-white/25 font-bold uppercase tracking-widest text-center">
                                            Hloubkové plánování: stratég → koncepty → nezávislá oponentura → revize (~1–2 min)
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </motion.div>
                )}



                {/* ═══ STEP 2: Content Plan Preview (batch mode only) ═══ */}
                {step === 2 && batchMode && (
                    <motion.div
                        key="step3-plan"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-12 border border-white/10"
                    >
                        <div className="text-center mb-8">
                            <h2 className="text-4xl font-black uppercase tracking-tighter text-white/90 mb-3">Plán obsahu</h2>
                            <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">
                                AI navrhuje strategický mix {contentPlan.length} postů. Upravte a schvalte.
                            </p>
                        </div>

                        {/* Campaign arc from the strategist stage */}
                        {planStrategy && (
                            <div className="mb-6 bg-[#050505] border border-emerald-500/15 rounded-sm p-5">
                                <p className="inline-flex items-center gap-1.5 text-[9px] text-emerald-400/60 font-bold uppercase tracking-widest mb-2"><Compass className="w-3 h-3 shrink-0" />Kampaňová linka</p>
                                <p className="text-sm text-white/70 leading-relaxed">{planStrategy}</p>
                            </div>
                        )}

                        {/* Pillar ratio bar */}
                        {contentPlan.length > 0 && (() => {
                            const pillarCounts: Record<string, { count: number; emoji: string }> = {}
                            contentPlan.forEach(p => {
                                if (!pillarCounts[p.pillar]) pillarCounts[p.pillar] = { count: 0, emoji: p.pillarEmoji }
                                pillarCounts[p.pillar].count++
                            })
                            return (
                                <div className="mb-8 space-y-2">
                                    <div className="flex h-2.5 rounded-sm overflow-hidden border border-white/10">
                                        {Object.entries(pillarCounts).map(([key, { count }], idx) => (
                                            <div key={key} className="h-full transition-all duration-500"
                                                style={{
                                                    width: `${(count / contentPlan.length) * 100}%`,
                                                    backgroundColor: `hsl(${idx * 70}, 50%, 45%)`
                                                }}
                                                title={`${key}: ${count} postů`}
                                            />
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap gap-3 text-[8px] text-white/30 font-bold uppercase tracking-widest">
                                        {Object.entries(pillarCounts).map(([key, { count, emoji }], idx) => (
                                            <span key={key} className="flex items-center gap-1">
                                                <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: `hsl(${idx * 70}, 50%, 45%)` }} />
                                                {emoji} {key}: {count} ({Math.round(count / contentPlan.length * 100)}%)
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )
                        })()}

                        {/* Schedule bar — auto-distributes posting times; editable per post below */}
                        <div className="max-w-2xl mx-auto mb-6 bg-[#0a0a0a] border border-white/10 rounded-sm p-4 flex flex-wrap items-end gap-4">
                            <div>
                                <label className="inline-flex items-center gap-1.5 block text-[8px] text-white/40 font-bold uppercase tracking-widest mb-1.5"><CalendarDays className="w-3 h-3 shrink-0" />Začít od</label>
                                <input
                                    type="date"
                                    value={scheduleStart}
                                    onChange={(e) => handleScheduleChange(e.target.value, postsPerWeek)}
                                    className="px-3 py-1.5 bg-[#050505] border border-white/20 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                />
                            </div>
                            <div>
                                <label className="block text-[8px] text-white/40 font-bold uppercase tracking-widest mb-1.5">Příspěvků týdně</label>
                                <select
                                    value={postsPerWeek}
                                    onChange={(e) => handleScheduleChange(scheduleStart, Number(e.target.value))}
                                    className="px-3 py-1.5 bg-[#050505] border border-white/20 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                >
                                    {[1, 2, 3, 4, 5, 6, 7, 10, 14].map(n => (
                                        <option key={n} value={n}>{n === 14 ? "14 (2×/den)" : n === 10 ? "10" : n}</option>
                                    ))}
                                </select>
                            </div>
                            <p className="text-[9px] text-white/30 flex-1 min-w-[140px] leading-relaxed">
                                Časy se rozloží automaticky. Každý post lze upravit níže.
                            </p>
                        </div>

                        {/* Plan items */}
                        <div className="space-y-3 max-w-2xl mx-auto">
                            {(() => {
                                let currentWeek = 0
                                return contentPlan.map((item, idx) => {
                                    const showWeekHeader = item.week && item.week !== currentWeek
                                    if (item.week) currentWeek = item.week

                                    return (
                                        <div key={item.id}>
                                            {showWeekHeader && (
                                                <div className="flex items-center gap-3 pt-6 pb-2">
                                                    <div className="h-px flex-1 bg-white/10" />
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Týden {item.week}</span>
                                                    <div className="h-px flex-1 bg-white/10" />
                                                </div>
                                            )}
                                            <div className={`bg-[#0a0a0a] border rounded-sm p-4 transition-all hover:border-white/20 ${
                                                regeneratingItem === item.id ? "border-amber-500/30 animate-pulse" : "border-white/10"
                                            }`}>
                                                <div className="flex items-start gap-3">
                                                    {/* Number + Type */}
                                                    <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-white/5 border border-white/10 rounded-sm">
                                                        <span className="text-lg">{item.postTypeEmoji}</span>
                                                    </div>

                                                    {/* Content */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-[8px] text-white/30 font-bold uppercase tracking-widest">#{idx + 1}</span>
                                                            <span className="text-[8px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded-sm text-white/40 font-bold uppercase tracking-wider">{item.postTypeLabel}</span>
                                                            {(() => {
                                                                const m = item.medium === "carousel"
                                                                    ? { emoji: "📸", label: "Carousel", cls: "text-sky-300/70 border-sky-400/20 bg-sky-400/5" }
                                                                    : item.medium === "reel"
                                                                    ? { emoji: "🎬", label: "Reel", cls: "text-fuchsia-300/70 border-fuchsia-400/20 bg-fuchsia-400/5" }
                                                                    : { emoji: "🖼️", label: "1 obrázek", cls: "text-emerald-300/70 border-emerald-400/20 bg-emerald-400/5" }
                                                                const editable = item.medium !== "reel"
                                                                return (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => editable && handleTogglePlanMedium(item.id)}
                                                                        disabled={!editable}
                                                                        title={editable ? "Přepnout formát: 1 obrázek ⇄ carousel" : "Reel"}
                                                                        className={`text-[10px] sm:text-[8px] min-h-[32px] sm:min-h-0 px-2 sm:px-1.5 py-1 sm:py-0.5 border rounded-sm font-bold uppercase tracking-wider transition-all ${m.cls} ${editable ? "cursor-pointer hover:brightness-150" : "cursor-default"}`}
                                                                    >{m.emoji} {m.label}{editable ? " ⇄" : ""}</button>
                                                                )
                                                            })()}
                                                            {/* Feed-pattern slot: which cell of the grid rhythm this post fills */}
                                                            {item.slotIntent && (() => {
                                                                const vm = VISUAL_MODE_LABELS[item.slotIntent.visualMode]
                                                                return (
                                                                    <span
                                                                        title={`Vzor feedu: ${vm.label} — pozice v mřížce profilu`}
                                                                        className="text-[8px] px-1.5 py-0.5 border border-white/10 bg-white/[0.03] text-white/40 rounded-sm font-bold uppercase tracking-wider"
                                                                    >
                                                                        {vm.icon} {vm.label}
                                                                    </span>
                                                                )
                                                            })()}
                                                            <span className="text-[8px] text-white/20">{item.pillarEmoji} {item.pillar}</span>
                                                            {item.ideaTitle && (
                                                                <span
                                                                    title="Ze zásobníku témat"
                                                                    className="text-[8px] px-1.5 py-0.5 border border-violet-400/20 bg-violet-400/5 text-violet-300/70 rounded-sm font-bold uppercase tracking-wider"
                                                                >
                                                                    💡 {item.ideaTitle}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Hook preview */}
                                                        <p className="text-white/80 text-sm font-bold leading-snug mb-1">
                                                            &ldquo;{item.hookPreview}&rdquo;
                                                        </p>

                                                        {/* Angle */}
                                                        <p className="text-[10px] text-white/40 leading-relaxed">{item.angle}</p>

                                                        {/* Editable topic */}
                                                        {editingPlanItem === item.id ? (
                                                            <div className="mt-2 flex gap-2">
                                                                <input
                                                                    autoFocus
                                                                    defaultValue={item.topic}
                                                                    onBlur={(e) => {
                                                                        handleUpdatePlanTopic(item.id, e.target.value)
                                                                        setEditingPlanItem(null)
                                                                    }}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === "Enter") {
                                                                            handleUpdatePlanTopic(item.id, e.currentTarget.value)
                                                                            setEditingPlanItem(null)
                                                                        }
                                                                    }}
                                                                    className="flex-1 px-3 py-1.5 bg-[#050505] border border-white/20 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                                                />
                                                            </div>
                                                        ) : (
                                                            <div className="mt-1 flex items-center gap-1.5">
                                                                <span className="text-[9px] text-emerald-400/60 font-mono"><Pin className="w-3.5 h-3.5 shrink-0 inline-block align-[-2px] mr-1" />{item.topic}</span>
                                                            </div>
                                                        )}

                                                        {/* Per-post schedule (overrides auto-distribute) */}
                                                        <div className="mt-2 flex items-center gap-2">
                                                            <CalendarDays className="w-3 h-3 text-[9px] text-white/30" />
                                                            <input
                                                                type="date"
                                                                value={item.scheduledDate || ""}
                                                                onChange={(e) => handleUpdatePlanSchedule(item.id, e.target.value, item.scheduledTime || "09:00")}
                                                                className="px-2 py-1.5 sm:py-1 min-h-[36px] sm:min-h-0 bg-[#050505] border border-white/10 rounded-sm text-white/70 text-[10px] focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                                                            />
                                                            <input
                                                                type="time"
                                                                value={item.scheduledTime || ""}
                                                                onChange={(e) => handleUpdatePlanSchedule(item.id, item.scheduledDate || scheduleStart, e.target.value)}
                                                                className="px-2 py-1.5 sm:py-1 min-h-[36px] sm:min-h-0 bg-[#050505] border border-white/10 rounded-sm text-white/70 text-[10px] focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                                                            />
                                                        </div>

                                                        {/* Product @ mention */}
                                                        <div className="mt-2 relative">
                                                            {item.productId ? (
                                                                <div className="inline-flex items-center gap-2 px-2.5 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-sm group">
                                                                    {item.productImage && (
                                                                        <img src={item.productImage} alt="" className="w-5 h-5 rounded-sm object-cover" />
                                                                    )}
                                                                    <span className="text-[9px] text-blue-400 font-bold">@{item.productName}</span>
                                                                    <button
                                                                        onClick={() => handleSetProduct(item.id, null)}
                                                                        aria-label="Odebrat produkt"
                                                                        // Na dotyku vidět vždy — jinak produkt z položky nešel odebrat.
                                                                        className="min-w-[28px] min-h-[28px] flex items-center justify-center text-xs sm:text-[8px] text-blue-400/70 sm:text-blue-400/40 hover:text-red-400 transition-colors sm:opacity-0 sm:group-hover:opacity-100 cursor-pointer"
                                                                    >
                                                                        ✕
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={() => {
                                                                        setProductPickerItem(productPickerItem === item.id ? null : item.id)
                                                                        setProductSearch("")
                                                                    }}
                                                                    className="inline-flex items-center gap-1 px-2 py-1 text-[9px] text-white/25 hover:text-white/50 font-bold uppercase tracking-widest transition-colors"
                                                                    title="Přiřadit produkt"
                                                                >
                                                                    <span>@</span> Produkt
                                                                </button>
                                                            )}

                                                            {/* Product picker dropdown */}
                                                            {productPickerItem === item.id && catalogProducts.length > 0 && (
                                                                <div ref={productPickerRef} className="absolute left-0 top-full mt-1 z-50 w-72 bg-[#0a0a0a] border border-white/15 rounded-sm shadow-2xl overflow-hidden">
                                                                    <div className="p-2 border-b border-white/10">
                                                                        <input
                                                                            autoFocus
                                                                            value={productSearch}
                                                                            onChange={(e) => setProductSearch(e.target.value)}
                                                                            placeholder="Hledat produkt..."
                                                                            className="w-full px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                                                        />
                                                                    </div>
                                                                    <div className="max-h-48 overflow-y-auto">
                                                                        {catalogProducts
                                                                            .filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()))
                                                                            .map(p => (
                                                                                <button
                                                                                    key={p.id}
                                                                                    onClick={() => handleSetProduct(item.id, p)}
                                                                                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
                                                                                >
                                                                                    <div className="w-8 h-8 flex-shrink-0 bg-[#050505] border border-white/10 rounded-sm overflow-hidden flex items-center justify-center">
                                                                                        {p.image_urls?.[0] ? (
                                                                                            <img src={p.image_urls[0]} alt="" className="w-full h-full object-cover" />
                                                                                        ) : (
                                                                                            <Package className="w-4 h-4 opacity-30" />
                                                                                        )}
                                                                                    </div>
                                                                                    <div className="flex-1 min-w-0">
                                                                                        <p className="text-white/80 text-xs font-bold truncate">{p.name}</p>
                                                                                        <p className="text-[8px] text-white/30">
                                                                                            {p.type && <span>{p.type}</span>}
                                                                                            {p.price && <span> · {p.price}</span>}
                                                                                        </p>
                                                                                    </div>
                                                                                </button>
                                                                            ))
                                                                        }
                                                                        {catalogProducts.filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())).length === 0 && (
                                                                            <p className="px-3 py-4 text-[10px] text-white/30 text-center">Žádné produkty nenalezeny</p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex-shrink-0 flex items-center gap-1">
                                                        <button
                                                            onClick={() => setEditingPlanItem(editingPlanItem === item.id ? null : item.id)}
                                                            className="p-1.5 text-white/20 hover:text-white/60 transition-colors"
                                                            title="Upravit téma"
                                                        >
                                                            <Pencil className="w-3 h-3 text-[10px]" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleRegenerateItem(item.id)}
                                                            disabled={regeneratingItem === item.id}
                                                            className="p-1.5 text-white/20 hover:text-amber-400/80 transition-colors disabled:opacity-30"
                                                            title="Jiný koncept"
                                                        >
                                                            <RefreshCw className="w-3 h-3 text-[10px]" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleRemovePlanItem(item.id)}
                                                            className="p-1.5 text-white/20 hover:text-red-400/80 transition-colors"
                                                            title="Odebrat"
                                                        >
                                                            <X className="w-3 h-3 text-[10px]" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })
                            })()}
                        </div>

                        {/* Add post button */}
                        <div className="flex justify-center mt-4">
                            <button
                                onClick={handleAddPlanItem}
                                className="flex items-center gap-2 px-5 py-2.5 bg-[#0a0a0a] border border-dashed border-white/15 rounded-sm text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white/60 hover:border-white/30 transition-all"
                            >
                                <span>+</span> Přidat post
                            </button>
                        </div>

                        {/* Bottom bar */}
                        <div className="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-4 text-[10px] text-white/30 font-bold uppercase tracking-widest">
                                <span>{contentPlan.length} postů</span>
                                <span>·</span>
                                {(() => {
                                    const cost = batchCreditCost(contentPlan.map(p => p.medium), freeRemaining)
                                    return <span>{cost === 0 ? "Zdarma — v rámci plánu" : `${cost} kreditů`}</span>
                                })()}
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setStep(1)}
                                    className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest text-white/40 bg-white/5 border border-white/10 hover:text-white hover:bg-white/10 transition-all"
                                >
                                    ← Zpět na brief
                                </button>
                                {draftId && (
                                    <button
                                        onClick={handleDiscardPlan}
                                        disabled={generating}
                                        className="inline-flex items-center gap-1.5 justify-center px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest text-white/40 bg-white/5 border border-white/10 hover:text-red-400 hover:border-red-400/30 transition-all disabled:opacity-50"
                                    ><Trash2 className="w-3 h-3 shrink-0" />Zahodit plán</button>
                                )}
                                <button
                                    onClick={handleApproveAndGenerate}
                                    disabled={contentPlan.length === 0 || generating}
                                    className="px-8 py-3 rounded-sm text-[10px] font-black uppercase tracking-widest bg-aisummit-cinnabar text-white shadow-[0_0_15px_rgba(229,83,63,0.3)] hover:shadow-[0_0_20px_rgba(229,83,63,0.6)] transition-all disabled:opacity-50"
                                >
                                    ✅ Schválit & generovat ({contentPlan.length})
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* ═══ STEP 3 (single) / STEP 4 (batch): Results ═══ */}
                {step === resultStep && (
                    <motion.div
                        key="step3"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-12 border border-white/10 relative overflow-hidden min-h-[500px] flex flex-col justify-center"
                    >
                        {generating ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] z-10">
                                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-aisummit-cinnabar via-[#0f0f0f] to-[#0f0f0f] pointer-events-none mix-blend-screen animate-pulse"></div>
                                <div className="w-16 h-16 border-[3px] border-white/10 border-t-aisummit-cinnabar rounded-full animate-spin mx-auto mb-8 shadow-sm relative z-10" />
                                <h3 className="text-2xl font-black uppercase tracking-tighter text-white mb-4 relative z-10">{batchProgress ? `Generuji post ${batchProgress.current} z ${batchProgress.total}...` : "Kreativní proces probíhá..."}</h3>
                                {agentStatus && !batchProgress && (
                                    <div className="relative z-10 mb-4 w-full max-w-xs">
                                        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mb-3">
                                            <div
                                                className="h-full bg-gradient-to-r from-aisummit-cinnabar to-orange-400 rounded-full transition-all duration-700 ease-out"
                                                style={{ width: `${agentStatus.progress}%` }}
                                            />
                                        </div>
                                        <p className="text-[11px] text-white/70 font-bold tracking-wide text-center">
                                            {agentStatus.message}
                                        </p>
                                    </div>
                                )}
                                {/* Editorial conversation log */}
                                {editorialLog.length > 0 && (
                                    <div className="relative z-10 w-full max-w-md mt-4">
                                        <div className="text-[9px] font-black uppercase tracking-widest text-white/30 mb-2 text-center">Konverzace agentů</div>
                                        <div className="bg-[#050505] border border-white/10 rounded-sm p-3 max-h-40 overflow-y-auto space-y-1.5">
                                            {editorialLog.map((msg, i) => {
                                                const RoleIcon = { strategist: ChartColumn, copywriter: PenLine, critic: Search, chief_editor: Award }[msg.role] || MessageCircle
                                                const roleLabel = { strategist: "Stratég", copywriter: "Copywriter", critic: "Kritik", chief_editor: "Šéfredaktor" }[msg.role] || msg.role
                                                const actionColor = msg.action === "approve" ? "text-emerald-400"
                                                    : msg.action === "revise" ? "text-amber-400"
                                                    : msg.action === "pushback" ? "text-purple-400"
                                                    : msg.action === "reject" ? "text-red-400"
                                                    : "text-white/50"
                                                return (
                                                    <div key={i} className="flex items-start gap-2">
                                                        <RoleIcon className="w-3.5 h-3.5 shrink-0 text-white/50" />
                                                        <div className="min-w-0">
                                                            <span className={`text-[9px] font-bold uppercase tracking-widest ${actionColor}`}>{roleLabel}</span>
                                                            <p className="text-[10px] text-white/60 leading-snug truncate">{msg.summary}</p>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                                {batchProgress && (
                                    <div className="w-64 h-2 bg-white/10 rounded-full mb-4 relative z-10 overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-aisummit-cinnabar to-orange-400 rounded-full transition-all duration-500"
                                            style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                                        />
                                    </div>
                                )}
                                {/* Live success/fail tally — proof the run is advancing even when a
                                    single post is slow, so the spinner never reads as "frozen" (QA #4). */}
                                {batchProgress && (batchProgress.successes > 0 || batchProgress.failures > 0) && (
                                    <p className="text-[9px] font-bold uppercase tracking-widest mb-4 relative z-10 text-center">
                                        <span className="text-emerald-400/80"><Check className="w-3.5 h-3.5 shrink-0 inline-block align-[-2px] mr-1" />{batchProgress.successes} hotovo</span>
                                        {batchProgress.failures > 0 && (
                                            <span className="text-amber-400/80"> · {batchProgress.failures} přeskočeno</span>
                                        )}
                                    </p>
                                )}
                                {batchProgress && campaignId && (
                                    <p className="text-[9px] text-emerald-400/70 font-bold uppercase tracking-widest mb-4 relative z-10 text-center max-w-xs">
                                        Kampaň běží na serveru — okno můžete klidně zavřít, generování pokračuje.
                                    </p>
                                )}
                                {batchProgress && !pollHealthy && (
                                    <p className="text-[9px] text-amber-400/80 font-bold uppercase tracking-widest mb-4 relative z-10 text-center max-w-xs animate-pulse">
                                        Obnovuji spojení se serverem… generování běží dál na pozadí.
                                    </p>
                                )}
                                {/* Quality-over-speed explainer — generation runs the top engines with
                                    hard retries under load, so it can take noticeably longer. Tell the
                                    user why, without exposing model/engine internals. */}
                                <p className="text-[10px] text-white/45 mb-5 relative z-10 text-center max-w-sm leading-relaxed normal-case">
                                    ⚡ Pracujeme na tom v <span className="text-white/75 font-bold">nejvyšší možné kvalitě</span>. Někdy to chvíli zabere — <span className="text-white/75 font-bold">kvalita má přednost před rychlostí</span>.
                                </p>
                                <div className="h-6 overflow-hidden relative z-10">
                                    <motion.div
                                        animate={{ y: [0, -24, -48, -72, -96] }}
                                        transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                                    >
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Architekt analyzuje brand identitu...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Copywriter skládá úderné texty...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Generuji vizuální prompt pro AI...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Generuji obrázek...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Finální leštění a optimalizace...</p>
                                    </motion.div>
                                </div>
                            </div>
                        ) : result ? (
                            <div className="w-full max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                <div className="text-center mb-8">
                                    <span className={`inline-flex items-center justify-center w-16 h-16 rounded-sm text-3xl mb-4 shadow-sm border ${result.success ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-aisummit-cinnabar/10 text-aisummit-cinnabar border-aisummit-cinnabar/20"}`}>
                                        {result.success ? "✨" : "⚠️"}
                                    </span>
                                    <h2 className="text-3xl font-black uppercase tracking-tighter text-white mb-2">
                                        {result.success ? "Prezentace návrhu" : "Něco se pokazilo"}
                                    </h2>
                                    {result.error && <p className="text-aisummit-cinnabar font-bold uppercase tracking-widest text-[10px]">{result.error}</p>}
                                    {!result.success && (
                                        <button
                                            onClick={() => { setResult(null); setStep(1); setTimeout(() => handleGenerate(), 100) }}
                                            className="mt-4 px-6 py-3 rounded-sm text-[10px] font-black uppercase tracking-widest bg-aisummit-cinnabar text-white shadow-[0_0_15px_rgba(229,83,63,0.3)] hover:shadow-[0_0_20px_rgba(229,83,63,0.5)] transition-all"
                                        >
                                            <span className="inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 shrink-0" />Zkusit znovu</span>
                                        </button>
                                    )}
                                </div>

                                {/* Detailed Presentation View */}
                                {result.success && result.imageUrl && (
                                    <div className="bg-[#0a0a0a] rounded-sm p-4 sm:p-6 border border-white/10 shadow-lg">
                                        <div className="mb-6 rounded-sm overflow-hidden bg-[#0f0f0f] shadow-inner border border-white/5">
                                            {(() => {
                                                const urls = result.imageUrl?.split("|").filter(Boolean) || []
                                                if (urls.length > 1) {
                                                    return (
                                                        <div className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar">
                                                            {urls.map((u, i) => (
                                                                <img key={i} src={u} className="w-full h-auto max-h-[500px] object-contain snap-center shrink-0 border-r border-white/5 last:border-0" alt={`Slide ${i}`} />
                                                            ))}
                                                        </div>
                                                    )
                                                }
                                                return <img src={urls[0]} className="w-full h-auto max-h-[500px] object-contain" alt="Vygenerovaný obsah" />
                                            })()}
                                        </div>

                                        {result.caption && (
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Finální Copy</span>
                                                    <button onClick={() => copyToClipboard(result.caption!, "final")} className="text-[10px] font-bold uppercase tracking-widest text-aisummit-cinnabar hover:text-white transition-colors">
                                                        {copiedField === "final" ? "Zkopírováno" : "Kopírovat text"}
                                                    </button>
                                                </div>
                                                <p className="text-white/70 font-medium leading-relaxed whitespace-pre-wrap bg-[#0f0f0f] p-5 rounded-sm border border-white/5 shadow-sm">{result.caption}</p>
                                            </div>
                                        )}

                                        {/* Editorial Review Log — "omáčka" for the client */}
                                        {editorialLog.length > 0 && (
                                            <div className="mt-6 pt-5 border-t border-white/5">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Kontrola kvality</span>
                                                    <span className="text-[8px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400/70 rounded-sm font-bold uppercase tracking-widest border border-emerald-500/10">
                                                        {editorialLog.some(m => m.action === "approve") ? "Schváleno" : "Dokončeno"}
                                                    </span>
                                                </div>
                                                <div className="bg-[#080808] border border-white/5 rounded-sm p-3 space-y-2">
                                                    {editorialLog.map((msg, i) => {
                                                        const RoleIcon = { strategist: ChartColumn, copywriter: PenLine, critic: Search, chief_editor: Award }[msg.role] || MessageCircle
                                                        const roleLabel = { strategist: "Stratég", copywriter: "Copywriter", critic: "Kritik", chief_editor: "Šéfredaktor" }[msg.role] || msg.role
                                                        const actionColor = msg.action === "approve" ? "text-emerald-400"
                                                            : msg.action === "revise" ? "text-amber-400"
                                                            : msg.action === "pushback" ? "text-purple-400"
                                                            : msg.action === "reject" ? "text-red-400"
                                                            : msg.action === "fix" ? "text-sky-400"
                                                            : "text-white/40"
                                                        const actionLabel = msg.action === "approve" ? "schválil"
                                                            : msg.action === "revise" ? "vrátil k úpravě"
                                                            : msg.action === "pushback" ? "nesouhlasí"
                                                            : msg.action === "reject" ? "zamítl"
                                                            : msg.action === "fix" ? "opravil"
                                                            : msg.action === "propose" ? "navrhl"
                                                            : msg.action
                                                        return (
                                                            <div key={i} className="flex items-start gap-2 py-1">
                                                                <RoleIcon className="w-3.5 h-3.5 shrink-0 mt-0.5 text-white/50" />
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="text-[9px] font-bold uppercase tracking-widest text-white/50">{roleLabel}</span>
                                                                        <span className={`text-[8px] font-bold uppercase tracking-widest ${actionColor}`}>{actionLabel}</span>
                                                                    </div>
                                                                    <p className="text-[10px] text-white/40 leading-snug mt-0.5">{msg.summary}</p>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {/* Schedule this post */}
                                        {result.success && result.postId && (
                                            <div className="pt-6 mt-6 border-t border-white/10">
                                                <span className="inline-flex items-center gap-1.5 block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-3"><CalendarDays className="w-3 h-3 shrink-0" />Naplánovat na Instagram</span>
                                                {singleScheduled ? (
                                                    <p className="text-[11px] text-emerald-400 font-bold">✅ Naplánováno na {singleScheduled} — uvidíš to v Plánovači</p>
                                                ) : (
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <input
                                                            type="date"
                                                            value={singleSchedDate || scheduleStart}
                                                            onChange={(e) => setSingleSchedDate(e.target.value)}
                                                            className="px-3 py-2 bg-[#050505] border border-white/15 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                                        />
                                                        <input
                                                            type="time"
                                                            value={singleSchedTime}
                                                            onChange={(e) => setSingleSchedTime(e.target.value)}
                                                            className="px-3 py-2 bg-[#050505] border border-white/15 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                                        />
                                                        <button
                                                            onClick={handleScheduleSingle}
                                                            disabled={singleScheduling}
                                                            className="px-5 py-2 rounded-sm text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                                                        >
                                                            {singleScheduling ? "Plánuji…" : "Naplánovat"}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="flex items-center justify-center gap-3 pt-6 mt-6 border-t border-white/10">
                                            <button
                                                onClick={() => setActiveSection("posts")}
                                                className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                                            >
                                                <span className="inline-flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5 shrink-0" />Otevřít v Příspěvcích</span>
                                            </button>
                                            <button
                                                onClick={() => { setResult(null); setStep(1); setSingleScheduled(null); setSingleSchedDate("") }}
                                                className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/60 border border-white/10 hover:text-white hover:bg-white/10 transition-all"
                                            >
                                                <span className="inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 shrink-0" />Generovat další</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : batchResult ? (
                            <div className="w-full max-w-md mx-auto text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                <span className="inline-flex items-center justify-center w-20 h-20 rounded-sm bg-emerald-500/10 text-emerald-400 shadow-sm border border-emerald-500/20 mb-2">
                                    <Rocket className="w-8 h-8" />
                                </span>
                                <h2 className="text-4xl font-black uppercase tracking-tighter text-white">Kampaň spuštěna</h2>
                                <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest">{batchResult.message}</p>

                                <div className="grid grid-cols-2 gap-4 mt-8">
                                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-sm p-6 shadow-sm">
                                        <p className="text-5xl font-black text-emerald-500 mb-2">{batchResult.generated}</p>
                                        <p className="text-[10px] font-bold tracking-widest uppercase text-emerald-500/50">Úspěch</p>
                                    </div>
                                    <div className="bg-aisummit-cinnabar/5 border border-aisummit-cinnabar/10 rounded-sm p-6 shadow-sm">
                                        <p className="text-5xl font-black text-aisummit-cinnabar mb-2">{batchResult.errors}</p>
                                        <p className="text-[10px] font-bold tracking-widest uppercase text-aisummit-cinnabar/50">Selhání</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-center gap-3 mt-8 flex-wrap">
                                    <button
                                        onClick={() => setActiveSection("posts")}
                                        className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                                    >
                                        <span className="inline-flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5 shrink-0" />Otevřít v Příspěvcích</span>
                                    </button>
                                    {batchResult.errors > 0 && (
                                        <button
                                            onClick={() => { setBatchResult(null); setStep(1) }}
                                            className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest bg-aisummit-cinnabar/10 text-aisummit-cinnabar border border-aisummit-cinnabar/20 hover:bg-aisummit-cinnabar/20 transition-all"
                                        >
                                            <span className="inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 shrink-0" />Zkusit selhané znovu</span>
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setStep(1); setContentPlan([]) }}
                                        className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/60 border border-white/10 hover:text-white hover:bg-white/10 transition-all"
                                    >
                                        <span className="inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 shrink-0" />Vytvořit další</span>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center text-white/40">
                                <p className="text-5xl mb-4 opacity-30 grayscale">✨</p>
                                <p className="text-xl font-black uppercase tracking-tighter text-white/50 mb-2">Čekám na zadání</p>
                                <p className="font-bold uppercase tracking-widest text-[10px]">Vraťte se na krok Brief a spusťte generování.</p>
                                <button onClick={() => setStep(1)} className="mt-6 px-6 py-2 rounded-sm text-[10px] font-bold tracking-widest uppercase bg-white/5 text-white/50 border border-white/10 hover:text-white hover:bg-white/10 transition-colors">Zpět na Zadání</button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
