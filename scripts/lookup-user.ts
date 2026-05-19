import supabaseAdmin from '../supabase/admin'

async function main() {
    // 1. Find user in auth
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers()
    const user = users.find(u => u.email === 'michal.manena@gmail.com')
    if (!user) { console.log('❌ User not found in auth'); return }
    console.log('👤 Auth user:', user.id, user.email, 'created:', user.created_at)

    // 2. Find client
    const { data: clients } = await supabaseAdmin.from('clients').select('id, name, slug, created_at').eq('user_id', user.id)
    console.log('🏢 Clients:', JSON.stringify(clients, null, 2))

    // 3. Find subscriptions + credits
    if (clients && clients.length > 0) {
        for (const c of clients) {
            const { data: subs } = await supabaseAdmin.from('subscriptions').select('id, plan_id, status, trial_ends_at, current_period_end').eq('client_id', c.id)
            console.log('💳 Subscriptions for', c.name, ':', JSON.stringify(subs, null, 2))

            const { data: credits } = await supabaseAdmin.from('credit_transactions').select('action, credits, description, created_at').eq('client_id', c.id)
            console.log('💰 Credit transactions:', JSON.stringify(credits, null, 2))
        }
    }
}

main().catch(console.error)
