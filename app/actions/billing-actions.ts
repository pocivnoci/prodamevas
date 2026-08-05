"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"

/**
 * Fakturační údaje zákazníka + přehled vystavených dokladů.
 *
 * Údaje jsou vázané na klienta (tenanta), ne na uživatele — fakturuje se
 * projektu, ne konkrétnímu člověku, který se zrovna přihlásil.
 */

export type CustomerType = "company" | "consumer"

export interface BillingDetailsInput {
    customerType: CustomerType
    name: string
    ico?: string
    dic?: string
    street: string
    city: string
    zip: string
    countryCode?: string
    email?: string
}

export interface BillingDetailsRecord extends BillingDetailsInput {
    /** Kdy zákazník souhlasil se zpřístupněním služby ihned. */
    instantAccessConsentAt: string | null
}

export interface InvoiceRecord {
    id: string
    number: string | null
    status: string
    totalCzk: number | null
    currency: string
    publicUrl: string | null
    pdfUrl: string | null
    issuedAt: string | null
    createdAt: string
}

/** Prázdné → false. Validuje se jen tvar, ne existence v rejstříku. */
function isValidIco(ico: string): boolean {
    const digits = ico.replace(/\s/g, "")
    if (!/^\d{8}$/.test(digits)) return false
    // Modulo 11 kontrolní číslice — chytí překlepy dřív, než skončí na faktuře.
    const weights = [8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0)
    const remainder = sum % 11
    const check = remainder === 0 ? 1 : remainder === 1 ? 0 : 11 - remainder
    return check === Number(digits[7])
}

function isValidZip(zip: string): boolean {
    return /^\d{3} ?\d{2}$/.test(zip.trim())
}

// ─── Načtení ────────────────────────────────────────────

export async function getBillingDetails(projectSlug: string): Promise<BillingDetailsRecord | null> {
    const { clientId } = await requireProjectAccess(projectSlug)

    const { data } = await supabaseAdmin
        .from("ig_billing_details")
        .select("customer_type, name, ico, dic, street, city, zip, country_code, email, instant_access_consent_at")
        .eq("client_id", clientId)
        .maybeSingle()

    if (!data) return null

    return {
        customerType: data.customer_type === "consumer" ? "consumer" : "company",
        name: data.name,
        ico: data.ico || "",
        dic: data.dic || "",
        street: data.street,
        city: data.city,
        zip: data.zip,
        countryCode: data.country_code || "CZ",
        email: data.email || "",
        instantAccessConsentAt: data.instant_access_consent_at,
    }
}

// ─── Uložení ────────────────────────────────────────────

export async function saveBillingDetails(
    projectSlug: string,
    input: BillingDetailsInput
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const name = input.name?.trim()
        const street = input.street?.trim()
        const city = input.city?.trim()
        const zip = input.zip?.trim()

        if (!name) return { success: false, error: "Vyplňte jméno nebo název firmy." }
        if (!street) return { success: false, error: "Vyplňte ulici a číslo popisné." }
        if (!city) return { success: false, error: "Vyplňte město." }
        if (!zip || !isValidZip(zip)) return { success: false, error: "PSČ musí mít 5 číslic." }

        const ico = input.ico?.replace(/\s/g, "") || ""
        // IČO je povinné jen u firmy — spotřebitel žádné nemá.
        if (input.customerType === "company") {
            if (!ico) return { success: false, error: "U firmy je IČO povinné." }
            if (!isValidIco(ico)) return { success: false, error: "IČO není platné — zkontrolujte číslice." }
        }

        const { error } = await supabaseAdmin
            .from("ig_billing_details")
            .upsert({
                client_id: clientId,
                customer_type: input.customerType,
                name,
                ico: ico || null,
                dic: input.dic?.trim().toUpperCase() || null,
                street,
                city,
                zip,
                country_code: (input.countryCode || "CZ").toUpperCase(),
                email: input.email?.trim() || null,
                updated_at: new Date().toISOString(),
            }, { onConflict: "client_id" })

        if (error) return { success: false, error: error.message }
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err?.message || "Uložení selhalo." }
    }
}

// ─── Souhlas se zahájením plnění ────────────────────────

/**
 * Zaznamená souhlas se zpřístupněním služby před uplynutím 14denní lhůty
 * (§1837 obč. zák.). Bez tohohle záznamu právo spotřebitele na odstoupení
 * TRVÁ a případné vrácení peněz je vymahatelné — proto se ukládá i přesné
 * znění, se kterým zákazník souhlasil.
 *
 * Zapisuje se jen jednou: opakované potvrzení nesmí přepsat původní čas,
 * protože ten je tím, co se v případném sporu prokazuje.
 */
export async function recordInstantAccessConsent(
    projectSlug: string,
    consentText: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data: existing } = await supabaseAdmin
            .from("ig_billing_details")
            .select("client_id, instant_access_consent_at")
            .eq("client_id", clientId)
            .maybeSingle()

        if (!existing) {
            return { success: false, error: "Nejdřív vyplňte fakturační údaje." }
        }
        if (existing.instant_access_consent_at) {
            return { success: true } // už udělen — původní čas se nepřepisuje
        }

        const { error } = await supabaseAdmin
            .from("ig_billing_details")
            .update({
                instant_access_consent_at: new Date().toISOString(),
                instant_access_consent_text: consentText,
                updated_at: new Date().toISOString(),
            })
            .eq("client_id", clientId)
            .is("instant_access_consent_at", null) // podmíněný zápis — nikdy nepřepíše dřívější souhlas

        if (error) return { success: false, error: error.message }
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err?.message || "Uložení souhlasu selhalo." }
    }
}

// ─── Doklady ────────────────────────────────────────────

export async function listInvoices(projectSlug: string): Promise<InvoiceRecord[]> {
    const { clientId } = await requireProjectAccess(projectSlug)

    const { data } = await supabaseAdmin
        .from("invoices")
        .select("id, number, status, total_czk, currency, public_url, pdf_url, issued_at, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(50)

    return (data || []).map(row => ({
        id: row.id,
        number: row.number,
        status: row.status,
        totalCzk: row.total_czk,
        currency: row.currency || "CZK",
        publicUrl: row.public_url,
        pdfUrl: row.pdf_url,
        issuedAt: row.issued_at,
        createdAt: row.created_at,
    }))
}

/**
 * Je zákazník připraven zaplatit? Platební tlačítko na to nemusí čekat, ale
 * bez fakturačních údajů vystavíme doklad s náhradními údaji (viz lib/invoicing),
 * což je stav, do kterého se nechceme dostat.
 */
export async function hasBillingDetails(projectSlug: string): Promise<boolean> {
    const details = await getBillingDetails(projectSlug)
    return Boolean(details?.name && details.street && details.city && details.zip)
}
