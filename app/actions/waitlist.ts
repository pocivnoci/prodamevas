'use server'

import supabaseAdmin from '@/supabase/admin'

export async function joinWaitlist(formData: FormData) {
    const email = formData.get('email') as string

    if (!email) {
        return { success: false, error: 'Vyplňte prosím e-mail.' }
    }

    const { error } = await supabaseAdmin
        .from('waitlist')
        .insert({ email })

    if (error) {
        if (error.code === '23505') { // Unique violation
            return { success: true } // Tvrdíme, že úspěch, pokud už tam je
        }
        console.error('Waitlist error:', error.message)
        return { success: false, error: 'Něco se pokazilo. Zkuste to prosím znovu.' }
    }

    return { success: true }
}
