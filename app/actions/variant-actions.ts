"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"

// ─── Post Revision ───────────────────────────────────────────

/**
 * Revise a post based on user feedback.
 * Creates a new draft post with revised caption/hashtags.
 * Original post is preserved unchanged.
 */
export async function revisePost(
    postId: string,
    feedback: string,
    projectSlug: string
): Promise<{ success: boolean; newPostId?: string; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // 1. Load original post (must belong to this client)
        const { data: original, error: fetchErr } = await supabaseAdmin
            .from("ig_posts")
            .select("*, ig_post_types(name, display_name)")
            .eq("id", postId)
            .eq("client_id", clientId)
            .single()

        if (fetchErr || !original) throw new Error("Post nenalezen")

        // 2. Validated config + engine revision (shared brand-voice logic)
        const { loadConfig } = await import("@/instagram/configs")
        const { reviseCaption } = await import("@/instagram/caption-generator")
        const fullConfig = await loadConfig(projectSlug)
        const postTypeSlug = original.ig_post_types?.name || ""

        let product: { name: string; slug: string; price?: string | null; description?: string | null } | null = null
        if (original.product_id) {
            const { data } = await supabaseAdmin
                .from("ig_products")
                .select("name, slug, price, description")
                .eq("id", original.product_id)
                .single()
            product = data
        }

        const parsed = await reviseCaption(fullConfig, {
            originalCaption: original.caption || "",
            originalHashtags: original.hashtags || [],
            postTypeDisplayName: original.ig_post_types?.display_name || "Instagram příspěvek",
            feedback,
            product,
        })

        // 4. Regenerate image if we have an image prompt
        let imageUrl = original.image_url
        let imagePrompt = original.image_prompt
        const imageStyle = original.image_style

        if (parsed.imagePrompt) {
            try {
                const { refineImagePrompt } = await import("@/instagram/image-pipeline")
                const { generateImage } = await import("@/instagram/gemini-client")
                const { overlayText } = await import("@/instagram/text-overlay")

                const refinedPrompt = await refineImagePrompt(
                    fullConfig,
                    { imagePrompt: parsed.imagePrompt, hook: parsed.hook || parsed.caption.split("\n")[0], imageSubtext: parsed.imageSubtext },
                    postTypeSlug
                )

                const imageBuffer = await generateImage(refinedPrompt, { aspectRatio: "3:4" as any })
                console.log(`   ✓ Revised image generated (${(imageBuffer.length / 1024).toFixed(0)} KB)`)

                // Apply text overlay
                const overlayStyle = imageStyle || "default"
                const finalImage = await overlayText(imageBuffer, {
                    headline: parsed.hook || parsed.caption.split("\n")[0],
                    subtext: parsed.imageSubtext,
                    variant: overlayStyle as any,
                    textAlign: fullConfig.feedAesthetic?.textAlign,
                    headlineScale: fullConfig.feedAesthetic?.headlineScale,
                    gradientColors: fullConfig.overlayGradient,
                    logoFile: fullConfig.logoFile,
                    fontFamily: fullConfig.feedAesthetic?.fontOverride,
                    accentColor: fullConfig.feedAesthetic?.accentColor,
                })

                // Compress and upload
                const sharp = (await import("sharp")).default
                const compressed = await sharp(finalImage)
                    .webp({ quality: 90, effort: 6 })
                    .toBuffer()

                const bucketName = fullConfig.storageBucket || "audit-screenshots"
                const filename = `ig-posts/${Date.now()}-revised.webp`
                const { error: uploadError } = await supabaseAdmin.storage
                    .from(bucketName)
                    .upload(filename, compressed, {
                        contentType: "image/webp",
                        cacheControl: "31536000",
                    })

                if (!uploadError) {
                    const { data: publicUrlData } = supabaseAdmin.storage
                        .from(bucketName)
                        .getPublicUrl(filename)
                    imageUrl = publicUrlData.publicUrl
                    imagePrompt = refinedPrompt
                    console.log(`   ✓ Revised image uploaded: ${imageUrl}`)
                } else {
                    console.warn(`   ⚠️ Revised image upload failed:`, uploadError.message)
                }
            } catch (imgErr: any) {
                console.warn(`   ⚠️ Image regeneration failed (keeping original):`, imgErr.message?.substring(0, 100))
            }
        }

        // 5. Save as new draft (non-destructive)
        const { data: newPost, error: insertErr } = await supabaseAdmin
            .from("ig_posts")
            .insert({
                client_id: clientId,
                caption: parsed.caption,
                hashtags: parsed.hashtags,
                image_url: imageUrl,
                image_prompt: imagePrompt,
                image_style: original.image_style,
                post_type_id: original.post_type_id,
                content_pillar: original.content_pillar,
                status: "draft",
                feedback: feedback,
                revision_of: postId,
                link_type: "revision",
            })
            .select("id")
            .single()

        if (insertErr) throw insertErr

        console.log(`✅ Post revised: ${postId} → ${newPost.id}`)

        // ─── REJECTION LEARNING ───────────────────────────
        // The user told us exactly what was wrong — the highest-quality signal
        // in the system. Extract a lasting preference/avoid memory. Fire & forget
        // so the response isn't blocked; waitUntil keeps the lambda alive.
        if (feedback?.trim()) {
            try {
                const { waitUntil } = await import("@vercel/functions")
                const { learnFromRevision } = await import("@/instagram/memory-agent")
                waitUntil(
                    learnFromRevision(
                        original.caption || "",
                        feedback,
                        parsed.caption || "",
                        [postId, newPost.id],
                        clientId
                    ).then(({ memoriesCreated }) => {
                        if (memoriesCreated > 0) console.log(`🧠 Revision learning: ${memoriesCreated} new memories`)
                    }).catch(() => { /* non-fatal */ })
                )
            } catch { /* non-fatal — revision already saved */ }
        }

        return { success: true, newPostId: newPost.id }
    } catch (err: any) {
        console.error("revisePost error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

// ─── Post Variant Generation ─────────────────────────────────
/**
 * Generate a variant of an existing post — same topic, different angle/hook/image.
 * Creates a new draft post linked to the original via variant_of field.
 */
export async function generatePostVariant(
    postId: string,
    projectSlug: string
): Promise<{ success: boolean; newPostId?: string; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // 1. Load original post (must belong to this client)
        const { data: original, error: fetchErr } = await supabaseAdmin
            .from("ig_posts")
            .select("*, ig_post_types(name, display_name)")
            .eq("id", postId)
            .eq("client_id", clientId)
            .single()

        if (fetchErr || !original) throw new Error("Post nenalezen")

        // Credit gate — variants run the full pipeline (Pro copy + render) and were
        // previously generated for FREE (billing leak). Weighted by the original's
        // medium: the variant is forced to the same medium for a fair A/B comparison.
        let variantMedium: "image" | "carousel" | "reel" =
            original.media_type === "carousel" || original.media_type === "reel"
                ? original.media_type
                : "image"
        // Reels kill-switch: the engine would clamp a reel to carousel anyway — bill the carousel.
        if (variantMedium === "reel" && process.env.REELS_ENABLED !== "1") variantMedium = "carousel"
        const { creditGuard } = await import("./credit-guard")
        const guard = await creditGuard(projectSlug, "post_variant", undefined, variantMedium)
        if (!guard.ok) {
            return { success: false, error: guard.error || "Nedostatek kreditů na variantu." }
        }

        // 2. Extract topic from caption (hook + first paragraph)
        const captionLines = (original.caption || "").split("\n").filter(Boolean)
        const hook = captionLines[0] || ""
        const body = captionLines.slice(1, 3).join(" ").substring(0, 200)
        const topicSummary = body ? `${hook} — ${body}` : hook

        // 3. Build a topic instruction that tells AI "same topic, different everything else"
        const variantTopic = `VARIANTA existujícího příspěvku. Stejné TÉMA ale ÚPLNĚ jiný úhel, hook a vizuál.

PŮVODNÍ PŘÍSPĚVEK (NEOPAKUJ!):
"${topicSummary}"

PRAVIDLA PRO VARIANTU:
- Stejné téma/produkt jako originál
- ÚPLNĚ jiný hook (jiná emoce, jiný formát)
- Jiný vizuální styl pro obrázek
- Jiné CTA
- Můžeš rozvinout jiný aspekt toho samého tématu`

        const postTypeName = original.ig_post_types?.name || undefined

        // 4. Generate via autopilot
        const { generateOnePost } = await import("@/instagram/autopilot")
        const { setActiveProject } = await import("@/instagram/service")
        setActiveProject(clientId)

        const result = await generateOnePost({
            configName: projectSlug,
            topic: variantTopic,
            type: postTypeName,
            medium: variantMedium,
            chargedMedium: variantMedium,
        })

        if (result.id) {
            // Mark as variant
            await supabaseAdmin
                .from("ig_posts")
                .update({ revision_of: postId, link_type: "variant" })
                .eq("id", result.id)
        }

        // Deduct only after the variant actually generated (sync server action —
        // a failure above skips the charge entirely).
        await guard.commit(`Varianta příspěvku (${variantMedium})`, result.id)

        console.log(`✅ Varianta vygenerována: ${postId} → ${result.id}`)
        return { success: true, newPostId: result.id }
    } catch (err: any) {
        console.error("generatePostVariant error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

// ─── A/B Variant System ──────────────────────────────────────

/**
 * Generate multiple variants of a post for A/B comparison.
 * Sequentially generates N variants (default 2) with rate limiting pauses.
 */
export async function generateMultipleVariants(
    postId: string,
    projectSlug: string,
    count: number = 2
): Promise<{ success: boolean; variantIds: string[]; error?: string }> {
    try {
        const clampedCount = Math.min(Math.max(count, 2), 3)
        const variantIds: string[] = []

        for (let i = 0; i < clampedCount; i++) {
            console.log(`🔀 Generating variant ${i + 1}/${clampedCount}...`)
            const result = await generatePostVariant(postId, projectSlug)

            if (result.success && result.newPostId) {
                variantIds.push(result.newPostId)
            } else {
                console.warn(`⚠️ Variant ${i + 1} failed: ${result.error}`)
            }

            // Rate limit pause between variants (skip after last)
            if (i < clampedCount - 1) {
                await new Promise(r => setTimeout(r, 15000))
            }
        }

        if (variantIds.length === 0) {
            return { success: false, variantIds: [], error: "Nepodařilo se vygenerovat žádnou variantu" }
        }

        console.log(`✅ ${variantIds.length}/${clampedCount} variant vygenerováno`)
        return { success: true, variantIds }
    } catch (err: any) {
        console.error("generateMultipleVariants error:", err?.message || err)
        return { success: false, variantIds: [], error: err?.message || String(err) }
    }
}

/**
 * Select a winning variant — sets winner to draft, losers to rejected.
 * Triggers memory agent learning from the user's preference.
 */
export async function selectVariantWinner(
    winnerId: string,
    loserIds: string[],
    projectSlug: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // Winner → draft (scoped to this client)
        await supabaseAdmin
            .from("ig_posts")
            .update({ status: "draft" })
            .eq("id", winnerId)
            .eq("client_id", clientId)

        // Losers → rejected
        if (loserIds.length > 0) {
            await supabaseAdmin
                .from("ig_posts")
                .update({ status: "rejected" })
                .in("id", loserIds)
                .eq("client_id", clientId)
        }

        // Memory learning — analyze winner vs losers asynchronously
        try {
            const { learnFromVariantSelection } = await import("@/instagram/memory-agent")
            await learnFromVariantSelection(winnerId, loserIds, clientId)
        } catch (memErr: any) {
            // Non-fatal — selection still works without memory learning
            console.warn(`⚠️ Memory learning skipped: ${memErr?.message?.substring(0, 80)}`)
        }

        console.log(`🏆 Winner: ${winnerId}, rejected: ${loserIds.join(", ")}`)
        return { success: true }
    } catch (err: any) {
        console.error("selectVariantWinner error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

/**
 * Get all A/B variants of a post (original + posts linked via revision_of
 * with link_type='variant' — user revisions are excluded from comparison).
 */
export async function getVariantGroup(
    postId: string,
    projectSlug: string
): Promise<{ posts: any[]; originalId: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // First check if this post IS a variant (has revision_of)
        const { data: post } = await supabaseAdmin
            .from("ig_posts")
            .select("id, revision_of")
            .eq("id", postId)
            .eq("client_id", clientId)
            .single()

        const originalId = post?.revision_of || postId

        // Get original + all A/B variants (not revisions)
        const { data: variants } = await supabaseAdmin
            .from("ig_posts")
            .select("id, caption, image_url, image_style, status, created_at, revision_of, link_type, ig_post_types(name, display_name, emoji)")
            .or(`id.eq.${originalId},and(revision_of.eq.${originalId},link_type.eq.variant)`)
            .eq("client_id", clientId)
            .order("created_at", { ascending: true })

        return { posts: variants || [], originalId }
    } catch (err: any) {
        console.error("getVariantGroup error:", err?.message || err)
        return { posts: [], originalId: postId }
    }
}

