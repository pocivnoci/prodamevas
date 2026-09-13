'use server'

/**
 * Kontakt z landingu — finální CTA veřejné stránky.
 *
 * Dřív to byl waitlist: „dáme vám vědět, až otevřeme". To je slib, který se
 * nedá porušit, protože nic neslibuje — a taky se podle toho choval: v tabulce
 * seděli lidé od května 2026 a nikdo se jim neozval. Teď se stránka ptá na
 * kontakt s jasným závazkem, že se ozve člověk, a `lib/agents/sales/digest.ts`
 * hlídá, že se to stalo.
 *
 * Zapisuje se pořád do tabulky `waitlist` — visí na ní pozvánkový agent, admin
 * sekce i mailingový segment. Přejmenovat ji kvůli textu na tlačítku by bylo
 * tři soubory rizika za nic.
 *
 * Akce je VEŘEJNÁ (formulář na landingu), takže si validuje sama a nespoléhá
 * na klienta: klientská kontrola je pro rychlou hlášku, tahle pro data.
 */

import supabaseAdmin from '@/supabase/admin'
import { normalizeTermMonths } from '@/lib/pricing'
import { actionTranslator } from '@/lib/i18n/actions'

/** Delší adresa než tohle není adresa, ale pokus o zaplnění sloupce. */
const MAX_LEN = 200

export interface ContactResult {
    success: boolean
    error?: string
}

function cleanText(v: FormDataEntryValue | null, max = MAX_LEN): string | null {
    const s = typeof v === 'string' ? v.trim() : ''
    return s ? s.slice(0, max) : null
}

/**
 * Telefon se ukládá tak, jak ho člověk napsal, jen bez balastu — normalizovat
 * české a zahraniční tvary na jeden by znamenalo hádat, a obchod stejně volá
 * očima. Odmítá se jen to, co číslo být nemůže.
 */
function cleanPhone(v: FormDataEntryValue | null): string | null {
    const s = cleanText(v, 40)
    if (!s) return null
    const digits = s.replace(/\D/g, '')
    return digits.length >= 9 ? s : null
}

/** `vasefirma.cz` i `https://vasefirma.cz/o-nas` musí projít stejně. */
function cleanWebsite(v: FormDataEntryValue | null): string | null {
    const s = cleanText(v)
    if (!s) return null
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
    try {
        const u = new URL(withScheme)
        // Bez tečky to není doména, jen překlep — a obchod by z toho nic nezjistil.
        return u.hostname.includes('.') ? u.toString() : null
    } catch {
        return null
    }
}

export async function leaveContact(formData: FormData): Promise<ContactResult> {
    const t = await actionTranslator('actionsAccount')
    const email = cleanText(formData.get('email'))?.toLowerCase() ?? null

    if (!email) {
        return { success: false, error: t('contact.leaveContact.emailRequired') }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { success: false, error: t('contact.leaveContact.emailInvalid') }
    }

    const phone = cleanPhone(formData.get('phone'))
    const website = cleanWebsite(formData.get('website'))

    // Který tarif a období si člověk vybral na ceníku. Nepovinné (formulář je
    // i mimo ceník) a nikdy se nebere doslova — období prochází normalizací,
    // aby se do DB nedostalo „24" ani „<script>".
    const planInterest = cleanText(formData.get('planInterest'), 60)
    const rawTerm = formData.get('termInterest') as string | null
    const termInterest = rawTerm ? normalizeTermMonths(rawTerm) : null

    const row = {
        email,
        phone,
        website,
        plan_interest: planInterest,
        term_interest: termInterest,
    }

    const { error } = await supabaseAdmin.from('waitlist').insert(row)

    if (!error) return { success: true }

    if (error.code === '23505') {
        // Už tu je. Druhé odeslání ale obvykle NESE víc než první — člověk se
        // vrátil a připsal telefon nebo web. Přepsat se smí jen to, co přišlo:
        // prázdné pole nesmí smazat číslo, které tam z minula je.
        const patch = Object.fromEntries(
            Object.entries(row).filter(([k, v]) => k !== 'email' && v !== null),
        )
        // `created_at` se ZÁMĚRNĚ nesahá — je to doklad, jak dlouho člověk čeká,
        // a ten se posunutím na dnešek ztratí.
        if (Object.keys(patch).length > 0) {
            const { error: upErr } = await supabaseAdmin
                .from('waitlist').update(patch).eq('email', email)
            if (upErr) console.error('Kontakt: doplnění řádku selhalo —', upErr.message)
        }
        return { success: true }
    }

    console.error('Kontakt z landingu selhal:', error.message)
    return { success: false, error: t('contact.leaveContact.failed') }
}
