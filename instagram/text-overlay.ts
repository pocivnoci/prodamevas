/**
 * Image Text Overlay — Pure-JS Czech text on images
 * ==================================================
 * Uses Satori (by Vercel) + resvg-js for text rendering.
 * 
 * Why: Sharp Pango depends on FontConfig which fails on Vercel
 * serverless (no writable cache directories, no Czech glyphs).
 * Satori uses OpenType.js — pure JavaScript font parsing,
 * zero system dependencies, works everywhere.
 */

import sharp from "sharp"
import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { loadLogo } from "./logo-loader"

// ─── Font loading ────────────────────────────────────────────
// Load font files as Buffers — Satori handles parsing in pure JS

function resolveFontsDir(): string {
    const candidates = [
        join(__dirname, "fonts"),
        join(process.cwd(), "instagram", "fonts"),
        "/var/task/instagram/fonts",
    ]

    for (const dir of candidates) {
        if (existsSync(join(dir, "Inter-Bold.ttf"))) {
            console.log("✓ Fonts found:", dir)
            return dir
        }
    }

    console.error("⚠️ Fonts NOT found in any location:")
    candidates.forEach(d => console.error(`   ✗ ${d}`))
    return candidates[0]
}

const fontsDir = resolveFontsDir()

// ─── Assets directory (logos, watermarks) ────────────────────
const assetsDir = join(fontsDir, "..", "assets")

// ─── Font Registry ──────────────────────────────────────────
// Load all available fonts at startup — Satori needs raw ArrayBuffer data

const fontRegistry: Record<string, { bold: Buffer; regular: Buffer }> = {}

function loadFont(name: string, boldFile: string, regularFile: string) {
    try {
        fontRegistry[name] = {
            bold: readFileSync(join(fontsDir, boldFile)),
            regular: readFileSync(join(fontsDir, regularFile)),
        }
        console.log(`✓ Font "${name}" loaded`)
    } catch (e) {
        console.warn(`⚠️ Font "${name}" not found (${boldFile}), skipping`)
    }
}

loadFont("Inter", "Inter-Bold.ttf", "Inter-Regular.ttf")
loadFont("BebasNeue", "BebasNeue-Bold.ttf", "BebasNeue-Regular.ttf")

function getFontData(fontFamily: string) {
    const font = fontRegistry[fontFamily] || fontRegistry["Inter"]
    return {
        bold: font.bold,
        regular: font.regular,
        name: fontFamily in fontRegistry ? fontFamily : "Inter",
    }
}

interface TextOverlayOptions {
    headline: string
    subtext?: string
    slideInfo?: { current: number; total: number }
    variant?: "default" | "cover" | "step" | "centered" | "top" | "split" | "full-typo" | "editorial"
    /** Text alignment override (default: "center") */
    textAlign?: "left" | "center" | "right"
    width?: number
    height?: number
    /** Gradient colors for brand overlay (default: dark neutral) */
    gradientColors?: { topColor: string; midColor: string; bottomColor: string }
    /** Logo watermark filename in assets/ dir (default: none) */
    logoFile?: string
    /** Font family override — must match a loaded font name (default: "Inter") */
    fontFamily?: string
    /** Primary brand accent color (hex) for keyword highlighting */
    accentColor?: string
    /** Words/phrases to highlight with accent color (must be exact substrings of headline) */
    accentWords?: string[]
    /** Headline size multiplier (default: 1.0). BebasNeue auto-scales to 1.25 if not set. */
    headlineScale?: number
}

// ─── Layout Engine ──────────────────────────────────────────

interface LayoutPositions {
    headlineY: number
    subtextY: number
    headlineAlign: "left" | "center" | "right"
    /** Gradient direction: controls where the darkening is strongest */
    gradientMode: "bottom" | "top" | "full"
    /** Font scale multiplier applied on top of base size */
    fontScale: number
}

function calculateLayout(
    variant: string,
    width: number,
    height: number,
    headlineH: number,
    subtextH: number,
    opts: TextOverlayOptions
): LayoutPositions {
    const padding = Math.round(width * 0.06)
    const gap = Math.round(width * 0.02)
    const bottomPadding = Math.round(width * 0.08)
    const align = opts.textAlign || "center"
    const userScale = opts.headlineScale || 1.0

    switch (variant) {
        case "centered": {
            const totalH = headlineH + (subtextH ? gap + subtextH : 0)
            return {
                headlineY: Math.round((height - totalH) / 2),
                subtextY: Math.round((height - totalH) / 2 + headlineH + gap),
                headlineAlign: align,
                gradientMode: "full",
                fontScale: userScale * 1.1,
            }
        }
        case "top": {
            const topPad = Math.round(height * 0.12)
            return {
                headlineY: topPad,
                subtextY: topPad + headlineH + gap,
                headlineAlign: align,
                gradientMode: "top",
                fontScale: userScale,
            }
        }
        case "split": {
            return {
                headlineY: Math.round(height * 0.40 - headlineH / 2),
                subtextY: height - bottomPadding - subtextH,
                headlineAlign: align,
                gradientMode: "full",
                fontScale: userScale * 1.05,
            }
        }
        case "full-typo": {
            return {
                headlineY: Math.round((height - headlineH) / 2 - (subtextH ? subtextH / 2 + gap : 0)),
                subtextY: Math.round((height + headlineH) / 2 + gap),
                headlineAlign: align,
                gradientMode: "full",
                fontScale: userScale * 1.5,
            }
        }
        case "editorial": {
            return {
                headlineY: Math.round(height * 0.25),
                subtextY: Math.round(height * 0.25 + headlineH + gap * 2),
                headlineAlign: align,
                gradientMode: "full",
                fontScale: userScale * 1.3,
            }
        }
        default: {
            // "default", "cover", "step" — existing bottom-anchor behavior
            const coverBoost = variant === "cover" ? 1.16 : 1.0
            let hY: number, sY: number
            if (subtextH) {
                sY = height - bottomPadding - subtextH
                hY = sY - gap - headlineH
            } else {
                hY = height - bottomPadding - headlineH
                sY = 0
            }
            return {
                headlineY: hY,
                subtextY: sY,
                headlineAlign: align,
                gradientMode: "bottom",
                fontScale: userScale * coverBoost,
            }
        }
    }
}

/**
 * Split text into segments by accent words (case-insensitive, diacritics-aware).
 * Returns array of { text, accent } segments preserving original casing.
 */
function splitByAccent(text: string, accentWords: string[]): { text: string; accent: boolean }[] {
    if (!accentWords || accentWords.length === 0) return [{ text, accent: false }]

    // Build regex from accent words, escape special chars, case insensitive
    const escaped = accentWords
        .filter(w => w.length > 0)
        .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    if (escaped.length === 0) return [{ text, accent: false }]

    // Sort by length descending so longer phrases match first
    escaped.sort((a, b) => b.length - a.length)
    const regex = new RegExp(`(${escaped.join("|")})`, "gi")

    const segments: { text: string; accent: boolean }[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ text: text.slice(lastIndex, match.index), accent: false })
        }
        segments.push({ text: match[0], accent: true })
        lastIndex = match.index + match[0].length
    }

    if (lastIndex < text.length) {
        segments.push({ text: text.slice(lastIndex), accent: false })
    }

    return segments.length > 0 ? segments : [{ text, accent: false }]
}

/**
 * Render text to a transparent PNG using Satori + resvg-js.
 * Supports accent-colored keywords via accentWords/accentColor.
 * No Pango, no FontConfig, no system dependencies.
 */
async function renderText(
    text: string,
    fontSizePx: number,
    maxWidth: number,
    bold: boolean,
    opacity: number = 1,
    fontFamily: string = "Inter",
    accentWords?: string[],
    accentColor?: string,
    textAlign: "left" | "center" | "right" = "center",
): Promise<Buffer> {
    const baseColor = `rgba(255, 255, 255, ${opacity})`
    const fd = getFontData(fontFamily)

    // Tokenize text to keep words and their punctuation together in flex items
    let markedText = text
    if (accentWords && accentWords.length > 0 && accentColor && bold) {
        const escaped = accentWords
            .filter(w => w.length > 0)
            .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .sort((a, b) => b.length - a.length)
        if (escaped.length > 0) {
            const regex = new RegExp(`(${escaped.join("|")})`, "gi")
            markedText = text.replace(regex, "\x01$1\x02")
        }
    }

    const tokens = markedText.split(/(\s+)/)
    let isAccent = false
    const children = []

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (!token) continue

        if (/^\s+$/.test(token)) {
            if (token.includes("\n")) {
                children.push({
                    type: "div",
                    props: { style: { width: "100%", height: 0 } }
                })
            } else {
                children.push({
                    type: "div",
                    props: {
                        style: { display: "flex", flexDirection: "row", flexShrink: 0 },
                        children: token.replace(/ /g, "\u00A0"),
                    }
                })
            }
            continue
        }

        const wordSpans = []
        let currentText = ""

        for (let j = 0; j < token.length; j++) {
            const char = token[j]
            if (char === "\x01") {
                if (currentText) wordSpans.push({ text: currentText, accent: isAccent })
                currentText = ""
                isAccent = true
            } else if (char === "\x02") {
                if (currentText) wordSpans.push({ text: currentText, accent: isAccent })
                currentText = ""
                isAccent = false
            } else {
                currentText += char
            }
        }
        if (currentText) wordSpans.push({ text: currentText, accent: isAccent })

        children.push({
            type: "div",
            props: {
                style: { display: "flex", flexDirection: "row", flexShrink: 0 },
                children: wordSpans.map((ws, idx) => ({
                    type: "span",
                    props: {
                        key: `${i}-${idx}`,
                        style: { color: ws.accent ? accentColor : baseColor },
                        children: ws.text,
                    }
                }))
            }
        })
    }

    // Satori renders a React-like element tree to SVG
    // NOTE: Satori only supports flexbox layout, NOT block/inline
    const svg = await satori(
        {
            type: "div",
            props: {
                children,
                style: {
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: textAlign === "left" ? "flex-start" : textAlign === "right" ? "flex-end" : "center",
                    textAlign: textAlign,
                    width: "100%",
                    color: baseColor,
                    fontSize: fontSizePx,
                    fontWeight: bold ? 700 : 400,
                    fontFamily: fd.name,
                    lineHeight: 1.2,
                    letterSpacing: fd.name === "BebasNeue" ? "0.05em" : "0",
                    textTransform: fd.name === "BebasNeue" ? "uppercase" : "none",
                    padding: "0",
                },
            },
        } as any,
        {
            width: maxWidth,
            fonts: [
                {
                    name: fd.name,
                    data: fd.bold.buffer.slice(
                        fd.bold.byteOffset,
                        fd.bold.byteOffset + fd.bold.byteLength
                    ) as ArrayBuffer,
                    weight: 700,
                    style: "normal" as const,
                },
                {
                    name: fd.name,
                    data: fd.regular.buffer.slice(
                        fd.regular.byteOffset,
                        fd.regular.byteOffset + fd.regular.byteLength
                    ) as ArrayBuffer,
                    weight: 400,
                    style: "normal" as const,
                },
            ],
        }
    )

    // Convert SVG to PNG via resvg-js (Rust-based, no system deps)
    const resvg = new Resvg(svg, {
        fitTo: { mode: "width" as const, value: maxWidth },
        background: "rgba(0, 0, 0, 0)",
    })
    const pngData = resvg.render()
    const pngBuffer = pngData.asPng()

    const accentInfo = accentWords?.length ? ` [accent: ${accentWords.join(", ")}]` : ""
    console.log(`   🔤 Rendered text (${bold ? 'bold' : 'regular'}, ${fontSizePx}px${accentInfo}): "${text.substring(0, 40)}..." → ${pngBuffer.length} bytes`)

    return Buffer.from(pngBuffer)
}

/**
 * Overlay text on an image buffer.
 * 
 * Layers (bottom to top):
 * 1. Original image (resized)
 * 2. Gradient overlay
 * 3. Logo watermark
 * 4. Slide indicator dots (if carousel)
 * 5. Step number (if step variant)
 * 6. Headline text (Satori)
 * 7. Subtext (Satori)
 */
export async function overlayText(
    imageBuffer: Buffer,
    options: TextOverlayOptions
): Promise<Buffer> {
    const { headline, subtext, slideInfo, variant = "default", gradientColors, logoFile } = options

    // Gradient colors — from config or neutral fallback
    const gTop = gradientColors?.topColor || "#111111"
    const gMid = gradientColors?.midColor || "#111111"
    const gBot = gradientColors?.bottomColor || "#111111"

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata()
    const width = options.width || metadata.width || 1080
    const height = options.height || metadata.height || 1080

    // Calculate sizes proportionally
    const padding = Math.round(width * 0.06)
    const textAreaWidth = width - padding * 2
    const fontName = options.fontFamily || "Inter"
    const autoScale = fontName === "BebasNeue" ? 1.25 : 1.0
    const baseScale = options.headlineScale || autoScale
    const subtextFontPx = Math.round(width * 0.028)

    // ─── Layer 1: Base image ───
    // full-typo: solid gradient background, no image
    let baseImage: Buffer
    if (variant === "full-typo") {
        baseImage = await sharp({
            create: { width, height, channels: 4, background: { r: 5, g: 5, b: 5, alpha: 255 } }
        }).png().toBuffer()
    } else {
        baseImage = await sharp(imageBuffer)
            .resize(width, height, { fit: "cover" })
            .ensureAlpha()
            .png()
            .toBuffer()
    }

    try {
        // We need preliminary text render to get dimensions for layout calculation
        // Use a temporary font size — will re-render with correct scale after layout
        const prelimFontPx = Math.round(width * 0.050 * baseScale)
        const prelimHeadline = await renderText(
            headline, prelimFontPx, textAreaWidth, true, 1,
            options.fontFamily, options.accentWords, options.accentColor,
            options.textAlign || "center"
        )
        const prelimMeta = await sharp(prelimHeadline).metadata()
        const prelimHeadlineH = prelimMeta.height || 60

        let prelimSubtextH = 0
        if (subtext) {
            const prelimSubtext = await renderText(subtext, subtextFontPx, textAreaWidth, false, 0.85, options.fontFamily,
                undefined, undefined, options.textAlign || "center")
            const sMeta = await sharp(prelimSubtext).metadata()
            prelimSubtextH = sMeta.height || 30
        }

        // ─── Calculate layout ───
        const layout = calculateLayout(variant, width, height, prelimHeadlineH, prelimSubtextH, options)

        // Apply layout font scale for final render
        const headlineFontPx = Math.round(width * 0.050 * layout.fontScale)

        // ─── Layer 2: Gradient overlay ───
        const gradientBuffer = await renderGradient(width, height, gTop, gMid, gBot, layout.gradientMode, variant)

        // ─── Layer 3: Logo watermark ───
        let logoBuffer: Buffer | null = null
        const logoWidth = Math.round(width * 0.40)
        const logoHeight = Math.round(logoWidth * 0.35)
        const logoMargin = Math.round(width * 0.025)

        if (logoFile) {
            const rawLogo = await loadLogo(logoFile)
            if (rawLogo) {
                logoBuffer = await sharp(rawLogo)
                    .resize(logoWidth, logoHeight, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .png()
                    .toBuffer()
            }
        }

        // ─── Layer 4: Slide indicator dots ───
        let slideIndicatorBuffer: Buffer | null = null
        if (slideInfo && slideInfo.total > 1) {
            const dotSize = Math.round(width * 0.012)
            const dotGap = Math.round(width * 0.008)
            const totalDotsWidth = slideInfo.total * dotSize + (slideInfo.total - 1) * dotGap
            const indicatorWidth = totalDotsWidth + dotSize * 4

            const dots = Array.from({ length: slideInfo.total }, (_, i) => {
                const cx = dotSize * 2 + i * (dotSize + dotGap) + dotSize / 2
                const cy = dotSize + 2
                const isCurrent = i === slideInfo.current - 1
                return `<circle cx="${cx}" cy="${cy}" r="${dotSize / 2}" fill="white" opacity="${isCurrent ? '1' : '0.4'}"/>`
            }).join("")

            const indicatorSvg = `<svg width="${indicatorWidth}" height="${dotSize * 2 + 4}" xmlns="http://www.w3.org/2000/svg">${dots}</svg>`
            slideIndicatorBuffer = await sharp(Buffer.from(indicatorSvg)).png().toBuffer()
        }

        // ─── Layer 5: Step number (if step variant) ───
        let stepNumberBuffer: Buffer | null = null
        if (variant === "step" && slideInfo && slideInfo.current > 1) {
            const stepNum = String(slideInfo.current - 1).padStart(2, "0")
            const stepFontPx = Math.round(width * 0.14)
            stepNumberBuffer = await renderText(stepNum, stepFontPx, Math.round(width * 0.35), true, 0.12, options.fontFamily)
        }

        // ─── Layer 6: Headline text (final render with correct scale) ───
        const headlineImage = await renderText(
            headline, headlineFontPx, textAreaWidth, true, 1,
            options.fontFamily, options.accentWords, options.accentColor,
            layout.headlineAlign
        )
        const headlineMeta = await sharp(headlineImage).metadata()
        const headlineW = headlineMeta.width || textAreaWidth

        // ─── Layer 7: Subtext ───
        let subtextImage: Buffer | null = null
        let subtextW = 0
        if (subtext) {
            subtextImage = await renderText(subtext, subtextFontPx, textAreaWidth, false, 0.85, options.fontFamily,
                undefined, undefined, layout.headlineAlign)
            const subtextMeta = await sharp(subtextImage).metadata()
            subtextW = subtextMeta.width || textAreaWidth
        }

        // ─── Compute horizontal positions based on alignment ───
        const headlineLeft = layout.headlineAlign === "left"
            ? padding
            : layout.headlineAlign === "right"
                ? width - padding - headlineW
                : Math.round((width - headlineW) / 2)

        const subtextLeft = subtextImage
            ? (layout.headlineAlign === "left"
                ? padding
                : layout.headlineAlign === "right"
                    ? width - padding - subtextW
                    : Math.round((width - subtextW) / 2))
            : 0

        // ─── Composite all layers ───
        const composites: sharp.OverlayOptions[] = [
            { input: gradientBuffer, top: 0, left: 0 },
        ]

        if (logoBuffer) {
            composites.push({
                input: logoBuffer,
                top: logoMargin,
                left: width - logoWidth - logoMargin,
            })
        }

        if (slideIndicatorBuffer) {
            const indicatorMeta = await sharp(slideIndicatorBuffer).metadata()
            const indicatorW = indicatorMeta.width || 100
            composites.push({
                input: slideIndicatorBuffer,
                top: Math.round(width * 0.04),
                left: Math.round((width - indicatorW) / 2),
            })
        }

        if (stepNumberBuffer) {
            composites.push({
                input: stepNumberBuffer,
                top: Math.round(height * 0.12),
                left: Math.round(width * 0.06),
            })
        }

        composites.push({
            input: headlineImage,
            top: Math.max(0, layout.headlineY),
            left: Math.max(0, headlineLeft),
        })

        if (subtextImage) {
            composites.push({
                input: subtextImage,
                top: Math.max(0, layout.subtextY),
                left: Math.max(0, subtextLeft),
            })
        }

        const result = await sharp(baseImage)
            .composite(composites)
            .png({ quality: 95 })
            .toBuffer()

        return result
    } catch (err) {
        console.error("   ⚠️ Text overlay failed (Satori/Fonts error). Falling back to base image:", err)
        return Buffer.from(baseImage)
    }
}

// ─── Gradient Rendering ────────────────────────────────────

function renderGradient(
    width: number,
    height: number,
    gTop: string,
    gMid: string,
    gBot: string,
    mode: "bottom" | "top" | "full",
    variant: string,
): Promise<Buffer> {
    let gradientSvg: string

    if (mode === "full") {
        // Full overlay — even darkening across entire image (for centered/editorial/full-typo)
        const opacity = variant === "full-typo" ? 1.0 : 0.75
        gradientSvg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style="stop-color:${gTop};stop-opacity:${opacity}"/>
                    <stop offset="50%" style="stop-color:${gMid};stop-opacity:${opacity}"/>
                    <stop offset="100%" style="stop-color:${gBot};stop-opacity:${opacity}"/>
                </linearGradient>
            </defs>
            <rect width="${width}" height="${height}" fill="url(#grad)"/>
        </svg>`
    } else if (mode === "top") {
        // Top-heavy gradient — for "top" variant where text is at the top
        gradientSvg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style="stop-color:${gTop};stop-opacity:0.90"/>
                    <stop offset="50%" style="stop-color:${gMid};stop-opacity:0.3"/>
                    <stop offset="100%" style="stop-color:${gBot};stop-opacity:0.15"/>
                </linearGradient>
                <linearGradient id="darken" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style="stop-color:#000000;stop-opacity:0.8"/>
                    <stop offset="60%" style="stop-color:#000000;stop-opacity:0"/>
                </linearGradient>
            </defs>
            <rect width="${width}" height="${height}" fill="url(#grad)"/>
            <rect width="${width}" height="${height}" fill="url(#darken)"/>
        </svg>`
    } else {
        // Bottom-heavy (default) — existing behavior
        const gradientOpacity = variant === "cover" ? 0.90 : 0.85
        gradientSvg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style="stop-color:${gTop};stop-opacity:0.15"/>
                    <stop offset="50%" style="stop-color:${gMid};stop-opacity:0.3"/>
                    <stop offset="100%" style="stop-color:${gBot};stop-opacity:${gradientOpacity}"/>
                </linearGradient>
                <linearGradient id="darken" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="40%" style="stop-color:#000000;stop-opacity:0"/>
                    <stop offset="100%" style="stop-color:#000000;stop-opacity:0.8"/>
                </linearGradient>
            </defs>
            <rect width="${width}" height="${height}" fill="url(#grad)"/>
            <rect width="${width}" height="${height}" fill="url(#darken)"/>
        </svg>`
    }

    return sharp(Buffer.from(gradientSvg)).png().toBuffer()
}
