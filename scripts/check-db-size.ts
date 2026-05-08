import supabaseAdmin from '../supabase/admin';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkDatabaseSize() {
    console.log("Checking Database Size...");
    const { data, error } = await supabaseAdmin.rpc('get_db_size'); // this might not exist, let's use a raw query if possible
    
    // We don't have direct SQL execution via supabase-js unless we use a rpc. 
    // Let's just check the size of some tables if possible.
    const tables = ['profiles', 'clients', 'instagram_posts', 'product_ideas'];
    for (const table of tables) {
        const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
        if (!error) {
            console.log(`Table ${table} has ${count} rows.`);
        } else {
            console.error(`Error querying ${table}:`, error.message);
        }
    }
}
checkDatabaseSize();
