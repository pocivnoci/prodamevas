"use server"

/**
 * Print design server actions
 *
 * Replaces triggerDesignGeneration / triggerMockupGeneration in product-actions.ts.
 * Three behavioural fixes over that path, beyond the pipeline rewrite itself:
 *
 * 1. Results are PERSISTED (ig_product_designs). The old flow kept the design in
 *    React state plus a bucket URL, so a refresh threw away a paid render and
 *    there was no history to diverge from or to A/B against.
 * 2. "Add text to this design" EDITS the artwork instead of re-rolling the whole
 *    concept. The old two-step flow charged 3 + 3 credits, produced two different
 *    designs, and discarded the first.
 * 3. Errors propagate. generateDesignConcept swallowed everything into `null`,
 *    which made the withRetry wrapper around it dead code.
 */

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"
import { creditGuard } from "./credit-guard"
import { loadConfig } from "@/instagram/configs"
import { getProductCategoryBySlug } from "@/instagram/service"
import {
    generatePrintBrief,
    runPrintArtwork,
    finalizePrintFile,
    formatPrintSpec,
    renderProductMockup,
    resolvePrintGeometry,
    type PrintBrief,
    type PrintCategory,
} from "@/instagram/print-pipeline"
import { editExistingImage } from "@/instagram/gemini-client"
import { upsertMemory } from "@/instagram/memory-agent"

const BUCKET = "product-designs"

export interface PrintDesignRow {
    id: string
    category_slug: string | null
    theme: string | null
    brief: PrintBrief | null
    artwork_url: string | null
    artwork_print_url: string | null
    dieline_url: string | null
    mockup_url: string | null
    print_spec: any
    variant_group: string | null
    is_winner: boolean
    rating: number | null
    qa_score: number | null
    qa_status: string | null
    status: string
    progress: string | null
    error: string | null
    created_at: string
}

export interface PrintDesignOptions {
    categorySlug: string
    theme: string
    productId?: string
    lineId?: string
    ideaId?: string
    includeLogo?: boolean
    overlayText?: string
    /** Free-text steer — this input used to be accepted by the UI and silently dropped */
    designDescription?: string
    runId?: string
    /** Internal: A/B grouping */
    variantGroup?: string
    divergeFrom?: string
}

// ============================================
// GENERATE
// ============================================

export async function generatePrintDesign(
    projectSlug: string,
    options: PrintDesignOptions,
): Promise<{ success: boolean; design?: PrintDesignRow; error?: string }> {
    const guard = await creditGuard(projectSlug, "product_design")
    if (!guard.ok) return { success: false, error: guard.error }
    const clientId = guard.clientId

    const { data: row, error: insertErr } = await supabaseAdmin
        .from("ig_product_designs")
        .insert({
            client_id: clientId,
            product_id: options.productId || null,
            idea_id: options.ideaId || null,
            line_id: options.lineId || null,
            category_slug: options.categorySlug,
            theme: options.theme,
            variant_group: options.variantGroup || null,
            status: "running",
            progress: "Startuji…",
            brief: { runId: options.runId || null },
        })
        .select("id")
        .single()

    if (insertErr || !row) {
        return { success: false, error: `Nepodařilo se založit design: ${insertErr?.message}` }
    }

    const setProgress = (message: string) => {
        void supabaseAdmin
            .from("ig_product_designs")
            .update({ progress: message })
            .eq("id", row.id)
            .eq("client_id", clientId)
    }

    try {
        const config = await loadConfig(projectSlug)
        const category = await resolveCategory(options.categorySlug, clientId)
        if (!category) throw new Error(`Kategorie "${options.categorySlug}" neexistuje`)

        const [product, line, recentBriefs] = await Promise.all([
            loadProductContext(clientId, options.productId),
            loadLineContext(clientId, options.lineId),
            loadRecentBriefs(clientId, options.categorySlug),
        ])

        setProgress("Navrhuji koncept (Pro ladder)…")
        const brief = await generatePrintBrief(config, clientId, {
            category,
            theme: options.theme,
            product,
            line,
            overlayText: options.overlayText,
            designDescription: options.designDescription,
            recentBriefs,
            divergeFrom: options.divergeFrom,
        })

        const logoBuffer = options.includeLogo && config.logoFile
            ? await loadLogoSafe(config.logoFile)
            : null
        if (options.includeLogo && config.logoFile && !logoBuffer) {
            // Previously this failed silently and the user never learned why the
            // logo was missing from a design they explicitly asked to include it in.
            setProgress("Logo se nepodařilo načíst — pokračuji bez něj")
        }

        const result = await runPrintArtwork(config, category, brief, logoBuffer, setProgress)

        setProgress("Připravuji tiskový soubor…")
        const { printBuffer, dielineBuffer, spec } = await finalizePrintFile(result.artwork, category, result.brief)

        const stamp = Date.now()
        const safeName = slugForFile(result.brief.name)
        const [artworkUrl, printUrl, dielineUrl] = await Promise.all([
            upload(result.artwork, `${clientId}/${safeName}_${stamp}_artwork.png`),
            upload(printBuffer, `${clientId}/${safeName}_${stamp}_print300dpi.png`),
            upload(dielineBuffer, `${clientId}/${safeName}_${stamp}_dieline.png`),
        ])

        const { data: saved } = await supabaseAdmin
            .from("ig_product_designs")
            .update({
                brief: { ...result.brief, runId: options.runId || null },
                artwork_url: artworkUrl,
                artwork_print_url: printUrl,
                dieline_url: dielineUrl,
                print_spec: { ...spec, markdown: formatPrintSpec(spec, result.brief, category) },
                qa_status: result.qaStatus,
                qa_score: result.qa.ok ? 0 : (result.qa.issues?.length || 1),
                status: "done",
                progress: null,
            })
            .eq("id", row.id)
            .eq("client_id", clientId)
            .select("*")
            .single()

        await guard.commit(`Tiskový design: ${result.brief.name}`, row.id)
        return { success: true, design: saved as PrintDesignRow }
    } catch (err: any) {
        console.error("generatePrintDesign error:", err)
        await supabaseAdmin
            .from("ig_product_designs")
            .update({ status: "failed", error: String(err?.message || err).slice(0, 400), progress: null })
            .eq("id", row.id)
            .eq("client_id", clientId)
        // Not charged — commit() only runs on the success path.
        return { success: false, error: err?.message || "Generování designu selhalo" }
    }
}

/**
 * A/B: two designs from one decision, each told to diverge from the other.
 *
 * Charged as two renders because it is two renders — the alternative (one charge,
 * two outputs) would sell the second below cost.
 */
export async function generatePrintVariants(
    projectSlug: string,
    options: PrintDesignOptions,
): Promise<{ success: boolean; designs?: PrintDesignRow[]; error?: string }> {
    const variantGroup = crypto.randomUUID()

    const first = await generatePrintDesign(projectSlug, { ...options, variantGroup })
    if (!first.success || !first.design) return { success: false, error: first.error }

    const second = await generatePrintDesign(projectSlug, {
        ...options,
        variantGroup,
        divergeFrom: summariseBrief(first.design.brief),
    })

    // A failed second variant still leaves a usable first one — returning what we
    // have beats discarding a paid render.
    const designs = [first.design, ...(second.design ? [second.design] : [])]
    return { success: true, designs }
}

// ============================================
// EDIT (no re-roll, no double charge)
// ============================================

/**
 * Apply a change to an EXISTING artwork — "add this slogan", "make the headline bigger".
 *
 * The old UI path for this called triggerDesignGeneration a second time, which
 * re-ran the concept at temperature 0.9 and produced a different design carrying
 * the requested text, at double the cost.
 */
export async function editPrintDesign(
    projectSlug: string,
    designId: string,
    instruction: string,
): Promise<{ success: boolean; design?: PrintDesignRow; error?: string }> {
    const guard = await creditGuard(projectSlug, "product_mockup") // edit = one image call
    if (!guard.ok) return { success: false, error: guard.error }
    const clientId = guard.clientId

    try {
        const { data: design } = await supabaseAdmin
            .from("ig_product_designs")
            .select("*")
            .eq("id", designId)
            .eq("client_id", clientId)
            .maybeSingle()
        if (!design?.artwork_url) return { success: false, error: "Design nenalezen." }

        const category = await resolveCategory(design.category_slug, clientId)
        if (!category) return { success: false, error: "Kategorie designu neexistuje." }
        const geo = resolvePrintGeometry(category)

        const original = await fetchBuffer(design.artwork_url)
        const edited = await editExistingImage(
            original,
            `${instruction}

Keep everything else identical: same flat artwork, same composition, same colors, same background.
Any Czech text must keep its exact spelling and diacritics. Do not turn this into a photograph or a product mockup.`,
            { mimeType: "image/png", aspectRatio: geo.ratio },
        )

        const brief = design.brief as PrintBrief
        const { printBuffer, dielineBuffer, spec } = await finalizePrintFile(edited, category, brief)

        const stamp = Date.now()
        const safeName = slugForFile(brief?.name || "design")
        const [artworkUrl, printUrl, dielineUrl] = await Promise.all([
            upload(edited, `${clientId}/${safeName}_${stamp}_artwork.png`),
            upload(printBuffer, `${clientId}/${safeName}_${stamp}_print300dpi.png`),
            upload(dielineBuffer, `${clientId}/${safeName}_${stamp}_dieline.png`),
        ])

        const { data: saved } = await supabaseAdmin
            .from("ig_product_designs")
            .update({
                artwork_url: artworkUrl,
                artwork_print_url: printUrl,
                dieline_url: dielineUrl,
                print_spec: { ...spec, markdown: formatPrintSpec(spec, brief, category) },
                qa_status: "edited",
            })
            .eq("id", designId)
            .eq("client_id", clientId)
            .select("*")
            .single()

        await guard.commit(`Úprava designu: ${instruction.slice(0, 60)}`, designId)
        return { success: true, design: saved as PrintDesignRow }
    } catch (err: any) {
        console.error("editPrintDesign error:", err)
        return { success: false, error: err?.message || "Úprava selhala" }
    }
}

// ============================================
// MOCKUP
// ============================================

export async function generateMockup(
    projectSlug: string,
    designId: string,
): Promise<{ success: boolean; mockupUrl?: string; error?: string }> {
    const guard = await creditGuard(projectSlug, "product_mockup")
    if (!guard.ok) return { success: false, error: guard.error }
    const clientId = guard.clientId

    try {
        const { data: design } = await supabaseAdmin
            .from("ig_product_designs")
            .select("*")
            .eq("id", designId)
            .eq("client_id", clientId)
            .maybeSingle()
        if (!design?.artwork_url) return { success: false, error: "Design nenalezen." }

        const category = await resolveCategory(design.category_slug, clientId)
        if (!category) return { success: false, error: "Kategorie designu neexistuje." }

        const artwork = await fetchBuffer(design.artwork_url)
        const mockup = await renderProductMockup(artwork, category, design.brief as PrintBrief)
        const mockupUrl = await upload(mockup, `${clientId}/${slugForFile((design.brief as any)?.name || "design")}_${Date.now()}_mockup.png`)

        await supabaseAdmin
            .from("ig_product_designs")
            .update({ mockup_url: mockupUrl })
            .eq("id", designId)
            .eq("client_id", clientId)

        await guard.commit(`Mockup: ${(design.brief as any)?.name || design.category_slug}`, designId)
        return { success: true, mockupUrl }
    } catch (err: any) {
        console.error("generateMockup error:", err)
        return { success: false, error: err?.message || "Mockup selhal" }
    }
}

// ============================================
// READ + FEEDBACK
// ============================================

export async function getPrintDesigns(
    projectSlug: string,
    filter?: { categorySlug?: string; lineId?: string; productId?: string; limit?: number },
): Promise<PrintDesignRow[]> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        let q = supabaseAdmin
            .from("ig_product_designs")
            .select("*")
            .eq("client_id", clientId)
            .eq("status", "done")
            .order("created_at", { ascending: false })
            .limit(filter?.limit ?? 40)

        if (filter?.categorySlug) q = q.eq("category_slug", filter.categorySlug)
        if (filter?.lineId) q = q.eq("line_id", filter.lineId)
        if (filter?.productId) q = q.eq("product_id", filter.productId)

        const { data } = await q
        return (data || []) as PrintDesignRow[]
    } catch {
        return []
    }
}

export async function getPrintProgress(
    projectSlug: string,
    runId: string,
): Promise<{ status: string; progress: string; designId: string } | null> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { data } = await supabaseAdmin
            .from("ig_product_designs")
            .select("id, status, progress")
            .eq("client_id", clientId)
            .eq("brief->>runId", runId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (!data) return null
        return { status: data.status, progress: data.progress || "", designId: data.id }
    } catch {
        return null
    }
}

export async function ratePrintDesign(
    projectSlug: string,
    designId: string,
    rating: 1 | -1 | null,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        await supabaseAdmin
            .from("ig_product_designs")
            .update({ rating })
            .eq("id", designId)
            .eq("client_id", clientId)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err?.message || "Hodnocení se neuložilo" }
    }
}

/**
 * Pick the winner of an A/B pair and LEARN from it.
 *
 * The learning is the point: the winning brief is distilled into a `visual` brand
 * memory, which getVisualMemoriesSection feeds to the Instagram art director too —
 * so a print decision improves the feed, not just the next label.
 */
export async function selectDesignWinner(
    projectSlug: string,
    designId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data: winner } = await supabaseAdmin
            .from("ig_product_designs")
            .select("*")
            .eq("id", designId)
            .eq("client_id", clientId)
            .maybeSingle()
        if (!winner) return { success: false, error: "Design nenalezen." }

        // Exactly one winner per group
        if (winner.variant_group) {
            await supabaseAdmin
                .from("ig_product_designs")
                .update({ is_winner: false })
                .eq("client_id", clientId)
                .eq("variant_group", winner.variant_group)
        }
        await supabaseAdmin
            .from("ig_product_designs")
            .update({ is_winner: true, rating: 1 })
            .eq("id", designId)
            .eq("client_id", clientId)

        const brief = winner.brief as PrintBrief | null
        if (brief?.composition) {
            const lesson = [
                brief.concept,
                `Kompozice: ${brief.composition}`,
                brief.colors?.length ? `Paleta: ${brief.colors.join(", ")}` : "",
                brief.placement ? `Logo: ${brief.placement}` : "",
            ].filter(Boolean).join(" · ")

            await upsertMemory(clientId, {
                type: "visual",
                content: `Vybraný tiskový design (${winner.category_slug || "produkt"}): ${lesson}`.slice(0, 500),
                confidence: 0.6,
            }).catch(err => console.warn(`selectDesignWinner: memory upsert failed — ${err?.message}`))
        }

        return { success: true }
    } catch (err: any) {
        console.error("selectDesignWinner error:", err)
        return { success: false, error: err?.message || "Výběr vítěze selhal" }
    }
}

// ============================================
// HELPERS
// ============================================

async function resolveCategory(slug: string | null, clientId: string): Promise<PrintCategory | null> {
    if (!slug) return null
    const cat = await getProductCategoryBySlug(slug, clientId)
    return cat ? (cat as unknown as PrintCategory) : null
}

async function loadProductContext(clientId: string, productId?: string) {
    if (!productId) return undefined
    const { data } = await supabaseAdmin
        .from("ig_products")
        .select("name, description, line_step, line_role, specs")
        .eq("id", productId)
        .eq("client_id", clientId)
        .maybeSingle()
    if (!data) return undefined
    return {
        name: data.name,
        description: data.description || undefined,
        step: data.line_step ?? undefined,
        role: data.line_role || undefined,
        specs: data.specs || undefined,
    }
}

async function loadLineContext(clientId: string, lineId?: string) {
    if (!lineId) return undefined
    const { data } = await supabaseAdmin
        .from("ig_product_lines")
        .select("name, naming_convention, system_logic")
        .eq("id", lineId)
        .eq("client_id", clientId)
        .maybeSingle()
    if (!data) return undefined

    const { data: siblings } = await supabaseAdmin
        .from("ig_products")
        .select("name")
        .eq("client_id", clientId)
        .eq("line_id", lineId)
        .order("line_step")

    return {
        name: data.name,
        namingConvention: data.naming_convention || undefined,
        systemLogic: data.system_logic || undefined,
        siblings: (siblings || []).map(s => s.name),
    }
}

/** Anti-repetition corpus: what this client's recent designs already looked like. */
async function loadRecentBriefs(clientId: string, categorySlug: string): Promise<string[]> {
    const { data } = await supabaseAdmin
        .from("ig_product_designs")
        .select("brief")
        .eq("client_id", clientId)
        .eq("category_slug", categorySlug)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(5)
    return (data || [])
        .map(r => summariseBrief(r.brief as PrintBrief | null))
        .filter(Boolean) as string[]
}

function summariseBrief(brief: PrintBrief | null): string {
    if (!brief) return ""
    return [brief.concept, brief.composition, brief.colors?.join("/")].filter(Boolean).join(" — ").slice(0, 220)
}

async function loadLogoSafe(logoFile: string): Promise<Buffer | null> {
    try {
        const { loadLogo } = await import("@/instagram/logo-loader")
        return await loadLogo(logoFile)
    } catch {
        return null
    }
}

async function fetchBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Nepodařilo se stáhnout ${url} (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
}

async function upload(buffer: Buffer, path: string): Promise<string> {
    const { error } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: "image/png", cacheControl: "31536000", upsert: true })
    if (error) throw new Error(`Upload selhal: ${error.message}`)
    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
    return data.publicUrl
}

function slugForFile(name: string): string {
    return name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "design"
}
