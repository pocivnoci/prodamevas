/**
 * Referenční obrázky pro Seedance — minimální rozměry.
 * ====================================================
 * Seedance 2.5 odmítá referenci pod 300 px na kratší straně nebo pod 90 000 px celkem —
 * rovnou HTTP 400 při zadání, bez úlohy. Živý test 11. 9. 2026 na tom shodil obě velikosti
 * reelu: logo značky mělo 192×192. Malou referenci proto zvětšíme, místo abychom ji
 * zahodili — logo je to nejdůležitější, co model o značce vidí.
 *
 * Čisté funkce nad sharp (bez sítě), drží je `scripts/test-reel-pipeline.ts`.
 */
import sharp from "sharp"

export const SEEDANCE_MIN_REFERENCE_SIDE = 300
export const SEEDANCE_MIN_REFERENCE_PIXELS = 90_000
/** Cíl kratší strany — s rezervou nad minimem. */
const TARGET_SHORT_SIDE = 512
/** Strop delší strany, ať se z úzkého banneru nestane obří soubor. */
const MAX_LONG_SIDE = 2048

export function referenceTooSmall(width: number, height: number): boolean {
    return width < SEEDANCE_MIN_REFERENCE_SIDE || height < SEEDANCE_MIN_REFERENCE_SIDE || width * height < SEEDANCE_MIN_REFERENCE_PIXELS
}

/**
 * Zvětší obrázek tak, aby kratší strana měla 512 px (delší nejvýš 2048). Když ani to
 * nestačí (extrémně široké logo), doplní průhledný okraj do 300 px. Vrací PNG.
 */
export async function upscaleReference(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
    const meta = await sharp(input).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    if (!w || !h) throw new Error("upscaleReference: obrázek bez rozměrů")

    let factor = Math.max(1, TARGET_SHORT_SIDE / Math.min(w, h))
    if (Math.max(w, h) * factor > MAX_LONG_SIDE) factor = Math.max(1, MAX_LONG_SIDE / Math.max(w, h))
    const width = Math.round(w * factor)
    const height = Math.round(h * factor)
    let buffer = await sharp(input).resize(width, height, { kernel: "lanczos3" }).png().toBuffer()

    const padX = Math.max(0, SEEDANCE_MIN_REFERENCE_SIDE - width)
    const padY = Math.max(0, SEEDANCE_MIN_REFERENCE_SIDE - height)
    if (padX || padY) {
        buffer = await sharp(buffer).extend({
            top: Math.floor(padY / 2), bottom: Math.ceil(padY / 2),
            left: Math.floor(padX / 2), right: Math.ceil(padX / 2),
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        }).png().toBuffer()
    }
    return { buffer, width: width + padX, height: height + padY }
}
