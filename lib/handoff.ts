/**
 * Předání značky zákazníkovi — včetně toho, kdo ještě nemá účet.
 * ═════════════════════════════════════════════════════════════
 * `user_clients` umí navázat jen existující `auth.users.id`. Značka onboardovaná
 * správcem za zákazníka tak patřila správci a předat ji šlo až ve chvíli, kdy si
 * zákazník sám udělal účet — což je přesně ten okamžik, na který si nikdo
 * nevzpomene.
 *
 * Tenhle modul drží **slib**: řádek v `client_handoffs` říká „až se přihlásí
 * tenhle e-mail, je klient jeho". Slib se zabírá podmíněným UPDATEm při prvním
 * přihlášení, takže dvě souběžná přihlášení nevytvoří dvě vazby.
 *
 * Účty se odsud **nezakládají**. Tiché založení účtu by obešlo potvrzení adresy
 * i souhlasy; zákazník se registruje sám, jen s kódem, který mu slib přibalí.
 *
 * Modul zůstává bez závislosti na poště a na `lib/mail/*`: sahá na něj
 * `lib/invite-gate.ts`, který běží u každého přihlášení. Odesílání pozvánky
 * je v `app/actions/admin-actions.ts`, kde je komu ji poslat.
 */

import supabaseAdmin from "@/supabase/admin"

export interface PendingHandoff {
    id: string
    client_id: string
    email: string
    invite_code: string | null
    invited_by: string | null
    created_at: string
}

/** E-mail je tu klíč. Supabase ho nerozlišuje velikostí písmen, tak ho nerozlišujeme taky. */
export function normalizeEmail(email: string | null | undefined): string {
    return (email || "").trim().toLowerCase()
}

/**
 * Jednorázový kód pozvánky pro předání.
 *
 * Znaky bez dvojznačností (žádné 0/O, 1/I) — kód se přepisuje z e-mailu ručně,
 * když se odkaz rozbije o firemní filtr. `invite_codes.code` je unique, takže
 * kolize se pozná zápisem, ne dotazem předem.
 */
async function mintInviteCode(): Promise<string | null> {
    const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for (let attempt = 0; attempt < 5; attempt++) {
        const suffix = Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("")
        const code = `ZNACKA-${suffix}`
        const { error } = await supabaseAdmin
            .from("invite_codes")
            .insert({ code, max_uses: 1, is_active: true })
        if (!error) return code
        // 23505 = unique violation → jen smůla v losování, zkus jiný kód.
        if (error.code !== "23505") {
            console.error(`🚨 handoff: kód pozvánky se nepodařilo založit: ${error.message}`)
            return null
        }
    }
    console.error("🚨 handoff: pětkrát po sobě kolize kódu pozvánky — něco je špatně s generátorem")
    return null
}

/**
 * Zapíše slib předání. Opakované předání témuž člověku vrátí **týž** řádek
 * i týž kód — správce, který klikne dvakrát, nemá rozesílat dva různé kódy.
 */
export async function stageHandoff(opts: {
    clientId: string
    email: string
    invitedBy?: string | null
}): Promise<{ handoff: PendingHandoff; reused: boolean } | { handoff: null; error: string }> {
    const email = normalizeEmail(opts.email)
    if (!email) return { handoff: null, error: "Chybí e-mail." }

    const { data: existing } = await supabaseAdmin
        .from("client_handoffs")
        .select("id, client_id, email, invite_code, invited_by, created_at")
        .eq("client_id", opts.clientId)
        .eq("email", email)
        .is("claimed_at", null)
        .is("cancelled_at", null)
        .maybeSingle()

    if (existing) return { handoff: existing as PendingHandoff, reused: true }

    // Kód se razí PŘED zápisem slibu: slib bez kódu je slib, na který se
    // zákazník nemá jak zaregistrovat, dokud je brána bety zavřená.
    const inviteCode = await mintInviteCode()

    const { data, error } = await supabaseAdmin
        .from("client_handoffs")
        .insert({
            client_id: opts.clientId,
            email,
            invite_code: inviteCode,
            invited_by: opts.invitedBy ?? null,
        })
        .select("id, client_id, email, invite_code, invited_by, created_at")
        .single()

    if (error || !data) {
        return { handoff: null, error: error?.message || "Slib předání se nepodařilo uložit." }
    }
    return { handoff: data as PendingHandoff, reused: false }
}

/** Čeká na tenhle e-mail nějaká značka? Čte, nic nemění — používá to brána bety. */
export async function hasPendingHandoff(email: string | null | undefined): Promise<boolean> {
    const needle = normalizeEmail(email)
    if (!needle) return false
    const { data } = await supabaseAdmin
        .from("client_handoffs")
        .select("id")
        .eq("email", needle)
        .is("claimed_at", null)
        .is("cancelled_at", null)
        .limit(1)
    return !!data?.length
}

/**
 * Zabere všechny sliby čekající na tenhle účet a založí vazby.
 *
 * Volá se hned po bráně při KAŽDÉM přihlášení — ne jen po registraci. Slib totiž
 * může vzniknout i pro účet, který už existuje a jen se zrovna nepřihlásil.
 *
 * Claim je podmíněný UPDATE: když řádek mezitím zabral jiný souběžný request,
 * `select` nevrátí nic a **je to konec, ne důvod zapisovat vazbu podruhé**.
 * Když naopak selže zápis vazby, claim se vrací zpátky — jinak by slib zmizel,
 * aniž by kdy něco předal.
 */
export async function claimHandoffs(user: { id: string; email?: string | null }): Promise<number> {
    const email = normalizeEmail(user.email)
    if (!email) return 0

    const { data: pending } = await supabaseAdmin
        .from("client_handoffs")
        .select("id, client_id")
        .eq("email", email)
        .is("claimed_at", null)
        .is("cancelled_at", null)

    if (!pending?.length) return 0

    let linked = 0
    for (const row of pending) {
        const { data: claimed } = await supabaseAdmin
            .from("client_handoffs")
            .update({ claimed_at: new Date().toISOString(), claimed_by: user.id })
            .eq("id", row.id)
            .is("claimed_at", null)
            .is("cancelled_at", null)
            .select("id")

        if (!claimed?.length) continue

        const { error } = await supabaseAdmin
            .from("user_clients")
            .upsert({ user_id: user.id, client_id: row.client_id, role: "owner" }, { onConflict: "user_id,client_id" })

        if (error) {
            console.error(`🚨 handoff: vazba na klienta ${row.client_id} selhala (${error.message}) — vracím slib zpět`)
            await supabaseAdmin
                .from("client_handoffs")
                .update({ claimed_at: null, claimed_by: null })
                .eq("id", row.id)
            continue
        }

        // Kód pozvánky svou práci odvedl. Nechat ho aktivní by z e-mailu
        // o předání udělal univerzální vstupenku do bety pro kohokoli dalšího.
        const { data: handoff } = await supabaseAdmin
            .from("client_handoffs")
            .select("invite_code")
            .eq("id", row.id)
            .maybeSingle()
        if (handoff?.invite_code) {
            await supabaseAdmin
                .from("invite_codes")
                .update({ is_active: false })
                .eq("code", handoff.invite_code)
        }

        linked++
        console.log(`🤝 handoff: klient ${row.client_id} předán účtu ${email}`)
    }
    return linked
}
