"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"

// ─── Delete IG Post ──────────────────────────────────────────────────

export async function deleteIGPost(
    postId: string,
    projectSlug: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // Get post to find image URL for cleanup
        const { data: post } = await supabaseAdmin
            .from("ig_posts")
            .select("image_url, client_id")
            .eq("id", postId)
            .single()

        if (!post || post.client_id !== clientId) {
            return { success: false, error: "Příspěvek nenalezen" }
        }

        // Delete images from storage
        if (post.image_url) {
            const urls = post.image_url.split("|")
            for (const url of urls) {
                const path = url.split("/storage/v1/object/public/audit-screenshots/")[1]
                    || url.split("/storage/v1/object/public/")[1]?.split("/").slice(1).join("/")
                if (path) {
                    const bucket = url.includes("audit-screenshots") ? "audit-screenshots" : url.split("/storage/v1/object/public/")[1]?.split("/")[0]
                    if (bucket) {
                        await supabaseAdmin.storage.from(bucket).remove([path]).catch(() => {})
                    }
                }
            }
        }

        // Delete from DB
        const { error } = await supabaseAdmin
            .from("ig_posts")
            .delete()
            .eq("id", postId)

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("deleteIGPost error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function deleteIGPosts(
    postIds: string[],
    projectSlug: string
): Promise<{ success: boolean; deleted: number; error?: string }> {
    try {
        if (!postIds.length) return { success: true, deleted: 0 }
        const { clientId } = await requireProjectAccess(projectSlug)

        // Get posts for image cleanup
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select("id, image_url")
            .eq("client_id", clientId)
            .in("id", postIds)

        // Delete images from storage
        if (posts) {
            for (const post of posts) {
                if (!post.image_url) continue
                const urls = post.image_url.split("|")
                for (const url of urls) {
                    const path = url.split("/storage/v1/object/public/audit-screenshots/")[1]
                        || url.split("/storage/v1/object/public/")[1]?.split("/").slice(1).join("/")
                    if (path) {
                        const bucket = url.includes("audit-screenshots") ? "audit-screenshots" : url.split("/storage/v1/object/public/")[1]?.split("/")[0]
                        if (bucket) {
                            await supabaseAdmin.storage.from(bucket).remove([path]).catch(() => {})
                        }
                    }
                }
            }
        }

        // Bulk delete from DB
        const { error, count } = await supabaseAdmin
            .from("ig_posts")
            .delete({ count: "exact" })
            .eq("client_id", clientId)
            .in("id", postIds)

        if (error) throw error
        return { success: true, deleted: count || postIds.length }
    } catch (err: any) {
        console.error("deleteIGPosts error:", err?.message || err)
        return { success: false, deleted: 0, error: err?.message || String(err) }
    }
}

