/**
 * Export portfolia → lib/portfolio-data.ts
 *
 *   npx tsx scripts/export-portfolio.ts
 *
 * Sourozenec `export-references.ts`, ale se dvěma zásadními rozdíly:
 *
 *  1. Bere klienty s `config.isPortfolio` — SKUTEČNÉ známé značky, které o tom
 *     nevědí a nejsou zákazníky. `isReference` (fiktivní demo značky) se sem
 *     nesmí připlést a naopak; proto dva příznaky a dva exporty.
 *  2. Vytahuje post CELÝ. Marketingová zeď ukazuje jeden čtverec na post, takže
 *     jí stačí první snímek; portfolio je podstránka, kde si člověk příspěvek
 *     rozklikne — potřebuje tedy všechny slidy karuselu, video i obálku reelu,
 *     text rozdělený na hook a body, výzvu k akci i hashtagy.
 *
 * Spouštěj po každém (pře)generování portfolia.
 */

import { writeFileSync } from "fs"
import { join } from "path"
import supabaseAdmin from "../supabase/admin"

type MediaType = "post" | "carousel" | "reel"

interface PortfolioPost {
    id: string
    mediaType: MediaType
    /** Snímky k zobrazení: slidy karuselu, jeden obrázek, nebo obálka reelu. */
    images: string[]
    /** Jen u reelu — samotné video. */
    videoUrl?: string
    hook: string
    body: string
    cta: string
    hashtags: string[]
    pillar?: string
}

interface PortfolioBrand {
    slug: string
    company: string
    industry: string
    website: string
    posts: PortfolioPost[]
}

const DISCLAIMER =
    "Nevyžádané koncepty. Příspěvky vygeneroval Chrlit z veřejně dostupných údajů o značce. " +
    "Nejde o oficiální obsah těchto značek a uvedené firmy nejsou zákazníky Chrlitu."

/**
 * `image_url` je jeden řetězec s částmi oddělenými `|`. Podoby, které tam žijí:
 *   jeden obrázek        → "…/1234.webp"
 *   karusel              → "…/slide0.webp|…/slide1.webp|…"
 *   reel                 → "…/1234.mp4|…/1234-cover.webp"   (občas "undefined|…")
 */
function parseMedia(raw: unknown, mediaTypeCol: string | null): { mediaType: MediaType; images: string[]; videoUrl?: string } {
    const parts = String(raw ?? "").split("|").map(s => s.trim()).filter(s => s && s !== "undefined")
    const video = parts.find(p => /\.(mp4|mov|webm)$/i.test(p))
    const images = parts.filter(p => /\.(webp|jpe?g|png)$/i.test(p))

    if (video) return { mediaType: "reel", images, videoUrl: video }
    if (mediaTypeCol === "carousel" || images.length > 1) return { mediaType: "carousel", images }
    return { mediaType: "post", images }
}

/**
 * Rozloží uložený caption zpátky na části.
 *
 * `caption-generator.ts` ho skládá jako `[hook, body, cta, hashtags].join("\n\n")`,
 * takže v DB je CELÝ text — včetně výzvy a hashtagů. Kdyby se sem vzalo naivně
 * „všechno za prvním odstavcem", stránka by výzvu i hashtagy vypsala DVAKRÁT:
 * jednou schované v textu a podruhé jako vlastní bloky.
 *
 * Rozebírá se proto odzadu: nejdřív padne blok se samými hashtagy, pak blok
 * shodný s CTA. Body může mít vlastní prázdné řádky, takže dělení na odstavce
 * nestačí — musí se poznávat obsah, ne pozice.
 */
function splitCaption(caption: string, cta: string): { hook: string; body: string } {
    const blocks = String(caption ?? "").split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
    if (blocks.length === 0) return { hook: "", body: "" }

    const hook = blocks[0]
    const rest = blocks.slice(1)

    const isHashtagBlock = (b: string) => b.length > 0 && b.split(/\s+/).every(w => w.startsWith("#"))
    if (rest.length > 0 && isHashtagBlock(rest[rest.length - 1])) rest.pop()

    const norm = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase()
    if (rest.length > 0 && cta && norm(rest[rest.length - 1]) === norm(cta)) rest.pop()

    return { hook, body: rest.join("\n\n") }
}

async function main() {
    console.log("📦 Exportuji portfolio…")

    const { data: clients, error } = await supabaseAdmin
        .from("clients")
        .select("id, slug, name, website, config")

    if (error || !clients) {
        console.error("❌ Klienti se nenačetli:", error?.message)
        process.exit(1)
    }

    const portfolioClients = clients.filter(c => (c.config as any)?.isPortfolio === true)
    if (portfolioClients.length === 0) {
        console.warn("⚠️ Žádný klient nemá isPortfolio. Spusť scripts/seed-portfolio-clients.ts.")
    }

    const brands: PortfolioBrand[] = []

    for (const c of portfolioClients) {
        const cfg = (c.config as any) || {}
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select("id, caption, call_to_action, hashtags, image_url, media_type, content_pillar, created_at")
            .eq("client_id", c.id)
            .is("revision_of", null)
            .not("image_url", "is", null)
            .order("created_at", { ascending: true })

        const mapped: PortfolioPost[] = (posts || [])
            .map(p => {
                const media = parseMedia(p.image_url, p.media_type as string | null)
                const cta = (p.call_to_action as string) || ""
                const { hook, body } = splitCaption(p.caption as string, cta)
                return {
                    id: p.id as string,
                    mediaType: media.mediaType,
                    images: media.images,
                    ...(media.videoUrl ? { videoUrl: media.videoUrl } : {}),
                    hook,
                    body,
                    cta,
                    hashtags: Array.isArray(p.hashtags) ? (p.hashtags as string[]) : [],
                    ...(p.content_pillar ? { pillar: p.content_pillar as string } : {}),
                }
            })
            // Reel se dá přehrát i bez obálky, takže stačí video. Vypadává jen to,
            // z čeho nezbylo vůbec nic — tedy záznam po selhaném renderu.
            .filter(p => p.images.length > 0 || !!p.videoUrl)

        brands.push({
            slug: c.slug,
            company: c.name,
            industry: cfg.industry || "",
            website: c.website || cfg.website || "",
            posts: mapped,
        })
        console.log(`   ${c.name}: ${mapped.length} příspěvků`)
    }

    const header = `// AUTO-GENERATED by scripts/export-portfolio.ts — neupravuj ručně.
//
// Příspěvky, které engine vyrobil pro SKUTEČNÉ veřejně známé značky. Ty firmy
// o tom nevědí a nejsou zákazníky — kdekoli se tahle data vykreslují, MUSÍ být
// vidět PORTFOLIO_DISCLAIMER. Bez něj stránka tvrdí obchodní vztah, který
// neexistuje.
//
// Fiktivní demo značky jsou jinde: lib/reference-data.ts (isReference).

export type PortfolioMediaType = "post" | "carousel" | "reel"

export interface PortfolioPost {
    id: string
    mediaType: PortfolioMediaType
    /** Slidy karuselu, jeden obrázek, nebo obálka reelu. */
    images: string[]
    /** Jen u reelu. */
    videoUrl?: string
    hook: string
    body: string
    cta: string
    hashtags: string[]
    pillar?: string
}

export interface PortfolioBrand {
    slug: string
    company: string
    industry: string
    website: string
    posts: PortfolioPost[]
}

export const PORTFOLIO_DISCLAIMER = ${JSON.stringify(DISCLAIMER)}

export const PORTFOLIO_BRANDS: PortfolioBrand[] = `

    const out = header + JSON.stringify(brands, null, 2) + "\n"
    writeFileSync(join(process.cwd(), "lib", "portfolio-data.ts"), out, "utf-8")

    const total = brands.reduce((n, b) => n + b.posts.length, 0)
    console.log(`\n✅ Zapsáno ${brands.length} značek / ${total} příspěvků → lib/portfolio-data.ts`)
}

main().catch(err => {
    console.error("💥 Export selhal:", err)
    process.exit(1)
})
