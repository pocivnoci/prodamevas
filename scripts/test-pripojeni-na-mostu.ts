/**
 * Aserce nad sesouhlasením připojení přes most (`lib/channels/uploadpost-reconcile.ts`).
 *   npx tsx scripts/test-pripojeni-na-mostu.ts
 *
 * Bez databáze a bez sítě. Hlídá, aby se `ig_connections` znovu potichu nerozešlo
 * s upload-postem — tedy aby Nastavení neukazovalo „Připojeno" u profilu, který
 * neexistuje, a publisher neposílal jedné značce příspěvky na cizí profil:
 *
 *  1. Pravidla rozporu (čistá funkce) — co je lež a co jen neznalost.
 *  2. „Jeden Instagram = jedna značka" drží databáze (částečný unikátní index),
 *     ne kontrola před zápisem, a kolize dojde k člověku jako věta.
 *  3. Nastavení i hromadná oprava jdou přes JEDNO jádro; rozbité připojení se
 *     přepíná na `revoked`, nemaže.
 *  4. Denní kontrola jen čte a ptá se profil po profilu, ne seznamem.
 */

import fs from "fs"
import { judgeBridgeConnection } from "../lib/channels/uploadpost-reconcile"
import type { UploadPostProfileStatus } from "../lib/channels/uploadpost-profiles"

let failed = 0
function check(name: string, ok: boolean, hint?: string) {
    if (ok) console.log(`  ✓ ${name}`)
    else { failed++; console.log(`  ✗ ${name}${hint ? `\n      ${hint}` : ""}`) }
}

const read = (p: string) => fs.readFileSync(p, "utf-8")

/** Tělo exportované funkce: od signatury po další `export`. */
function body(src: string, signature: string): string {
    const start = src.indexOf(signature)
    if (start < 0) return ""
    const next = src.indexOf("\nexport ", start + signature.length)
    return src.slice(start, next < 0 ? undefined : next)
}

const remote = (o: Partial<UploadPostProfileStatus> = {}): UploadPostProfileStatus => ({
    exists: true,
    instagramUsername: "znacka",
    instagramUserId: "111",
    connected: true,
    reauthRequired: false,
    ...o,
})
const gone = remote({ exists: false, connected: false, instagramUsername: null, instagramUserId: null })

console.log("\nPřipojení přes most — databáze nesmí slibovat víc než upload-post\n")

// ── 1. Pravidla rozporu ─────────────────────────────────────────────────────
check(
    "„připojeno“ u neexistujícího profilu je rozpor",
    judgeBridgeConnection({ status: "connected", igUserId: "111" }, gone) === "missing_profile",
    "Přesně tenhle stav měli kvetiny-nad-museem i klima-pohotovost.",
)
check(
    "profil bez připojeného Instagramu je rozpor",
    judgeBridgeConnection({ status: "connected", igUserId: "111" }, remote({ connected: false })) === "not_connected",
)
check(
    "nutná reautorizace u „připojeno“ je rozpor, u „vypršelo“ ne",
    judgeBridgeConnection({ status: "connected", igUserId: "111" }, remote({ reauthRequired: true })) === "reauth_required" &&
        judgeBridgeConnection({ status: "expired", igUserId: "111" }, remote({ reauthRequired: true })) === null,
)
check(
    "„vypršelo“ u funkčního profilu je rozpor (publisher by příspěvky odmítal)",
    judgeBridgeConnection({ status: "expired", igUserId: "111" }, remote()) === "healed",
)
check(
    "jiný Instagram v profilu než u nás je rozpor",
    judgeBridgeConnection({ status: "connected", igUserId: "999" }, remote()) === "account_mismatch",
    "klima-pohotovost měl uložené ID našeho @chrlit.cz.",
)
check(
    "když upload-post ID nehlásí, není s čím porovnat — to není rozpor",
    judgeBridgeConnection({ status: "connected", igUserId: "999" }, remote({ instagramUserId: null })) === null,
)
check(
    "sedící řádek rozpor není",
    judgeBridgeConnection({ status: "connected", igUserId: "111" }, remote()) === null,
)
check(
    "zrušený řádek nic neslibuje, takže nemůže lhát",
    judgeBridgeConnection({ status: "revoked", igUserId: "111" }, gone) === null,
)

// ── 2. Jeden Instagram = jedna značka ───────────────────────────────────────
const migration = read("supabase/migrations/20260911_jeden_instagram_jedna_znacka.sql")
const connection = read("instagram/ig-connection.ts")
check(
    "unikátní index na (provider, ig_user_id) jen mezi connected",
    /create unique index[\s\S]{0,80}ig_connections_jeden_ucet_jedna_znacka\s+on ig_connections \(provider, ig_user_id\)\s+where status = 'connected'/i.test(migration),
    "Bez `where` by vypršelý řádek jedné značky navždy blokoval účet pro všechny ostatní.",
)
check(
    "transport v klíči indexu není",
    !/on ig_connections \([^)]*transport/i.test(migration),
    "Tentýž účet přes most i přes Meta appku je pořád tentýž účet.",
)
check(
    "saveConnection čte kolizi 23505 na tomhle indexu jako větu pro člověka",
    /23505/.test(body(connection, "export async function saveConnection")) &&
        connection.includes(`ONE_ACCOUNT_INDEX = "ig_connections_jeden_ucet_jedna_znacka"`),
)
check(
    "saveConnection se před zápisem neptá, jestli účet už někdo nemá",
    !/\.eq\("ig_user_id"/.test(body(connection, "export async function saveConnection")),
    "„Zjisti a pak zapiš“ je závod — hranici drží index.",
)

// ── 3. Jedno jádro, žádné mazání ────────────────────────────────────────────
const reconcile = read("lib/channels/uploadpost-reconcile.ts")
const actions = read("app/actions/ig-connection-actions.ts")
const sync = body(actions, "export async function syncUploadPostConnection")
check(
    "Nastavení sesouhlasuje přes reconcileBridgeConnection",
    /reconcileBridgeConnection\(clientId\)/.test(sync) && !/saveConnection\(|disconnect\(/.test(sync),
    "Druhá kopie pravidla v server action je přesně to, co se rozejde.",
)
check(
    "sesouhlasení rozbité připojení přepne na revoked, nesmaže",
    /markRevoked\(clientId\)/.test(reconcile) && !/disconnect\(/.test(reconcile),
    "Smazaný řádek zmizí i z denního přehledu rizik — platící klient bez připojení by nebyl vidět.",
)
check(
    "Nastavení ukáže chybu sesouhlasení, ne „zatím nevidím“",
    /res\.error \|\| "Připojení zatím nevidím/.test(read("app/(dashboard)/dashboard/instagram/tabs/SettingsTab.tsx")),
)

// ── 4. Denní kontrola jen čte ───────────────────────────────────────────────
const find = body(reconcile, "export async function findBridgeDrift")
const health = read("lib/agents/health-check.ts")
check(
    "findBridgeDrift nic nezapisuje",
    find.length > 0 && !/\.update\(|\.delete\(|\.upsert\(|saveConnection|markRevoked|reconcileBridgeConnection/.test(find),
    "Kontrola, která při rozbité odpovědi poskytovatele sama zapisuje, odpojí všechny naráz.",
)
check(
    "findBridgeDrift se ptá profil po profilu, ne seznamem",
    /getProfileStatus\(/.test(find) && !/listProfileNames/.test(find),
    "Změna tvaru seznamu by vypadala jako „všechny profily zmizely“.",
)
check(
    "findBridgeDrift nevolá upload-post souběžně",
    !/Promise\.all/.test(find),
    "upload-post omezuje na 100 požadavků za 5 minut.",
)
check(
    "health check má kontrolu připojení na mostu",
    /safe\("připojení na mostu"[\s\S]{0,400}findBridgeDrift\(\)/.test(health),
)
check(
    "health check sesouhlasení nespouští",
    !/reconcileBridgeConnection/.test(health),
)

console.log(failed ? `\n✗ ${failed} aserce selhala\n` : "\n✓ vše drží\n")
if (failed) process.exit(1)
