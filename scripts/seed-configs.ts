import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { config as mobilnamiruConfig } from "../instagram/configs/mobilnamiru"
import { config as hanzfansConfig } from "../instagram/configs/hanzfans"

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

async function seedConfigs() {
    console.log("Seeding legacy configs to Supabase...")

    const clientsToSeed = [
        {
            slug: "mobilnamiru",
            name: "Mobil na míru",
            website: "https://mobilnamiru.cz",
            instagram: "mobilnamiru.cz",
            config: mobilnamiruConfig
        },
        {
            slug: "hanzfans",
            name: "HanzFans",
            website: "https://hanzfans.cz",
            instagram: "hanzfanscz",
            config: hanzfansConfig
        }
    ]

    for (const client of clientsToSeed) {
        const { error } = await supabaseAdmin
            .from("clients")
            .upsert({
                slug: client.slug,
                name: client.name,
                website: client.website,
                instagram: client.instagram,
                config: client.config,
                is_active: true
            }, { onConflict: "slug" })

        if (error) {
            console.error(`Failed to seed ${client.slug}:`, error.message)
        } else {
            console.log(`Successfully seeded config for: ${client.slug}`)
        }
    }

    console.log("Seeding complete.")
}

seedConfigs()
