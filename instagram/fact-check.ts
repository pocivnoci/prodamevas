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
 * značky, vybraný produkt, zadaný námět.
 *
 * Odpovědi jsou TŘI, ne dvě. Tvrzení o SVĚTĚ (zákon, norma, parametr cizího produktu)
 * pravda je, ale v `brandFacts` nikdy nebude — a brána z něj dřív dělala vatu. Takové
 * tvrzení jde na `instagram/fact-web.ts`, který ho buď doloží citací a odkazem, nebo
 * mlčí. Tvrzení o SAMOTNÉ ZNAČCE se na web nepouští nikdy: veřejný web o malém
 * klientovi nic neví a našel by leda jeho vlastní marketing opsaný jinde.
 *
 * Ke každému rizikovému tvrzení si judge vyžádá
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
import { verifyClaimsOnWeb, type FactSource, type WebCheckInput } from "./fact-web"
import { industryRiskFamily } from "@/lib/industry-risk"

export type { FactSource } from "./fact-web"

/**
 * Strop hledání na jeden příspěvek. Účtuje se $0,01 za hledání, takže tohle je
 * i cenový strop — a zároveň pojistka proti postu, kde si soudce usmyslí, že nejistých
 * tvrzení je patnáct.
 */
const MAX_WEB_CLAIMS = 5

/** Jak dopadla brána — propisuje se do ig_generation_log.fact_status a do UI. */
export type FactStatus = "clean" | "repaired" | "flagged" | "skipped"

export interface FactClaim {
    /** Tvrzení, jak stojí v textu. */
    claim: string
    /**
     * ok = podložené povoleným zdrojem
     * unsure = o SVĚTĚ nebo o třetí straně, může to rozsoudit veřejný zdroj → jde na web
     * risk = nepodložené / v rozporu, **a vždycky, když jde o tvrzení o samotné značce**
     */
    verdict: "ok" | "unsure" | "risk"
    /**
     * Čeho se tvrzení týká. Rozhoduje o tom, jestli se smí ověřovat na webu:
     * `brand` na web NIKDY nejde — veřejný web není autorita na malého klienta a
     * shodu by našel v jeho vlastním marketingu opsaném jinde. Filtruje to KÓD
     * (viz checkCaptionFacts), ne dobrá vůle modelu.
     */
    scope?: "brand" | "world"
    /** Co má ověřovatel hledat (jen u unsure). */
    query?: string
    /** Proč je to riziko (u risk; u unsure důvod, proč to chce doklad). */
    reason?: string
    /** Přesný podřetězec textu k nahrazení (u risk i unsure — web může mlčet). */
    find?: string
    /** Bezpečné znění bez nepodloženého tvrzení (u risk i unsure). */
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
    /** Co brána skutečně vyměnila (staré → nové). Do logu: „opraveno" bez seznamu
     *  je tvrzení o vlastní práci, které si nikdo nemůže ověřit — a přesně takovým
     *  tvrzením má tenhle modul bránit. */
    repairs: { claim: string; from: string; to: string }[]
    /** Doběhl judge? false = brána neproběhla (fail-open), ne „čisté". */
    judged: boolean
    /** Tvrzení doložená na webu, i s odkazem. Ukazují se u příspěvku — jednak proto,
     *  že nedoložitelný „doklad" je totéž co žádný, jednak protože citaci ke zdroji
     *  vyžaduje poskytovatel vyhledávání, když se výstup ukazuje uživateli. */
    sources: FactSource[]
}

/** Zdroje, proti kterým se tvrzení ověřují. Cokoli mimo ně je nepodložené. */
export interface FactContext {
    product?: { name: string; type?: string; price?: string | null; description?: string | null } | null
    /** Téma, které NAPSAL ČLOVĚK (options.topic). Za jeho pravdivost ručí on. */
    topic?: string | null
    /**
     * Nápad ze zásobníku. **NENÍ zdroj faktů**, i když tak vypadá.
     *
     * Nápady z 99 % píše `idea-generator.ts` a noční doplňovač — je to výstup modelu,
     * který nikdo nečetl. Kdyby platil jako povolený zdroj, vznikne pračka na
     * halucinace: model si vymyslí „25 let na trhu" do nápadu, copywriter to opíše do
     * postu a brána to posvětí, protože „to je přece v námětu". Nápad proto licencuje
     * TÉMA, ne čísla; ta musí stát v ověřených faktech.
     *
     * (Tabulka `ig_post_ideas` původ nerozlišuje, takže ručně přidaný nápad se posuzuje
     * stejně přísně. Jeho fakt patří stejně do seznamu faktů — tam vydrží napořád.)
     */
    idea?: string | null
    /**
     * Hook, který uživatel SCHVÁLIL v plánu.
     *
     * Mega prompt copywriterovi slibuje, že schválený hook zachová „včetně
     * konkrétnosti (čísla, jména, fakta)" — a brána o něm dosud nevěděla, takže ho
     * v režimu „opatrné" mohla přepsat. To je porušený slib: uživatel v plánu klikl
     * na konkrétní znění a v postu by našel jiné.
     *
     * Schválení je vědomý lidský úkon nad viditelným zněním (draft plánu je status
     * flip nad tím, co uživatel vidí v UI), takže hook platí jako zdroj — stejně jako
     * téma, které si napsal sám. Co copywriter přidá NAVÍC, se posuzuje normálně.
     */
    approvedHook?: string | null
    /** Reálná recenze zákazníka (u recenzních formátů) — citace je fakt. */
    review?: { quote: string; customer_name?: string | null } | null
    postTypeName?: string
    /**
     * Doklady, které tenhle příspěvek UŽ má (z předchozího běhu brány).
     *
     * Přehodnocení (retuš, „Je to pravda") pouští bránu nad hotovým textem znovu. Bez
     * tohohle by doložené tvrzení naskočilo jako nepodložené a štítek by se vrátil —
     * a hledání by se platilo podruhé za tentýž nález.
     */
    webVerified?: FactSource[] | null
    /**
     * Varování, které brána pověsila na `approvedHook` UŽ V PLÁNU a uživatel ho přesto
     * schválil (viděl ho u položky, než klikl).
     *
     * Schválený hook je povolený zdroj — mega prompt slíbil, že ho copywriter zachová,
     * a přepsat uživateli pod rukama znění, na které v plánu klikl, je porušený slib.
     * Ochrana se ale týká ZNĚNÍ, ne štítku: kdyby se varování tady ztratilo, doputuje
     * nepodložené tvrzení na kartu příspěvku jako „v pořádku". Připojuje se proto
     * k výsledku deterministicky v kódu, ne prosbou v promptu.
     */
    approvedHookFlag?: string | null
}

/**
 * Textová pole, která čte člověk (a proto můžou zalhat). imagePrompt je anglický
 *  popis scény pro renderer, ne tvrzení ke čtenáři — ten se neověřuje.
 *
 * `display: true` = text, který se VYPALUJE DO OBRÁZKU (hook, nadpisy slidů,
 * snímky story, podtext na coveru). Na plakátu o třech slovech je rozdíl mezi
 * opravou a vatou vidět okamžitě — naměřeno: „Vyrábíme od roku 1947" brána nejdřív
 * měnila na „Vyrábíme s dlouholetou tradicí", což je přesně ten korporátní blábol,
 * který má značka v anti-patterns. Proto brána musí vědět, co je nadpis.
 */
function collectTexts(data: any): { text: string; display: boolean }[] {
    const out: { text: string; display: boolean }[] = []
    const push = (v: unknown, display = false) => {
        if (typeof v === "string" && v.trim()) out.push({ text: v.trim(), display })
    }
    push(data?.hook, true)
    push(data?.body)
    push(data?.caption)
    push(data?.cta)
    push(data?.imageSubtext, true)
    for (const s of data?.slides || []) { push(s?.headline, true); push(s?.subtext, true) }
    for (const f of data?.frames || []) { push(f?.headline, true); push(f?.subtext, true) }
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
        if (out === v) return v
        const cleaned = tidy(out)
        // Pole se NIKDY nesmí vyprázdnit. Prázdná náhrada nad celým nadpisem sebere
        // hook — a ten je nosný dál: skládá se z něj caption, dedup, titulek karty
        // i text vypálený do obrázku. Radši ať tvrzení zůstane a příspěvek se označí
        // (unresolved to pozná z hotového textu) než aby se vyrenderoval prázdný
        // plakát. Naměřeno testem invariantů, ne odhadem.
        return cleaned.trim().length === 0 ? v : cleaned
    }
    const walkStrings = (obj: any, keys: string[]) => {
        for (const k of keys) if (typeof obj?.[k] === "string") obj[k] = fixString(obj[k])
    }

    // Kolik oprav vůbec někde sedí — spočítané PŘED zápisem, ať se `find` nepočítá
    // podruhé v textu, který už je opravený.
    const haystack = collectTexts(clone).map(t => t.text).join("\n")
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
 * Přitvrzení pro rizikový obor — prázdný řetězec pro kavárnu, odstavec pro izolatéra.
 *
 * Obecný prompt brány je psaný pro průměrného klienta, a průměrný klient je kavárna:
 * tvrzení „pečeme od pěti ráno" nikoho nepoškodí. U technického oboru je ale KAŽDÝ
 * parametr vlastní práce závazek, který se ověřuje reklamací, ne googlením — a brána
 * ho dřív pouštěla jako `unsure`, protože „norma se přece na webu najde". Norma ano,
 * vlastní izolace ne. Blok se proto točí kolem JEDNÉ hranice: čí je ten údaj.
 */
function buildRiskFamilyBlock(industry?: string): string {
    const family = industryRiskFamily(industry)
    if (!family) return ""

    if (family === "technical") {
        return `
## ⚠️ TECHNICKÝ / ŘEMESLNÝ OBOR — PŘÍSNĚJŠÍ PRAVIDLO NA PARAMETRY
Tahle značka prodává práci, kterou zákazník reklamuje, ne čte. Proto:
1. **Technický parametr VLASTNÍ práce nebo vlastního produktu je VŽDYCKY \`risk\`,
   nikdy \`unsure\`.** Tloušťka, tlak, únosnost, spád, tepelný odpor, výdrž,
   životnost v letech, doba schnutí, délka záruky. Na veřejném webu se dá najít
   norma — ne to, co odvedla TAHLE firma. Nedohledatelnost není důvod ke smíru.
2. **Hybridní tvrzení ROZDĚL na dvě.** „Naše izolace vydrží 4 bary podle ČSN P 73 0606"
   jsou dva claims: citace normy (\`unsure\`, scope "world", query na znění normy)
   a výkon vlastní práce (\`risk\`). Doložená norma NEPROPOUŠTÍ větu jako celek —
   přesně tudy propadlo „splňujeme" bez jediného dokladu.
3. **Záruční lhůta a životnost jsou \`risk\` bez výjimky** — i „až", i „běžně",
   i „obvykle". A NEHEDGUJ je: „dlouholetá záruka", „dlouhá životnost" je pořád
   týž závazek, jen nezměřitelný, takže z něj v opravě nedělej rozmazanou verzi.
   Buď stojí v ověřených faktech, nebo v textu být nemá.
4. **Nikdy nevyrob NOVÉ číslo — ani v těle textu, nejen v nadpisu.** Oprava smí být
   obecnější, ne jinak konkrétní: „vydrží 4 bary" → věta o tom, kde se to používá,
   ne „vydrží 2 bary" a ne „vydrží vysoký tlak".
`
    }

    if (family === "finance") {
        return `
## ⚠️ FINANČNÍ OBOR — PŘÍSNĚJŠÍ PRAVIDLO NA VÝNOSY A GARANCE
1. **Výnos, zhodnocení, úrok, garance odkupu a „jistota" jsou VŽDYCKY \`risk\`**,
   i když se podobné číslo najde na webu: ten výnos slibuje TAHLE značka.
2. **Hybridní tvrzení rozděl** — obecná tržní data (\`unsure\`, scope "world") od
   slibu téhle značky (\`risk\`).
3. **Nehedguj.** „Nadprůměrné zhodnocení", „prakticky bez rizika" je týž slib,
   jen nevymahatelný. Buď je v ověřených faktech, nebo v textu být nemá.
`
    }

    return `
## ⚠️ ZDRAVOTNICKÝ / ESTETICKÝ OBOR — PŘÍSNĚJŠÍ PRAVIDLO NA ÚČINKY
1. **Zdravotní nebo estetický účinek, výsledek zákroku a doba rekonvalescence jsou
   VŽDYCKY \`risk\`** — i „pomáhá", „uleví", „omladí". Slibuje je tahle značka
   konkrétnímu člověku, veřejný zdroj ji z toho nevyviní.
2. **Hybridní tvrzení rozděl** — obecný fakt o látce či metodě (\`unsure\`, scope
   "world") od slibu výsledku u téhle kliniky (\`risk\`).
3. **Nehedguj** na „viditelné zlepšení" ani „většina klientů" — to je týž slib
   bez čísla. Bez opory v ověřených faktech v textu být nemá.
`
}

/**
 * Prompt brány. Čistá funkce (exportovaná kvůli guardu) — ŽÁDNÉ volání modelu.
 */
export function buildFactCheckPrompt(
    config: ClientConfig,
    texts: { text: string; display: boolean }[],
    ctx: FactContext = {},
    mode: "safe" | "balanced" | "bold" = "balanced",
): string {
    const facts = (config.brandFacts || []).filter(f => f?.text?.trim())
    const factList = facts.length > 0
        ? facts.map(f => `- ${f.text.trim()}${f.source ? ` (zdroj: ${f.source})` : ""}`).join("\n")
        : "(žádná — značka nemá zadaný ani jeden ověřený fakt, takže KAŽDÉ konkrétní tvrzení o značce je nepodložené)"

    const productBlock = ctx.product
        ? `\n## POVOLENÝ ZDROJ — VYBRANÝ PRODUKT (živý katalog)\nNázev: ${ctx.product.name}\n${ctx.product.type ? `Typ: ${ctx.product.type}\n` : ""}${ctx.product.price ? `Cena: ${ctx.product.price}\n` : ""}${ctx.product.description ? `Popis: ${ctx.product.description}\n` : ""}`
        : ""
    const topicBlock = ctx.topic
        ? `\n## POVOLENÝ ZDROJ — TÉMA OD UŽIVATELE (napsal ho člověk, ručí za něj)\n${ctx.topic}\n`
        : ""
    const hookBlock = ctx.approvedHook
        ? `\n## POVOLENÝ ZDROJ — HOOK SCHVÁLENÝ UŽIVATELEM V PLÁNU\n„${ctx.approvedHook}"\n\nTohle znění uživatel viděl a schválil; engine mu slíbil, že ho zachová. Tvrzení, které\nv něm stojí, tedy NEOZNAČUJ. Platí to jen na ně — co copywriter přidal navíc, posuzuj\nnormálně.\n`
        : ""
    // Nápad ze zásobníku schválně NENÍ mezi povolenými zdroji — viz FactContext.idea.
    const ideaBlock = ctx.idea
        ? `\n## ⚠️ NÁPAD ZE ZÁSOBNÍKU — TÉMA, NE ZDROJ FAKTŮ\n${ctx.idea}\n\nNápad říká, O ČEM se píše. Napsal ho model, nikdo ho neověřoval. Konkrétní údaj z něj\n(číslo, rok, ocenění, garance) je proto NEPODLOŽENÝ úplně stejně, jako by si ho\nvymyslel copywriter — pokud zároveň nestojí v ověřených faktech výš.\n`
        : ""
    const reviewBlock = ctx.review
        ? `\n## POVOLENÝ ZDROJ — REÁLNÁ RECENZE\n„${ctx.review.quote}"${ctx.review.customer_name ? ` — ${ctx.review.customer_name}` : ""}\n`
        : ""
    // Doložené v minulém běhu. Bez tohohle by přehodnocení (retuš, „Je to pravda")
    // shodilo štítek zpátky na tvrzení, které už má odkaz na zdroj.
    const verifiedBlock = (ctx.webVerified && ctx.webVerified.length > 0)
        ? `\n## POVOLENÝ ZDROJ — UŽ DOLOŽENO NA WEBU\n${ctx.webVerified.map(v => `- ${v.claim} (${v.url})`).join("\n")}\n`
        : ""

    return `Jsi faktický korektor českého marketingového textu pro značku "${config.name}" (${config.website}).
Nehodnotíš styl, hook ani kreativitu — jenom PRAVDIVOST. Styl řeší někdo jiný.

## POVOLENÝ ZDROJ — IDENTITA ZNAČKY (nastavení klienta, platí jako ověřené)
Název: ${config.name}
Web: ${config.website}${config.instagram ? `\nInstagram: ${config.instagram}` : ""}${config.city ? `\nPůsobí ve městě / lokalitě: ${config.city}` : ""}${config.industry ? `\nObor: ${config.industry}` : ""}${config.contentFocus ? `\nO čem značka je: ${config.contentFocus}` : ""}
Tohle si klient nastavil sám. Jméno značky, její město a obor jsou proto OVĚŘENÉ —
zmínka o nich není tvrzení k prověření. Naměřeno: bez tohohle bloku brána mazala
z postů název města, ve kterém klient sídlí, a dělala tím obsah méně lokálním.

## POVOLENÝ ZDROJ — OVĚŘENÁ FAKTA O ZNAČCE
${factList}
${productBlock}${topicBlock}${hookBlock}${reviewBlock}${verifiedBlock}${ideaBlock}
## TEXT KE KONTROLE${ctx.postTypeName ? ` (formát: ${ctx.postTypeName})` : ""}
${texts.map((t, i) => `[${i + 1}]${t.display ? " 🖼 NADPIS DO OBRÁZKU:" : ""} ${t.text}`).join("\n")}

## CO HLEDÁŠ
Konkrétní tvrzení, které si čtenář může ověřit a přistihnout značku při lži:
- číslo, procento, statistika, počet zákazníků / kusů / let
- rok, datum, doba působení („už od roku 1998", „patnáct let")
- cena, sleva, akce, dostupnost, otevírací doba, dodací lhůta
- ocenění, certifikát, členství, jméno třetí strany nebo partnera
- superlativ a nárok na výlučnost („největší", „jediný v ČR", „nejrychlejší")
- slib nebo garance („do 24 hodin", „garantujeme vrácení peněz")
- tvrzení o účincích (zdravotní, výkonnostní), které by muselo mít oporu

${buildRiskFamilyBlock(config.industry)}
## JAK ROZHODUJEŠ
Nejdřív se zeptej: **je to tvrzení o TÉHLE ZNAČCE, nebo o světě?** Podle toho se liší,
kdo ho může doložit.

- **ok** (scope neuváděj) = tvrzení doslova stojí v některém povoleném zdroji výš.
- **unsure** (scope: "world") = tvrzení o SVĚTĚ nebo o JMENOVANÉ TŘETÍ STRANĚ, které
  umí rozsoudit veřejný zdroj. Někdo si ho půjde ověřit — a půjde to. Patří sem:
  zákon, vyhláška, norma, termín platnosti; parametr, složení nebo specifikace CIZÍHO
  produktu či značky; obecný technický, přírodní nebo kalendářní údaj.
  Přidej "query" — co se má vyhledat, česky nebo v jazyce výrobce.
  ⚠️ I tak vrať find/replace jako u risk. Když se tvrzení nepotvrdí, oprava se použije.
- **risk** = všechno ostatní, a **VŽDYCKY tvrzení o samotné značce** — o její historii,
  velikosti, zákaznících, výsledcích, cenách, dodání či zárukách („25 let na trhu",
  „9 z 10 zákazníků", „doprava zdarma nad 500"). Veřejný web o tomhle klientovi nic
  neví; co se na něm najde, je jeho vlastní marketing opsaný jinde. Takové tvrzení
  patří do Ověřených faktů, kam ho zadá člověk — ne na internet.
  Sem patří i tvrzení, které JE nejspíš pravda, ale nikdo ho nepotvrdil a nedá se
  veřejně ověřit.

⚠️ „Nezpochybnitelná obecná znalost" NENÍ ok — je to unsure. Přesně u obecných znalostí
si model bývá jistý i tehdy, když se plete, a nikde po tom nezůstane stopa. Ať to doloží
zdroj.

## CO NAOPAK NEOZNAČUJEŠ (naměřeno: brána tohle mazala a dělala z postů vatu)
- Obrazné, subjektivní a náladové formulace („nejlepší ráno", „miluju tenhle kousek",
  „voní jako léto"). Hledáš čísla a nároky, ne poezii.
- Detaily z vyprávění o běžném dni — čas („v pět ráno je v peci plno"), počasí, pořadí
  úkonů, smyslový popis. Zákazník na nich značku nechytí za slovo, a právě ony dělají
  post konkrétním. Označ je JEN tehdy, když z nich plyne slib zákazníkovi: otevírací
  doba, dodací lhůta, termín, dostupnost.
- Popis vlastního produktu, který sedí na jeho popis v katalogu výš.
- Ustálené obraty a nadsázka, kterou nikdo nečte jako údaj („nekonečně dlouho",
  „milionkrát ověřeno"). **Číslo v nadsázce není údaj**: „praští do očí z padesáti
  metrů", „stokrát jsem to říkal", „za pět minut hotovo" u něčeho, co se neměří.
  Zkouška: šel by si to zákazník ověřit metrem, stopkami nebo fakturou? Když ne,
  není to tvrzení. (Naměřeno — brána tohle přepisovala a brala postům šťávu.)
- **Jména a místa.** Název značky, města, kraje, ulice nebo okolní krajiny, kde
  značka působí (viz IDENTITA výš), a názvy vlastních produktů z katalogu. To je
  identita, ne tvrzení — a bez nich je z postu bezejmenná vata.
- **Rétorika hooku.** „3 věci, které děláte špatně", „Tohle vám nikdo neřekne",
  „Mýtus vs. realita" — to je slib OBSAHU příspěvku, ne údaj o značce. Číslo v něm
  („3 věci") popisuje, kolik jich v postu je; ověřovat se dá jen tím, že si post
  přečteš, ne v seznamu faktů.
- **Věty o ČTENÁŘI, ne o značce.** „Poprvé po letech", „Cítíte ten klid", „Znáte
  ten moment, kdy…". Popisují prožitek, který si čtenář buď pozná, nebo ne. Značka
  jimi nic netvrdí o sobě a nikdo ji za ně nemůže chytit za slovo.
- **Smyslový a obrazný popis.** „Vůně dřeva", „ranní mlha", „hluboký nádech".
  Naměřeno: tohle brána mazala jako „nepodložené" a měnila poctivé posty v prázdné
  fráze. Označuj údaje, ne poezii.
- **Nadčasové učebnicové konstanty.** Voda vře při 100 °C, rok má 12 měsíců, led taje
  nad nulou. Tohle se nemůže změnit a nikdo tím značku nechytí za slovo — je to jazyk,
  ne tvrzení. POZOR na rozdíl: údaj, který se MŮŽE ZMĚNIT nebo ho někdo STANOVUJE
  (zákon, vyhláška, norma, termín, servisní interval, parametr výrobku), učebnicová
  konstanta NENÍ — ten patří mezi unsure, i když si jím jsi jistý.
- Když je textů víc, ber je jako jeden příspěvek.

## OPRAVA (jen u verdiktu "risk")
- \`find\` = PŘESNÝ podřetězec z textu výš, znak po znaku, včetně diakritiky a
  interpunkce. Nic nepřepisuj, nezkracuj, needituj velikost písmen. Ber nejkratší
  úsek, který nepodložené tvrzení obsahuje (ideálně celou větu).
- **Maž po celých větách.** Když tvrzení mizí, musí \`find\` obsáhnout CELOU větu včetně
  spojky a tečky, ať zbytek zůstane gramaticky celý. Utržená spojka je poznat na první
  přečtení: z „Vyrábíme od roku 1947 a testy ADAC nás daly na první místo. Kontaktní tuk…"
  nesmí vzniknout „Vyrábíme od roku 1947 a Kontaktní tuk…". Buď vezmi celé souvětí, nebo
  nech tvrzení být a označ ho bez opravy.
- \`replace\` = tentýž úsek bez nepodloženého tvrzení. Zachovej tón, rytmus i délku
  a hlavně SMYSL věty. Neuváděj místo čísla jiné číslo.
- ⚠️ NEHEDGUJ. „Dlouhá léta", „mnoho zákazníků", „spousta lidí", „jedni z nejlepších"
  jsou pořád tvrzení, jen rozmazaná — a text je po nich vata. Když se konkrétní údaj
  nedá podložit, buď ho VYPUSŤ (prázdný \`replace\`, když věta bez něj dává smysl),
  nebo ho vyměň za smyslový detail, který se nedá zpochybnit, protože ho vidíš:
  „chleba, co při krájení chrupe", „ráno v pět je v peci plno". Konkrétní obraz místo
  vymyšleného čísla — ne vágní náhražka téhož tvrzení.

## 🖼 NADPISY DO OBRÁZKU MAJÍ PŘÍSNĚJŠÍ PRAVIDLA
Řádky označené „NADPIS DO OBRÁZKU" se VYPALUJÍ DO GRAFIKY. Jsou to tři až sedm slov
na plakátu — vata je tam vidět okamžitě a zabírá celou plochu. Proto u nich platí:
1. **Máš-li v ověřených faktech správnou hodnotu, DOSAĎ JI** místo špatné. To je
   nejlepší možná oprava: „Odolá až +300 °C" → „Odolá až +150 °C". Nadpis zůstane
   stejně úderný a je pravdivý.
2. ${mode === "safe"
    ? `**Nemáš-li čím nahradit, tvrzení z nadpisu VYPUSŤ a napiš jiné úderné sdělení** —
   benefit bez čísla, otázka, výzva, pojmenování problému. NIKDY z něj nedělej
   rozmazanou verzi téhož tvrzení.`
    : `**Nemáš-li v ověřených faktech správnou hodnotu, nadpis NEPŘEPISUJ.** Vrať ho
   jako riziko BEZ \`find\`/\`replace\` — vyřeší ho člověk před publikací. Přepsaný
   nadpis bez opory skončí jako vata („Kvalita, na kterou se spolehneš"), a to je
   u nadpisu horší než upozornění.`}
   ❌ „Vyrábíme od roku 1947" → „Vyrábíme s dlouholetou tradicí" (vata, a ještě
      korporátní — přesně to, co si značky zakazují v anti-patterns)
   ✅ „Vyrábíme od roku 1947" → nadpis o TOM, co značka dělá dnes, bez letopočtu
   ❌ „9 z 10 servisů to ví" → „Servisy to potvrzují" (mlha místo čísla)
   ✅ „9 z 10 servisů to ví" → nadpis o tom, KDE se to používá, bez podílu
3. **Nikdy nevyrob NOVÉ tvrzení.** Nadpis smí být obecnější, ne jinak konkrétní.
   ❌ „Doprava zdarma nad 500 Kč" → „Doprava zdarma při nákupu" (zní, jako by byla
      vždycky zdarma — z nepodloženého tvrzení se stalo zavádějící)
   ✅ „Doprava zdarma nad 500 Kč" → nadpis o snadnosti objednání, bez podmínky

⚠️ Příklady výš jsou ukázka POSTUPU, ne texty k opsání. Konkrétní znění napiš vždycky
z tohohle postu a téhle značky — opsaný příklad je nové nepodložené tvrzení.
4. Délku drž stejnou nebo kratší. Dlouhý nadpis se do grafiky nevejde.

## VÝSTUP — vrať POUZE validní JSON:
{
  "claims": [
    { "claim": "citace tvrzení", "verdict": "ok" | "unsure" | "risk", "scope": "world" (jen u unsure), "query": "co vyhledat (jen u unsure)", "reason": "proč (u risk i unsure, max 12 slov)", "find": "přesný podřetězec (u risk i unsure)", "replace": "opravené znění (u risk i unsure)" }
  ]
}
Když text žádné konkrétní tvrzení neobsahuje, vrať {"claims": []}.`
}

/**
 * Brána nad samostatnými řetězci, které se čtou jako NADPIS — tiskový brief
 * (nadpis/podnadpis/patička) i hooky v obsahovém plánu.
 *
 * Uvnitř staví ze vstupu synteticky `frames`, aby jel přesně tentýž kód jako u
 * příspěvků: stejná pravidla pro nadpisy do obrázku, stejná ochrana proti vyprázdnění
 * pole, stejné filtrování oprav podle režimu. Druhá implementace téhož by se rozešla.
 *
 * `flagsByIndex` říká, KTERÝ řetězec je označený — plán potřebuje pověsit varování
 * na konkrétní položku, ne na celý týden. Přiřazuje se podle toho, ve kterém řetězci
 * tvrzení po opravách skutečně zůstalo; co se nepodařilo přiřadit, zůstává aspoň
 * v souhrnném `flags` (nikdy se nezahodí).
 */
export async function checkDisplayStrings(
    config: ClientConfig,
    strings: string[],
    ctx: FactContext = {},
): Promise<{ status: FactStatus; strings: string[]; flags: string[]; flagsByIndex: string[][]; repairs: { claim: string; from: string; to: string }[]; judged: boolean; sources: FactSource[] }> {
    const usable = strings.map(s => (s || "").trim())
    if (usable.every(s => !s)) {
        return { status: "skipped", strings, flags: [], flagsByIndex: strings.map(() => []), repairs: [], judged: false, sources: [] }
    }
    const synthetic = { frames: usable.map(text => ({ headline: text, subtext: "" })) }
    const out = await checkCaptionFacts(config, synthetic, ctx)
    const back = (out.captionData as typeof synthetic).frames.map(f => f.headline)
    // Prázdné vstupy se vrací tak, jak přišly — index po indexu.
    const merged = strings.map((orig, i) => (usable[i] ? back[i] : orig))

    // Varování na konkrétní řetězec. Rozhoduje HOTOVÝ text (stejně jako `unresolved`
    // v checkCaptionFacts): tvrzení, které jiná oprava mezitím vyhodila, se nesmí
    // pověsit na položku, ve které už není.
    const flagsByIndex: string[][] = strings.map(() => [])
    for (const flag of out.flags) {
        const claim = flag.replace(/\s*\([^)]*\)\s*$/, "").trim()
        const i = merged.findIndex(t => claim.length > 0 && (t || "").includes(claim))
        if (i !== -1) flagsByIndex[i].push(flag)
    }

    return { status: out.status, strings: merged, flags: out.flags, flagsByIndex, repairs: out.repairs, judged: out.judged, sources: out.sources }
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
    const base: FactCheckOutcome<T> = { status: "skipped", captionData, changed: false, flags: [], repairs: [], judged: false, sources: ctx.webVerified ?? [] }

    const mode = config.factCheckMode ?? (config.factCheck === false ? "off" : "balanced")
    if (mode === "off") return base
    const texts = collectTexts(captionData)
    if (texts.length === 0) return base

    let claims: FactClaim[]
    try {
        const raw = await judgeText(buildFactCheckPrompt(config, texts, ctx, mode), { label: "fact-check" })
        const match = raw.match(/\{[\s\S]*\}/)
        const parsed = JSON.parse(match?.[0] || raw)
        claims = Array.isArray(parsed?.claims) ? parsed.claims : []
    } catch (err: any) {
        // Fail-open, nahlas: text projde neověřený, ale musí to být v logu.
        console.warn(`   ⚠️ Faktická brána nedoběhla — post jde bez kontroly faktů: ${String(err?.message || err).slice(0, 120)}`)
        return base
    }

    // ── Nejistá tvrzení jdou na web ──────────────────────────────────────────────
    // Sem se dostane VÝHRADNĚ to, co soudce označil za `unsure` a za tvrzení o světě.
    // Tvrzení o značce (`scope: "brand"`) se filtruje TADY, v kódu — prompt se dá
    // přemluvit, `if` ne — a padá rovnou mezi riziková, jako by web neexistoval.
    // Levný ověřovatel tak umí jediné: posunout `unsure` na doložené. Nikdy nemůže
    // shodit tvrzení, které soudce pustil.
    const unsureAll = claims.filter(c => c?.verdict === "unsure")
    const searchable = unsureAll.filter(c => c.scope !== "brand").slice(0, MAX_WEB_CLAIMS)
    let sources: FactSource[] = ctx.webVerified ?? []

    if (searchable.length > 0) {
        const found = await verifyClaimsOnWeb(
            searchable.map((c): WebCheckInput => ({ claim: c.claim, query: c.query })),
            { brandName: config.name, brandWebsite: config.website, label: "fact-web" },
        )
        // Sloučení bez duplicit: přehodnocení postu už nějaké doklady nést může.
        const known = new Set(sources.map(v => v.claim))
        sources = [...sources, ...found.filter(f => !known.has(f.claim))]
    }

    // Co se nedoložilo (ani teď, ani dřív), je nepodložené úplně stejně jako `risk` —
    // včetně toho, co se na web vůbec nepustilo.
    const proven = new Set(sources.map(v => v.claim))
    const unresolvedUnsure = unsureAll
        .filter(c => !proven.has(c.claim))
        .map(c => ({ ...c, reason: c.reason || (c.scope === "brand" ? "tvrzení o značce bez opory ve faktech" : "na webu se nepotvrdilo") }))

    const risky = [...claims.filter(c => c?.verdict === "risk"), ...unresolvedUnsure]

    // Varování, které si hook přinesl ze schváleného plánu. Připojuje se VŽDY — brána
    // ho totiž sama nikdy nenajde: schválený hook je pro ni povolený zdroj, takže
    // tvrzení v něm neoznačí. Bez tohohle řádku by nepodložené číslo, které uživatel
    // v plánu vědomě propustil, skončilo u příspěvku jako „čisté".
    const carried = ctx.approvedHookFlag?.trim() ? [ctx.approvedHookFlag.trim()] : []

    if (risky.length === 0) {
        return carried.length > 0
            ? { ...base, status: "flagged", judged: true, sources, flags: carried }
            : { ...base, status: "clean", judged: true, sources }
    }

    // Které opravy se vůbec smějí použít, rozhoduje REŽIM — a rozhoduje se v kódu.
    // Prompt se dá přemluvit, `if` ne; a rozdíl mezi „opravím nadpis" a „nechám to na
    // člověku" je přesně to, co si klient nastavuje posuvníkem.
    const displayTexts = new Set(collectTexts(captionData).filter(t => t.display).map(t => t.text))
    const hasNumber = (v: string) => /\d/.test(v)
    const usable = (c: FactClaim): boolean => {
        if (typeof c.find !== "string" || !c.find.trim() || typeof c.replace !== "string") return false
        if (mode === "bold") return false // nepřepisuje nic, jen značkuje
        if (mode === "safe") return true
        // balanced: v nadpisu do obrázku smí jen VÝMĚNA HODNOTY za správnou.
        // Poznávací znamení: původní text nese číslo a náhrada taky. Bez čísla by
        // z úderného nadpisu vznikla vata („Záruka 5 let" → „Kvalita, na kterou se
        // spolehneš") — naměřeno, proto to hlídá kód, ne dobrá vůle modelu.
        const inDisplay = [...displayTexts].some(t => t.includes(c.find as string))
        if (!inDisplay) return true
        return hasNumber(c.find) && hasNumber(c.replace as string)
    }
    const fixes = risky.filter(usable).map(c => ({ find: c.find as string, replace: c.replace as string }))

    const { data, missed } = applyFactFixes(captionData, fixes)
    const changed = JSON.stringify(data) !== JSON.stringify(captionData)

    // Nevyřešené = to, co je po opravě pořád v textu. Rozhoduje HOTOVÝ text, ne
    // účetnictví oprav: opravy se překrývají (delší věta spolkne kratší tvrzení
    // uvnitř sebe), takže „tenhle claim neměl vlastní find" ještě neznamená, že
    // v postu zůstal — naměřeno na první ostré zkoušce, kde brána označila post
    // za rizikový kvůli ocenění, které z něj sama předtím vyhodila.
    const after = collectTexts(data).map(t => t.text).join("\n")
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

    const flags = [...carried, ...unresolved.map(c => `${c.claim}${c.reason ? ` (${c.reason})` : ""}`.slice(0, 160))]
    const status: FactStatus = flags.length > 0 ? "flagged" : "repaired"
    // Vyměněné = ty, co v hotovém textu nezůstaly a měly čím být nahrazeny.
    const repairs = risky
        .filter(c => !unresolved.includes(c) && c.find && typeof c.replace === "string")
        .map(c => ({ claim: c.claim, from: c.find as string, to: c.replace as string }))

    return { status, captionData: data, changed, flags, repairs, judged: true, sources }
}
