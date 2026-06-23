/**
 * Export reference posts → lib/reference-data.ts
 *
 *   npx tsx scripts/export-references.ts [--per-brand=7]
 *
 * Reads every client flagged `config.isReference === true`, pulls its generated
 * posts (those with an image), and writes a static module the marketing site
 * imports. Re-run any time after generating/regenerating posts.
 */

import { writeFileSync } from "fs"
import { join } from "path"
import supabaseAdmin from "../supabase/admin"

interface ReferencePost {
    imageUrl: string
    caption: string
    hashtags: string
}
interface ReferenceBrand {
    slug: string
    company: string
    industry: string
    emoji: string
    website: string
    posts: ReferencePost[]
}

function emojiFor(industry: string, name: string): string {
    const s = `${industry} ${name}`.toLowerCase()
    if (s.includes("vina") || s.includes("víno") || s.includes("vino")) return "🍷"
    if (s.includes("kavár") || s.includes("kavar") || s.includes("café") || s.includes("coffee")) return "☕"
    if (s.includes("salon") || s.includes("kadeř") || s.includes("krása") || s.includes("beauty")) return "✂️"
    if (s.includes("fitness") || s.includes("wellness") || s.includes("gym")) return "🏋️"
    if (s.includes("restaur") || s.includes("gastro")) return "🍽️"
    if (s.includes("hotel") || s.includes("penzion") || s.includes("ubytov")) return "🏨"
    if (s.includes("e-com") || s.includes("eshop") || s.includes("e-shop")) return "🛒"
    if (s.includes("foto")) return "📸"
    if (s.includes("chrlit")) return "⚡"
    if (s.includes("aplikace") || s.includes("saas") || s.includes("app") || s.includes("startup") || s.includes("tech")) return "🚀"
    return "✨"
}

// Posts hidden from the marketing wall by hand (kept in the DB, just not shown).
// Matched by their image filename substring.
const WALL_EXCLUDE = [
    "1781848520617", "1780154534202", "1779667940718", "1781860350996",
    "1781848738644", "1781847273498", "1781769396263", "1781161430713",
    "1781161306576", "1781161220274", "1781161136131", "1781161029633",
]
const isExcluded = (url: string) => WALL_EXCLUDE.some(id => url.includes(id))

async function main() {
    const perBrandArg = process.argv.slice(2).find(a => a.startsWith("--per-brand="))
    const perBrand = perBrandArg ? parseInt(perBrandArg.split("=")[1], 10) : 7

    console.log("📦 Exporting reference posts…")

    const { data: clients, error } = await supabaseAdmin
        .from("clients")
        .select("id, slug, name, website, config")
        .eq("is_active", true)

    if (error || !clients) {
        console.error("❌ Failed to load clients:", error?.message)
        process.exit(1)
    }

    // isReference demo brands + Chrlit's own brand (its real posts dogfood the wall).
    const refClients = clients.filter(c => (c.config as any)?.isReference === true || c.slug === "chrlit")
    if (refClients.length === 0) {
        console.warn("⚠️ No clients flagged isReference. Run scripts/seed-reference-clients.ts first.")
    }

    const brands: ReferenceBrand[] = []
    for (const c of refClients) {
        const cfg = (c.config as any) || {}
        // Chrlit's own brand: pull its NEWEST posts (best quality) and more of them.
        const isOwn = c.slug === "chrlit"
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select("id, caption, hashtags, image_url, created_at")
            .eq("client_id", c.id)
            .not("image_url", "is", null)
            .order("created_at", { ascending: !isOwn })
            .limit(isOwn ? 24 : perBrand)

        // qa_status per post: "fallback" means the native Nano Banana render failed QA
        // and dropped to the legacy Satori overlay. We keep these in the gallery but never
        // let them lead — the hero showcase should always be a clean native render.
        const ids = (posts || []).map(p => p.id).filter(Boolean)
        const qaByPost: Record<string, string> = {}
        if (ids.length) {
            const { data: logs } = await supabaseAdmin
                .from("ig_generation_log")
                .select("post_id, qa_status, created_at")
                .in("post_id", ids)
                .order("created_at", { ascending: true })
            for (const l of logs || []) if (l.post_id) qaByPost[l.post_id] = (l.qa_status as string) ?? qaByPost[l.post_id]
        }

        // image_url may be a single URL, a pipe-joined carousel ("slide0|slide1|…"),
        // or a reel ("undefined|cover"). The marketing site shows one image per post,
        // so take the first real slide and drop anything without a usable image.
        const firstImage = (raw: unknown): string => {
            const parts = String(raw ?? "").split("|").map(s => s.trim()).filter(s => s && s !== "undefined")
            return parts[0] || ""
        }

        const isReel = (raw: unknown): boolean => {
            const s = String(raw ?? "")
            return s.includes("/ig-reels/") || s.trim().startsWith("undefined|")
        }

        // Ranking: clean feed posts first, overlay-fallback feed posts next, reels last —
        // so FEATURED_BRANDS[*].posts[0] (the hero) is always a square native render.
        const rank = (p: { _reel: boolean; _fallback: boolean }) => (p._reel ? 2 : 0) + (p._fallback ? 1 : 0)

        const mapped: ReferencePost[] = (posts || [])
            .map(p => ({
                imageUrl: firstImage(p.image_url),
                caption: (p.caption as string) || "",
                hashtags: Array.isArray(p.hashtags) ? (p.hashtags as string[]).join(" ") : (p.hashtags || ""),
                _reel: isReel(p.image_url),
                _fallback: qaByPost[p.id] === "fallback",
            }))
            .filter(p => p.imageUrl && !isExcluded(p.imageUrl))
            .sort((a, b) => rank(a) - rank(b))
            .map(({ _reel, _fallback, ...p }) => p)

        const industry: string = cfg.industry || ""
        brands.push({
            slug: c.slug,
            company: c.name,
            industry,
            emoji: emojiFor(industry, c.name),
            website: c.website || cfg.website || "",
            posts: mapped,
        })
        console.log(`   ${emojiFor(industry, c.name)} ${c.name}: ${mapped.length} posts`)
    }

    const header = `// AUTO-GENERATED by scripts/export-references.ts — do not edit by hand.
// Real posts generated by the Chrlit engine for fictional demo brands (isReference).
// Re-run the export after (re)generating posts.

export interface ReferencePost {
    imageUrl: string
    caption: string
    hashtags: string
}
export interface ReferenceBrand {
    slug: string
    company: string
    industry: string
    emoji: string
    website: string
    posts: ReferencePost[]
}

export const REFERENCE_BRANDS: ReferenceBrand[] = `

    const out = header + JSON.stringify(brands, null, 2) + "\n"
    const target = join(process.cwd(), "lib", "reference-data.ts")
    writeFileSync(target, out, "utf-8")

    const totalPosts = brands.reduce((n, b) => n + b.posts.length, 0)
    console.log(`\n✅ Wrote ${brands.length} brands / ${totalPosts} posts → lib/reference-data.ts`)
}

main().catch(err => {
    console.error("💥 Export failed:", err)
    process.exit(1)
})
