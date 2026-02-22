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
    const next = searchParams.get('next') ?? '/dashboard/instagram'

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`)
        }
    }

    // Auth code exchange failed — redirect to login with error
    return NextResponse.redirect(`${origin}/login?error=invalid_credentials`)
}
