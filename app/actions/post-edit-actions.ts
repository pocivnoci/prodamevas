"use server"

/**
 * Targeted post editing — retouch, never re-design
 * ================================================
 *
 * The problem this replaces: revisePost() answers "move the headline up" by calling
 * renderImage(), which runs generateDesignBrief() and draws a brand-new concept,
 * archetype, photo and layout. The finished image the user was looking at is never
 * shown to any model. Every small note therefore came back as a different post.
 *
 * The fix is the pattern print already uses (editPrintDesign): download the shipped
 * image, hand THAT buffer to editExistingImage() with the user's instruction plus a
 * preservation clause, and write the result back onto the same row.
 *
 * Three rules this file must keep:
 *
 * 1. **Never import renderImage or generateDesignBrief.** They are the re-design path.
 *    A "small fix" that reaches them is the bug, not a fallback. (Asserted in §15 of
 *    test-beta-e2e.ts.)
 * 2. **Never regenerate from scratch after a user edit** — at most ONE corrective edit,
 *    and only for a `severe` QA verdict (garbled/unreadable text), never for a cosmetic
 *    mismatch. After a text edit the "expected" text is intentionally out of date.
 * 3. **In place, with history.** The row is updated, never duplicated; the previous state
 *    is pushed onto ig_posts.edit_history so revertPostEdit() can undo it. `revision_of`
 *    and `link_type` belong to the revision/variant system and are not touched here.
 */

import supabaseAdmin from "@/supabase/admin"
import { creditGuard } from "./credit-guard"
import { requireProjectAccess } from "@/lib/auth-guard"
import { fetchImageBuffer, nearestAspectRatio } from "@/lib/image-buffer"
import { parsePostMedia } from "@/lib/media-urls"
import type { IGPost, PostEditHistoryEntry } from "@/lib/types/database"

/** How many undo steps a post keeps. Beyond this the oldest are dropped — jsonb on a
 *  hot table, and nobody undoes eleven edits back. */
const MAX_HISTORY = 10

export type EditScope = "text" | "image" | "both"

export interface PostEditInput {
    scope: EditScope
    /** What to change, in the user's words. */
    instruction: string
    /** Optional "don't touch this" list. */
    preserve?: string
    /** Optional marked area on the image, normalized 0..1 from the top-left. */
    region?: { x: number; y: number; w: number; h: number }
    /** Which slide/frame of a carousel or story to edit. Defaults to the first. */
    slideIndex?: number
}

export interface PostEditResult {
    success: boolean
    post?: IGPost
    error?: string
    /** True when the image was actually re-rendered (i.e. a credit was spent). */
    imageChanged?: boolean
    /** Surfaced to the UI as a warning — the edit shipped, but vision QA still dislikes it. */
    warning?: string
}

// ─── Edit ────────────────────────────────────────────────────

export async function editPost(
    projectSlug: string,
    postId: string,
    edit: PostEditInput,
): Promise<PostEditResult> {
    const instruction = edit.instruction?.trim()
    if (!instruction) return { success: false, error: "Napiš, co se má upravit." }

    const wantsImage = edit.scope !== "text"
    const wantsText = edit.scope !== "image"

    let clientId: string
    try {
        clientId = (await requireProjectAccess(projectSlug)).clientId
    } catch (err: any) {
        return { success: false, error: err?.message || "Neautorizovaný přístup." }
    }

    const { data: post } = await supabaseAdmin
        .from("ig_posts")
        .select("*, ig_post_types(name, display_name)")
        .eq("id", postId)
        .eq("client_id", clientId)
        .maybeSingle()

    if (!post) return { success: false, error: "Příspěvek nenalezen." }

    // Already live on Instagram — editing the row would silently desync it from the
    // published media (ig_media_id / permalink point at what followers actually see).
    if (post.status === "posted" || post.status === "posting") {
        return { success: false, error: "Publikovaný příspěvek už nejde upravit — vytvoř variantu." }
    }

    const media = parsePostMedia(post.image_url, post.media_type)

    // A reel is an MP4; the image model can't edit video. Text edits are still fine.
    if (wantsImage && media.kind === "reel") {
        return { success: false, error: "Video u reelu nejde upravit — uprav text, nebo vygeneruj příspěvek znovu." }
    }
    if (wantsImage && !media.thumbUrl) {
        return { success: false, error: "Příspěvek nemá obrázek k úpravě." }
    }

    // Credits: the image branch is one Nano Banana call, the text branch is cheap and free.
    // Charged only on success (guard.commit at the end), like every other action.
    const guard = wantsImage ? await creditGuard(projectSlug, "post_edit") : null
    if (guard && !guard.ok) return { success: false, error: guard.error }

    // The state we may need to restore, captured before anything changes.
    const historyEntry: PostEditHistoryEntry = {
        at: new Date().toISOString(),
        scope: edit.scope,
        instruction,
        preserve: edit.preserve?.trim() || null,
        region: edit.region ?? null,
        slide_index: edit.slideIndex ?? null,
        image_url: post.image_url,
        image_prompt: post.image_prompt,
        image_style: post.image_style,
        caption: post.caption,
        hashtags: post.hashtags,
    }

    const update: Record<string, any> = {}
    let imageChanged = false
    let warning: string | undefined

    try {
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)

        // The headline burnt into the artwork. design_brief is the truthful source;
        // the caption's first line is only a guess for pre-native rows.
        const brief = post.design_brief as any
        const renderedHook: string | undefined =
            brief?.typography?.headlineText || post.caption?.split("\n")[0] || undefined

        // ── Text ────────────────────────────────────────────
        if (wantsText) {
            const { reviseCaption } = await import("@/instagram/caption-generator")

            let product: { name: string; slug: string; price?: string | null; description?: string | null } | null = null
            if (post.product_id) {
                const { data } = await supabaseAdmin
                    .from("ig_products")
                    .select("name, slug, price, description")
                    .eq("id", post.product_id)
                    .maybeSingle()
                product = data
            }

            const revised = await reviseCaption(config, {
                originalCaption: post.caption || "",
                originalHashtags: post.hashtags || [],
                postTypeDisplayName: post.ig_post_types?.display_name || "Instagram příspěvek",
                feedback: buildTextFeedback(instruction, edit.preserve),
                product,
                postTypeName: post.ig_post_types?.name || "",
                // On a text-only edit the picture isn't being redrawn, so the hook it
                // already carries must survive verbatim — otherwise the caption starts
                // contradicting the image. keepHook also strips imagePrompt from the
                // schema, which is what made every revision trigger a re-roll.
                keepHook: !wantsImage,
                renderedHook,
            })

            update.caption = revised.caption
            update.hashtags = revised.hashtags
        }

        // ── Image ───────────────────────────────────────────
        if (wantsImage) {
            const slideIndex = clampSlide(edit.slideIndex, media.urls.length)
            const targetUrl = media.urls[slideIndex]
            const original = await fetchImageBuffer(targetUrl)

            // Ratio comes from the ACTUAL pixels. Deriving it from the post type's format
            // is how revisePost ends up re-framing a 9:16 story into 4:5 — a different
            // aspectRatio makes the model recompose the whole picture.
            const sharp = (await import("sharp")).default
            const meta = await sharp(original).metadata()
            const aspectRatio = nearestAspectRatio(meta.width, meta.height, media.aspect === "vertical" ? "9:16" : "4:5")

            const { buildPostEditPrompt, normalizeEditRegion, verifyNativeImage, qaScore } =
                await import("@/instagram/image-pipeline")
            const { editExistingImage } = await import("@/instagram/gemini-client")
            const { uploadPostImage } = await import("@/instagram/orchestrators/image-orchestrator")

            const prompt = buildPostEditPrompt({
                instruction,
                preserve: edit.preserve,
                region: normalizeEditRegion(edit.region),
                hook: renderedHook,
            })

            // mimeType matters: stored post images are WebP (uploadPostImage compresses
            // them), while editExistingImage defaults to image/jpeg.
            let edited = await editExistingImage(original, prompt, {
                mimeType: "image/webp",
                aspectRatio,
            })

            // QA is deliberately narrow here. The user is the authority on whether the
            // change is right; vision QA only guards against the edit model garbling the
            // Czech typography. So: act on "severe" only, and spend at most one corrective
            // edit. A fresh regeneration would throw away the design the user is keeping —
            // which is the entire failure mode this feature exists to remove.
            const expectedHeadline = brief?.typography?.headlineText
            if (expectedHeadline) {
                const qa = await verifyNativeImage(edited, {
                    headline: expectedHeadline,
                    subtext: brief?.typography?.subtextText || undefined,
                    logoExpected: brief?.logoPlacement !== "none",
                    safeZone: media.kind === "story",
                })
                // Gated on textAccurate, not on severity alone: the fix prompt below can only
                // repair typography, and QA also reports things the edit never caused. A real
                // run flagged "no brand logo present" on a post whose ORIGINAL had no logo —
                // the corrective pass then added one, silently making a design change the user
                // never asked for. An edit is only ever blamed for breaking the text.
                if (!qa.ok && qa.severity === "severe" && qa.textAccurate === false) {
                    console.log(`   ⚠️ QA po úpravě: ${qa.issues.join("; ")} → jeden korektivní edit`)
                    try {
                        const fixed = await editExistingImage(
                            edited,
                            `Fix ONLY the text rendering problems in this image — keep the composition, photo, style, colors and layout EXACTLY the same.
Render the headline as this EXACT Czech text, character-for-character including diacritics: "${expectedHeadline}"
${qa.fixHint ? `Specific fix: ${qa.fixHint}` : ""}`,
                            { mimeType: "image/png", aspectRatio },
                        )
                        const qa2 = await verifyNativeImage(fixed, {
                            headline: expectedHeadline,
                            subtext: brief?.typography?.subtextText || undefined,
                            logoExpected: brief?.logoPlacement !== "none",
                        })
                        // Ship whichever attempt is closer — same ship-best doctrine as the
                        // orchestrator, minus the regeneration rung.
                        if (qaScore(qa2) < qaScore(qa)) edited = fixed
                        else warning = "Text v obrázku po úpravě nemusí být úplně čistý — zkontroluj ho."
                    } catch (fixErr: any) {
                        console.warn(`   ⚠️ Korektivní edit selhal: ${fixErr?.message?.substring(0, 80)}`)
                        warning = "Text v obrázku po úpravě nemusí být úplně čistý — zkontroluj ho."
                    }
                }
            }

            const newUrl = await uploadPostImage(edited, config)
            if (!newUrl) throw new Error("Nahrání upraveného obrázku selhalo.")

            // Splice the edited slide back in — the other slides of a carousel/story are
            // untouched and must keep their original URLs and order.
            const urls = [...media.urls]
            urls[slideIndex] = newUrl
            update.image_url = urls.join("|")
            update.image_style = post.image_style?.startsWith("edited:")
                ? post.image_style
                : `edited:${post.image_style || "native"}`
            imageChanged = true
        }

        // ── Persist, in place ───────────────────────────────
        const history = Array.isArray(post.edit_history) ? post.edit_history : []
        update.edit_history = [...history, historyEntry].slice(-MAX_HISTORY)
        update.feedback = instruction

        const { data: saved, error: saveErr } = await supabaseAdmin
            .from("ig_posts")
            .update(update)
            .eq("id", postId)
            .eq("client_id", clientId)
            .select("*, ig_post_types(name, display_name, emoji)")
            .single()

        if (saveErr) throw saveErr

        if (guard) await guard.commit(`Úprava příspěvku: ${instruction.slice(0, 60)}`, postId)

        // The user telling us what was wrong is the strongest signal in the system —
        // the same learning the old revision path fed. Fire & forget.
        // Only when the caption actually moved: learnFromRevision diffs old vs new text,
        // so an image-only edit would hand it two identical strings and burn an AI call
        // to conclude nothing changed.
        if (wantsText && saved.caption !== historyEntry.caption) try {
            const { waitUntil } = await import("@vercel/functions")
            const { learnFromRevision } = await import("@/instagram/memory-agent")
            waitUntil(
                learnFromRevision(
                    historyEntry.caption || "",
                    buildTextFeedback(instruction, edit.preserve),
                    saved.caption || "",
                    [postId],
                    clientId,
                ).catch(() => { /* non-fatal */ })
            )
        } catch { /* non-fatal — the edit is already saved */ }

        console.log(`✅ Post upraven (${edit.scope}): ${postId}`)
        return { success: true, post: saved as IGPost, imageChanged, warning }
    } catch (err: any) {
        console.error("editPost error:", err?.message || err)
        return { success: false, error: err?.message || "Úprava selhala." }
    }
}

// ─── Undo ────────────────────────────────────────────────────

/**
 * Restore the state from before the last edit. Free — the user is not paying twice
 * because our edit missed, and no AI call is involved.
 */
export async function revertPostEdit(
    projectSlug: string,
    postId: string,
): Promise<PostEditResult> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data: post } = await supabaseAdmin
            .from("ig_posts")
            .select("id, status, edit_history")
            .eq("id", postId)
            .eq("client_id", clientId)
            .maybeSingle()

        if (!post) return { success: false, error: "Příspěvek nenalezen." }
        if (post.status === "posted" || post.status === "posting") {
            return { success: false, error: "Publikovaný příspěvek už nejde vrátit zpět." }
        }

        const history: PostEditHistoryEntry[] = Array.isArray(post.edit_history) ? post.edit_history : []
        const previous = history[history.length - 1]
        if (!previous) return { success: false, error: "Není co vrátit." }

        const { data: saved, error: saveErr } = await supabaseAdmin
            .from("ig_posts")
            .update({
                caption: previous.caption,
                hashtags: previous.hashtags,
                image_url: previous.image_url,
                image_prompt: previous.image_prompt,
                image_style: previous.image_style,
                edit_history: history.slice(0, -1),
            })
            .eq("id", postId)
            .eq("client_id", clientId)
            .select("*, ig_post_types(name, display_name, emoji)")
            .single()

        if (saveErr) throw saveErr

        console.log(`↩️ Úprava vrácena: ${postId}`)
        return { success: true, post: saved as IGPost }
    } catch (err: any) {
        console.error("revertPostEdit error:", err?.message || err)
        return { success: false, error: err?.message || "Vrácení selhalo." }
    }
}

// ─── Helpers ─────────────────────────────────────────────────

/** Fold the optional "don't touch" field into the copywriter's feedback string. */
function buildTextFeedback(instruction: string, preserve?: string): string {
    const keep = preserve?.trim()
    return keep
        ? `${instruction}\n\nNESAHEJ NA (ponech beze změny): ${keep}`
        : instruction
}

function clampSlide(index: number | undefined, count: number): number {
    if (!Number.isFinite(index) || index == null) return 0
    return Math.min(Math.max(Math.trunc(index), 0), Math.max(0, count - 1))
}
