import { NextResponse } from "next/server"
import { requireProjectAccess } from "@/lib/auth-guard"
import { signState } from "@/lib/ig-oauth-state"

/**
 * GET /api/ig-connect/start?slug={projectSlug}
 *
 * Begins the "Instagram API with Instagram Login" OAuth flow. Verifies the caller
 * owns the project, signs the tenant into a short-lived `state`, and redirects the
 * browser to Instagram's authorize page. The callback finishes the exchange.
 *
 * Scopes: instagram_business_basic + instagram_business_manage_insights +
 * instagram_business_content_publish (auto-publish). In dev mode / Standard Access
 * only app-role accounts can connect at all, so requesting publish is safe for the
 * chrlit dogfood account; tenant publishing still needs content_publish approved in
 * a 2nd App Review before the app goes Live for non-role accounts
 * (docs/META_APP_REVIEW_PLAN.md). Comments are deferred.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const slug = searchParams.get("slug")
    if (!slug) {
        return NextResponse.json({ error: "Chybí slug projektu." }, { status: 400 })
    }

    let clientId: string
    try {
        ;({ clientId } = await requireProjectAccess(slug))
    } catch {
        // Not logged in / no access — bounce to login rather than leak which slugs exist.
        return NextResponse.redirect(`${origin}/login`)
    }

    const appId = process.env.META_APP_ID
    if (!appId) {
        return NextResponse.json({ error: "Instagram OAuth není nakonfigurován (META_APP_ID)." }, { status: 503 })
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin
    const redirectUri = `${siteUrl}/api/ig-connect/callback`
    const state = signState(clientId, slug)

    const authorize = new URL("https://api.instagram.com/oauth/authorize")
    authorize.searchParams.set("client_id", appId)
    authorize.searchParams.set("redirect_uri", redirectUri)
    authorize.searchParams.set("response_type", "code")
    authorize.searchParams.set(
        "scope",
        "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish",
    )
    authorize.searchParams.set("state", state)

    return NextResponse.redirect(authorize.toString())
}
