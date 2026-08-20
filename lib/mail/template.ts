/**
 * Co je šablona.
 * ==============
 * Šablona je **čistá funkce** `vars → { subject, blocks }`. Nesahá na databázi
 * ani na `lib/notifications` (aserce 29.1) — data si obstará volající. Díky tomu
 * jde vyrenderovat v guardu bez `.env.local` i v náhledové galerii bez ohledu
 * na to, kdo je přihlášený.
 *
 * `fields` je schéma formuláře. Admin panel z něj vygeneruje vstupy, takže nová
 * šablona se v Mailingu objeví sama — bez zásahu do UI.
 */

import type { Block } from "./blocks"
import { renderEmail, type MailKind } from "./layout"

export type FieldType = "text" | "textarea" | "url" | "date"

export interface TemplateField {
    key: string
    label: string
    type: FieldType
    placeholder?: string
    required?: boolean
    help?: string
}

export interface TemplateDraft {
    subject: string
    eyebrow?: string
    preheader?: string
    blocks: Block[]
}

/** Proměnné šablony jsou vždy řetězce — jdou tak přenést z formuláře beze ztráty. */
export type TemplateVars = Record<string, string>

export interface EmailTemplate<V extends TemplateVars = TemplateVars> {
    id: string
    label: string
    group: "waitlist" | "subscription" | "news" | "promo" | "transactional"
    kind: MailKind
    /**
     * Zpráva uvádí cenu → musí nést větu o DPH. Neplátce, který napíše částku
     * bez „Nejsem plátce DPH", vypadá, jako by DPH zatajil. Hlídá aserce 29.8.
     */
    pricing?: boolean
    /** Nabízí se v Mailingu k hromadnému odeslání. Transakční se posílají samy. */
    broadcast?: boolean
    fields: TemplateField[]
    sample: V
    build: (vars: V) => TemplateDraft
}

export interface RenderedTemplate {
    subject: string
    html: string
    text: string
}

/** Šablona + proměnné → hotová zpráva v obou formátech. */
export function renderTemplate<V extends TemplateVars>(
    template: EmailTemplate<V>,
    vars: V,
    unsubscribeEmail?: string,
): RenderedTemplate {
    const draft = template.build(vars)
    const { html, text } = renderEmail({
        subject: draft.subject,
        preheader: draft.preheader,
        eyebrow: draft.eyebrow,
        blocks: draft.blocks,
        kind: template.kind,
        unsubscribeEmail,
    })
    return { subject: draft.subject, html, text }
}
