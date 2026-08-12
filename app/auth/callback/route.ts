import { NextResponse, after } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/supabase/server'
import { enforceInviteGate, INVITE_COOKIE } from '@/lib/invite-gate'

/**
 * Auth callback route — handles email confirmation links from Supabase and the
 * return leg of Google OAuth. Both arrive with a `code` query parameter, which
 * we exchange for a session before redirecting into the app.
 *
 * Side effects:
 *  - OAuth arrivals pass through the invite gate (beta is invite-only, and
 *    Supabase creates the account before we ever see it).
 *  - The first successful confirmation triggers a one-time welcome e-mail
 *    (best-effort, sent after the redirect via after()).
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

            // Invite gate — only for OAuth. The e-mail flows (confirmation,
            // recovery) already passed a code at registration, so gating them
            // here would only risk locking existing people out.
            const isOAuth = !!user && (user.app_metadata?.provider ?? 'email') !== 'email'
            if (isOAuth) {
                const jar = await cookies()
                const verdict = await enforceInviteGate(user, jar.get(INVITE_COOKIE)?.value ?? null)
                jar.delete(INVITE_COOKIE)

                if (!verdict.ok) {
                    // Účet v Supabase zůstane, ale bez razítka je bezcenný —
                    // session hned zahazujeme, ať se nikdo neproklikne dál.
                    await supabase.auth.signOut()
                    return NextResponse.redirect(`${origin}/register?error=${verdict.reason}`)
                }
            }

            // Welcome e-mail, exactly once per user. The recovery flow reuses this
            // callback (next=/reset-password) and must never trigger it. Guard is
            // claim-first on app_metadata (admin-only, so not user-tamperable):
            // stamp, then send — a failed send loses one best-effort e-mail, never
            // duplicates. Auth codes are single-use, so no concurrent double-exchange.
            if (user?.email && !user.app_metadata?.welcome_email_at && !next.startsWith('/reset-password')) {
                after(async () => {
                    try {
                        const { default: supabaseAdmin } = await import('@/supabase/admin')
                        // Metadata se čtou znovu, ne z `user`: brána o pár řádků
                        // výš mohla zapsat razítko kódu a rozšíření zdejší kopie
                        // by ho přepsalo zpátky pryč.
                        const { data: fresh } = await supabaseAdmin.auth.admin.getUserById(user.id)
                        const { error: stampErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
                            app_metadata: {
                                ...(fresh?.user?.app_metadata ?? user.app_metadata),
                                welcome_email_at: new Date().toISOString(),
                            },
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
                    } catch (err) {
                        console.warn(`auth-callback: welcome e-mail failed: ${(err as Error)?.message}`)
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
