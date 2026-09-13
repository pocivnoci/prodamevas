/**
 * Co je šablona.
 * ==============
 * Šablona je **čistá funkce** `(vars, t, locale) → { subject, blocks }`. Nesahá na
 * databázi ani na `lib/notifications` (aserce 29.1) — data si obstará volající.
 * Díky tomu jde vyrenderovat v guardu bez `.env.local` i v náhledové galerii bez
 * ohledu na to, kdo je přihlášený.
 *
 * Texty šablona nepíše sama: bere je z překladače nad `messages/<locale>/mail.json`
 * (namespace `mail`), protože e-mail mluví jazykem PŘÍJEMCE, ne requestu — skládá
 * se v callbacku, v cronech a v agentech bez cookie. Jazyk si šablona nezjišťuje;
 * `renderTemplate` jí předá hotový `t` a `locale` (pro `Intl`). Bez `locale` je to
 * čeština, takže stávající volající i guard renderují to, co dřív.
 *
 * `fields` je schéma formuláře. Admin panel z něj vygeneruje vstupy, takže nová
 * šablona se v Mailingu objeví sama — bez zásahu do UI.
 */

import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locales"
import type { Block } from "./blocks"
import { mailTranslatorSync, type MailTranslator } from "./i18n"
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
    /** Název pro picker v Mailingu — čte ho jen správce, zůstává česky. */
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
    /**
     * `vars → draft` v jazyce příjemce. `t` je překladač nad `mail.*`
     * (`t("templates.<id>.subject", { … })`, sdílené `common.*`), `locale` je po
     * ruce pro `Intl`. Marketingové šablony (news, offer, promo) `t` nepoužívají —
     * rozesílky jdou české bázi.
     */
    build: (vars: V, t: MailTranslator, locale: UiLocale) => TemplateDraft
}

export interface RenderedTemplate {
    subject: string
    html: string
    text: string
}

/**
 * Oslovení + tělo prvního odstavce. Jediné místo, kde se skládá „Dobrý den,\n\n…",
 * aby každý zákaznický e-mail otevíral stejně a překlad oslovení žil jednou.
 */
export function withGreeting(t: MailTranslator, body: string): string {
    return `${t("common.greeting")}\n\n${body}`
}

/**
 * Šablona + proměnné → draft (předmět a bloky) v jazyce příjemce, bez slupky.
 * Pro volající, kteří bloky posílají dál přes `sendNotification({ blocks })`.
 */
export function buildTemplate<V extends TemplateVars>(
    template: EmailTemplate<V>,
    vars: V,
    locale: UiLocale = DEFAULT_UI_LOCALE,
): TemplateDraft {
    return template.build(vars, mailTranslatorSync(locale, "mail"), locale)
}

/** Šablona + proměnné → hotová zpráva v obou formátech. Bez `locale` čeština. */
export function renderTemplate<V extends TemplateVars>(
    template: EmailTemplate<V>,
    vars: V,
    unsubscribeEmail?: string,
    /** Jazyk příjemce (`localeOfUser`, `localeOfClientOwner`) — řídí texty i chrome. */
    locale: UiLocale = DEFAULT_UI_LOCALE,
): RenderedTemplate {
    const draft = buildTemplate(template, vars, locale)
    const { html, text } = renderEmail({
        subject: draft.subject,
        preheader: draft.preheader,
        eyebrow: draft.eyebrow,
        blocks: draft.blocks,
        kind: template.kind,
        unsubscribeEmail,
        locale,
    })
    return { subject: draft.subject, html, text }
}
