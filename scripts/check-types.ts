import * as fs from 'fs';

// Ruční parsování
const envFile = fs.readFileSync('.env.local', 'utf8');
const env: Record<string, string> = {};
envFile.split('\\n').forEach(line => {
    const match = line.match(/^([^#]+?)=(.+)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
});

const URL = env['NEXT_PUBLIC_SUPABASE_URL'];
const KEY = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!URL || !KEY) {
    console.error("Missing URL or KEY");
    process.exit(1);
}

async function check() {
    // 1. Get client UUID "mobilnamiru"
    const clientRes = await fetch(`${URL}/rest/v1/clients?slug=eq.mobilnamiru&select=id`, {
        headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` }
    });

    if (!clientRes.ok) {
        console.error("Failed to fetch client:", await clientRes.text());
        return;
    }

    const clients = await clientRes.json();
    if (clients.length === 0) {
        console.error("Client 'mobilnamiru' not found!");
        return;
    }

    const clientId = clients[0].id;
    console.log("Client ID:", clientId);

    // 2. Get post types for client
    const typesRes = await fetch(`${URL}/rest/v1/ig_post_types?client_id=eq.${clientId}&select=name,is_active`, {
        headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` }
    });

    if (!typesRes.ok) {
        console.error("Failed to fetch types:", await typesRes.text());
        return;
    }

    const types = await typesRes.json();
    console.log("Found post types:", types.length);
    console.table(types);
}

check().catch(console.error);
