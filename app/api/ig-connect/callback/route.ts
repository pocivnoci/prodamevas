import { NextResponse } from "next/server"
import { verifyState } from "@/lib/ig-oauth-state"
import {
    exchangeCodeForShortLivedToken,
    exchangeForLongLivedToken,
    fetchIgProfile,
    saveConnection,
} from "@/instagram/ig-connection"

/**
 * GET /api/ig-connect/callback
 *
 * Instagram redirects here after the user authorizes (or denies). We:
 *  1. Verify the signed `state` → the tenant that started the flow (CSRF + tenant
 *     binding; the IG redirect carries no Supabase session cookie).
 *  2. Exchange code → short-lived → long-lived (~60-day) token.
 *  3. Fetch the connected account id + @handle and persist the encrypted token.
 *
 * No requireAuth() here — the signed state IS the proof of authorization. Auth-
 * exempt like the payment webhook; everything sensitive is gated by the HMAC.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin

    const verified = verifyState(searchParams.get("state"))
    // Without a valid state we can't trust which tenant this is — bail to dashboard.
    if (!verified) {
        return NextResponse.redirect(`${siteUrl}/dashboard/instagram?ig=error#settings`)
    }
    const dashboard = `${siteUrl}/dashboard/instagram`

    // User denied on Instagram's consent screen.
    if (searchParams.get("error")) {
        return NextResponse.redirect(`${dashboard}?ig=denied#settings`)
    }

    const code = searchParams.get("code")
    if (!code) {
        return NextResponse.redirect(`${dashboard}?ig=error#settings`)
    }

    try {
        const redirectUri = `${siteUrl}/api/ig-connect/callback`
        const short = await exchangeCodeForShortLivedToken(code, redirectUri)
        const long = await exchangeForLongLivedToken(short.accessToken)
        const profile = await fetchIgProfile(long.accessToken)
        const expiresAt = long.expiresIn ? new Date(Date.now() + long.expiresIn * 1000).toISOString() : null

        await saveConnection(verified.clientId, {
            igUserId: profile.userId || short.userId,
            igUsername: profile.username,
            accessToken: long.accessToken,
            expiresAt,
            // This is OUR OAuth flow, so the row is a Graph connection. A tenant who
            // reconnects here after using the bridge overwrites their upload-post row,
            // which is exactly the migration path back to our own app.
            transport: "meta",
        })

        return NextResponse.redirect(`${dashboard}?ig=connected#settings`)
    } catch (err) {
        console.error("ig-connect callback failed:", (err as Error).message)
        return NextResponse.redirect(`${dashboard}?ig=error#settings`)
    }
}
