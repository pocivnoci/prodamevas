/**
 * Ops nástroj: připojení tenanta na most upload-post z příkazové řádky.
 *
 * Existuje proto, že most jde nasadit dřív, než se do produkce dostane UI —
 * a taky proto, že „Ověřit připojení" v Nastavení dělá přesně tohle, takže když
 * něco nesedí, tady je to vidět bez prohlížeče.
 *
 * Použití:
 *   npx tsx scripts/uploadpost-connect.ts url    <slug>   → vypíše access_url
 *   npx tsx scripts/uploadpost-connect.ts status <slug>   → stav u poskytovatele
 *   npx tsx scripts/uploadpost-connect.ts save   <slug>   → zapíše ig_connections
 *   npx tsx scripts/uploadpost-connect.ts show   <slug>   → co je uložené u nás
 *
 * `url` vrací adresu s podepsaným 48h JWT — je to přihlašovací údaj. Nedávej ji
 * nikam, kde zůstane (chat, log, ticket) déle, než je potřeba.
 */

import supabaseAdmin from "@/supabase/admin"
import { generateConnectUrl, getProfileStatus, uploadPostProfileName } from "@/lib/channels/uploadpost-profiles"
import { getConnectionMeta, saveConnection } from "@/instagram/ig-connection"

async function resolveClient(slug: string): Promise<{ id: string; name: string }> {
    const { data } = await supabaseAdmin.from("clients").select("id, name").eq("slug", slug).maybeSingle()
    if (!data) throw new Error(`Klient se slugem '${slug}' neexistuje.`)
    return { id: data.id, name: data.name }
}

async function main() {
    const [cmd, slug] = process.argv.slice(2)
    if (!cmd || !slug) {
        console.log("Použití: npx tsx scripts/uploadpost-connect.ts <url|status|save|show> <slug>")
        return
    }

    const client = await resolveClient(slug)
    console.log(`\nKlient: ${client.name}  (${slug} → ${client.id})`)
    console.log(`Profil u upload-post: ${uploadPostProfileName(client.id)}\n`)

    switch (cmd) {
        case "url": {
            const url = await generateConnectUrl(client.id)
            console.log("👉 Otevři a připoj Instagram TOHOTO klienta (platí 48 h):\n")
            console.log(`   ${url}\n`)
            console.log(`   Pak: npx tsx scripts/uploadpost-connect.ts save ${slug}`)
            break
        }
        case "status": {
            const s = await getProfileStatus(client.id)
            console.log(`profil existuje: ${s.exists}`)
            console.log(`instagram připojen: ${s.connected ? "✅ ano" : "❌ ne"}`)
            console.log(`handle: ${s.instagramUsername ?? "—"}`)
            break
        }
        case "save": {
            const s = await getProfileStatus(client.id)
            if (!s.connected) {
                console.log("❌ Instagram u upload-post připojený není — nemám co uložit.")
                console.log(`   Spusť nejdřív: npx tsx scripts/uploadpost-connect.ts url ${slug}`)
                process.exit(1)
            }
            await saveConnection(client.id, {
                igUserId: s.instagramUsername || uploadPostProfileName(client.id),
                igUsername: s.instagramUsername,
                accessToken: uploadPostProfileName(client.id),
                expiresAt: null,
                transport: "uploadpost",
                metadata: { profileUsername: uploadPostProfileName(client.id), igUsername: s.instagramUsername },
            })
            console.log(`✅ Uloženo: @${s.instagramUsername} přes transport 'uploadpost'.`)
            break
        }
        case "show": {
            const meta = await getConnectionMeta(client.id)
            console.log(meta ? JSON.stringify(meta, null, 2) : "(žádné připojení uložené)")
            break
        }
        default:
            console.log(`Neznámý příkaz '${cmd}'.`)
    }
}

main().catch(err => {
    console.error("\n❌ Selhalo:", err?.message || err)
    process.exit(1)
})
