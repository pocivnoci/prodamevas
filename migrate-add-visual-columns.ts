/**
 * Add design_url and mockup_url columns to ig_product_ideas
 */
import supabaseAdmin from "./supabase/admin"

async function main() {
    console.log("Adding design_url and mockup_url columns to ig_product_ideas...")

    // Add design_url column
    const { error: e1 } = await supabaseAdmin.rpc("exec_sql", {
        query: `ALTER TABLE ig_product_ideas ADD COLUMN IF NOT EXISTS design_url TEXT;`
    })

    // Add mockup_url column  
    const { error: e2 } = await supabaseAdmin.rpc("exec_sql", {
        query: `ALTER TABLE ig_product_ideas ADD COLUMN IF NOT EXISTS mockup_url TEXT;`
    })

    // Fallback: try direct SQL if RPC doesn't exist
    if (e1 || e2) {
        console.log("RPC not available, trying direct approach...")
        // Test if columns already exist by selecting them
        const { error: testError } = await supabaseAdmin
            .from("ig_product_ideas")
            .select("design_url, mockup_url")
            .limit(1)

        if (testError) {
            console.log("❌ Columns don't exist yet. Please run this SQL in Supabase Dashboard:")
            console.log(`
ALTER TABLE ig_product_ideas 
  ADD COLUMN IF NOT EXISTS design_url TEXT,
  ADD COLUMN IF NOT EXISTS mockup_url TEXT;
            `)
        } else {
            console.log("✅ Columns already exist!")
        }
    } else {
        console.log("✅ Columns added successfully!")
    }
}
main()
