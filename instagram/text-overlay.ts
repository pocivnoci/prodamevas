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
    variant?: "default" | "cover" | "step"
    width?: number
    height?: number
    /** Gradient colors for brand overlay (default: dark neutral) */
    gradientColors?: { topColor: string; midColor: string; bottomColor: string }
    /** Logo watermark filename in fonts/ dir (default: none) */
    logoFile?: string
    /** Font family override — must match a loaded font name (default: "Inter") */
    fontFamily?: string
}

/**
 * Render text to a transparent PNG using Satori + resvg-js.
 * No Pango, no FontConfig, no system dependencies.
 */
async function renderText(
    text: string,
    fontSizePx: number,
    maxWidth: number,
    bold: boolean,
    opacity: number = 1,
    fontFamily: string = "Inter",
): Promise<Buffer> {
    const color = `rgba(255, 255, 255, ${opacity})`
    const fd = getFontData(fontFamily)

    // Satori renders a React-like element tree to SVG
    const svg = await satori(
        {
            type: "div",
            props: {
                children: text,
                style: {
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    textAlign: "center",
                    width: "100%",
                    color: color,
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

    console.log(`   🔤 Rendered text (${bold ? 'bold' : 'regular'}, ${fontSizePx}px): "${text.substring(0, 40)}..." → ${pngBuffer.length} bytes`)

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

    // Calculate sizes proportionally — cover variant gets larger text
    const padding = Math.round(width * 0.06)
    const textAreaWidth = width - padding * 2
    const headlineFontPx = Math.round(width * (variant === "cover" ? 0.058 : 0.050))
    const subtextFontPx = Math.round(width * 0.028)

    // ─── Layer 1: Resize original image ───
    const baseImage = await sharp(imageBuffer)
        .resize(width, height, { fit: "cover" })
        .ensureAlpha()
        .png()
        .toBuffer()

    try {
        // ─── Layer 2: Gradient overlay (SVG, no text) ───
        // Cover variant gets a stronger gradient for better text contrast
        const gradientOpacity = variant === "cover" ? 0.90 : 0.85
        const gradientSvg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style="stop-color:${gTop};stop-opacity:0.15"/>
                    <stop offset="50%" style="stop-color:${gMid};stop-opacity:0.3"/>
                    <stop offset="100%" style="stop-color:${gBot};stop-opacity:${gradientOpacity}"/>
                </linearGradient>
            </defs>
            <rect width="${width}" height="${height}" fill="url(#grad)"/>
        </svg>`

        const gradientBuffer = await sharp(Buffer.from(gradientSvg))
            .png()
            .toBuffer()

        // ─── Layer 3: Logo watermark (pre-rendered PNG) ───
        let logoBuffer: Buffer | null = null
        const logoWidth = Math.round(width * 0.30)
        const logoHeight = Math.round(logoWidth * 0.24)
        const logoMargin = Math.round(width * 0.04)

        if (logoFile) {
            try {
                const logoPngPath = join(fontsDir, logoFile)
                if (existsSync(logoPngPath)) {
                    logoBuffer = await sharp(readFileSync(logoPngPath))
                        .resize(logoWidth, logoHeight, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                        .png()
                        .toBuffer()
                    console.log("✓ Logo watermark loaded:", logoBuffer.length, "bytes")
                } else {
                    console.warn("⚠️ Logo PNG not found at", logoPngPath)
                }
            } catch (err) {
                console.warn('⚠️ Logo watermark error, skipping:', err)
            }
        }

        // ─── Layer 4: Slide indicator dots (if carousel) ───
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

        // ─── Layer 6: Headline text (Satori) ───
        const headlineImage = await renderText(headline, headlineFontPx, textAreaWidth, true, 1, options.fontFamily)
        const headlineMeta = await sharp(headlineImage).metadata()
        const headlineW = headlineMeta.width || textAreaWidth
        const headlineH = headlineMeta.height || 60

        // ─── Layer 7: Subtext (Satori) ───
        let subtextImage: Buffer | null = null
        let subtextW = 0
        let subtextH = 0
        if (subtext) {
            subtextImage = await renderText(subtext, subtextFontPx, textAreaWidth, false, 0.85, options.fontFamily)
            const subtextMeta = await sharp(subtextImage).metadata()
            subtextW = subtextMeta.width || textAreaWidth
            subtextH = subtextMeta.height || 30
        }

        // ─── Calculate vertical positions (from bottom up) ───
        const gap = Math.round(width * 0.02)
        const bottomPadding = Math.round(width * 0.08)

        let subtextY = 0
        let headlineY = 0

        if (subtextImage) {
            subtextY = height - bottomPadding - subtextH
            headlineY = subtextY - gap - headlineH
        } else {
            headlineY = height - bottomPadding - headlineH
        }

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

        // Slide indicator dots at top center
        if (slideIndicatorBuffer) {
            const indicatorMeta = await sharp(slideIndicatorBuffer).metadata()
            const indicatorW = indicatorMeta.width || 100
            composites.push({
                input: slideIndicatorBuffer,
                top: Math.round(width * 0.04),
                left: Math.round((width - indicatorW) / 2),
            })
        }

        // Step number watermark (large, faded, top-left area)
        if (stepNumberBuffer) {
            composites.push({
                input: stepNumberBuffer,
                top: Math.round(height * 0.12),
                left: Math.round(width * 0.06),
            })
        }

        composites.push({
            input: headlineImage,
            top: Math.max(0, headlineY),
            left: Math.max(0, Math.round((width - headlineW) / 2)),
        })

        if (subtextImage) {
            composites.push({
                input: subtextImage,
                top: Math.max(0, subtextY),
                left: Math.max(0, Math.round((width - subtextW) / 2)),
            })
        }

        const result = await sharp(baseImage)
            .composite(composites)
            .png({ quality: 95 })
            .toBuffer()

        return result
    } catch (err) {
        console.error("   ⚠️ Text overlay failed (Satori/Fonts error). Falling back to base image:", err)
        return Buffer.from(baseImage) // Return original raw image smoothly
    }
}
