/**
 * Blog content layer — reads in-repo Markdown articles at build time.
 * ===================================================================
 * Articles live as `content/blog/<slug>.md` with YAML frontmatter. Pages are
 * statically generated (generateStaticParams), so filesystem reads happen at
 * build, never per-request. `marked` renders Markdown → HTML server-side, which
 * keeps the output SEO-clean (real crawlable HTML, no client JS needed).
 */

import fs from "node:fs"
import path from "node:path"
import matter from "gray-matter"
import { marked } from "marked"

const BLOG_DIR = path.join(process.cwd(), "content", "blog")

export interface ArticleMeta {
    slug: string
    title: string
    description: string
    date: string // ISO "YYYY-MM-DD"
    keywords: string[]
    author: string
    ogImage?: string
    readingMinutes: number
}

export interface Article extends ArticleMeta {
    html: string
}

function readRaw(slug: string): { data: Record<string, unknown>; content: string } | null {
    const file = path.join(BLOG_DIR, `${slug}.md`)
    if (!fs.existsSync(file)) return null
    return matter(fs.readFileSync(file, "utf8"))
}

function toMeta(slug: string, data: Record<string, unknown>, content: string): ArticleMeta {
    const words = content.trim().split(/\s+/).length
    return {
        slug,
        title: String(data.title || slug),
        description: String(data.description || ""),
        date: String(data.date || ""),
        keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
        author: String(data.author || "Chrlit"),
        ogImage: data.ogImage ? String(data.ogImage) : undefined,
        readingMinutes: Math.max(1, Math.round(words / 200)), // ~200 wpm
    }
}

/** All article slugs (filenames without .md). */
export function getArticleSlugs(): string[] {
    if (!fs.existsSync(BLOG_DIR)) return []
    return fs.readdirSync(BLOG_DIR).filter(f => f.endsWith(".md")).map(f => f.replace(/\.md$/, ""))
}

/** Article metadata list, newest first — for the /blog index. */
export function getAllArticleMeta(): ArticleMeta[] {
    return getArticleSlugs()
        .map(slug => {
            const raw = readRaw(slug)
            return raw ? toMeta(slug, raw.data, raw.content) : null
        })
        .filter((a): a is ArticleMeta => a !== null)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
}

/** Full article (meta + rendered HTML) by slug, or null if missing. */
export function getArticle(slug: string): Article | null {
    const raw = readRaw(slug)
    if (!raw) return null
    const meta = toMeta(slug, raw.data, raw.content)
    return { ...meta, html: marked.parse(raw.content, { async: false }) as string }
}
