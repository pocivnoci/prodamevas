"use server"

import supabaseAdmin from "@/supabase/admin"

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
        const { resolveClientId, loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)
        const clientId = await resolveClientId(projectSlug)

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
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

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
    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update({
            status: "ready",
            updated_at: new Date().toISOString(),
        })
        .eq("id", postId)

    return { success: !error }
}
