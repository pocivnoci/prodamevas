'use server'

import supabaseAdmin from '@/supabase/admin'
import { createClient } from '@/supabase/server'

/**
 * Upload a brand/reference image from the dashboard.
 * Saves to Supabase storage and adds URL to characterReferenceImages in client config.
 */
export async function uploadBrandImage(formData: FormData): Promise<{
    success: boolean
    imageUrl?: string
    error?: string
}> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return { success: false, error: 'Nepřihlášený uživatel' }

        const file = formData.get('file') as File
        if (!file) return { success: false, error: 'Nebyl vybrán žádný soubor' }

        const clientSlug = formData.get('clientSlug') as string
        if (!clientSlug) return { success: false, error: 'Chybí identifikace klienta' }

        const category = (formData.get('category') as string) || 'brand'

        // Validate file
        if (!file.type.startsWith('image/')) {
            return { success: false, error: 'Podporovány jsou pouze obrázky (JPG, PNG, WebP)' }
        }
        if (file.size > 10_000_000) {
            return { success: false, error: 'Obrázek je příliš velký (max 10 MB)' }
        }

        // Read file to buffer
        const buffer = Buffer.from(await file.arrayBuffer())
        const ext = file.type.includes('png') ? 'png' : file.type.includes('webp') ? 'webp' : 'jpg'
        const timestamp = Date.now()
        const filename = `client-assets/${clientSlug}/${category}-${timestamp}.${ext}`

        // Upload to Supabase storage
        const { error: uploadError } = await supabaseAdmin.storage
            .from('audit-screenshots')
            .upload(filename, buffer, {
                contentType: file.type,
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

        // Add URL to client config's characterReferenceImages
        const { data: client, error: fetchError } = await supabaseAdmin
            .from('clients')
            .select('config')
            .eq('slug', clientSlug)
            .single()

        if (fetchError || !client) {
            return { success: true, imageUrl } // Image uploaded but config not updated
        }

        const config = client.config as any
        const existingRefs = config.characterReferenceImages || []
        const updatedRefs = [...existingRefs, imageUrl]

        await supabaseAdmin
            .from('clients')
            .update({
                config: { ...config, characterReferenceImages: updatedRefs }
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
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return { success: false, error: 'Nepřihlášený uživatel' }

        // Remove from config
        const { data: client } = await supabaseAdmin
            .from('clients')
            .select('config')
            .eq('slug', clientSlug)
            .single()

        if (client) {
            const config = client.config as any
            const existingRefs = config.characterReferenceImages || []
            const updatedRefs = existingRefs.filter((url: string) => url !== imageUrl)

            await supabaseAdmin
                .from('clients')
                .update({
                    config: { ...config, characterReferenceImages: updatedRefs }
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
        const { data: client } = await supabaseAdmin
            .from('clients')
            .select('config')
            .eq('slug', clientSlug)
            .single()

        if (!client) return []
        return (client.config as any)?.characterReferenceImages || []
    } catch {
        return []
    }
}
