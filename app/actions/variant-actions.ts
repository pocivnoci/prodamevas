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
        // 1. Load original post
        const { data: original, error: fetchErr } = await supabaseAdmin
            .from("ig_posts")
            .select("*, ig_post_types(name, display_name)")
            .eq("id", postId)
            .single()

        if (fetchErr || !original) throw new Error("Post nenalezen")

        // 2. Load client config for brand voice
        const { clientId } = await requireProjectAccess(projectSlug)
        const { ai } = await import("@/instagram/gemini-client")

        const { data: clientData } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()

        const config = clientData?.config || {}
        const bv = config.brandVoice || {}
        const brandName = config.name || projectSlug
        const postTypeName = original.ig_post_types?.display_name || "Instagram příspěvek"
        const postTypeSlug = original.ig_post_types?.name || ""

        // Resolve linked product if any
        let productSection = ""
        if (original.product_id) {
            const { data: product } = await supabaseAdmin
                .from("ig_products")
                .select("name, slug, price, description")
                .eq("id", original.product_id)
                .single()
            if (product) {
                productSection = `\n## PRODUKT V PŘÍSPĚVKU\nNázev: ${product.name}\nCena: ${product.price || "neuvedena"}\nPopis: ${product.description || ""}\nURL: ${config.website}/p/${product.slug}\n⚠️ Pokud feedback nemění produkt, zachovej odkaz na ${config.website}/p/${product.slug} v CTA.\n`
            }
        }

        // Hashtag pool instructions
        const hashtagSection = config.hashtagPools
            ? `\n## HASHTAG POOLS (vyber z těchto):\n- Core: ${config.hashtagPools.core?.join(", ") || ""}\n- Niche: ${config.hashtagPools.niche?.slice(0, 5).join(", ") || ""}\n- Broad: ${config.hashtagPools.broad?.slice(0, 4).join(", ") || ""}\nPoužij 8-10 hashtagů, mix core + niche + relevantní z originálu.\n`
            : ""

        // 3. Build revision prompt
        const prompt = `Jsi senior copywriter pro značku "${brandName}" (${config.website || ""}).

## BRAND PERSONA
${bv.persona || "Profesionální a přátelský tón."}

## VOICE TRAITS
${(bv.voiceTraits || []).map((t: string) => `- ${t}`).join("\n") || "- Autentický a přirozený"}

## ZAKÁZÁNO (NIKDY NEPOUŽÍVEJ)
${(bv.antiPatterns || []).map((p: string) => `- ${p}`).join("\n") || "- Generické fráze, emoji spam"}

## TYP PŘÍSPĚVKU: ${postTypeName}
${productSection}
## PŮVODNÍ CAPTION:
${original.caption}

## PŮVODNÍ HASHTAGY: ${(original.hashtags || []).join(" ")}
${hashtagSection}
## FEEDBACK OD KLIENTA:
"${feedback}"

## INSTRUKCE:
1. Přepiš caption PŘESNĚ podle feedbacku — ale zachovej brand voice a styl
2. Hook (první řádek) musí stále zastavit scrollování — max 15 slov, bez emoji
3. CTA musí směřovat na ${config.website || "web značky"}
4. Zachovej strukturu: hook → body → CTA → hashtags
5. Pokud feedback říká "zkrátit" — zkrať. Pokud "přidat humor" — přidej. Buď DOSLOVNÝ.
6. NIKDY nepřekládej anglické názvy produktů/kolekcí do češtiny

## VÝSTUP — vrať POUZE validní JSON:
{
  "caption": "kompletní nový text příspěvku (hook + body + CTA)",
  "hashtags": ["#hashtag1", "#hashtag2", "..."],
  "hook": "první řádek captiony — hook text pro overlay na obrázku (max 15 slov, bez emoji)",
  "imagePrompt": "English prompt for AI image generation — describe the background photo. NO TEXT in image. Photorealistic, editorial quality.",
  "imageSubtext": "krátký podtext pod hook na obrázku (max 8 slov, česky)"
}`

        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" },
        })

        const text = response.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""
        let parsed: { caption: string; hashtags: string[]; hook?: string; imagePrompt?: string; imageSubtext?: string }
        try {
            parsed = JSON.parse(text.replace(/```json|```/g, "").trim())
        } catch {
            throw new Error("AI vrátilo neplatný JSON")
        }

        // 4. Regenerate image if we have an image prompt
        let imageUrl = original.image_url
        let imagePrompt = original.image_prompt
        const imageStyle = original.image_style

        if (parsed.imagePrompt) {
            try {
                const { loadConfig } = await import("@/instagram/configs")
                const { refineImagePrompt } = await import("@/instagram/image-pipeline")
                const { generateImage } = await import("@/instagram/gemini-client")
                const { overlayText } = await import("@/instagram/text-overlay")

                const fullConfig = await loadConfig(projectSlug)
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
            })
            .select("id")
            .single()

        if (insertErr) throw insertErr

        console.log(`✅ Post revised: ${postId} → ${newPost.id}`)
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
        // 1. Load original post
        const { data: original, error: fetchErr } = await supabaseAdmin
            .from("ig_posts")
            .select("*, ig_post_types(name, display_name)")
            .eq("id", postId)
            .single()

        if (fetchErr || !original) throw new Error("Post nenalezen")

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
        const { clientId } = await requireProjectAccess(projectSlug)
        setActiveProject(clientId)

        const result = await generateOnePost({
            configName: projectSlug,
            topic: variantTopic,
            type: postTypeName,
        })

        if (result.id) {
            // Mark as variant
            await supabaseAdmin
                .from("ig_posts")
                .update({ revision_of: postId })
                .eq("id", result.id)
        }

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
        await requireProjectAccess(projectSlug)

        // Winner → draft
        await supabaseAdmin
            .from("ig_posts")
            .update({ status: "draft" })
            .eq("id", winnerId)

        // Losers → rejected
        if (loserIds.length > 0) {
            await supabaseAdmin
                .from("ig_posts")
                .update({ status: "rejected" })
                .in("id", loserIds)
        }

        // Memory learning — analyze winner vs losers asynchronously
        try {
            const { learnFromVariantSelection } = await import("@/instagram/memory-agent")
            const { setActiveProject } = await import("@/instagram/service")
            const { resolveClientId } = await import("@/instagram/configs")
            const clientId = await resolveClientId(projectSlug)
            setActiveProject(clientId)
            await learnFromVariantSelection(winnerId, loserIds)
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
 * Get all variants of a post (original + all linked via revision_of).
 */
export async function getVariantGroup(
    postId: string,
    projectSlug: string
): Promise<{ posts: any[]; originalId: string }> {
    try {
        await requireProjectAccess(projectSlug)

        // First check if this post IS a variant (has revision_of)
        const { data: post } = await supabaseAdmin
            .from("ig_posts")
            .select("id, revision_of")
            .eq("id", postId)
            .single()

        const originalId = post?.revision_of || postId

        // Get original + all variants
        const { data: variants } = await supabaseAdmin
            .from("ig_posts")
            .select("id, caption, image_url, image_style, status, created_at, revision_of, ig_post_types(name, display_name, emoji)")
            .or(`id.eq.${originalId},revision_of.eq.${originalId}`)
            .order("created_at", { ascending: true })

        return { posts: variants || [], originalId }
    } catch (err: any) {
        console.error("getVariantGroup error:", err?.message || err)
        return { posts: [], originalId: postId }
    }
}

