import supabaseAdmin from './supabase/admin'

async function linkHanzFans() {
    // get user ID
    console.log("Fetching users from auth...")
    const { data: users, error: userError } = await supabaseAdmin.auth.admin.listUsers()

    if (userError || !users?.users?.length) {
        console.error("Auth Error:", userError)
        return
    }

    const userId = users.users[0].id
    console.log(`Setting user_id ${userId} for 'hanzfans' and 'mobilnamiru' and 'laurawine'...`)

    const { error: updateError } = await supabaseAdmin
        .from('clients')
        .update({ user_id: userId })
        .in('slug', ['hanzfans', 'mobilnamiru', 'laurawine'])

    if (updateError) {
        console.error("Update Error:", updateError)
        return
    }

    console.log("Successfully linked accounts to user.")
}

linkHanzFans()
