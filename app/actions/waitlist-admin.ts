'use server'

import supabaseAdmin from '@/supabase/admin'
import { requireSuperAdmin } from '@/lib/auth-guard'

export async function getWaitlist() {
    await requireSuperAdmin()
    const { data, error } = await supabaseAdmin
        .from('waitlist')
        .select('*')
        .order('created_at', { ascending: false })
    
    if (error) {
        console.error('getWaitlist error:', error)
        return []
    }
    return data || []
}

/**
 * Razítko „ozval jsem se". Bez něj nejde odlišit vyřízený kontakt od
 * zapomenutého a ranní brief by hlásil pořád ty samé lidi, dokud by se na něj
 * nepřestalo koukat. `contacted_at` se nepřepisuje — první ozvání je to, které
 * platí; opakované kliknutí tedy nic nezhorší.
 */
export async function markContacted(id: string) {
    await requireSuperAdmin()
    const { error } = await supabaseAdmin
        .from('waitlist')
        .update({ contacted_at: new Date().toISOString() })
        .eq('id', id)
        .is('contacted_at', null)

    if (error) {
        console.error('markContacted error:', error)
        return { success: false, error: error.message }
    }
    return { success: true }
}

export async function getInviteCodes() {
    await requireSuperAdmin()
    const { data, error } = await supabaseAdmin
        .from('invite_codes')
        .select('*')
        .order('created_at', { ascending: false })
    
    if (error) {
        console.error('getInviteCodes error:', error)
        return []
    }
    return data || []
}

export async function createInviteCode(code: string, maxUses: number) {
    await requireSuperAdmin()
    const { error } = await supabaseAdmin
        .from('invite_codes')
        .insert({
            code: code.toUpperCase().trim(),
            max_uses: maxUses
        })
    
    if (error) {
        console.error('createInviteCode error:', error)
        return { success: false, error: error.message }
    }
    return { success: true }
}

export async function toggleInviteCodeActive(id: string, isActive: boolean) {
    await requireSuperAdmin()
    const { error } = await supabaseAdmin
        .from('invite_codes')
        .update({ is_active: isActive })
        .eq('id', id)
    
    if (error) {
        console.error('toggleInviteCodeActive error:', error)
        return { success: false, error: error.message }
    }
    return { success: true }
}
