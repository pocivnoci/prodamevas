'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'

export async function signup(formData: FormData) {
    const supabase = await createClient()

    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const passwordConfirm = formData.get('passwordConfirm') as string

    if (!email || !password) {
        redirect('/register?error=missing_fields')
    }

    if (password !== passwordConfirm) {
        redirect('/register?error=password_mismatch')
    }

    if (password.length < 6) {
        redirect('/register?error=password_too_short')
    }

    const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
        },
    })

    if (error) {
        if (error.message.includes('already registered')) {
            redirect('/register?error=already_exists')
        }
        console.error('Signup error:', error.message)
        redirect('/register?error=signup_failed')
    }

    redirect('/register?success=check_email')
}
