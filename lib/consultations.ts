/**
 * Nastavení značky na míru — vstupní schůzka
 * ==========================================
 * Dělba rolí je tu záměrná a nesmí se rozmazat:
 *
 *   NAŠE:     peníze (`payments`, kvůli daňovému dokladu), nárok, stav schůzky,
 *             podklad pro hovor.
 *   Cal.com:  volné termíny, časová pásma, video hovor, připomínky.
 *
 * **Peníze přes Cal.com nikdy nejdou.** Kdyby 999 Kč inkasoval on svým Stripem,
 * nevystaví se doklad ve Fakturoidu — a to je zákonná povinnost, ne detail.
 * Cal.com dostane rezervaci až po zaplacení (nebo z nároku), takže o ceně
 * nemusí vědět vůbec.
 *
 * Schůzka vzniká dvěma cestami a obě končí ve stejném stavovém automatu:
 *   – jednorázový nákup za 999 Kč      → `paid`
 *   – předplatné na 6 nebo 12 měsíců   → `entitled` (v ceně, peníze se nehýbou)
 */

import supabaseAdmin from "@/supabase/admin"
import { CONSULTATION, consultationIncluded } from "@/lib/pricing"

export type ConsultationStatus = "entitled" | "paid" | "booked" | "completed" | "cancelled"
export type ConsultationSource = "purchase" | "term_6" | "term_12" | "manual"

export interface Consultation {
    id: string
    clientId: string
    status: ConsultationStatus
    source: ConsultationSource
    scheduledAt: string | null
    bookingUrl: string | null
    brief: string | null
}

/** Je Cal.com nakonfigurovaný? Bez něj se rezervace nenabízí, jen se o ní píše. */
export function isBookingConfigured(): boolean {
    return Boolean(process.env.CAL_EVENT_URL)
}

/**
 * Odkaz na rezervaci s předvyplněnou identitou.
 *
 * `metadata[clientId]` je to podstatné: webhook z Cal.comu jinak nemá podle čeho
 * rezervaci přiřadit ke klientovi — e-mail k tomu nestačí, jeden člověk může mít
 * víc projektů a do formuláře může napsat jiný.
 *
 * Když Cal.com nakonfigurovaný není, vrací se odkaz do studia; zákazník tam
 * uvidí, že se ozveme sami. Nikdy nevrací prázdný řetězec — mrtvé tlačítko
 * v potvrzovacím e-mailu je horší než upřímné „ozveme se".
 */
export async function consultationBookingUrl(clientId: string, email?: string | null): Promise<string> {
    const { siteUrl } = await import("@/lib/notifications")
    const base = process.env.CAL_EVENT_URL
    if (!base) return `${siteUrl()}/dashboard/instagram?sekce=nastaveni`

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("name")
        .eq("id", clientId)
        .maybeSingle()

    const u = new URL(base)
    u.searchParams.set("metadata[clientId]", clientId)
    if (client?.name) u.searchParams.set("name", client.name)
    if (email) u.searchParams.set("email", email)
    return u.toString()
}

/**
 * Udělí schůzku v ceně předplatného.
 *
 * Volá se po aktivaci zaplaceného tarifu. Idempotenci drží
 * `consultations_entitlement_uniq` (jeden nárok na klienta) — bez něj by každá
 * obnova ročního tarifu založila další schůzku zdarma.
 *
 * Nikdy nevyhazuje: nárok je bonus, ne podmínka aktivace. Kdyby selhal, zákazník
 * má zaplacený tarif a přijde o schůzku — což je oprava, ne důvod shodit platbu.
 */
export async function grantConsultationEntitlement(clientId: string, termMonths: number): Promise<boolean> {
    if (!consultationIncluded(termMonths)) return false

    try {
        const { data, error } = await supabaseAdmin
            .from("consultations")
            .insert({
                client_id: clientId,
                status: "entitled",
                source: termMonths === 12 ? "term_12" : "term_6",
            })
            .select("id")
            .maybeSingle()

        // 23505 = klient nárok už má. To není chyba, to je správný stav.
        if (error) {
            if (error.code === "23505") return false
            throw new Error(error.message)
        }
        console.log(`🎁 Nastavení značky v ceně (${termMonths} měs.) uděleno klientovi ${clientId} (${data?.id})`)
        return true
    } catch (err: any) {
        console.error(`⚠️ Nárok na nastavení značky se neudělil pro ${clientId}: ${err?.message}`)
        return false
    }
}

/** Schůzka, která ještě nemá termín — z ní chodí pobídka k rezervaci. */
export async function pendingConsultation(clientId: string): Promise<Consultation | null> {
    const { data } = await supabaseAdmin
        .from("consultations")
        .select("id, client_id, status, source, scheduled_at, booking_url, brief")
        .eq("client_id", clientId)
        .in("status", ["entitled", "paid", "booked"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!data) return null
    return {
        id: data.id,
        clientId: data.client_id,
        status: data.status as ConsultationStatus,
        source: data.source as ConsultationSource,
        scheduledAt: data.scheduled_at,
        bookingUrl: data.booking_url,
        brief: data.brief,
    }
}

/**
 * Zapíše rezervovaný termín z Cal.comu.
 *
 * Podmíněný claim na `booking_uid`: stejná rezervace dorazí opakovaně, dokud
 * webhook nedostane 2xx, a druhé doručení nesmí přepsat stav ani znovu spustit
 * generování podkladu.
 *
 * Vrací id konzultace, jen když se termín SKUTEČNĚ zapsal — volající podle toho
 * pozná, jestli má rozjet přípravu, nebo jde o replay.
 */
export async function recordBooking(input: {
    clientId: string
    bookingUid: string
    bookingUrl: string | null
    scheduledAt: string
}): Promise<string | null> {
    const now = new Date().toISOString()

    // Nejdřív navázat na čekající schůzku (nárok nebo zaplacenou).
    const { data: claimed } = await supabaseAdmin
        .from("consultations")
        .update({
            status: "booked",
            booking_uid: input.bookingUid,
            booking_url: input.bookingUrl,
            scheduled_at: input.scheduledAt,
            updated_at: now,
        })
        .eq("client_id", input.clientId)
        .in("status", ["entitled", "paid"])
        .is("booking_uid", null)
        .select("id")
        .maybeSingle()

    if (claimed) return claimed.id

    // Rezervace bez nároku — někdo si termín vzal přímo z Cal.comu. Termín se
    // nezahazuje: schůzka je domluvená a musí být vidět, jen je označená jako
    // ruční, aby bylo poznat, že za ni nikdo nezaplatil.
    const { data: created, error } = await supabaseAdmin
        .from("consultations")
        .insert({
            client_id: input.clientId,
            status: "booked",
            source: "manual",
            booking_uid: input.bookingUid,
            booking_url: input.bookingUrl,
            scheduled_at: input.scheduledAt,
        })
        .select("id")
        .maybeSingle()

    // 23505 = tuhle rezervaci už jsme zpracovali (replay). Konec, ne insert znovu.
    if (error) {
        if (error.code !== "23505") console.error(`⚠️ recordBooking: ${error.message}`)
        return null
    }
    return created?.id ?? null
}

/** Zrušený termín se vrací do fronty — nárok tím nezaniká. */
export async function releaseBooking(bookingUid: string): Promise<void> {
    const now = new Date().toISOString()
    const { data } = await supabaseAdmin
        .from("consultations")
        .select("id, payment_id, source")
        .eq("booking_uid", bookingUid)
        .maybeSingle()
    if (!data) return

    // Zaplacenou schůzku vracíme do 'paid', nárokovou do 'entitled' — zrušený
    // termín přece nesmí spolknout to, co si zákazník koupil.
    const back = data.source === "purchase" ? "paid" : data.source === "manual" ? "cancelled" : "entitled"
    await supabaseAdmin
        .from("consultations")
        .update({ status: back, booking_uid: null, booking_url: null, scheduled_at: null, updated_at: now })
        .eq("id", data.id)
}

export const CONSULTATION_PRICE_HALERU = CONSULTATION.priceHaleru
