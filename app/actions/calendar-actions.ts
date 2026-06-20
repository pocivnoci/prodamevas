"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess, requireClientAccess } from "@/lib/auth-guard"

/**
 * Resolve a post's tenant and verify the caller may touch it. Throws on missing
 * post or no access. Returns the post's client_id.
 */
async function gatePostAccess(postId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from("ig_posts")
        .select("client_id")
        .eq("id", postId)
        .single()
    if (error || !data?.client_id) throw new Error("Příspěvek nenalezen.")
    await requireClientAccess(data.client_id)
    return data.client_id
}

// ─── Plan Week ──────────────────────────────────────────

export async function planWeekAction(
    projectSlug: string,
    weekStartISO: string, // "2026-05-19"
    postsPerWeek: number = 5,
    city?: string
): Promise<{
    success: boolean
    plan?: { slots: any[]; city: string | null; weatherAvailable: boolean }
    error?: string
}> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)

        const { setActiveProject } = await import("@/instagram/service")
        setActiveProject(clientId)

        const { analyzePerformance } = await import("@/instagram/performance")
        const { createPillarMapper } = await import("@/instagram/service")
        const getPillar = createPillarMapper(config)
        const performance = await analyzePerformance(config, getPillar)

        const { planWeek } = await import("@/instagram/content-planner")
        const startDate = new Date(weekStartISO)
        const plan = await planWeek(config, startDate, performance, postsPerWeek, city)

        if (plan.slots.length === 0) {
            return { success: false, error: "AI nevygenerovalo žádné sloty" }
        }

        // For each planned slot, create a post via autopilot and schedule it
        const { generateOnePost } = await import("@/instagram/autopilot")
        const { schedulePost } = await import("@/instagram/service")

        let generated = 0
        for (const slot of plan.slots) {
            try {
                // Generate the actual post
                const result = await generateOnePost({
                    configName: projectSlug,
                    type: slot.postType,
                    topic: slot.topic,
                })

                if (result.id) {
                    // Update post with planning metadata
                    await supabaseAdmin
                        .from("ig_posts")
                        .update({
                            scheduled_for: `${slot.date}T${slot.time}:00`,
                            time_slot: slot.time,
                        })
                        .eq("id", result.id)

                    // Schedule into content calendar
                    try {
                        await schedulePost(slot.date, result.id, slot.time)
                    } catch {
                        // Calendar entry may fail if table doesn't exist yet — non-fatal
                    }

                    generated++
                    console.log(`   ✅ ${slot.day} ${slot.time}: "${slot.topic}" → ${result.id}`)
                }
            } catch (slotErr: any) {
                console.warn(`   ⚠️ Slot ${slot.day} failed: ${slotErr?.message?.substring(0, 80)}`)
            }
        }

        return {
            success: true,
            plan: {
                slots: plan.slots,
                city: plan.city,
                weatherAvailable: plan.weatherAvailable,
            },
        }
    } catch (err: any) {
        console.error("planWeekAction error:", err)
        return { success: false, error: err?.message || "Planning failed" }
    }
}

// ─── Get Week Posts ──────────────────────────────────────

export async function getWeekPosts(
    projectSlug: string,
    weekStartISO: string // "2026-05-19"
): Promise<{
    posts: {
        id: string
        caption: string
        image_url: string | null
        status: string
        scheduled_for: string | null
        time_slot: string | null
        created_at: string
        post_type?: { name: string; display_name: string; emoji: string }
    }[]
}> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const startDate = new Date(weekStartISO)
        const endDate = new Date(startDate)
        endDate.setDate(endDate.getDate() + 6)

        const startStr = startDate.toISOString()
        const endStr = new Date(endDate.getTime() + 24 * 60 * 60 * 1000).toISOString() // end of day

        const { data, error } = await supabaseAdmin
            .from("ig_posts")
            .select(`
                id, caption, image_url, status, scheduled_for, time_slot, created_at,
                ig_post_types ( name, display_name, emoji )
            `)
            .eq("client_id", clientId)
            .not("scheduled_for", "is", null)
            .gte("scheduled_for", startStr)
            .lte("scheduled_for", endStr)
            .order("scheduled_for", { ascending: true })

        if (error) throw error

        return {
            posts: (data || []).map(p => ({
                ...p,
                post_type: p.ig_post_types as any,
            })),
        }
    } catch (err: any) {
        console.error("getWeekPosts error:", err?.message)
        return { posts: [] }
    }
}

// ─── Move Post to Different Day ──────────────────────────

export async function movePost(
    postId: string,
    newDate: string,    // "2026-05-22"
    newTime?: string    // "17:00"
): Promise<{ success: boolean }> {
    await gatePostAccess(postId)
    const update: Record<string, any> = {
        scheduled_for: `${newDate}T${newTime || "12:00"}:00`,
        updated_at: new Date().toISOString(),
    }
    if (newTime) update.time_slot = newTime

    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update(update)
        .eq("id", postId)

    return { success: !error }
}

// ─── Approve Post ──────────────────────────────────────

export async function approvePost(postId: string): Promise<{ success: boolean }> {
    await gatePostAccess(postId)
    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update({
            status: "ready",
            updated_at: new Date().toISOString(),
        })
        .eq("id", postId)

    return { success: !error }
}

// ─── Schedule a single post (from the generate result or posts list) ─────────

/**
 * Assign a posting time to one already-generated post and add it to the calendar.
 * Used by the "📅 Naplánovat" control after a single generation.
 */
export async function schedulePostAction(
    projectSlug: string,
    postId: string,
    date: string,    // "2026-06-20"
    time: string,    // "17:00"
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        // Confirm the post belongs to this tenant before mutating.
        const { data: post } = await supabaseAdmin
            .from("ig_posts")
            .select("client_id")
            .eq("id", postId)
            .single()
        if (!post || post.client_id !== clientId) {
            return { success: false, error: "Příspěvek nepatří tomuto projektu." }
        }

        const { toScheduledFor } = await import("@/lib/schedule-planner")
        const { error } = await supabaseAdmin
            .from("ig_posts")
            .update({
                scheduled_for: toScheduledFor(date, time),
                time_slot: time,
                status: "ready",
                updated_at: new Date().toISOString(),
            })
            .eq("id", postId)
        if (error) return { success: false, error: error.message }

        // Calendar entry — best-effort, non-fatal (mirrors planWeekAction).
        try {
            const { schedulePost } = await import("@/instagram/service")
            await schedulePost(date, postId, time)
        } catch { /* calendar insert is non-critical */ }

        return { success: true }
    } catch (err) {
        return { success: false, error: (err as Error)?.message || "Plánování selhalo" }
    }
}
