'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'
import { claimInvite, findUsableInvite } from '@/lib/invite-gate'

export async function signup(formData: FormData) {
    const supabase = await createClient()

    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const inviteCode = (formData.get('inviteCode') as string)?.toUpperCase().trim()

    if (!email || !password || !inviteCode) {
        redirect('/register?error=missing_fields')
    }

    if (password.length < 6) {
        redirect('/register?error=password_too_short')
    }

    const inviteRecord = await findUsableInvite(inviteCode)
    if (!inviteRecord) {
        redirect('/register?error=invalid_invite')
    }

    const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
            data: {
                invite_code: inviteRecord.code
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

    // Podmíněný claim — místo se zabere jen tehdy, když ho mezi validací a
    // zápisem nikdo jiný nevzal. Účet už existuje a nese kód v metadatech, takže
    // ho nezavíráme; přetečení o jedno místo je vidět v logu.
    if (!(await claimInvite(inviteRecord))) {
        console.warn(`⚠️ invite ${inviteRecord.code} vyčerpán mezi validací a registrací ${email} — účet vznikl nad rámec kapacity`)
    }

    redirect('/register?success=check_email')
}
