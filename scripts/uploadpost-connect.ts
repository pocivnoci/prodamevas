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
                igUserId: s.instagramUserId || uploadPostProfileName(client.id),
                igUsername: s.instagramUsername,
                accessToken: uploadPostProfileName(client.id),
                expiresAt: null,
                transport: "uploadpost",
                status: s.reauthRequired ? "expired" : "connected",
                metadata: {
                    profileUsername: uploadPostProfileName(client.id),
                    igUsername: s.instagramUsername,
                    igUserId: s.instagramUserId,
                },
            })
            console.log(`✅ Uloženo: @${s.instagramUsername} (IG id ${s.instagramUserId}) přes transport 'uploadpost'.`)
            if (s.reauthRequired) console.log("⚠️  upload-post hlásí reauth_required → uloženo jako 'expired'.")
            break
        }
        case "metrics": {
            // Read-only: what the adapter would hand metrics-sync, without writing.
            const { getConnection } = await import("@/instagram/ig-connection")
            const { getChannelAdapter } = await import("@/lib/channels")
            const conn = await getConnection(client.id)
            if (!conn) { console.log("(žádné připojení)"); break }

            const adapter = getChannelAdapter("instagram", conn.transport)
            if (!adapter.fetchMetricsBatch) { console.log("(transport nemá dávkové čtení)"); break }

            const rows = await adapter.fetchMetricsBatch(
                { accessToken: conn.accessToken, externalUserId: conn.igUserId, transport: conn.transport },
                { limit: 50 },
            )
            console.log(`Vráceno ${rows.length} příspěvků:\n`)
            for (const r of rows.slice(0, 15)) {
                const m = r.metrics
                console.log(`  ${r.externalId}  ${r.capturedAt ?? "—"}`)
                console.log(`     likes=${m.likes ?? "—"} comments=${m.comments ?? "—"} reach=${m.reach ?? "—"} saves=${m.saves ?? "—"} shares=${m.shares ?? "—"} views=${m.views ?? "—"}`)
                console.log(`     ${r.permalink ?? "—"}`)
            }
            break
        }
        case "publish": {
            // Publishes ONE post, by explicit id, through the real adapter and the same
            // helpers the cron uses — so this exercises the production path rather than
            // a parallel one. Requires the id on purpose: no argument, nothing happens.
            const postId = process.argv[4]
            if (!postId) { console.log("Chybí id příspěvku: ... publish <slug> <post-id>"); process.exit(1) }

            const { getConnection } = await import("@/instagram/ig-connection")
            const { getChannelAdapter } = await import("@/lib/channels")
            const { parsePostMedia } = await import("@/lib/media-urls")
            const { isMediumType } = await import("@/lib/credits")

            const { data: post } = await supabaseAdmin
                .from("ig_posts")
                .select("id, client_id, caption, image_url, media_type, status")
                .eq("id", postId)
                .single()
            if (!post) { console.log("Příspěvek neexistuje."); process.exit(1) }
            if (post.client_id !== client.id) { console.log("Příspěvek patří jinému klientovi — končím."); process.exit(1) }
            if (post.status === "posted") { console.log("Už je publikovaný — končím."); process.exit(1) }

            const conn = await getConnection(client.id)
            if (!conn || conn.status !== "connected") { console.log("Není živé připojení."); process.exit(1) }

            const mediaType = isMediumType(post.media_type)
                ? post.media_type
                : (String(post.image_url || "").includes("|") ? "carousel" : "image")
            const mediaUrls = parsePostMedia(post.image_url, post.media_type).urls

            console.log(`Typ: ${mediaType}, médií: ${mediaUrls.length}`)
            console.log(`Popisek: ${String(post.caption || "").replace(/\s+/g, " ").slice(0, 120)}…\n`)

            const adapter = getChannelAdapter("instagram", conn.transport)
            const result = await adapter.publish(
                { accessToken: conn.accessToken, externalUserId: conn.igUserId, transport: conn.transport },
                { channel: "instagram", body: post.caption || "", mediaUrls, mediaType: mediaType as any },
            )

            await supabaseAdmin.from("ig_posts").update({
                status: "posted",
                posted_at: new Date().toISOString(),
                ...(result.externalId ? { ig_media_id: result.externalId } : {}),
                ...(result.providerRef ? { publish_request_id: result.providerRef } : {}),
                permalink: result.permalink || null,
                updated_at: new Date().toISOString(),
            }).eq("id", post.id)

            console.log("✅ Publikováno")
            console.log(`   ig_media_id: ${result.externalId}`)
            console.log(`   permalink:   ${result.permalink ?? "—"}`)
            console.log(`   providerRef: ${result.providerRef ?? "—"}`)
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
