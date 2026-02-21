/**
 * Migration: Add Growth Engine columns to ig_posts
 * Run: npx tsx instagram/migrate-growth.ts
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve } from "path"

dotenv.config({ path: resolve(__dirname, "../.env.local") })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function migrate() {
    console.log("🔄 Running Growth Engine migration...\n")

    // Add new columns to ig_posts
    const queries = [
        `ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS reach integer DEFAULT 0`,
        `ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS shares integer DEFAULT 0`,
        `ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS profile_visits integer DEFAULT 0`,
        `ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS link_clicks integer DEFAULT 0`,
        `ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS content_pillar text`,
    ]

    for (const query of queries) {
        const { error } = await supabase.rpc("exec_sql", { query })
        if (error) {
            // Try raw SQL via REST if rpc doesn't exist
            console.log(`   ⚠️ RPC exec_sql not available, trying direct...`)
            break
        }
        console.log(`   ✓ ${query.substring(0, 60)}...`)
    }

    // Alternative: Use Supabase's built-in SQL editor approach
    // Test if columns already exist by trying to query them
    const { data, error } = await supabase
        .from("ig_posts")
        .select("id, reach, shares, profile_visits, link_clicks, content_pillar")
        .limit(1)

    if (error && error.message.includes("column")) {
        console.log("\n⚠️ Columns don't exist yet. Please run this SQL in Supabase Dashboard → SQL Editor:\n")
        console.log("```sql")
        queries.forEach(q => console.log(q + ";"))
        console.log("```\n")
        console.log("URL: https://supabase.com/dashboard/project/vmxnwpwidjjhtddaibqm/sql/new")
    } else if (error) {
        console.error("❌ Error:", error.message)
    } else {
        console.log("\n✅ All columns exist! Migration complete.")
    }
}

migrate().catch(console.error)
