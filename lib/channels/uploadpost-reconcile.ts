/**
 * Sesouhlasení `ig_connections` s upload-postem (server-only).
 * =============================================================
 * U mostu řádek `connected` neslibuje databáze, ale upload-post: autorizace proběhla
 * u nich a profil tam může zmizet (uvolněný slot) nebo nikdy nevzniknout (vyčerpaný
 * tarif). V našich datech to vidět není — Nastavení dál ukazuje „Připojeno" a
 * publisher posílá příspěvky na profil, který neexistuje.
 *
 * Jedno pravidlo, tři volající:
 *  - `syncUploadPostConnection` — tenant se vrací z upload-postu nebo klikne „Ověřit",
 *  - `scripts/uploadpost-reconcile.ts` — hromadná oprava,
 *  - denní health check — jen HLEDÁ (`findBridgeDrift`), nic nepřepisuje.
 *
 * Proč health check sám neopravuje: rozbitý tvar odpovědi upload-postu by jedním
 * nočním během odpojil všechny klienty naráz. Rozpor proto posuzuje odpověď pro
 * KONKRÉTNÍ profil (404 = profil není, jiná chyba = nevíme a nic se nemění), nikdy
 * seznam profilů, a zápis spouští tenant nebo člověk.
 */

import { getProfileStatus, uploadPostProfileName, type UploadPostProfileStatus } from "./uploadpost-profiles"

export type BridgeDriftKind =
    | "missing_profile"
    | "not_connected"
    | "reauth_required"
    | "account_mismatch"
    | "healed"

export interface StoredBridgeRow {
    status: "connected" | "expired" | "revoked"
    igUserId: string
}

/**
 * V čem náš řádek tvrdí něco jiného než upload-post. `null` = sedí.
 *
 * Čistá funkce — žádné I/O —, aby šla pravidla ověřit bez sítě i databáze.
 */
export function judgeBridgeConnection(stored: StoredBridgeRow, remote: UploadPostProfileStatus): BridgeDriftKind | null {
    // Zrušený řádek nic neslibuje: Nastavení nabízí „Připojit" a publisher ho odmítne.
    if (stored.status === "revoked") return null
    if (!remote.exists) return "missing_profile"
    if (!remote.connected) return "not_connected"
    if (remote.reauthRequired) return stored.status === "expired" ? null : "reauth_required"
    // Opačná lež: u nás „vypršelo", u nich funguje. Publisher takové příspěvky
    // odmítá jako nepřipojené, takže to doručení blokuje stejně jako chybějící profil.
    if (stored.status === "expired") return "healed"
    // Bez ID od upload-postu nemáme s čím porovnat — to není rozpor, jen neznalost.
    if (remote.instagramUserId && remote.instagramUserId !== stored.igUserId) return "account_mismatch"
    return null
}

const DRIFT_TEXT: Record<BridgeDriftKind, string> = {
    missing_profile: "u nás „připojeno“, ale profil u upload-postu neexistuje",
    not_connected: "u nás „připojeno“, ale v profilu u upload-postu Instagram není",
    reauth_required: "u nás „připojeno“, ale upload-post chce novou autorizaci",
    account_mismatch: "u nás je uložený jiný Instagram, než na jaký profil publikuje",
    healed: "u nás „vypršelo“, ale profil u upload-postu funguje",
}

export function describeBridgeDrift(kind: BridgeDriftKind): string {
    return DRIFT_TEXT[kind]
}

/**
 * Srovná řádek klienta s upload-postem a zapíše pravdu.
 *
 * Nepřipojený profil řádek PŘEPNE na `revoked`, nesmaže ho: platící klient s
 * rozbitým připojením se tak dál ukazuje v denním přehledu (client-health hlásí
 * `ig_disconnected`), místo aby zmizel, jako by se nikdy nepřipojil.
 *
 * Chyba volání upload-postu (cokoli kromě 404) se propaguje a nic se nezapíše —
 * výpadek poskytovatele nesmí nikoho odpojit.
 */
export async function reconcileBridgeConnection(
    clientId: string,
): Promise<{ connected: boolean; username: string | null }> {
    const remote = await getProfileStatus(clientId)
    const { getConnectionMeta, saveConnection, markRevoked } = await import("@/instagram/ig-connection")

    if (!remote.connected) {
        // Jen řádek mostu. Připojení přes vlastní Meta appku tahle cesta neřídí.
        const stored = await getConnectionMeta(clientId)
        if (stored?.transport === "uploadpost" && stored.status !== "revoked") await markRevoked(clientId)
        return { connected: false, username: null }
    }

    await saveConnection(clientId, {
        // upload-post hlásí číselné ID Instagramu pod `username` a @jméno pod `handle`
        // — obráceně, než napovídají názvy (viz readInstagram).
        igUserId: remote.instagramUserId || uploadPostProfileName(clientId),
        igUsername: remote.instagramUsername,
        // Přihlašovací údaj tenanta JE jméno profilu — API klíč je globální.
        accessToken: uploadPostProfileName(clientId),
        // Připojení přes most nevyprší; refresh cron se ho proto nesmí dotknout.
        expiresAt: null,
        transport: "uploadpost",
        // Propojené, ale s nutnou reautorizací NENÍ připojené: publikace by selhala.
        status: remote.reauthRequired ? "expired" : "connected",
        metadata: {
            profileUsername: uploadPostProfileName(clientId),
            igUsername: remote.instagramUsername,
            igUserId: remote.instagramUserId,
        },
    })
    return { connected: !remote.reauthRequired, username: remote.instagramUsername }
}

export interface BridgeDrift {
    clientId: string
    slug: string | null
    kind: BridgeDriftKind
    storedStatus: StoredBridgeRow["status"]
    storedUsername: string | null
}

/**
 * Všechny řádky mostu, které tvrdí něco jiného než upload-post. Jen čte.
 *
 * Profil po profilu, ne přes seznam: změna tvaru seznamu by vypadala jako
 * „všechny profily zmizely". A po jednom, ne souběžně — upload-post omezuje
 * na 100 požadavků za 5 minut.
 */
export async function findBridgeDrift(): Promise<BridgeDrift[]> {
    const { default: supabaseAdmin } = await import("@/supabase/admin")
    const { data, error } = await supabaseAdmin
        .from("ig_connections")
        .select("client_id, status, ig_user_id, ig_username, clients(slug)")
        .eq("provider", "instagram")
        .eq("transport", "uploadpost")
        .neq("status", "revoked")
    if (error) throw new Error(`ig_connections: ${error.message}`)

    const drift: BridgeDrift[] = []
    for (const row of data || []) {
        const remote = await getProfileStatus(row.client_id)
        const kind = judgeBridgeConnection({ status: row.status, igUserId: row.ig_user_id }, remote)
        if (!kind) continue
        const client = row.clients as { slug?: string } | { slug?: string }[] | null
        const slug = Array.isArray(client) ? client[0]?.slug : client?.slug
        drift.push({
            clientId: row.client_id,
            slug: slug ?? null,
            kind,
            storedStatus: row.status,
            storedUsername: row.ig_username,
        })
    }
    return drift
}
