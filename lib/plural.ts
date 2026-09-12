/**
 * České skloňování počítaných podstatných jmen.
 *
 * Čeština má tři tvary podle počtu: 1 příspěvek, 2–4 příspěvky, 5+ příspěvků.
 * Anglická logika `n === 1 ? a : b` tu vyrábí „12 obrázek", což na marketingové
 * stránce působí jako strojový překlad — přesně dojem, který produkt prodávající
 * český obsah nesmí budit.
 *
 * V dashboardu se to řeší inline na několika místech; tohle je první sdílená
 * verze, ať se to nemusí psát počtvrté.
 */

export interface PluralForms {
    /** 1 */
    one: string
    /** 2–4 */
    few: string
    /** 0, 5 a víc */
    many: string
}

export function plural(n: number, forms: PluralForms): string {
    if (n === 1) return forms.one
    if (n >= 2 && n <= 4) return forms.few
    return forms.many
}

/** `12 příspěvků` — číslo i tvar najednou, protože se skoro vždycky chtějí spolu. */
export function countLabel(n: number, forms: PluralForms): string {
    return `${n} ${plural(n, forms)}`
}

export const POSTS: PluralForms = { one: "příspěvek", few: "příspěvky", many: "příspěvků" }
export const CAROUSELS: PluralForms = { one: "karusel", few: "karusely", many: "karuselů" }
export const REELS: PluralForms = { one: "reel", few: "reely", many: "reelů" }
export const IMAGES: PluralForms = { one: "obrázek", few: "obrázky", many: "obrázků" }
export const BRANDS: PluralForms = { one: "značka", few: "značky", many: "značek" }
export const CREDITS: PluralForms = { one: "kredit", few: "kredity", many: "kreditů" }
/** „1 zájemce / 3 zájemci / 7 zájemců" — obchodní fronta v denním přehledu. */
export const LEADS: PluralForms = { one: "zájemce", few: "zájemci", many: "zájemců" }
export const MONTHS: PluralForms = { one: "měsíc", few: "měsíce", many: "měsíců" }
/** „26 dní" — kolik dní něco trvá. Ne „před 26 dny", to je jiný pád. */
export const DAYS: PluralForms = { one: "den", few: "dny", many: "dní" }
/**
 * 7. pád po předložce „před": „před 1 dnem", „před 3 dny", „před 26 dny".
 *
 * Vlastní tvar, protože `DAYS` je 1. pád a po „před" z něj vyjde „před 26 dní".
 * Pro 2+ je tvar shodný, ale jedničku to zachrání — a ta padne pokaždé, když se
 * něco stalo předevčírem.
 */
export const DAYS_AGO: PluralForms = { one: "dnem", few: "dny", many: "dny" }
