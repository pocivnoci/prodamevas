import { NextResponse, after } from 'next/server'
import { createClient } from '@/supabase/server'

/**
 * Auth callback route — handles email confirmation links from Supabase.
 * When a user clicks the confirmation link in their email, Supabase redirects
 * them here with a `code` query parameter. We exchange that code for a session
 * and then redirect to the dashboard.
 *
 * Side effect: the first successful confirmation triggers a one-time welcome
 * e-mail (best-effort, sent after the redirect via after()).
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
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            const user = data?.user
            // Welcome e-mail, exactly once per user. The recovery flow reuses this
            // callback (next=/reset-password) and must never trigger it. Guard is
            // claim-first on app_metadata (admin-only, so not user-tamperable):
            // stamp, then send — a failed send loses one best-effort e-mail, never
            // duplicates. Auth codes are single-use, so no concurrent double-exchange.
            if (user?.email && !user.app_metadata?.welcome_email_at && !next.startsWith('/reset-password')) {
                after(async () => {
                    try {
                        const { default: supabaseAdmin } = await import('@/supabase/admin')
                        const { error: stampErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
                            app_metadata: { ...user.app_metadata, welcome_email_at: new Date().toISOString() },
                        })
                        if (stampErr) {
                            console.warn(`auth-callback: welcome stamp failed for ${user.id}: ${stampErr.message}`)
                            return
                        }
                        const { sendNotification, siteUrl } = await import('@/lib/notifications')
                        await sendNotification({
                            to: user.email,
                            kind: 'transactional',
                            subject: 'Vítejte v Chrlit — účet je aktivní',
                            body: `Dobrý den,

váš účet je potvrzený a připravený. Chrlit se naučí vaši značku a chrlí za vás hotové příspěvky — stačí zadat web, projít krátké nastavení a spustit první generování.

<a href="${siteUrl()}/dashboard/instagram">Otevřít studio →</a>

Tým Chrlit`,
                        })
                    } catch (err: any) {
                        console.warn(`auth-callback: welcome e-mail failed: ${err?.message}`)
                    }
                })
            }
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
