/**
 * Data nápovědy — jeden zdroj pro obrazovku i pro znalostní bázi agenta.
 * =====================================================================
 * Do 13. 9. 2026 žilo `FAQ_CATEGORIES` uvnitř `FaqTab.tsx`, takže se k němu
 * nedostalo nic než ta jedna stránka. Jakmile má na tytéž odpovědi odpovídat
 * i agent podpory (`scripts/sync-support-kb.ts`), je to problém: druhá kopie
 * odpovědí se s tou první rozejde a zákazník dostane jiné číslo v nápovědě než
 * od podpory. Přesně to už jednou nastalo — ceny tu stály natvrdo a přežily
 * přecenění na v6.
 *
 * Modul je **client-safe**: čte ho `FaqTab` v prohlížeči i synchronizační skript
 * na serveru, takže sem nesmí přijít import z `instagram/`, `supabase/` ani
 * `process.env`. Stejný režim jako `lib/voice-library.ts`.
 *
 * Čísla se ZE ZÁSADY neopisují. Věty o cenách si je berou z `lib/pricing.ts`
 * a `lib/credits.ts`; copy zůstává tady (je to marketingový text, ne data).
 */

import { EXTRA_CREDIT_HALERU, FALLBACK_PLANS, formatCzk } from "@/lib/pricing"
import { MEDIA_CREDITS, ACTION_CREDITS, mediaCreditsSentence } from "@/lib/credits"
import { countLabel, CREDITS } from "@/lib/plural"

/**
 * Věta o tarifech se skládá z ceníku, ne z ruky.
 *
 * Do 9/2026 tu stály ceny natvrdo a přežily přecenění na v6 — zákazník tak četl
 * v nápovědě jinou cenu, než jakou mu naúčtovala pokladna. Copy zůstává tady
 * (je to marketingový text, ne data), čísla chodí z `lib/pricing.ts`.
 */
const PLAN_BLURB: Record<string, string> = {
    chrlit_start: "obrázky a carousely",
    chrlit_rust: "navíc úprava hotových příspěvků, dvě verze příspěvku na výběr a růstový dashboard",
    chrlit_dominance: "navíc reels, product studio a prioritní generování",
    // Ne „pro agentury a e-shopy": víc profilů na účet není implementované ani
    // vynucované, takže by to prodávalo něco, co zákazník nedostane.
    chrlit_imperium: "nejvyšší objem pro jednu značku",
}

/** Váhy z `MEDIA_CREDITS` — viz mediaCreditsSentence v lib/credits.ts. */
function mediaCenySentence(): string {
    return mediaCreditsSentence()
}

/** Ceny akcí z `ACTION_CREDITS`; ruční čísla tu jednou už lhala („Varianta stojí 1 kredit"). */
function actionCenySentence(): string {
    const k = (n: number) => countLabel(n, CREDITS)
    return `Úprava hotového příspěvku = ${k(ACTION_CREDITS.post_edit)}. Generování nápadů = ${k(ACTION_CREDITS.idea_generate)}. `
        + `Produktová vizualizace = ${k(ACTION_CREDITS.product_visual)}. Design pro tisk = ${k(ACTION_CREDITS.product_design)}. `
        + `Mockup = ${k(ACTION_CREDITS.product_mockup)}. Business Brief = ${k(ACTION_CREDITS.product_brief)}. Celá produktová řada = ${k(ACTION_CREDITS.product_line)}.`
}

/** „Start 20, Růst 70, Dominance 130, Impérium 260" — také z ceníku, ne z ruky. */
function creditsSentence(): string {
    return FALLBACK_PLANS.map((p) => `${p.name} ${p.creditsPerMonth}`).join(", ")
}

function plansSentence(): string {
    const list = FALLBACK_PLANS.map(
        (p) => `${p.name} (${formatCzk(p.monthlyHaleru)}, ${countLabel(p.creditsPerMonth, CREDITS)} — ${PLAN_BLURB[p.id] ?? ""})`,
    )
    const last = list.pop()
    return `Čtyři plány: ${list.join(", ")} a ${last}.`
}

export interface FaqItem {
    q: string
    a: string
}

export interface FaqCategory {
    id: string
    emoji: string
    label: string
    items: FaqItem[]
}

export const FAQ_CATEGORIES: FaqCategory[] = [
    {
        id: "generating",
        emoji: "🚀",
        label: "Generování obsahu",
        items: [
            {
                q: "Jak funguje generování příspěvků?",
                a: "AI přečte vaši brand konfiguraci (tón komunikace, barvy, produkty, témata obsahu) a na základě toho vygeneruje caption, obrázek a hashtagy. Výsledek odpovídá vaší značce — používá vaše barvy, font a styl komunikace.",
            },
            {
                q: "Proč je výsledek pokaždé jiný?",
                a: "AI generuje obsah s určitou mírou kreativity (temperature). To je záměr — chcete různorodý feed, ne opakující se šablony. Pokud chcete konzistentní styl, upřesněte brand voice v nastavení.",
            },
            {
                q: "Co ovlivní kvalitu výstupu?",
                a: "Hlavně kvalita konfigurace. Čím detailnější máte styl textu (persona, tón komunikace, co neříkáme), témata s kategoriemi, a šablony úvodních vět — tím přesnější výstup dostanete. Investice do nastavení se vyplatí.",
            },
            {
                q: "Jak funguje batch generování?",
                a: "Můžete vygenerovat více postů najednou (např. celý týden). Posty se generují sekvenčně — jeden po druhém — aby se zachovala kvalita a různorodost. Každý post stojí 1 kredit.",
            },
            {
                q: "Co znamenají různé typy postů?",
                a: "Chrlit podporuje typy jako tip, meme, carousel, behind_scenes, product_drop, recenze, challenge a další. Každý typ má jiný tón a formát — tip je edukativní, meme je vtipný, product_drop je prodejní. Typy jsou definované ve vaší konfiguraci.",
            },
            {
                q: "Můžu u hotového příspěvku něco změnit?",
                a: "Ano, dvěma způsoby. Úprava hotového příspěvku (od tarifu Růst) zasáhne do existujícího vizuálu nebo textu — „posuňte nadpis“, „zkraťte text“ — a stojí 1 kredit. Druhá možnost je „Dvě verze na výběr“: vygenerují se dva úplně nové příspěvky na stejné téma (jiný hook, vizuál i CTA), vy si vyberete jeden a zbylé se zahodí. Nejde o test — nic se neměří, jen si vybíráte.",
            },
        ],
    },
    {
        id: "credits",
        emoji: "💳",
        label: "Kredity & plán",
        items: [
            {
                q: "Kolik stojí jedna akce?",
                a: `Příspěvek stojí podle média (${mediaCenySentence()}). Každá verze v „Dvě verze na výběr“ je plnohodnotný příspěvek, takže se účtuje stejně jako on — dvě verze carouselu tedy stojí ${countLabel(2 * MEDIA_CREDITS.carousel, CREDITS)}, i když nakonec použijete jednu. ${actionCenySentence()}`,
            },
            {
                q: "Co se stane, když mi dojdou kredity?",
                a: "Nemůžete generovat další obsah, dokud si nedokoupíte kredity nebo nečekáte na reset v dalším měsíci. Existující posty zůstávají — nic se nesmaže.",
            },
            {
                q: "Jak funguje dobíjení kreditů?",
                a: "Kdykoli si můžete dokoupit extra kredity za 49 Kč/ks. Jdete do Nastavení → Předplatné a dobíjete. Kredity se přičtou okamžitě.",
            },
            {
                q: "Převádí se nevyčerpané kredity do dalšího měsíce?",
                a: `Ne. Každý měsíc dostanete kredity podle svého plánu (${creditsSentence()}). Nevyčerpané kredity propadnou. Pokud potřebujete víc, dobijte si je za ${formatCzk(EXTRA_CREDIT_HALERU)}/ks.`,
            },
            {
                q: "Jak funguje trial?",
                a: "3 posty zdarma, bez kreditky a bez časového limitu. Z plánu obsahu máte 3 příspěvky plně odemčené k vyzkoušení; zbytek se odemkne po výběru plánu. Nic se nesmaže — vygenerované posty vám zůstanou.",
            },
            {
                q: "Jaké jsou plány a jak si dobiju kredity?",
                a: `${plansSentence()} Ceny jsou měsíční; při delším období platíte míň. Když kredity dojdou, dobijete si je za ${formatCzk(EXTRA_CREDIT_HALERU)}/ks v Nastavení → Předplatné.`,
            },
            {
                q: "Jak funguje placení na 3, 6 nebo 12 měsíců?",
                a: "Zaplatíte jednou dopředu a máte klid. Za čtvrt roku ušetříte 5 %, za půl roku 10 % a za rok platíte jen deset měsíců — dva jsou zdarma. Cenu máte navíc zamčenou na celé období: i kdyby se ceník mezitím zvedl, vás se to dotkne až při obnově. Kredity se přitom obnovují každý měsíc úplně stejně jako u měsíčního plánu.",
            },
            {
                q: "Co když si to rozmyslím po zaplacení na rok?",
                a: "Máte 30 dní na rozmyšlenou — napište nám a peníze vrátíme, bez udání důvodu. Po té lhůtě předplacené období doběhne; předplatné jde kdykoli vypovědět k jeho konci, takže se další období už nestrhne.",
            },
            {
                q: "Můžu uprostřed předplaceného období přejít na vyšší tarif?",
                a: "Ano, ale ne jedním klikem — napsali bychom vám tím zbytek zaplaceného období k dobru a to musíme udělat ručně. Napište nám a zbývající období převedeme do nového tarifu.",
            },
        ],
    },
    {
        id: "settings",
        emoji: "⚙️",
        label: "Nastavení & konfigurace",
        items: [
            {
                q: "Jak změním tón komunikace?",
                a: "V Nastavení → Styl textu. Upravte personu, voice traits a anti-patterns. Změny se projeví u všech nově generovaných postů. Existující posty zůstávají beze změny.",
            },
            {
                q: "Jak přidám nový produkt?",
                a: "V Nastavení → Produkty. Přidejte název, typ, cenu a popis. AI ho pak bude používat v product_drop postech a produktových vizualizacích.",
            },
            {
                q: "Můžu změnit barvy a gradient?",
                a: "Ano, v Nastavení → Vizuální identita. Změníte overlay gradient (3 barvy), font, accent color a celkový feel feedu. Doporučujeme tmavší, syté barvy — bílý text musí být čitelný.",
            },
            {
                q: "Co jsou témata obsahu?",
                a: "Témata definují strategii obsahu: Dosah (virální obsah), Hodnota (edukace), Konverze (prodej), Propojení (komunita). Každé téma má poměr (kolik % obsahu), post typy a kategorie. AI podle nich vybírá, co generovat.",
            },
            {
                q: "Jak fungují šablony úvodních vět?",
                a: "Šablony úvodních vět jsou vzory pro první řádek captionů — to, co zaujme v feedu. Příklady: '{{téma}}? Tohle nikdo neříká.' nebo '3 chyby, které děláš s {{produkt}}'. AI je používá jako inspiraci, ne doslova.",
            },
            {
                q: "Jak spustím re-onboarding?",
                a: "V Nastavení úplně dole najdete tlačítko Re-onboarding. AI znovu analyzuje váš web a přegeneruje celou konfiguraci. Stávající posty se neztratí.",
            },
        ],
    },
    {
        id: "products",
        emoji: "🛍️",
        label: "Produkty & vizualizace",
        items: [
            {
                q: "Co je produktový pipeline?",
                a: "Funkce pro e-shopy a značky s produkty. AI navrhne celou produktovou řadu jako systém (každý produkt dostane svůj krok, roli a místo v cenovém žebříčku), nebo jednotlivé produktové nápady. Ke schváleným produktům pak vygeneruje tiskovou grafiku, mockupy a Business Brief s analýzou nákladů a marží.",
            },
            {
                q: "Jak fungují mockupy?",
                a: "AI vygeneruje fotorealistický obrázek produktu — tričko na modelce, hrnek na stole, krabička v kontextu. Ideální pro testování nových designů nebo prezentaci zákazníkům.",
            },
            {
                q: "Co je Design pro tisk?",
                a: "AI vytvoří plochou tiskovou grafiku pro produkty a obaly — trička, plakáty, etikety lahví, ovinové etikety. Výstup je PNG doškálované na fyzický rozměr při 300 DPI, u potisků s průhledným pozadím, plus náhled s vyznačenou spadávkou a bezpečným okrajem a textové zadání pro tiskárnu. Je to podklad pro tiskaře, ne hotová produkční data: barvy jsou v RGB a pro velké formáty je potřeba grafiku převést do vektorů.",
            },
            {
                q: "Můžu použít vygenerované obrázky komerčně?",
                a: "Ano. Všechny AI-generované obrázky jsou vaše — můžete je používat na Instagramu, webu, v reklamách i na produktech. Chrlit si nenárokuje žádná práva na vygenerovaný obsah.",
            },
        ],
    },
    {
        id: "tips",
        emoji: "💡",
        label: "Tipy & triky",
        items: [
            {
                q: "Jak dostanu lepší výsledky?",
                a: "1) Vyplňte detailní styl textu — hlavně co neříkáme (co nepoužívat). 2) Přidejte fotky značky — AI se z nich učí styl. 3) Používejte kategorie v tématech pro cílenější obsah. 4) Pravidelně kontrolujte Paměť — AI se učí z výkonu.",
            },
            {
                q: "Kolik postů na týden je optimální?",
                a: "Pro většinu značek 3-5 postů týdně. Méně a ztrácíte viditelnost, víc a riskujete únavu publika. Chrlit vám pomůže udržet konzistenci bez stresu.",
            },
            {
                q: "Jak funguje AI Paměť (Brain)?",
                a: "Chrlit analyzuje výkon vašich postů (liky, komentáře, uložení) a učí se, co funguje. Postupně přizpůsobuje strategii — víc obsahu, který rezonuje, méně toho, co nefunguje. Čím déle ho používáte, tím lepší výsledky.",
            },
            {
                q: "Můžu generovat obsah v jiném jazyce než češtině?",
                a: "Aktuálně je Chrlit optimalizovaný pro češtinu. Brand voice, hook templates a CTA jsou generované česky. Podpora dalších jazyků je v plánu.",
            },
            {
                q: "Jak nejlépe využít Nápady?",
                a: "Nápady jsou zásobník témat, ze kterého si AI sama bere náměty pro nové příspěvky. Nechte AI vygenerovat dávku nápadů pro konkrétní téma (Dosah, Hodnota, Konverze...), projděte je a slabé vypněte nebo smažte. Nápad můžete také ručně vybrat při generování — příspěvek se pak započítá do jeho výkonu.",
            },
            {
                q: "Co se stane s nápadem po použití?",
                a: "Nic se nemaže. Použitý nápad si dá pauzu (cooldown), aby se váš feed neopakoval, a po ní se vrací do hry. Nápady, které mají dobré výsledky, si AI vybírá častěji — poznáte je podle štítku 🔥 Funguje. Nápad můžete kdykoli vypnout nebo smazat.",
            },
        ],
    },
]
