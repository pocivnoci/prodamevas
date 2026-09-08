/**
 * Kam vede finální CTA veřejných stránek.
 *
 * Kotva je jedna a bydlí v heru landingu, protože jen ten zná stav brány bety:
 * podle něj v ní stojí buď kontaktní formulář (ozve se obchod), nebo tlačítko
 * do registrace. Blog, portfolio i hlavička podstránek proto míří SEM a nemusí
 * o bráně nic vědět — jinak by se stav musel číst na pěti místech a čtyři z nich
 * by ho měly zapečený z buildu.
 *
 * Modul je schválně bez importů a bez `process.env`: sahá na něj klientský
 * landing i serverové stránky.
 */

/** `id` bloku s finálním CTA v heru landingu. */
export const CONTACT_ANCHOR = "kontakt"

/** Odkaz na finální CTA z jiné stránky než z landingu. */
export const CONTACT_HREF = `/#${CONTACT_ANCHOR}`
