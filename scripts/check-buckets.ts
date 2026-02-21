import supabaseAdmin from '../supabase/admin';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkBuckets() {
    const { data, error } = await supabaseAdmin.storage.listBuckets();
    if (error) {
        console.error("Error listing buckets:", error);
    } else {
        console.log("Available buckets:", data.map(b => b.name));
    }
}
checkBuckets();
