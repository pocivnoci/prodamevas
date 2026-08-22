'use server'

import supabaseAdmin from '@/supabase/admin'
import { requireProjectAccess } from '@/lib/auth-guard'
import { getConfigBrandImages, isValidBrandTag, type BrandImage } from '@/instagram/configs/types'

/**
 * Upload a brand/reference image from the dashboard.
 * Saves to Supabase storage and adds URL to brandReferenceImages in client config.
 */
export async function uploadBrandImage(formData: FormData): Promise<{
    success: boolean
    imageUrl?: string
    error?: string
}> {
    try {
        const file = formData.get('file') as File
        if (!file) return { success: false, error: 'Nebyl vybrán žádný soubor' }

        const clientSlug = formData.get('clientSlug') as string
        if (!clientSlug) return { success: false, error: 'Chybí identifikace klienta' }

        await requireProjectAccess(clientSlug)

        const category = (formData.get('category') as string) || 'brand'

        // Validate file
        if (!file.type.startsWith('image/')) {
            return { success: false, error: 'Podporovány jsou pouze obrázky (JPG, PNG, WebP, HEIC z iPhonu).' }
        }
        if (file.size > 25_000_000) {
            return { success: false, error: 'Obrázek je příliš velký (max 25 MB).' }
        }

        // Normalize EVERY upload (PC or phone): auto-rotate from EXIF, downscale,
        // and re-encode to JPEG. Guarantees a browser-displayable, AI-taggable,
        // reference-usable image regardless of source format / orientation / size.
        const rawBuffer = Buffer.from(await file.arrayBuffer())
        let buffer: Buffer
        try {
            const sharp = (await import('sharp')).default
            buffer = await sharp(rawBuffer, { failOn: 'none' })
                .rotate() // apply EXIF orientation (phone photos are often rotated)
                .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer()
        } catch {
            // Unsupported codec — almost always a raw iPhone HEIC the browser
            // didn't auto-convert. sharp's prebuilt libvips can't decode HEVC.
            return { success: false, error: 'Tuhle fotku nejde zpracovat (nejspíš HEIC z iPhonu). Pošli ji jako JPG, nebo na iPhonu zapni Nastavení → Fotoaparát → Formáty → „Nejkompatibilnější".' }
        }

        const timestamp = Date.now()
        const filename = `client-assets/${clientSlug}/${category}-${timestamp}.jpg`

        // Upload to Supabase storage (always JPEG after normalization)
        const { error: uploadError } = await supabaseAdmin.storage
            .from('audit-screenshots')
            .upload(filename, buffer, {
                contentType: 'image/jpeg',
                cacheControl: '31536000',
                upsert: true,
            })

        if (uploadError) {
            console.error('Upload error:', uploadError)
            return { success: false, error: `Upload selhal: ${uploadError.message}` }
        }

        // Get public URL
        const { data: publicUrlData } = supabaseAdmin.storage
            .from('audit-screenshots')
            .getPublicUrl(filename)

        const imageUrl = publicUrlData.publicUrl

        // Tag the uploaded image with AI
        let brandImageObj: any = imageUrl  // fallback: just the URL string
        try {
            const { tagBrandImage } = await import('@/instagram/brand-tagger')
            const { tags, description } = await tagBrandImage(buffer, 'image/jpeg')
            if (tags.length > 0 || description) {
                brandImageObj = { url: imageUrl, tags, description }
            }
        } catch { /* tagging failed, save as plain URL */ }

        // Add to client config's brandReferenceImages
        const { data: client, error: fetchError } = await supabaseAdmin
            .from('clients')
            .select('config')
            .eq('slug', clientSlug)
            .single()

        if (fetchError || !client) {
            return { success: true, imageUrl } // Image uploaded but config not updated
        }

        const config = client.config as any
        const { getConfigBrandImageObjects } = await import('@/instagram/configs/types')
        const existingRefs = getConfigBrandImageObjects(config)
        const updatedRefs = [...existingRefs, brandImageObj]

        await supabaseAdmin
            .from('clients')
            .update({
                config: { ...config, brandReferenceImages: updatedRefs }
            })
            .eq('slug', clientSlug)

        return { success: true, imageUrl }
    } catch (error) {
        console.error('Upload error:', error)
        return { success: false, error: `Upload selhal: ${(error as Error).message}` }
    }
}

/**
 * Delete a brand/reference image from storage and config.
 */
export async function deleteBrandImage(
    clientSlug: string,
    imageUrl: string
): Promise<{ success: boolean; error?: string }> {
    try {
        await requireProjectAccess(clientSlug)

        // Remove from config
        const { data: client } = await supabaseAdmin
            .from('clients')
            .select('config')
            .eq('slug', clientSlug)
            .single()

        if (client) {
            const config = client.config as any
            const { getConfigBrandImageObjects } = await import('@/instagram/configs/types')
            const existingRefs = getConfigBrandImageObjects(config)
            const updatedRefs = existingRefs.filter(img => img.url !== imageUrl)

            await supabaseAdmin
                .from('clients')
                .update({
                    config: { ...config, brandReferenceImages: updatedRefs }
                })
                .eq('slug', clientSlug)
        }

        // Try to delete from storage
        try {
            const urlPath = new URL(imageUrl).pathname
            const storagePath = urlPath.split('/object/public/audit-screenshots/')[1]
            if (storagePath) {
                await supabaseAdmin.storage
                    .from('audit-screenshots')
                    .remove([storagePath])
            }
        } catch {
            // Storage delete may fail, but config is already updated
        }

        return { success: true }
    } catch (error) {
        return { success: false, error: `Smazání selhalo: ${(error as Error).message}` }
    }
}

/**
 * Get all brand images for a client.
 */
export async function getBrandImages(clientSlug: string): Promise<string[]> {
    try {
        await requireProjectAccess(clientSlug)

        const { data: client } = await supabaseAdmin
            .from('clients')
            .select('config')
            .eq('slug', clientSlug)
            .single()

        if (!client) return []
        const config = client.config as any
        // Primary: brandReferenceImages, fallback: characterReferenceImages
        return getConfigBrandImages(config)
    } catch {
        return []
    }
}

/**
 * Get brand images as full objects (url + AI tags + description) for the UI,
 * so the dashboard can show how each photo was auto-labelled.
 */
export async function getBrandImageObjects(clientSlug: string): Promise<BrandImage[]> {
    try {
        await requireProjectAccess(clientSlug)
        const { data: client } = await supabaseAdmin
            .from('clients').select('config').eq('slug', clientSlug).single()
        if (!client) return []
        const { getConfigBrandImageObjects } = await import('@/instagram/configs/types')
        return getConfigBrandImageObjects(client.config as any)
    } catch {
        return []
    }
}

/**
 * Přepiš štítky jedné fotky ručně.
 *
 * Štítky nejsou popisky do galerie — rozhodují, kdy se fotka k příspěvku vůbec
 * přiloží (skórování v reel-orchestratoru) a jaká pravidla věrnosti dostane art
 * director. Vision model přitom nepozná, že zrovna tenhle portrét je tvář značky;
 * ochotně ho označí za „detail" a fotka pak leží ladem. Tohle je způsob, jak mu to
 * přebít — a `userTagged` zajistí, že si na ni už nikdy nesáhne.
 *
 * Prázdný seznam štítků je odmítnutý: fotka bez štítku je pro pipeline neviditelná,
 * takže by to tiše znamenalo „smaž ji z výběru".
 */
export async function setBrandImageTags(
    clientSlug: string,
    imageUrl: string,
    tags: string[],
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(clientSlug)

        const clean = Array.from(new Set(
            tags.map(t => t.trim().toLowerCase()).filter(t => t && isValidBrandTag(t))
        )).slice(0, 4)
        if (clean.length === 0) {
            return { success: false, error: 'Vyber aspoň jeden štítek — bez štítku se fotka v příspěvcích nepoužije.' }
        }

        const { data: client } = await supabaseAdmin
            .from('clients').select('config').eq('id', clientId).single()
        if (!client) return { success: false, error: 'Klient nenalezen.' }

        const config = client.config as any
        const { getConfigBrandImageObjects } = await import('@/instagram/configs/types')
        const imgs = getConfigBrandImageObjects(config)

        let found = false
        const updated: BrandImage[] = imgs.map(img => {
            if (img.url !== imageUrl) return img
            found = true
            return { ...img, tags: clean, userTagged: true }
        })
        if (!found) return { success: false, error: 'Fotka nenalezena.' }

        await supabaseAdmin
            .from('clients')
            .update({ config: { ...config, brandReferenceImages: updated } })
            .eq('id', clientId)

        const { invalidateConfigCache } = await import('@/instagram/configs')
        invalidateConfigCache(clientSlug)
        return { success: true }
    } catch (err) {
        return { success: false, error: (err as Error).message }
    }
}

/**
 * Re-tag ALL of a client's brand photos with vision AI. Downloads each photo,
 * runs tagBrandImage(), and writes refreshed tags + description back to config.
 * For photos uploaded before tagging existed, or to refresh labels after changes.
 * Fotky se štítky od člověka (`userTagged`) přeskakuje — ty jsou konečné.
 */
export async function retagBrandImages(
    clientSlug: string
): Promise<{ success: boolean; count: number; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(clientSlug)
        const { data: client } = await supabaseAdmin
            .from('clients').select('config, name').eq('id', clientId).single()
        if (!client) return { success: false, count: 0, error: 'Klient nenalezen.' }

        const config = client.config as any
        const { getConfigBrandImageObjects } = await import('@/instagram/configs/types')
        const imgs = getConfigBrandImageObjects(config)
        if (imgs.length === 0) return { success: true, count: 0 }

        const { tagBrandImage } = await import('@/instagram/brand-tagger')
        const retagged: BrandImage[] = []
        let count = 0
        for (const img of imgs) {
            // Ruční oprava je konečná. Vision model nepozná, že zrovna tenhle obličej
            // je tvář značky — portrét ochotně označí jako „detail" a fotka se pak
            // v příspěvcích nikdy neobjeví. Kdo to jednou opravil, nesmí o to přijít.
            if (img.userTagged) { retagged.push(img); continue }
            try {
                const resp = await fetch(img.url)
                if (!resp.ok) { retagged.push(img); continue }
                const buf = Buffer.from(await resp.arrayBuffer())
                const mime = img.url.endsWith('.png') ? 'image/png' : 'image/jpeg'
                const { tags, description } = await tagBrandImage(buf, mime, client.name)
                retagged.push({
                    url: img.url,
                    tags: tags.length ? tags : img.tags,
                    description: description || img.description,
                })
                if (tags.length) count++
            } catch {
                retagged.push(img)
            }
        }

        await supabaseAdmin
            .from('clients')
            .update({ config: { ...config, brandReferenceImages: retagged } })
            .eq('id', clientId)
        const { invalidateConfigCache } = await import('@/instagram/configs')
        invalidateConfigCache(clientSlug)
        return { success: true, count }
    } catch (err) {
        return { success: false, count: 0, error: (err as Error).message }
    }
}
