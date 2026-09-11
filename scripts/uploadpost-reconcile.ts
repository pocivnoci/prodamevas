/**
 * Ops: srovná `ig_connections` (transport uploadpost) s tím, co ví upload-post.
 *
 *   npx tsx scripts/uploadpost-reconcile.ts           → jen vypíše rozpory
 *   npx tsx scripts/uploadpost-reconcile.ts --apply   → a opraví je
 *
 * Oprava jde přes totéž jádro jako „Ověřit" v Nastavení
 * (`reconcileBridgeConnection`), takže skript neumí nic, co by tenant neudělal
 * jedním kliknutím — jen to udělá za všechny naráz. Rozbité připojení se přepne
 * na `revoked`, nesmaže.
 */

import { describeBridgeDrift, findBridgeDrift, reconcileBridgeConnection } from "@/lib/channels/uploadpost-reconcile"

async function main() {
    const apply = process.argv.includes("--apply")
    const drift = await findBridgeDrift()

    if (drift.length === 0) {
        console.log("\n✅ Všechna připojení přes most sedí s upload-postem.\n")
        return
    }

    console.log(`\n${drift.length}× rozpor:\n`)
    for (const d of drift) {
        const stored = `u nás ${d.storedStatus}${d.storedUsername ? ` @${d.storedUsername}` : ""}`
        console.log(`• ${d.slug ?? d.clientId} — ${describeBridgeDrift(d.kind)} (${stored})`)
        if (!apply) continue
        const res = await reconcileBridgeConnection(d.clientId)
        console.log(`   → ${res.connected ? `připojeno @${res.username ?? "—"}` : "přepnuto na revoked"}`)
    }

    if (!apply) console.log("\nNic jsem nezměnil. Opravit: npx tsx scripts/uploadpost-reconcile.ts --apply\n")
}

main().catch(err => {
    console.error("\n❌ Selhalo:", err?.message || err)
    process.exit(1)
})
