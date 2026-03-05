'use server'

import { createClient } from '@/supabase/server'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)

/**
 * Check if the current user is a super admin
 */
export async function checkIsAdmin(): Promise<boolean> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return false
    return SUPER_ADMIN_EMAILS.includes(user.email)
}
