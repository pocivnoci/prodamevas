/**
 * Logo Loader — shared utility for loading client logos
 * =====================================================
 * Tries local filesystem first (dev / bundled assets),
 * then falls back to Supabase storage (production / onboarding uploads).
 */

import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import supabaseAdmin from "@/supabase/admin"

const assetsDir = join(process.cwd(), "instagram", "assets")

/**
 * Load a client logo as a raw Buffer.
 * @param logoFile — filename like "logo-prodamevas.png"
 * @returns Buffer or null if not found anywhere
 */
export async function loadLogo(logoFile: string): Promise<Buffer | null> {
    if (!logoFile) return null

    // 1) Local filesystem (dev / bundled in repo)
    const localPath = join(assetsDir, logoFile)
    if (existsSync(localPath)) {
        try {
            const buf = await readFile(localPath)
            console.log(`✓ Logo loaded from filesystem: ${logoFile} (${(buf.length / 1024).toFixed(0)} KB)`)
            return buf
        } catch { /* fall through */ }
    }

    // 2) Supabase storage fallback (production uploads from onboarding)
    try {
        const slug = logoFile.replace(/^logo-/, "").replace(/\\.png$/i, "")
        const storagePath = `client-assets/${slug}/logo.png`
        const { data, error } = await supabaseAdmin.storage
            .from("audit-screenshots")
            .download(storagePath)

        if (data && !error) {
            const buf = Buffer.from(await data.arrayBuffer())
            console.log(`✓ Logo loaded from Supabase storage: ${storagePath} (${(buf.length / 1024).toFixed(0)} KB)`)
            return buf
        }
    } catch { /* fall through */ }

    console.warn(`⚠️ Logo not found: ${logoFile} (checked filesystem + Supabase storage)`)
    return null
}
