'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'

/**
 * Krok 1 obnovy hesla: pošle uživateli e-mail s odkazem na obnovu.
 * Odkaz míří na /auth/callback, který vymění `code` za relaci a přesměruje
 * na /reset-password, kde si uživatel nastaví nové heslo.
 *
 * Bezpečnost: nikdy neprozrazujeme, zda e-mail v systému existuje — vždy
 * vracíme stejnou neutrální hlášku (jediná výjimka je rate limit).
 */
export async function requestPasswordReset(formData: FormData) {
    const email = (formData.get('email') as string)?.trim()

    if (!email) {
        redirect('/forgot-password?error=missing_email')
    }

    const supabase = await createClient()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    })

    // 429 = příliš mnoho žádostí. Jiné chyby neprozrazujeme (enumerace e-mailů).
    if (error?.status === 429) {
        redirect('/forgot-password?error=rate_limit')
    }

    redirect('/forgot-password?sent=1')
}
