'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'
import { findUsableInvite, INVITE_COOKIE, INVITE_COOKIE_MAX_AGE } from '@/lib/invite-gate'

/**
 * Přihlášení přes Google. Supabase vrátí URL k souhlasné obrazovce, my na ni
 * jen přesměrujeme; kód se pak vymění za session v `/auth/callback`.
 */

/**
 * Origin aktuálního requestu — ne `siteUrl()`. Ten vrací kanonickou doménu,
 * takže by lokální vývoj skončil na produkci. Podvrženou hlavičkou se nikam
 * nedostane: Supabase pouští jen URL ze svého allow-listu.
 */
async function requestOrigin(): Promise<string> {
    const h = await headers()
    const host = h.get('x-forwarded-host') || h.get('host') || 'www.chrlit.cz'
    const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
    return `${proto}://${host}`
}

/** Vrátí URL souhlasné obrazovky Googlu, nebo null když brána selže. */
async function googleConsentUrl(): Promise<string | null> {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${await requestOrigin()}/auth/callback`,
            queryParams: { access_type: 'offline', prompt: 'select_account' },
        },
    })

    if (error || !data?.url) {
        console.error(`Google OAuth start selhal: ${error?.message ?? 'chybí URL'}`)
        return null
    }
    return data.url
}

/** Přihlášení existujícího účtu. Nové účty odchytí brána v callbacku. */
export async function signInWithGoogle() {
    const url = await googleConsentUrl()
    // redirect() vyhazuje NEXT_REDIRECT — musí zůstat mimo try/catch.
    redirect(url ?? '/login?error=google_unavailable')
}

/**
 * Registrace přes Google. Kód se tady **nezabírá** — účet ještě neexistuje.
 * Ověříme, že je platný, uložíme ho do httpOnly cookie a claim proběhne až
 * v callbacku, kde je komu ho přiřadit.
 */
export async function signUpWithGoogle(formData: FormData) {
    const invite = await findUsableInvite(formData.get('inviteCode') as string)
    if (!invite) redirect('/register?error=invalid_invite')

    const jar = await cookies()
    jar.set(INVITE_COOKIE, invite.code, {
        httpOnly: true,
        sameSite: 'lax', // návrat z Googlu je top-level navigace, 'strict' by cookie zahodil
        secure: process.env.NODE_ENV === 'production',
        maxAge: INVITE_COOKIE_MAX_AGE,
        path: '/',
    })

    const url = await googleConsentUrl()
    redirect(url ?? '/register?error=google_unavailable')
}
