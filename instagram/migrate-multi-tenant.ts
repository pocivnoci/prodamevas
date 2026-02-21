/**
 * DB Migration: Add project_id for multi-tenant support
 * ======================================================
 * Run: npx tsx instagram/migrate-multi-tenant.ts
 */

import supabase from "../supabase/client"

async function migrate() {
    console.log("🔧 Migrace: Přidávám project_id pro multi-tenant support...\n")

    // Add project_id to ig_posts
    const { error: e1 } = await (supabase.rpc as any)("exec_sql", {
        sql: `
            ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'mobilnamiru';
            CREATE INDEX IF NOT EXISTS idx_ig_posts_project ON ig_posts(project_id);
        `
    })

    // Fallback: try direct SQL if rpc doesn't work
    if (e1) {
        console.log("   ℹ️ RPC not available, trying direct column add via insert test...")

        // Check if columns already exist by querying
        const { data: testPost } = await supabase.from("ig_posts").select("project_id").limit(1)
        if (testPost !== null) {
            console.log("   ✓ ig_posts.project_id already exists")
        } else {
            console.log("   ⚠️ Please run this SQL manually in Supabase Dashboard > SQL Editor:")
            console.log(`
ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'mobilnamiru';
ALTER TABLE ig_post_ideas ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'mobilnamiru';
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'mobilnamiru';
CREATE INDEX IF NOT EXISTS idx_ig_posts_project ON ig_posts(project_id);
CREATE INDEX IF NOT EXISTS idx_ig_ideas_project ON ig_post_ideas(project_id);
            `)
            return
        }
    } else {
        console.log("   ✓ ig_posts.project_id přidán")
    }

    // Add project_id to ig_post_ideas
    const { error: e2 } = await (supabase.rpc as any)("exec_sql", {
        sql: `
            ALTER TABLE ig_post_ideas ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'mobilnamiru';
            CREATE INDEX IF NOT EXISTS idx_ig_ideas_project ON ig_post_ideas(project_id);
        `
    })
    if (e2) {
        const { data: testIdea } = await supabase.from("ig_post_ideas").select("project_id").limit(1)
        if (testIdea !== null) {
            console.log("   ✓ ig_post_ideas.project_id already exists")
        }
    } else {
        console.log("   ✓ ig_post_ideas.project_id přidán")
    }

    // Add project_id to ig_generation_log
    const { error: e3 } = await (supabase.rpc as any)("exec_sql", {
        sql: `ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'mobilnamiru';`
    })
    if (e3) {
        const { data: testLog } = await supabase.from("ig_generation_log").select("project_id").limit(1)
        if (testLog !== null) {
            console.log("   ✓ ig_generation_log.project_id already exists")
        }
    } else {
        console.log("   ✓ ig_generation_log.project_id přidán")
    }

    console.log("\n✅ Migrace dokončena!")
    console.log("   Všechna existující data mají project_id = 'mobilnamiru' (default)")
    console.log("   HanzFans data budou mít project_id = 'hanzfans'")
}

migrate().catch(err => {
    console.error("💥 Migrace selhala:", err)
    console.log("\n⚠️ Pokud RPC nefunguje, spusť SQL ručně v Supabase Dashboard:")
    console.log(`
ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'mobilnamiru';
ALTER TABLE ig_post_ideas ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'mobilnamiru';
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'mobilnamiru';
CREATE INDEX IF NOT EXISTS idx_ig_posts_project ON ig_posts(project_id);
CREATE INDEX IF NOT EXISTS idx_ig_ideas_project ON ig_post_ideas(project_id);
    `)
    process.exit(1)
})
