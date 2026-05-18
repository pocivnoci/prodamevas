'use server'

import { requireSuperAdmin } from '@/lib/auth-guard'

/**
 * Check if the current user is a super admin
 */
export async function checkIsAdmin(): Promise<boolean> {
    try {
        await requireSuperAdmin()
        return true
    } catch {
        return false
    }
}
