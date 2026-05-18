'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'
import supabaseAdmin from '@/supabase/admin'

export async function signup(formData: FormData) {
    const supabase = await createClient()

    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const passwordConfirm = formData.get('passwordConfirm') as string
    const inviteCode = (formData.get('inviteCode') as string)?.toUpperCase().trim()

    if (!email || !password || !inviteCode) {
        redirect('/register?error=missing_fields')
    }

    if (password !== passwordConfirm) {
        redirect('/register?error=password_mismatch')
    }

    if (password.length < 6) {
        redirect('/register?error=password_too_short')
    }

    // Validate invite code
    const { data: inviteRecord } = await supabaseAdmin
        .from('invite_codes')
        .select('*')
        .eq('code', inviteCode)
        .eq('is_active', true)
        .single()

    if (!inviteRecord || inviteRecord.used_count >= inviteRecord.max_uses) {
        redirect('/register?error=invalid_invite')
    }

    const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
            data: {
                invite_code: inviteCode
            }
        },
    })

    if (error) {
        if (error.message.includes('already registered')) {
            redirect('/register?error=already_exists')
        }
        console.error('Signup error:', error.message)
        redirect('/register?error=signup_failed')
    }

    // Increment used_count for the invite code
    await supabaseAdmin
        .from('invite_codes')
        .update({ used_count: inviteRecord.used_count + 1 })
        .eq('id', inviteRecord.id)

    redirect('/register?success=check_email')
}
