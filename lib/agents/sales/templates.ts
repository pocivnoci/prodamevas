/**
 * Zpráva pro lead — jedna šablona, konkrétní první věta
 * =====================================================
 * Šablona drží jednotný, profesionální tvar u všech; konkrétní je **první věta**,
 * odvozená z týchž signálů, kterými se lead kvalifikoval (`qualify.ts`).
 *
 * Tři pravidla, která platí bez výjimky:
 *
 *  1. **Žádná příloha a žádný obrázek.** Ukázka žije na stránce za odkazem. Obrázek
 *     v nevyžádaném mailu je spamový signál a doručitelnost je tu důležitější než
 *     první dojem — spálenou doménu nespraví žádná konverze, a přestanou po ní
 *     chodit i potvrzení o platbě.
 *  2. **Neslibovat, co produkt neumí.** Slibuje se hotový obsah, ne dosah, ne
 *     prodeje, ne „porostete na Instagramu". Tohle hlídá i soudce (`judgeRubric`).
 *  3. **Identifikace odesílatele z `lib/legal.ts`.** IČO se nikdy nepíše natvrdo.
 */

import { LEGAL, formatIdentityLine } from "@/lib/legal"
import { openingLine, type LeadSignals } from "./qualify"

/** Nejdelší přípustná zpráva. Delší cold mail se nečte. */
export const MAX_WORDS = 90

export interface ComposedMessage {
    subject: string
    /** Čistý text — v mailu není HTML obrázek ani příloha. */
    text: string
    wordCount: number
}

/**
 * Tři varianty z playbooku (`brain/GTM/Kanály.md`): čas, peníze, výloha.
 * Vybírá se podle signálů, ne náhodně — u dlouho spícího profilu sedí „výloha",
 * u krátce spícího „čas".
 */
export type Angle = "cas" | "penize" | "vyloha"

export function pickAngle(s: LeadSignals, now: Date = new Date()): Angle {
    const idle = s.lastPostAt ? Math.floor((now.getTime() - s.lastPostAt.getTime()) / 86_400_000) : null
    if (idle !== null && idle >= 180) return "vyloha"
    if ((s.followers ?? 0) >= 3000) return "penize"
    return "cas"
}

const BODY: Record<Angle, (previewUrl: string) => string> = {
    cas: (url) =>
        `Nechal jsem naši AI vygenerovat ukázku příspěvků přímo z vašeho webu — vašimi barvami, o vašich věcech. ` +
        `Můžete se na ni podívat tady: ${url}\n\n` +
        `Chrlit umí připravit obsah na celý měsíc dopředu. Ukázka je zdarma a nezávazná.`,
    penize: (url) =>
        `Vygeneroval jsem z vašeho webu ukázku příspěvků — podívat se můžete tady: ${url}\n\n` +
        `Agentura si za měsíc obsahu řekne o 15 tisíc. Chrlit dělá totéž od 990 Kč měsíčně. ` +
        `Ukázka je zdarma a nezávazná.`,
    vyloha: (url) =>
        `Zákazníci si vás před návštěvou projedou na Instagramu — a ten teď působí, jako byste měli zavřeno. ` +
        `Vygeneroval jsem z vašeho webu ukázku, jak by mohl vypadat: ${url}\n\n` +
        `Ukázka je zdarma a nezávazná.`,
}

/**
 * Název firmy stojí VŽDY v apozici za pomlčkou nebo dvojtečkou, nikdy uvnitř věty.
 *
 * Čeština názvy skloňuje a my je skloňovat neumíme: „Instagram Kavárna Alchymista
 * vypadá…" pozná jako šablonu každý rodilý mluvčí na první pohled — a to u
 * produktu, jehož celý argument je „píšeme česky, ne strojovým překladem".
 * Apozice se neskloňuje, takže je to bezpečné u každého názvu.
 */
const SUBJECT: Record<Angle, (name: string) => string> = {
    cas: (n) => `${n} — ukázka příspěvků na Instagram`,
    penize: (n) => `${n} — ukázka Instagramu a co to stojí`,
    vyloha: (n) => `${n} — Instagram vypadá, jako byste měli zavřeno`,
}

/**
 * Podpis s identifikací odesílatele. Bez něj je to obchodní sdělení bez toho, kdo
 * ho posílá — a hlavně: příjemce musí vědět, kdo mu píše a jak se odhlásit.
 * Odkaz na odhlášení dolepuje odesílací vrstva (podepsaný, `lib/email-sign.ts`).
 */
export function signature(): string {
    // formatIdentityLine() je tentýž zdroj, ze kterého čerpají obchodní podmínky
    // i faktury — IČO se nikde nepíše natvrdo.
    return `— ${LEGAL.tradeName || LEGAL.name}, ${LEGAL.website}\n${formatIdentityLine()}`
}

export function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length
}

export function composeMessage(s: LeadSignals, previewUrl: string, now: Date = new Date()): ComposedMessage {
    const name = s.company?.trim() || s.igHandle?.replace(/^@/, "") || "vás"
    const angle = pickAngle(s, now)
    const text = `Dobrý den,\n\n${openingLine(s, now)} ${BODY[angle](previewUrl)}\n\n${signature()}`
    return { subject: SUBJECT[angle](name), text, wordCount: countWords(text) }
}

/**
 * Rubrika pro soudce (`instagram/judge.ts`, Claude — jiná rodina než pisatel).
 * Tohle je brána místo zakladatelova klikání: co neprojde, neodejde.
 *
 * Poslední bod je ten nejdůležitější — cold mail, který slíbí výsledky, je přesně
 * ta věc, kvůli které se firma dostane do potíží.
 */
export function judgeRubric(msg: ComposedMessage, s: LeadSignals): string {
    return `Jsi přísný kontrolor odchozích obchodních e-mailů. Dostaneš zprávu, která má odejít firmě.
Rozhodni, jestli smí odejít. Buď přísný — projít má jen zpráva, za kterou by se odesílatel nemusel stydět.

FIRMA: ${s.company ?? "?"} | web: ${s.website ?? "?"} | Instagram: ${s.igHandle ?? "?"}

ZPRÁVA:
"""
${msg.text}
"""

Zkontroluj:
1. KONKRÉTNOST — je první věta opravdu o TÉHLE firmě, nebo by beze změny seděla komukoli?
2. SLIBY — neslibuje výsledky (dosah, sledující, prodeje, "porostete")? Slíbit se smí jen
   hotový obsah a cena. Cokoli o výsledcích je důvod k zamítnutí.
3. PRAVDIVOST — netvrdí něco, co z uvedených údajů nevyplývá?
4. DÉLKA A TÓN — pod ${MAX_WORDS} slov, česky, věcně, bez patolízalství a bez vykřičníků?
5. IDENTIFIKACE — je pod zprávou, kdo ji posílá, včetně IČO?

Vrať JSON: {"pass": true/false, "score": 1-10, "problems": ["..."]}
Když je jediný bod porušený, "pass" je false.`
}
