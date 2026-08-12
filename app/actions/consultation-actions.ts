"use server"

/**
 * Vstupní schůzka ze studia.
 *
 * Peníze tudy nechodí — nákup jde stejnou cestou jako tarif
 * (`/api/payments/create`), aby se vystavil daňový doklad. Tyhle akce jenom
 * ukazují stav a podávají odkaz na rezervaci.
 */

import { requireProjectAccess } from "@/lib/auth-guard"
import { consultationBookingUrl, isBookingConfigured, pendingConsultation } from "@/lib/consultations"
import { CONSULTATION } from "@/lib/pricing"

export interface ConsultationState {
    /** Má klient schůzku (nárok, zaplacenou nebo rezervovanou)? */
    status: "none" | "entitled" | "paid" | "booked"
    /** Vznikla z předplatného (a je tedy v ceně), nebo se za ni platilo? */
    included: boolean
    scheduledAt: string | null
    bookingUrl: string | null
    /** Cena v haléřích, když si ji teprve má koupit. */
    priceHaleru: number
    durationMinutes: number
    /** Cal.com zapojený? Bez něj se termín domlouvá ručně a UI to musí říct. */
    bookingReady: boolean
}

export async function getConsultationState(projectSlug: string): Promise<ConsultationState> {
    const { clientId } = await requireProjectAccess(projectSlug)

    const base = {
        priceHaleru: CONSULTATION.priceHaleru,
        durationMinutes: CONSULTATION.durationMinutes,
        bookingReady: isBookingConfigured(),
    }

    const c = await pendingConsultation(clientId)
    if (!c) return { status: "none", included: false, scheduledAt: null, bookingUrl: null, ...base }

    return {
        status: c.status === "booked" ? "booked" : c.status === "paid" ? "paid" : "entitled",
        included: c.source === "term_6" || c.source === "term_12",
        scheduledAt: c.scheduledAt,
        bookingUrl: c.bookingUrl,
        ...base,
    }
}

/**
 * Odkaz na výběr termínu. Generuje se až na kliknutí, protože nese identitu
 * klienta — do statického HTML stránky nepatří.
 */
export async function getBookingLink(projectSlug: string): Promise<{ url: string }> {
    const { clientId, email } = await requireProjectAccess(projectSlug)
    return { url: await consultationBookingUrl(clientId, email) }
}
