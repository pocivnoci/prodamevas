import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, "../.env.local") })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error("Missing Supabase credentials in .env.local")
    process.exit(1)
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)

async function setupTestUser() {
    console.log("Setting up test admin user: tym@prodamevas.cz...")

    // 1. Create the user using Admin API (bypasses email validation)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: "tym@prodamevas.cz",
        password: "password123",
        email_confirm: true,
        user_metadata: { name: "Admin Tym" }
    })

    if (authError && authError.message !== "User already registered") {
        console.error("Failed to create user:", authError.message)
        return
    }

    // Attempt to get the user ID (either newly created or already existing)
    let userId = authData?.user?.id
    if (!userId) {
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
        const existingUser = existingUsers.users.find(u => u.email === "tym@prodamevas.cz")
        if (existingUser) {
            userId = existingUser.id
            console.log("User already exists, proceeding to link clients...")
        } else {
            console.error("Could not determine User ID.")
            return
        }
    } else {
        console.log("Created Auth user successfully.")
    }

    // 2. Fetch seeded clients
    const { data: clients, error: clientsError } = await supabaseAdmin
        .from("clients")
        .select("id, slug")

    if (clientsError || !clients || clients.length === 0) {
        console.error("No clients found. Did you run `npm run seed` first?")
        return
    }

    // 3. Link user to all available clients in `user_clients`
    console.log("Linking user to clients...")
    for (const client of clients) {
        const { error: linkError } = await supabaseAdmin
            .from("user_clients")
            .upsert({
                user_id: userId,
                client_id: client.id,
                role: "owner"
            }, { onConflict: "user_id, client_id" })

        if (linkError) {
            console.error(`Failed to link client ${client.slug}:`, linkError.message)
        } else {
            console.log(`Linked user to client -> ${client.slug}`)
        }
    }

    console.log("\n✅ Setup complete! You can now log in.")
    console.log("Email: tym@prodamevas.cz")
    console.log("Password: password123")
}

setupTestUser()
