'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'
import { enforceInviteGate } from '@/lib/invite-gate'

export async function login(formData: FormData) {
    const supabase = await createClient()

    const credentials = {
        email: formData.get('email') as string,
        password: formData.get('password') as string,
    }

    const { data, error } = await supabase.auth.signInWithPassword(credentials)

    if (error || !data.user) {
        redirect('/login?error=invalid_credentials')
    }

    // Heslo samo o sobě přístup do bety nedává. Účty z doby před pozvánkami,
    // které nikdy nedostaly kód ani nezaložily projekt, se sem nedostanou —
    // jinak by šlo obejít bránu prostě tím, že se člověk přihlásí postaru.
    const verdict = await enforceInviteGate(data.user, null)
    if (!verdict.ok) {
        await supabase.auth.signOut()
        redirect('/login?error=no_access')
    }

    revalidatePath('/', 'layout')
    redirect('/dashboard/instagram')
}

export async function logout() {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/')
}
