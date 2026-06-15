'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'

/**
 * Krok 2 obnovy hesla: uživatel sem dorazí s aktivní (recovery) relací,
 * kterou vytvořil /auth/callback z odkazu v e-mailu. Nastaví nové heslo.
 */
export async function updatePassword(formData: FormData) {
    const password = formData.get('password') as string
    const passwordConfirm = formData.get('passwordConfirm') as string

    if (!password || password.length < 6) {
        redirect('/reset-password?error=password_too_short')
    }
    if (password !== passwordConfirm) {
        redirect('/reset-password?error=password_mismatch')
    }

    const supabase = await createClient()

    // Bez platné relace z e-mailového odkazu nelze heslo změnit.
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        redirect('/forgot-password?error=link_expired')
    }

    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
        if (error.message.toLowerCase().includes('different from the old')) {
            redirect('/reset-password?error=same_password')
        }
        console.error('Reset password error:', error.message)
        redirect('/reset-password?error=update_failed')
    }

    revalidatePath('/', 'layout')
    redirect('/dashboard/instagram')
}
