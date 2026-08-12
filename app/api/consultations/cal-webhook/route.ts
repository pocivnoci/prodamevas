/**
 * POST /api/consultations/cal-webhook
 *
 * Cal.com hlásí, co se stalo s termínem. Routa dělá tři věci a nic víc:
 * ověří podpis, přeloží událost na náš stav a spustí přípravu podkladu.
 *
 * Obsluhované události:
 *   BOOKING_CREATED     termín rezervovaný → uložit + rozjet podklad na hovor
 *   BOOKING_RESCHEDULED přesunutý          → přepsat čas (podklad zůstává)
 *   BOOKING_CANCELLED   zrušený            → vrátit nárok zpět do fronty
 *
 * ⚠️ **Peníze tudy nikdy nechodí.** 990 Kč inkasujeme vlastní platební cestou,
 *    protože jen tak vznikne daňový doklad ve Fakturoidu. Cal.com o ceně nemusí
 *    vědět vůbec — dostane rezervaci až po zaplacení nebo z nároku.
 *
 * Klienta poznáváme z `metadata.clientId`, který do odkazu vkládá
 * `consultationBookingUrl()`. E-mail by nestačil: jeden člověk může mít víc
 * projektů a do formuláře napsat jiný.
 *
 * Lokální test:
 *   cal webhook → https://<tunel>/api/consultations/cal-webhook
 */

import { NextRequest } from "next/server"
import crypto from "crypto"

/**
 * Ověří HMAC podpis Cal.comu nad SYROVÝM tělem.
 *
 * Bez ověření by kdokoli poslal „rezervováno" a připsal si schůzku, na kterou
 * nemá nárok — webhook URL je veřejná. `timingSafeEqual` proto, že porovnání
 * řetězců přes `===` prozradí délku shodné předpony.
 */
function verifyCalSignature(rawBody: string, signature: string | null): boolean {
    const secret = process.env.CAL_WEBHOOK_SECRET
    if (!secret || !signature) return false
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
    const a = Buffer.from(expected, "utf8")
    const b = Buffer.from(signature, "utf8")
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

type CalPayload = {
    uid?: string
    startTime?: string
    metadata?: { clientId?: string; videoCallUrl?: string }
    attendees?: { email?: string; name?: string }[]
}

export async function POST(req: NextRequest) {
    if (!process.env.CAL_WEBHOOK_SECRET) {
        // Integrace není zapnutá — 503 říká „zkus později", ne „zahoď".
        return new Response("Cal.com není nakonfigurovaný", { status: 503 })
    }

    // Syrové tělo, ne req.json() — podpis se počítá z bajtů.
    const rawBody = await req.text()
    if (!verifyCalSignature(rawBody, req.headers.get("x-cal-signature-256"))) {
        console.error("🔒 Cal webhook: neplatný podpis")
        return new Response("Neplatný podpis", { status: 400 })
    }

    let event: { triggerEvent?: string; payload?: CalPayload }
    try {
        event = JSON.parse(rawBody)
    } catch {
        return new Response("Neplatné tělo", { status: 400 })
    }

    const trigger = event.triggerEvent
    const p = event.payload || {}
    const bookingUid = p.uid

    if (!bookingUid) {
        console.warn(`⚠️ Cal webhook: ${trigger} bez uid rezervace`)
        return Response.json({ received: true, handled: false })
    }

    const { recordBooking, releaseBooking } = await import("@/lib/consultations")

    if (trigger === "BOOKING_CANCELLED") {
        // Nárok zrušením termínu NEZANIKÁ — zákazník si vybere jiný.
        await releaseBooking(bookingUid)
        console.log(`🗓️ Termín ${bookingUid} zrušen, nárok vrácen do fronty`)
        return Response.json({ received: true, handled: true })
    }

    if (trigger !== "BOOKING_CREATED" && trigger !== "BOOKING_RESCHEDULED") {
        console.log(`🗓️ Cal webhook: ${trigger} — ignorováno`)
        return Response.json({ received: true, handled: false })
    }

    const clientId = p.metadata?.clientId
    if (!clientId || !p.startTime) {
        // Rezervace mimo náš odkaz (někdo si vzal termín přímo z Cal.comu).
        // Nezakládat nic naslepo — schůzka bez klienta je jen záznam v kalendáři.
        console.warn(`⚠️ Cal webhook: rezervace ${bookingUid} bez clientId nebo času`)
        return Response.json({ received: true, handled: false })
    }

    const consultationId = await recordBooking({
        clientId,
        bookingUid,
        bookingUrl: p.metadata?.videoCallUrl || null,
        scheduledAt: p.startTime,
    })

    // `null` = replay téhož webhooku. Podklad se nesmí generovat podruhé —
    // stojí kredity u modelu a přepsal by poznámky z prvního běhu.
    if (!consultationId) {
        console.log(`🗓️ Rezervace ${bookingUid} nic nezabrala — replay`)
        return Response.json({ received: true, handled: false })
    }

    // Podklad na hovor mimo kritickou cestu: Cal.com má dostat ACK hned,
    // generování trvá desítky sekund a jeho selhání nesmí shodit rezervaci.
    const { enqueueTask } = await import("@/lib/agent-runner")
    await enqueueTask({
        type: "consultation_brief",
        payload: { consultationId },
        clientId,
    })

    console.log(`🗓️ Termín ${p.startTime} zapsán (${bookingUid}), podklad zařazen`)
    return Response.json({ received: true, handled: true })
}
