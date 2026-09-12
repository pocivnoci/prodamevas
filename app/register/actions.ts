'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/supabase/server'
import { claimInvite, findUsableInvite } from '@/lib/invite-gate'
import { inviteRequired } from '@/lib/beta-access'
import { currentLocaleCookie } from '@/lib/i18n/server'

export async function signup(formData: FormData) {
    const supabase = await createClient()

    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const inviteCode = (formData.get('inviteCode') as string)?.toUpperCase().trim()

    // Kód je povinný jen dokud je brána zavřená. Po otevření se pole ve formuláři
    // ani neukáže — a kdo si ho vyplní z paměti, dostane ho zabraný jako dřív.
    const gateClosed = inviteRequired()

    if (!email || !password || (gateClosed && !inviteCode)) {
        redirect('/register?error=missing_fields')
    }

    if (password.length < 6) {
        redirect('/register?error=password_too_short')
    }

    const inviteRecord = await findUsableInvite(inviteCode)
    if (gateClosed && !inviteRecord) {
        redirect('/register?error=invalid_invite')
    }

    const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
            data: {
                // Razítko je jediná evidence, že účet branou prošel. Bez kódu se
                // razítkuje 'OPEN' — prázdná hodnota by účet nechala bez razítka
                // a middleware by ho z /dashboard vyhodil se smazanými cookies.
                invite_code: inviteRecord?.code || 'OPEN',
                // Jazyk UI zvolený ještě před registrací patří k účtu, ne k prohlížeči.
                ...(await currentLocaleCookie() ? { locale: await currentLocaleCookie() } : {}),
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
    if (inviteRecord && !(await claimInvite(inviteRecord))) {
        console.warn(`⚠️ invite ${inviteRecord.code} vyčerpán mezi validací a registrací ${email} — účet vznikl nad rámec kapacity`)
    }

    // REGISTRACE NESMÍ SKONČIT ČEKÁNÍM NA E-MAIL, KTERÝ NEMUSÍ DORAZIT.
    //
    // 9. 9. 2026 se na obchodní schůzce zaregistroval zájemce ze seznam.cz,
    // dvacet minut se marně zkoušel přihlásit a odešel. Účet měl v pořádku
    // včetně razítka pozvánky — jen mu nedorazil potvrzovací mail. Projekt
    // tehdy neměl vlastní SMTP a jel na vestavěném odesílači Supabase se
    // stropem DVA maily za hodinu. Čtyři účty z třinácti uvízly stejně.
    //
    // Když Supabase vrátí rovnou session (potvrzování vypnuté), je uživatel
    // přihlášený — pustíme ho dovnitř. Tenhle kód je proto správně při OBOU
    // nastaveních `mailer_autoconfirm` a nezávisí na tom, jestli mail dojde.
    if (signUpData.session) {
        // Značka slíbená na tuhle adresu (`client_handoffs`) se vybírá i tady,
        // ne jen v přihlášení — jinak by nový zákazník přišel do prázdna,
        // zatímco jeho projekt na něj v databázi čeká.
        const { claimHandoffs } = await import('@/lib/handoff')
        if (signUpData.user) await claimHandoffs(signUpData.user)
        revalidatePath('/', 'layout')
        redirect('/dashboard/instagram')
    }

    redirect('/register?success=check_email')
}
