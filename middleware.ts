import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { hasBetaStamp } from '@/lib/beta-access'

export async function middleware(request: NextRequest) {
    try {
        let supabaseResponse = NextResponse.next({
            request,
        })

        if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
            console.error('Middleware: Missing Supabase environment variables! NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is undefined.');
            return supabaseResponse;
        }

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            {
                cookies: {
                    getAll() {
                        return request.cookies.getAll()
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
                        supabaseResponse = NextResponse.next({
                            request,
                        })
                        cookiesToSet.forEach(({ name, value, options }) =>
                            supabaseResponse.cookies.set(name, value, options)
                        )
                    },
                },
            }
        )

        const {
            data: { user },
            error,
        } = await supabase.auth.getUser()

        // Handle invalid refresh token — clear session cookies so the user
        // can log in again cleanly instead of being stuck with a broken session.
        if (error && error.message?.includes('Refresh Token')) {
            console.warn('Middleware: Invalid refresh token detected, clearing session.')
            
            let finalResponse = supabaseResponse;

            if (
                request.nextUrl.pathname.startsWith('/dashboard') ||
                request.nextUrl.pathname.startsWith('/onboarding')
            ) {
                const url = request.nextUrl.clone()
                url.pathname = '/login'
                finalResponse = NextResponse.redirect(url)
            }

            // Delete all Supabase auth cookies on the final response being sent back
            const cookiesToClear = request.cookies.getAll()
                .filter(c => c.name.startsWith('sb-'))
            cookiesToClear.forEach(c => {
                finalResponse.cookies.set(c.name, '', { maxAge: 0, path: '/' })
            })

            return finalResponse
        }

        const isProtected =
            request.nextUrl.pathname.startsWith('/dashboard') ||
            request.nextUrl.pathname.startsWith('/onboarding')

        if (!user && isProtected) {
            const url = request.nextUrl.clone()
            url.pathname = '/login'
            return NextResponse.redirect(url)
        }

        // Brána bety platí i pro session, která vznikla dřív, než účet zavřel.
        // Kontrola u přihlášení sama nestačí — kdo je přihlášený, ten se kolem ní
        // proklikne až do onboardingu a začne pálit generování.
        //
        // Cookies se přitom musí smazat, jinak vznikne smyčka: /dashboard by
        // posílal na /login a pravidlo o něco níž rovnou zpátky na /dashboard.
        // Ztráta session nic nezničí — kdo na betu nárok má, tomu ho přihlášení
        // vrátí i s razítkem.
        if (user && isProtected && !hasBetaStamp(user)) {
            const url = request.nextUrl.clone()
            url.pathname = '/login'
            url.search = '?error=no_access'
            const denied = NextResponse.redirect(url)
            request.cookies.getAll()
                .filter(c => c.name.startsWith('sb-'))
                .forEach(c => denied.cookies.set(c.name, '', { maxAge: 0, path: '/' }))
            return denied
        }

        // Ensure logged-in users can't visit login/register pages
        if (user && (request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/register'))) {
            const url = request.nextUrl.clone()
            url.pathname = '/dashboard/instagram'
            return NextResponse.redirect(url)
        }

        return supabaseResponse
    } catch (e) {
        console.error('Middleware exception:', e);
        // Fallback to allowing the request to pass through rather than returning 500
        return NextResponse.next({ request });
    }
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
