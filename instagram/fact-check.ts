/**
 * Faktická brána — druhá vrstva pravdivosti nad hotovým textem.
 * ============================================================
 * Kritik hodnotí STYL (hook, tělo, CTA, originalita). Post, který je stylisticky
 * skvělý a zároveň si vymyslel „už 25 let na trhu", projde kritikem na 9/10 — a
 * jménem klienta zalže. To je horší závada než nudný post: nudný post se pozná,
 * lživý ne, a odnese ho značka, ne my.
 *
 * Prevence žije v promptu (buildFactsSection → PRAVIDLO PRAVDIVOSTI). Tohle je
 * kontrola po napsání: jeden judge průchod (cross-family, viz judge.ts) vytáhne z
 * textu KONKRÉTNÍ tvrzení a porovná je proti povoleným zdrojům — ověřená fakta
 * značky, vybraný produkt, zadaný námět. Ke každému rizikovému tvrzení si vyžádá
 * `find`/`replace`, které se pak aplikují DETERMINISTICKY v kódu (stejná doktrína
 * jako verbatim hook v post-editingu: „oprav to prosím" model dodrží jen někdy,
 * záměna podřetězce vždy).
 *
 * Fail-open, ale nahlas: když judge nedoběhne, post projde a v logu je varování —
 * kvalita se nesmí degradovat POTICHU (viz CLAUDE.md). Když se oprava nepovede,
 * post projde označený jako `flagged` a dashboard u něj ukáže varování.
 */

import type { ClientConfig } from "./configs/types"
import { judgeText } from "./judge"

/** Jak dopadla brána — propisuje se do ig_generation_log.fact_status a do UI. */
export type FactStatus = "clean" | "repaired" | "flagged" | "skipped"

export interface FactClaim {
    /** Tvrzení, jak stojí v textu. */
    claim: string
    /** ok = podložené povoleným zdrojem, risk = nepodložené / v rozporu. */
    verdict: "ok" | "risk"
    /** Proč je to riziko (jen u risk). */
    reason?: string
    /** Přesný podřetězec textu k nahrazení (jen u risk). */
    find?: string
    /** Bezpečné znění bez nepodloženého tvrzení (jen u risk). */
    replace?: string
}

export interface FactCheckOutcome<T> {
    status: FactStatus
    /** Text po deterministicky aplikovaných opravách (nebo původní, když se nic neměnilo). */
    captionData: T
    /** Změnil se text? Volající pak musí zahodit spočítaný embedding. */
    changed: boolean
    /** Krátké popisy tvrzení, která zůstala nepodložená — do logu a do UI. */
    flags: string[]
    /** Doběhl judge? false = brána neproběhla (fail-open), ne „čisté". */
    judged: boolean
}

/** Zdroje, proti kterým se tvrzení ověřují. Cokoli mimo ně je nepodložené. */
export interface FactContext {
    product?: { name: string; type?: string; price?: string | null; description?: string | null } | null
    /** Zadaný námět / téma postu — uživatel za jeho pravdivost ručí. */
    topic?: string | null
    /** Reálná recenze zákazníka (u recenzních formátů) — citace je fakt. */
    review?: { quote: string; customer_name?: string | null } | null
    postTypeName?: string
}

/** Textová pole, která čte člověk (a proto můžou zalhat). imagePrompt je anglický
 *  popis scény pro renderer, ne tvrzení ke čtenáři — ten se neověřuje. */
function collectTexts(data: any): string[] {
    const out: string[] = []
    const push = (v: unknown) => { if (typeof v === "string" && v.trim()) out.push(v.trim()) }
    push(data?.hook)
    push(data?.body)
    push(data?.caption)
    push(data?.cta)
    push(data?.imageSubtext)
    for (const s of data?.slides || []) { push(s?.headline); push(s?.subtext) }
    for (const f of data?.frames || []) { push(f?.headline); push(f?.subtext) }
    for (const sc of data?.scenes || []) { push(sc?.narration) }
    return out
}

/**
 * Úklid po záměně. Když se z věty vyřízne nepodložené tvrzení, zbude po něm dvojitá
 * mezera, mezera před tečkou nebo věta začínající malým písmenem — naměřeno na první
 * ostré zkoušce brány. Text jde rovnou do postu, takže tohle nesmí zůstat na modelu.
 */
function tidy(v: string): string {
    let out = v
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/([,.!?;:]){2,}/g, "$1")
        .replace(/ +\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    // Velké písmeno po konci věty. Slova s velkým písmenem uvnitř (iPhone, eShop)
    // se nechávají být — oprava by z nich udělala překlep.
    out = out.replace(/([.!?]\s+)(\p{Ll})(\p{L}*)/gu, (m, sep, first, rest) =>
        /\p{Lu}/u.test(rest) ? m : sep + first.toUpperCase() + rest)
    return out.replace(/^(\p{Ll})(\p{L}*)/u, (m, first, rest) =>
        /\p{Lu}/u.test(rest) ? m : first.toUpperCase() + rest)
}

/**
 * Aplikuje opravy podřetězcem přes všechna čtená textová pole. Čistá funkce —
 * testuje ji scripts/test-prompt-assembly.ts bez volání modelu.
 *
 * Vrací i `missed`: `find`, které se v textu nenašlo, znamená, že si judge citaci
 * upravil (velké písmeno, jiná diakritika) a záměna neproběhla. O tom, jestli
 * tvrzení v postu zůstalo, ale rozhoduje HOTOVÝ text (viz checkCaptionFacts) —
 * překrývající se opravy jinak hlásí nález, který už mezitím vypadl.
 */
export function applyFactFixes<T>(data: T, fixes: { find: string; replace: string }[]): { data: T; applied: number; missed: string[] } {
    let applied = 0
    const missed: string[] = []
    const clone: any = JSON.parse(JSON.stringify(data))

    const fixString = (v: string): string => {
        let out = v
        for (const f of fixes) {
            if (!f.find || out.indexOf(f.find) === -1) continue
            out = out.split(f.find).join(f.replace)
        }
        // Uklízí se jen text, do kterého se sáhlo — nedotčené pole musí zůstat znak
        // po znaku stejné (hook se za chvíli vypaluje do obrázku).
        return out === v ? v : tidy(out)
    }
    const walkStrings = (obj: any, keys: string[]) => {
        for (const k of keys) if (typeof obj?.[k] === "string") obj[k] = fixString(obj[k])
    }

    // Kolik oprav vůbec někde sedí — spočítané PŘED zápisem, ať se `find` nepočítá
    // podruhé v textu, který už je opravený.
    const haystack = collectTexts(clone).join("\n")
    for (const f of fixes) {
        if (f.find && haystack.indexOf(f.find) !== -1) applied++
        else missed.push(f.find)
    }

    walkStrings(clone, ["hook", "body", "caption", "cta", "imageSubtext"])
    for (const s of clone?.slides || []) walkStrings(s, ["headline", "subtext"])
    for (const f of clone?.frames || []) walkStrings(f, ["headline", "subtext"])
    for (const sc of clone?.scenes || []) walkStrings(sc, ["narration"])

    return { data: clone as T, applied, missed }
}

/**
 * Prompt brány. Čistá funkce (exportovaná kvůli guardu) — ŽÁDNÉ volání modelu.
 */
export function buildFactCheckPrompt(config: ClientConfig, texts: string[], ctx: FactContext = {}): string {
    const facts = (config.brandFacts || []).filter(f => f?.text?.trim())
    const factList = facts.length > 0
        ? facts.map(f => `- ${f.text.trim()}${f.source ? ` (zdroj: ${f.source})` : ""}`).join("\n")
        : "(žádná — značka nemá zadaný ani jeden ověřený fakt, takže KAŽDÉ konkrétní tvrzení o značce je nepodložené)"

    const productBlock = ctx.product
        ? `\n## POVOLENÝ ZDROJ — VYBRANÝ PRODUKT (živý katalog)\nNázev: ${ctx.product.name}\n${ctx.product.type ? `Typ: ${ctx.product.type}\n` : ""}${ctx.product.price ? `Cena: ${ctx.product.price}\n` : ""}${ctx.product.description ? `Popis: ${ctx.product.description}\n` : ""}`
        : ""
    const topicBlock = ctx.topic
        ? `\n## POVOLENÝ ZDROJ — ZADANÝ NÁMĚT (za jeho pravdivost ručí uživatel)\n${ctx.topic}\n`
        : ""
    const reviewBlock = ctx.review
        ? `\n## POVOLENÝ ZDROJ — REÁLNÁ RECENZE\n„${ctx.review.quote}"${ctx.review.customer_name ? ` — ${ctx.review.customer_name}` : ""}\n`
        : ""

    return `Jsi faktický korektor českého marketingového textu pro značku "${config.name}" (${config.website}).
Nehodnotíš styl, hook ani kreativitu — jenom PRAVDIVOST. Styl řeší někdo jiný.

## POVOLENÝ ZDROJ — OVĚŘENÁ FAKTA O ZNAČCE
${factList}
${productBlock}${topicBlock}${reviewBlock}
## TEXT KE KONTROLE${ctx.postTypeName ? ` (formát: ${ctx.postTypeName})` : ""}
${texts.map((t, i) => `[${i + 1}] ${t}`).join("\n")}

## CO HLEDÁŠ
Konkrétní tvrzení, které si čtenář může ověřit a přistihnout značku při lži:
- číslo, procento, statistika, počet zákazníků / kusů / let
- rok, datum, doba působení („už od roku 1998", „patnáct let")
- cena, sleva, akce, dostupnost, otevírací doba, dodací lhůta
- ocenění, certifikát, členství, jméno třetí strany nebo partnera
- superlativ a nárok na výlučnost („největší", „jediný v ČR", „nejrychlejší")
- slib nebo garance („do 24 hodin", „garantujeme vrácení peněz")
- tvrzení o účincích (zdravotní, výkonnostní), které by muselo mít oporu

## JAK ROZHODUJEŠ
- **ok** = tvrzení doslova stojí v některém povoleném zdroji výš, nebo je to
  nezpochybnitelná obecná znalost (voda vře při 100 °C, Vánoce jsou v prosinci).
- **risk** = všechno ostatní. Sem patří i tvrzení, které JE nejspíš pravda, ale
  žádný zdroj výš ho neuvádí — model si ho vymyslel a nikdo ho nepotvrdil.
## CO NAOPAK NEOZNAČUJEŠ (naměřeno: brána tohle mazala a dělala z postů vatu)
- Obrazné, subjektivní a náladové formulace („nejlepší ráno", „miluju tenhle kousek",
  „voní jako léto"). Hledáš čísla a nároky, ne poezii.
- Detaily z vyprávění o běžném dni — čas („v pět ráno je v peci plno"), počasí, pořadí
  úkonů, smyslový popis. Zákazník na nich značku nechytí za slovo, a právě ony dělají
  post konkrétním. Označ je JEN tehdy, když z nich plyne slib zákazníkovi: otevírací
  doba, dodací lhůta, termín, dostupnost.
- Popis vlastního produktu, který sedí na jeho popis v katalogu výš.
- Ustálené obraty a nadsázka, kterou nikdo nečte jako údaj („nekonečně dlouho",
  „milionkrát ověřeno").
- Když je textů víc, ber je jako jeden příspěvek.

## OPRAVA (jen u verdiktu "risk")
- \`find\` = PŘESNÝ podřetězec z textu výš, znak po znaku, včetně diakritiky a
  interpunkce. Nic nepřepisuj, nezkracuj, needituj velikost písmen. Ber nejkratší
  úsek, který nepodložené tvrzení obsahuje (ideálně celou větu).
- \`replace\` = tentýž úsek bez nepodloženého tvrzení. Zachovej tón, rytmus i délku
  a hlavně SMYSL věty. Neuváděj místo čísla jiné číslo.
- ⚠️ NEHEDGUJ. „Dlouhá léta", „mnoho zákazníků", „spousta lidí", „jedni z nejlepších"
  jsou pořád tvrzení, jen rozmazaná — a text je po nich vata. Když se konkrétní údaj
  nedá podložit, buď ho VYPUSŤ (prázdný \`replace\`, když věta bez něj dává smysl),
  nebo ho vyměň za smyslový detail, který se nedá zpochybnit, protože ho vidíš:
  „chleba, co při krájení chrupe", „ráno v pět je v peci plno". Konkrétní obraz místo
  vymyšleného čísla — ne vágní náhražka téhož tvrzení.

## VÝSTUP — vrať POUZE validní JSON:
{
  "claims": [
    { "claim": "citace tvrzení", "verdict": "ok" | "risk", "reason": "proč (jen u risk, max 12 slov)", "find": "přesný podřetězec (jen u risk)", "replace": "opravené znění (jen u risk)" }
  ]
}
Když text žádné konkrétní tvrzení neobsahuje, vrať {"claims": []}.`
}

/**
 * Ověří hotový text proti povoleným zdrojům a deterministicky opraví, co je
 * nepodložené. Nikdy nevyhazuje — post se nesmí zabít kvůli bráně; selhání je ale
 * v logu vidět.
 */
export async function checkCaptionFacts<T>(
    config: ClientConfig,
    captionData: T,
    ctx: FactContext = {},
): Promise<FactCheckOutcome<T>> {
    const base: FactCheckOutcome<T> = { status: "skipped", captionData, changed: false, flags: [], judged: false }

    if (config.factCheck === false) return base
    const texts = collectTexts(captionData)
    if (texts.length === 0) return base

    let claims: FactClaim[]
    try {
        const raw = await judgeText(buildFactCheckPrompt(config, texts, ctx), { label: "fact-check" })
        const match = raw.match(/\{[\s\S]*\}/)
        const parsed = JSON.parse(match?.[0] || raw)
        claims = Array.isArray(parsed?.claims) ? parsed.claims : []
    } catch (err: any) {
        // Fail-open, nahlas: text projde neověřený, ale musí to být v logu.
        console.warn(`   ⚠️ Faktická brána nedoběhla — post jde bez kontroly faktů: ${String(err?.message || err).slice(0, 120)}`)
        return base
    }

    const risky = claims.filter(c => c?.verdict === "risk")
    if (risky.length === 0) return { ...base, status: "clean", judged: true }

    const fixes = risky
        .filter(c => typeof c.find === "string" && c.find.trim().length > 0 && typeof c.replace === "string")
        .map(c => ({ find: c.find as string, replace: c.replace as string }))

    const { data, missed } = applyFactFixes(captionData, fixes)
    const changed = JSON.stringify(data) !== JSON.stringify(captionData)

    // Nevyřešené = to, co je po opravě pořád v textu. Rozhoduje HOTOVÝ text, ne
    // účetnictví oprav: opravy se překrývají (delší věta spolkne kratší tvrzení
    // uvnitř sebe), takže „tenhle claim neměl vlastní find" ještě neznamená, že
    // v postu zůstal — naměřeno na první ostré zkoušce, kde brána označila post
    // za rizikový kvůli ocenění, které z něj sama předtím vyhodila.
    const after = collectTexts(data).join("\n")
    const unresolved = risky.filter(c => {
        const needle = (c.find && c.find.trim()) || c.claim
        if (needle && after.indexOf(needle) === -1) return false
        return true
    })
    if (missed.length > 0) {
        // Judge si citaci upravil (velikost písmen, diakritika) → záměna neproběhla.
        // Nemusí to být závada (tvrzení mohla vyhodit jiná, delší oprava), ale musí
        // to jít vidět, jinak se brána tváří pilněji, než je.
        console.warn(`   ⚠️ Faktická brána: ${missed.length}× se citace netrefila do textu (${missed[0].slice(0, 60)}…)`)
    }

    const flags = unresolved.map(c => `${c.claim}${c.reason ? ` (${c.reason})` : ""}`.slice(0, 160))
    const status: FactStatus = unresolved.length > 0 ? "flagged" : "repaired"

    return { status, captionData: data, changed, flags, judged: true }
}
