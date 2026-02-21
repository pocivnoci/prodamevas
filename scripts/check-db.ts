import fs from 'fs';
import https from 'https';

const env = fs.readFileSync('.env.local', 'utf-8').split('\n').reduce((acc, line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) acc[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    return acc;
}, {} as Record<string, string>);

const url = env['NEXT_PUBLIC_SUPABASE_URL'];
const key = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!url || !key) {
    console.error('Missing credentials');
    process.exit(1);
}

const req = https.request(new URL(`${url}/rest/v1/clients?slug=eq.mobilnamiru&select=id`), {
    method: 'GET',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
}, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const clients = JSON.parse(data);
        if (!clients.length) return console.log('Client not found');
        const clientId = clients[0].id;

        console.log('Client ID:', clientId);

        const req2 = https.request(new URL(`${url}/rest/v1/ig_post_types?client_id=eq.${clientId}&select=name,is_active`), {
            method: 'GET',
            headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
        }, res2 => {
            let data2 = '';
            res2.on('data', chunk => data2 += chunk);
            res2.on('end', () => console.log('Types:', JSON.parse(data2)));
        });
        req2.end();
    });
});
req.end();
