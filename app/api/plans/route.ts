import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { requireAuth } from "@/lib/auth-guard"

/**
 * GET /api/plans — active subscription plans for the pricing UI (dashboard).
 * The marketing landing page keeps static copy; this powers SubscriptionSection.
 */
export async function GET() {
    try {
        await requireAuth()

        const { data, error } = await supabaseAdmin
            .from("subscription_plans")
            .select("id, name, description, price_czk, interval, features")
            .eq("is_active", true)
            .neq("id", "trial_v2")
            .order("price_czk", { ascending: true })

        if (error) throw error
        return NextResponse.json({ plans: data || [] })
    } catch (err: any) {
        const status = err?.message?.includes("Neautorizovaný") ? 401 : 500
        return NextResponse.json({ error: err?.message || "Failed to load plans" }, { status })
    }
}
