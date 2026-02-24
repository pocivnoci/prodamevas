import supabaseAdmin from './supabase/admin'

async function checkClients() {
    const { data: clients, error } = await supabaseAdmin
        .from('clients')
        .select('id, slug, name, user_id, onboarding_status')

    if (error) {
        console.error("DB Error:", error)
        return
    }

    console.log("Clients in DB:")
    console.table(clients)
}

checkClients()
