'use server'

import { requireAuth } from '@/lib/auth-guard'

/**
 * Check if the current user is a super admin
 */
export async function checkIsAdmin(): Promise<boolean> {
    try {
        await requireAuth()
        return true
    } catch {
        return false
    }
}
