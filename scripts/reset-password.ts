/**
 * Admin nástroj pro nastavení hesla — obejde e-mail a nastaví heslo přímo
 * přes Supabase Admin API. Pro zaseknuté účty (např. heslo se neuložilo do
 * klíčenky a uživatel se nemůže přihlásit).
 *
 *   npx tsx scripts/reset-password.ts <email> <noveHeslo>
 *
 * Vyžaduje SUPABASE_SERVICE_ROLE_KEY v .env.local.
 */
import supabaseAdmin from '../supabase/admin'

async function main() {
    const email = process.argv[2]?.trim().toLowerCase()
    const newPassword = process.argv[3]

    if (!email || !newPassword) {
        console.error('Použití: npx tsx scripts/reset-password.ts <email> <noveHeslo>')
        process.exit(1)
    }
    if (newPassword.length < 6) {
        console.error('❌ Heslo musí mít alespoň 6 znaků.')
        process.exit(1)
    }

    // listUsers je stránkované — projdeme stránky, dokud uživatele nenajdeme.
    let userId: string | undefined
    for (let page = 1; !userId; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) {
            console.error('❌ listUsers selhalo:', error.message)
            process.exit(1)
        }
        userId = data.users.find(u => u.email?.toLowerCase() === email)?.id
        if (data.users.length < 1000) break
    }

    if (!userId) {
        console.error(`❌ Žádný uživatel s e-mailem ${email}`)
        process.exit(1)
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: newPassword,
        email_confirm: true,
    })
    if (error) {
        console.error('❌ Změna hesla selhala:', error.message)
        process.exit(1)
    }

    console.log(`✅ Heslo nastaveno pro ${email}`)
    console.log(`   E-mail: ${email}`)
    console.log(`   Heslo:  ${newPassword}`)
    console.log(`   Přihlas se na /login a hned si ho můžeš změnit přes „Zapomněl jsi heslo?".`)
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
