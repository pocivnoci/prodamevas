import { NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

/**
 * Auth callback route — handles email confirmation links from Supabase.
 * When a user clicks the confirmation link in their email, Supabase redirects
 * them here with a `code` query parameter. We exchange that code for a session
 * and then redirect to the dashboard.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')

    // Only allow internal relative paths — guard against open-redirect via `next`.
    const rawNext = searchParams.get('next')
    const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')
        ? rawNext
        : '/dashboard/instagram'

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`)
        }
    }

    // Exchange failed — expired/invalid link. Password-recovery links go back
    // to the recovery flow; everything else to login.
    const failurePath = next.startsWith('/reset-password')
        ? '/forgot-password?error=link_expired'
        : '/login?error=invalid_credentials'
    return NextResponse.redirect(`${origin}${failurePath}`)
}
