/**
 * Přílohy odchozích e-mailů — meze a ověření na jednom místě.
 *
 * Žije to mimo `mailing-actions.ts` schválně: modul s `"use server"` smí
 * exportovat jen async funkce, takže by si stropy nemohl přečíst formulář
 * a musely by se opsat podruhé. Druhá kopie čísla je druhá pravda.
 *
 * Obsah jde k Resendu inline v jednom requestu, takže limit je zároveň stropem
 * na tělo server akce (`serverActions.bodySizeLimit` = 10 MB v `next.config.ts`).
 * Base64 obsah nafoukne o třetinu, takže z 10 MB zbývá ~7,5 MB skutečných dat —
 * a z toho musí odejít i samotná zpráva. Odtud 5 MB na soubor a 6 MB celkem;
 * to `test-mail-attachments.ts` hlídá proti opravdové hodnotě v `next.config.ts`,
 * aby zvednutí stropu příloh bez zvednutí stropu Nextu neskončilo neprůhledným
 * odmítnutím requestu ještě před ověřením.
 */

import type { MailAttachment } from "@/lib/email"

export const ATTACH_MAX_FILES = 3
export const ATTACH_MAX_FILE_BYTES = 5 * 1024 * 1024
export const ATTACH_MAX_TOTAL_BYTES = 6 * 1024 * 1024

export interface MailingAttachmentInput {
    filename: string
    /** base64 obsahu souboru, bez `data:` prefixu */
    content: string
    contentType?: string
}

/** Kolik bajtů má base64 řetězec po dekódování — bez toho, aby se dekódoval. */
export function base64Bytes(content: string): number {
    const clean = content.replace(/\s/g, "")
    const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0
    return Math.max(0, Math.floor((clean.length * 3) / 4) - padding)
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

/**
 * Ověří přílohy a vrátí je ve tvaru pro Resend.
 *
 * Jméno se ořezává na holý název souboru: klient ho posílá jak chce a cesta
 * (`../`, `C:\…`) v hlavičce přílohy nemá co dělat. Prázdný vstup → prázdno,
 * ne chyba: e-mail bez přílohy je normální stav.
 */
export function validateAttachments(list: MailingAttachmentInput[] | undefined): MailAttachment[] {
    if (!list?.length) return []
    if (list.length > ATTACH_MAX_FILES) {
        throw new Error(`Nejvýš ${ATTACH_MAX_FILES} přílohy na jeden e-mail.`)
    }

    let total = 0
    return list.map(a => {
        const filename = String(a.filename || "").split(/[\\/]/).pop()?.trim().slice(0, 120) || ""
        if (!filename) throw new Error("Příloha musí mít název souboru.")
        const content = String(a.content || "").replace(/\s/g, "")
        if (!content) throw new Error(`Příloha „${filename}" je prázdná.`)
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
            throw new Error(`Příloha „${filename}" není platný base64.`)
        }

        const bytes = base64Bytes(content)
        if (bytes > ATTACH_MAX_FILE_BYTES) {
            throw new Error(`Příloha „${filename}" má ${(bytes / 1024 / 1024).toFixed(1)} MB, strop je ${mb(ATTACH_MAX_FILE_BYTES)}.`)
        }
        total += bytes
        if (total > ATTACH_MAX_TOTAL_BYTES) {
            throw new Error(`Přílohy dohromady přesáhly ${mb(ATTACH_MAX_TOTAL_BYTES)}.`)
        }

        return { filename, content, ...(a.contentType ? { contentType: a.contentType } : {}) }
    })
}
