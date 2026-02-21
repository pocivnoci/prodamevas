"use server"

import supabaseAdmin from "@/supabase/admin"

// ─── Types ───────────────────────────────────────────────────────────

export interface AdminStats {
    totalSubmissions: number
    todaySubmissions: number
    paidSubmissions: number
    totalRevenue: number
    premiumCount: number
    premiumConversion: number
    avgTimeSavedDaily: number
    iosCount: number
    androidCount: number
    igPostsTotal: number
    igPostsDraft: number
    igPostsReady: number
    igPostsPosted: number
}

export interface SubmissionRow {
    id: string
    name: string | null
    email: string | null
    system_type: string | null
    report_type: string | null
    payment_status: string | null
    marketing_consent: boolean | null
    created_at: string
    hasReport: boolean
    hasPremium: boolean
}

export interface UserRow {
    email: string
    name: string | null
    auditCount: number
    paidCount: number
    latestAudit: string
    marketingConsent: boolean
}

export interface PaymentRow {
    id: string
    name: string | null
    email: string | null
    report_type: string | null
    paid_at: string | null
    amount: number
}

export interface RecentActivityItem {
    type: "audit" | "payment" | "premium" | "ig_post"
    description: string
    email?: string | null
    timestamp: string
}

export interface MonthlyRevenue {
    month: string
    revenue: number
    count: number
}

export interface SubmissionDetail {
    submission: {
        id: string
        name: string | null
        email: string | null
        system_type: string | null
        answers: any
        locale: string | null
        report_type: string | null
        payment_status: string | null
        payment_id: string | null
        paid_at: string | null
        marketing_consent: boolean | null
        created_at: string
    }
    report: {
        id: string
        status: string | null
        summary: string | null
        conclusion: string | null
        time_saved_daily: number | null
        time_saved_monthly: number | null
        time_saved_yearly: number | null
        created_at: string
    } | null
    diagnosis: Array<{ category: string; score: number; comment: string | null; color: string | null }>
    timeWasters: Array<{ title: string; description: string | null }>
    actionSteps: Array<{ step_number: number; category: string; title: string }>
    premium: {
        status: string
        hasGuide: boolean
        created_at: string
    } | null
}

// ─── Dashboard Stats ─────────────────────────────────────────────────

export async function getAdminStats(): Promise<AdminStats> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    const [
        { count: totalSubmissions },
        { count: todaySubmissions },
        { data: paidSubs },
        { data: premiumSubs },
        { data: reportData },
        { count: iosCount },
        { count: androidCount },
        { count: igPostsTotal },
        { count: igPostsDraft },
        { count: igPostsReady },
        { count: igPostsPosted },
    ] = await Promise.all([
        supabaseAdmin.from("audit_submissions").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("audit_submissions").select("*", { count: "exact", head: true }).gte("created_at", todayISO),
        supabaseAdmin.from("audit_submissions").select("report_type").eq("payment_status", "paid"),
        supabaseAdmin.from("premium_submissions").select("id"),
        supabaseAdmin.from("audit_report").select("time_saved_daily"),
        supabaseAdmin.from("audit_submissions").select("*", { count: "exact", head: true }).eq("system_type", "ios"),
        supabaseAdmin.from("audit_submissions").select("*", { count: "exact", head: true }).eq("system_type", "android"),
        supabaseAdmin.from("ig_posts").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("ig_posts").select("*", { count: "exact", head: true }).eq("status", "draft"),
        supabaseAdmin.from("ig_posts").select("*", { count: "exact", head: true }).eq("status", "ready"),
        supabaseAdmin.from("ig_posts").select("*", { count: "exact", head: true }).eq("status", "posted"),
    ])

    const paidCount = paidSubs?.length || 0
    let totalRevenue = 0
    paidSubs?.forEach((s: any) => {
        totalRevenue += s.report_type === "complex" ? 299 : 129
    })

    const avgTimeSaved = reportData?.length
        ? reportData.reduce((sum: number, r: any) => sum + (r.time_saved_daily || 0), 0) / reportData.length
        : 0

    return {
        totalSubmissions: totalSubmissions || 0,
        todaySubmissions: todaySubmissions || 0,
        paidSubmissions: paidCount,
        totalRevenue,
        premiumCount: premiumSubs?.length || 0,
        premiumConversion: paidCount > 0 ? ((premiumSubs?.length || 0) / paidCount) * 100 : 0,
        avgTimeSavedDaily: Math.round(avgTimeSaved),
        iosCount: iosCount || 0,
        androidCount: androidCount || 0,
        igPostsTotal: igPostsTotal || 0,
        igPostsDraft: igPostsDraft || 0,
        igPostsReady: igPostsReady || 0,
        igPostsPosted: igPostsPosted || 0,
    }
}

// ─── Submissions List ────────────────────────────────────────────────

export async function getSubmissionsList(): Promise<SubmissionRow[]> {
    const { data: submissions } = await supabaseAdmin
        .from("audit_submissions")
        .select(`
            id, name, email, system_type, report_type, payment_status, marketing_consent, created_at,
            audit_report ( id ),
            premium_submissions ( id )
        `)
        .order("created_at", { ascending: false })

    if (!submissions) return []

    return submissions.map((s: any) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        system_type: s.system_type,
        report_type: s.report_type,
        payment_status: s.payment_status,
        marketing_consent: s.marketing_consent,
        created_at: s.created_at,
        hasReport: Array.isArray(s.audit_report) && s.audit_report.length > 0,
        hasPremium: Array.isArray(s.premium_submissions) && s.premium_submissions.length > 0,
    }))
}

// ─── Submission Detail ───────────────────────────────────────────────

export async function getSubmissionDetail(id: string): Promise<SubmissionDetail | null> {
    const { data: submission } = await supabaseAdmin
        .from("audit_submissions")
        .select("*")
        .eq("id", id)
        .single()

    if (!submission) return null

    const { data: reports } = await supabaseAdmin
        .from("audit_report")
        .select("*")
        .eq("submission_id", id)
        .limit(1)

    const report = reports?.[0] || null

    let diagnosis: any[] = []
    let timeWasters: any[] = []
    let actionSteps: any[] = []

    if (report) {
        const [diagRes, twRes, asRes] = await Promise.all([
            supabaseAdmin.from("report_diagnosis").select("category, score, comment, color").eq("report_id", report.id),
            supabaseAdmin.from("report_time_wasters").select("title, description").eq("report_id", report.id),
            supabaseAdmin.from("report_action_steps").select("step_number, category, title").eq("report_id", report.id).order("step_number"),
        ])
        diagnosis = diagRes.data || []
        timeWasters = twRes.data || []
        actionSteps = asRes.data || []
    }

    const { data: premiumData } = await supabaseAdmin
        .from("premium_submissions")
        .select("status, final_guide, created_at")
        .eq("submission_id", id)
        .single()

    return {
        submission,
        report,
        diagnosis,
        timeWasters,
        actionSteps,
        premium: premiumData ? {
            status: premiumData.status,
            hasGuide: !!premiumData.final_guide,
            created_at: premiumData.created_at,
        } : null,
    }
}

// ─── Users List ──────────────────────────────────────────────────────

export async function getUsersList(): Promise<UserRow[]> {
    const { data: submissions } = await supabaseAdmin
        .from("audit_submissions")
        .select("email, name, payment_status, marketing_consent, created_at")
        .order("created_at", { ascending: false })

    if (!submissions) return []

    const userMap = new Map<string, UserRow>()
    for (const s of submissions) {
        if (!s.email) continue
        const existing = userMap.get(s.email)
        if (existing) {
            existing.auditCount++
            if (s.payment_status === "paid") existing.paidCount++
        } else {
            userMap.set(s.email, {
                email: s.email,
                name: s.name,
                auditCount: 1,
                paidCount: s.payment_status === "paid" ? 1 : 0,
                latestAudit: s.created_at,
                marketingConsent: s.marketing_consent || false,
            })
        }
    }

    return Array.from(userMap.values())
}

// ─── Payments Overview ───────────────────────────────────────────────

export async function getPaymentsOverview(): Promise<{
    payments: PaymentRow[]
    monthlyRevenue: MonthlyRevenue[]
    totalRevenue: number
    thisMonthRevenue: number
}> {
    const { data: paidSubmissions } = await supabaseAdmin
        .from("audit_submissions")
        .select("id, name, email, report_type, paid_at")
        .eq("payment_status", "paid")
        .order("paid_at", { ascending: false })

    const payments: PaymentRow[] = (paidSubmissions || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        report_type: s.report_type,
        paid_at: s.paid_at,
        amount: s.report_type === "complex" ? 299 : 129,
    }))

    // Group by month
    const monthMap = new Map<string, { revenue: number; count: number }>()
    for (const p of payments) {
        const date = p.paid_at ? new Date(p.paid_at) : new Date()
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
        const existing = monthMap.get(month)
        if (existing) {
            existing.revenue += p.amount
            existing.count++
        } else {
            monthMap.set(month, { revenue: p.amount, count: 1 })
        }
    }

    const monthlyRevenue: MonthlyRevenue[] = Array.from(monthMap.entries())
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => a.month.localeCompare(b.month))

    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const thisMonthData = monthMap.get(thisMonth)

    return {
        payments,
        monthlyRevenue,
        totalRevenue: payments.reduce((sum, p) => sum + p.amount, 0),
        thisMonthRevenue: thisMonthData?.revenue || 0,
    }
}

// ─── Recent Activity ─────────────────────────────────────────────────

export async function getRecentActivity(limit = 15): Promise<RecentActivityItem[]> {
    const [
        { data: recentAudits },
        { data: recentPremiums },
        { data: recentIGPosts },
    ] = await Promise.all([
        supabaseAdmin.from("audit_submissions")
            .select("email, name, payment_status, created_at, paid_at")
            .order("created_at", { ascending: false })
            .limit(limit),
        supabaseAdmin.from("premium_submissions")
            .select("submission_id, status, created_at")
            .order("created_at", { ascending: false })
            .limit(limit),
        supabaseAdmin.from("ig_posts")
            .select("id, status, caption, created_at")
            .order("created_at", { ascending: false })
            .limit(limit),
    ])

    const activities: RecentActivityItem[] = []

    recentAudits?.forEach((a: any) => {
        activities.push({
            type: "audit",
            description: `Nový audit od ${a.name || a.email || "anonymous"}`,
            email: a.email,
            timestamp: a.created_at,
        })
        if (a.payment_status === "paid" && a.paid_at) {
            activities.push({
                type: "payment",
                description: `Platba od ${a.name || a.email || "anonymous"}`,
                email: a.email,
                timestamp: a.paid_at,
            })
        }
    })

    recentPremiums?.forEach((p: any) => {
        activities.push({
            type: "premium",
            description: `Premium status: ${p.status}`,
            timestamp: p.created_at,
        })
    })

    recentIGPosts?.forEach((p: any) => {
        const preview = p.caption?.substring(0, 50) || "bez titulku"
        activities.push({
            type: "ig_post",
            description: `IG post: ${preview}...`,
            timestamp: p.created_at,
        })
    })

    return activities
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit)
}

// ─── Submissions Per Day (last 30 days) ──────────────────────────────

export async function getSubmissionsPerDay(): Promise<Array<{ date: string; count: number }>> {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data } = await supabaseAdmin
        .from("audit_submissions")
        .select("created_at")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: true })

    if (!data) return []

    const dayMap = new Map<string, number>()
    // Fill all 30 days
    for (let i = 0; i < 30; i++) {
        const d = new Date()
        d.setDate(d.getDate() - (29 - i))
        dayMap.set(d.toISOString().split("T")[0], 0)
    }

    data.forEach((s: any) => {
        const day = s.created_at.split("T")[0]
        dayMap.set(day, (dayMap.get(day) || 0) + 1)
    })

    return Array.from(dayMap.entries()).map(([date, count]) => ({ date, count }))
}

// ─── Instagram Actions ───────────────────────────────────────────────

export async function getIGPostsList(statusFilter?: string, projectSlug: string = "mobilnamiru"): Promise<any[]> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        let query = supabaseAdmin
            .from("ig_posts")
            .select(`
                id, caption, hashtags, call_to_action, image_url, image_prompt,
                scheduled_for, time_slot, status, posted_at, likes, comments, saves,
                reach, shares, profile_visits, link_clicks, content_pillar,
                created_at, updated_at, client_id,
                ig_post_types ( name, display_name, emoji )
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(15)

        if (statusFilter && statusFilter !== "all") {
            query = query.eq("status", statusFilter)
        }

        const { data, error } = await query
        if (error) {
            console.error("getIGPostsList error:", error.message)
            return []
        }
        return data || []
    } catch (err: any) {
        console.error("getIGPostsList exception:", err?.message || err)
        return []
    }
}

export async function getIGIdeasList(projectSlug: string = "mobilnamiru"): Promise<any[]> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("*")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(100)
        if (error) {
            console.error("getIGIdeasList error:", error.message)
            return []
        }
        return data || []
    } catch (err: any) {
        console.error("getIGIdeasList exception:", err?.message || err)
        return []
    }
}

export async function getIGReviewsList(projectSlug: string = "mobilnamiru"): Promise<any[]> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_reviews")
            .select("*")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(100)
        if (error) {
            console.error("getIGReviewsList error:", error.message)
            return []
        }
        return data || []
    } catch (err: any) {
        console.error("getIGReviewsList exception:", err?.message || err)
        return []
    }
}

export async function updateIGReviewApproval(id: string, approved: boolean): Promise<{ success: boolean }> {
    const { error } = await supabaseAdmin
        .from("ig_reviews")
        .update({ is_approved: approved })
        .eq("id", id)
    return { success: !error }
}

export async function getIGPostTypes(configName?: string): Promise<any[]> {
    const { data } = await supabaseAdmin
        .from("ig_post_types")
        .select("*")
        .order("name")
    const allTypes = data || []

    // Filter by client's postTypes if config specified
    if (configName) {
        try {
            const { loadConfig, getPillarForPostType } = await import("@/instagram/configs")
            const config = await loadConfig(configName)
            if (config.postTypes && config.postTypes.length > 0) {
                return allTypes
                    .filter(pt => config.postTypes!.includes(pt.name))
                    .map(pt => ({
                        ...pt,
                        pillarId: getPillarForPostType(config, pt.name)
                    }))
            }
        } catch (e) {
            console.error("Failed to load config for post type filtering:", e)
        }
    }

    return allTypes
}

/**
 * Get available clients from config registry (for dashboard project selector)
 */
export async function getAvailableIGClients(): Promise<{ id: string; name: string; icon: string; description: string }[]> {
    const { getAvailableClients } = await import("@/instagram/configs")
    return getAvailableClients()
}

/**
 * Get post format specs for a client (aspect ratio, medium, overlay style per post type)
 */
export async function getIGPostFormats(configName: string): Promise<Record<string, { aspectRatio: string; medium: string; overlayStyle: string }>> {
    try {
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(configName)
        const formats: Record<string, { aspectRatio: string; medium: string; overlayStyle: string }> = {}
        const defaultFmt = config.defaultFormat || { aspectRatio: "4:5", medium: "image", overlayStyle: "default" }

        // Build format map for all post types
        for (const name of (config.postTypes || [])) {
            formats[name] = config.postFormats?.[name] || defaultFmt
        }
        return formats
    } catch {
        return {}
    }
}

/**
 * Get content pillar categories for a client (used in Generate tab dropdown)
 */
export async function getIGCategories(configName: string): Promise<{ id: string; emoji: string; label: string }[]> {
    try {
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(configName)
        if (!config.contentPillars) return []
        return Object.entries(config.contentPillars).map(([id, pillar]: [string, any]) => ({
            id,
            emoji: pillar.emoji || "📦",
            label: pillar.label || id,
        }))
    } catch {
        return []
    }
}

/**
 * Sync eshop product images — scrapes and downloads product photos from the client's eshop
 */
export async function syncEshopProducts(configName: string): Promise<{ success: boolean; message: string; imageCount: number }> {
    try {
        const { loadConfig } = await import("@/instagram/configs")
        const { scrapeAllProducts } = await import("@/instagram/eshop-scraper")
        const config = await loadConfig(configName)
        const results = await scrapeAllProducts(config)
        const totalImages = results.reduce((sum, r) => sum + r.localPaths.length, 0)
        return {
            success: true,
            message: `Synced ${results.length} products, ${totalImages} images downloaded`,
            imageCount: totalImages,
        }
    } catch (err: any) {
        return { success: false, message: err.message || "Sync failed", imageCount: 0 }
    }
}

export async function getIGGenerationLogs(limit = 50, projectSlug: string = "mobilnamiru"): Promise<any[]> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_generation_log")
            .select(`
                id, prompt_used, model_used, tokens_used, generation_time_ms, error, created_at,
                ig_posts ( caption, status )
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(limit)
        if (error) {
            console.error("getIGGenerationLogs error:", error.message)
            return []
        }
        return data || []
    } catch (err: any) {
        console.error("getIGGenerationLogs exception:", err?.message || err)
        return []
    }
}

export async function getIGCalendar(startDate: string, endDate: string): Promise<any[]> {
    const { data } = await supabaseAdmin
        .from("ig_content_calendar")
        .select(`
            id, date, time_slot, notes, created_at,
            ig_posts ( id, caption, status, image_url ),
            ig_post_types ( name, display_name, emoji )
        `)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
    return data || []
}

export async function updateIGPostStatus(postId: string, status: string): Promise<{ success: boolean }> {
    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update({
            status,
            ...(status === "posted" ? { posted_at: new Date().toISOString() } : {}),
            updated_at: new Date().toISOString(),
        })
        .eq("id", postId)
    return { success: !error }
}

export async function updateIGPostMetrics(
    postId: string,
    metrics: {
        likes: number
        comments: number
        saves: number
        reach: number
        shares: number
        profile_visits: number
        link_clicks: number
    }
): Promise<{ success: boolean }> {
    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update({
            ...metrics,
            updated_at: new Date().toISOString(),
        })
        .eq("id", postId)
    return { success: !error }
}

// ─── Delete Submission ───────────────────────────────────────────────

export async function deleteSubmission(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Delete cascading: report sections → report → premium → user_reports → submission
        const { data: reports } = await supabaseAdmin
            .from("audit_report")
            .select("id")
            .eq("submission_id", id)

        if (reports && reports.length > 0) {
            const reportIds = reports.map((r: any) => r.id)
            await Promise.all([
                supabaseAdmin.from("report_diagnosis").delete().in("report_id", reportIds),
                supabaseAdmin.from("report_time_wasters").delete().in("report_id", reportIds),
                supabaseAdmin.from("report_action_steps").delete().in("report_id", reportIds),
                supabaseAdmin.from("report_automations").delete().in("report_id", reportIds),
                supabaseAdmin.from("report_checklist").delete().in("report_id", reportIds),
            ])
            await supabaseAdmin.from("audit_report").delete().eq("submission_id", id)
        }

        await supabaseAdmin.from("premium_submissions").delete().eq("submission_id", id)
        await supabaseAdmin.from("user_reports").delete().eq("submission_id", id)
        await supabaseAdmin.from("audit_submissions").delete().eq("id", id)

        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}
