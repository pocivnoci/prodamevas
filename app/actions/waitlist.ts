'use server'

import supabaseAdmin from '@/supabase/admin'
import { normalizeTermMonths } from '@/lib/pricing'

export async function joinWaitlist(formData: FormData) {
    const email = formData.get('email') as string

    if (!email) {
        return { success: false, error: 'Vyplňte prosím e-mail.' }
    }

    // Který tarif a období si člověk vybral na ceníku. Nepovinné (formulář je
    // i mimo ceník) a nikdy se nebere doslova — období prochází normalizací,
    // aby se do DB nedostalo „24" ani „<script>".
    const planInterest = (formData.get('planInterest') as string | null)?.trim() || null
    const rawTerm = formData.get('termInterest') as string | null
    const termInterest = rawTerm ? normalizeTermMonths(rawTerm) : null

    const { error } = await supabaseAdmin
        .from('waitlist')
        .insert({ email, plan_interest: planInterest, term_interest: termInterest })

    if (error) {
        if (error.code === '23505') { // Unique violation
            return { success: true } // Tvrdíme, že úspěch, pokud už tam je
        }
        console.error('Waitlist error:', error.message)
        return { success: false, error: 'Něco se pokazilo. Zkuste to prosím znovu.' }
    }

    return { success: true }
}
