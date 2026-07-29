/**
 * One-off rebrand: HanzFans / MRDKE GANG® → HanzGarage (eshop s autokosmetikou)
 * ============================================================================
 * Přepíše clients.config, vyčistí veškerý obsah staré značky a nasadí nový
 * katalog autokosmetiky + nové formáty.
 *
 *   npx tsx scripts/rebrand-hanzgarage.ts            # dry run (nic nezapisuje)
 *   npx tsx scripts/rebrand-hanzgarage.ts --apply    # provede
 *
 * Před zápisem vždy uloží kompletní zálohu do scripts/backups/.
 */

import fs from "fs"
import path from "path"
import type { ClientConfig, PostTypeDef, ProductInfo } from "../instagram/configs/types"

const CLIENT_ID = "c4971b9f-4076-4abb-9849-0bdc87ed79a3"
const SLUG = "hanzfans" // slug zůstává — váže se na storage cesty
const APPLY = process.argv.includes("--apply")

// ─── Supabase REST helper ────────────────────────────────────────────

const env = fs.readFileSync(".env.local", "utf-8").split("\n").reduce((acc, line) => {
    const m = line.match(/^([^=#]+)=(.*)$/)
    if (m) acc[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "")
    return acc
}, {} as Record<string, string>)

const URL = env["NEXT_PUBLIC_SUPABASE_URL"]
const KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
if (!URL || !KEY) throw new Error("Chybí NEXT_PUBLIC_SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY")

async function rest(pathAndQuery: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${URL}/rest/v1/${pathAndQuery}`, {
        ...init,
        headers: {
            apikey: KEY,
            Authorization: `Bearer ${KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
            ...(init.headers || {}),
        },
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${res.status} ${pathAndQuery}: ${text}`)
    return text ? JSON.parse(text) : null
}

const select = (t: string) => rest(`${t}?client_id=eq.${CLIENT_ID}&select=*`)
const wipe = (t: string) => rest(`${t}?client_id=eq.${CLIENT_ID}`, { method: "DELETE" })

// ─── Produkty (dodané klientem) ──────────────────────────────────────
// Ceny záměrně prázdné — klient je zatím nedodal a vymyšlená cena by se
// dostala do publikovaného captionu.

const PRODUCTS: ProductInfo[] = [
    {
        name: "Autošampon 1 l",
        slug: "autosampon-1l",
        type: "šampon",
        description:
            "pH neutrální koncentrovaný šampon pro pravidelné mytí. Šetrný ke keramickým povlakům, voskům i sealantům. Vysoká lubrikace a pěnivost.",
    },
    {
        name: "Kyselý čistič kol 500 ml",
        slug: "kysely-cistic-kol-500ml",
        type: "kola",
        description:
            "Silný čistič disků na brzdový prach, silniční nečistoty a minerální usazeniny. Minimalizuje potřebu mechanického čištění.",
    },
    {
        name: "Čistič interiéru 500 ml",
        slug: "cistic-interieru-500ml",
        type: "interiér",
        description:
            "Univerzální čistič na plasty, volant, palubní desku, displeje, dveřní výplně, vinyl, gumu i kůži. Zanechává přirozený vzhled bez mastného filmu.",
    },
    {
        name: "Čistič skel 500 ml",
        slug: "cistic-skel-500ml",
        type: "sklo",
        description: "Beze šmouh. Na vnější i vnitřní skla, zrcátka a skleněné displeje.",
    },
    {
        name: "Odstraňovač hmyzu 500 ml",
        slug: "odstranovac-hmyzu-500ml",
        type: "dekontaminace",
        description: "Silný, ale bezpečný přípravek na zaschlý hmyz z laku, plastů, skel i PPF fólií.",
    },
    {
        name: "Dressing na pneumatiky 500 ml",
        slug: "dressing-na-pneumatiky-500ml",
        type: "pneumatiky",
        description:
            "Výrazný lesk a sytě černý vzhled. Chrání před UV zářením, vysycháním a praskáním. Snadná aplikace, dlouhá výdrž.",
    },
    {
        name: "Iron Remover 500 ml",
        slug: "iron-remover-500ml",
        type: "dekontaminace",
        description: "Odstraňuje poletavou rez z laku i kol. Základ pravidelné dekontaminace vozu.",
    },
    {
        name: "Tar & Glue Remover 500 ml",
        slug: "tar-glue-remover-500ml",
        type: "dekontaminace",
        description: "Odstraňuje asfalt, lepidla, zbytky samolepek, pryskyřici a další mastné nečistoty.",
    },
    {
        name: "Quick Detailer 500 ml",
        slug: "quick-detailer-500ml",
        type: "údržba",
        description:
            "Rychlé odstranění lehkého prachu, otisků prstů a vodních skvrn mezi mytím. Okamžitý lesk během pár minut.",
    },
    {
        name: "Keramická ochrana laku (Spray Sealant) 500 ml",
        slug: "keramicka-ochrana-laku-500ml",
        type: "ochrana",
        description:
            "Rychlá keramická ochrana bez návštěvy detailingového studia. Výrazný hydrofobní efekt, snazší následné mytí, lak zůstane déle čistý. Aplikace během několika minut.",
    },
    {
        name: "APC — univerzální čistič 1 l",
        slug: "apc-univerzalni-cistic-1l",
        type: "čistič",
        description:
            "Vysoce koncentrovaný univerzální čistič pro exteriér i interiér — motorový prostor, podběhy, prahy, plasty, guma, textil. Ředí se podle typu znečištění.",
    },
    {
        name: "Čistič textilu 500 ml",
        slug: "cistic-textilu-500ml",
        type: "interiér",
        description: "Na sedačky, koberce, čalounění a textilní části interiéru. Odstraňuje běžné nečistoty a osvěžuje vzhled.",
    },
]

// ─── Formáty ─────────────────────────────────────────────────────────

const POST_TYPE_DEFS: PostTypeDef[] = [
    {
        name: "krok_za_krokem",
        display_name: "Krok za krokem",
        emoji: "🧼",
        pillar: "navod",
        medium: "carousel",
        aspectRatio: "4:5",
        uses_product: true,
        description:
            "Carousel, kde rozebereme jeden konkrétní proces (mytí dvěma kbelíky, dekontaminace, aplikace keramiky) na jasné kroky. Funguje, protože lidi hledají postup, ne teorii — a uloží si ho na víkend.",
        structure:
            "Slide 1 COVER: velký nadpis procesu + kolik zabere času ('DEKONTAMINACE LAKU — 40 MINUT'). Slide 2–5: jeden krok na slide, číslo kroku velké, jedna věta co dělat + jedna věta proč. Slide 6 CHYBY: 'Co nedělat' — 2–3 nejčastější chyby. Slide 7 CTA: seznam použitých produktů HanzGarage + 'Ulož si to, ať to máš u kbelíku.'",
        visualStyle:
            "Reálná garáž, zářivky nebo denní světlo, mokrý beton. Detaily rukou v černých nitrilových rukavicích při práci. Čísla kroků jako velká condensed typografie v signální červené. Žádné stock fotky — pracovní, mokré, opravdové.",
    },
    {
        name: "chyba_ktera_nici_lak",
        display_name: "Chyba, která ti ničí lak",
        emoji: "⚠️",
        pillar: "navod",
        medium: "image",
        aspectRatio: "4:5",
        uses_product: false,
        description:
            "Jedna konkrétní chyba (mytí kruhem, houba místo rukavice, kartáčová myčka, mytí na slunci) a co přesně napáchá. Buduje autoritu, sbírá uložení i hádky v komentářích.",
        structure:
            "Hook: pojmenuj chybu tvrdě ('Kartáčová myčka ti za rok udělá z laku brusný papír.') → Body: co se s lakem fyzicky děje + jak to poznáš na svém autě → Řešení: co dělat místo toho, konkrétně → CTA: 'Děláš to taky? Přiznej se v komentech 👇'",
        visualStyle:
            "Extrémní makro na poškozený lak — swirly a hologramy v ostrém bočním světle lampy, zbytek utopený ve tmě. Jedna tvrdá světelná linka přes kapotu. Varovná typografie, výstražná energie.",
    },
    {
        name: "before_after",
        display_name: "Před / Po",
        emoji: "✨",
        pillar: "vysledek",
        medium: "carousel",
        aspectRatio: "4:5",
        uses_product: true,
        description:
            "Přímé srovnání stejného místa před a po zásahu — disky, kliky, sedačka, maska po hmyzu. Nejsdílenější formát, protože výsledek mluví sám za sebe.",
        structure:
            "Slide 1 COVER: split screen před/po, tenká dělící čára, text 'PŘED / PO' + název produktu. Slide 2: detail 'před' s popisem, co to vlastně je za špínu. Slide 3: detail 'po' + kolik to trvalo. Slide 4: jak na to ve třech větách. Slide 5 CTA: použitý produkt + odkaz.",
        visualStyle:
            "Identický úhel a světlo na obou snímcích — rozdíl musí být v autě, ne v nasvícení. Studená zářivka v garáži, mokré odlesky. Ostrá dělící čára, minimum textu, ať mluví fotka.",
    },
    {
        name: "beading_porn",
        display_name: "Voda na laku",
        emoji: "💧",
        pillar: "vysledek",
        medium: "reel",
        aspectRatio: "9:16",
        uses_product: true,
        description:
            "Krátký satisfying reel s vodou perlící na čerstvě ošetřeném laku. Nejlepší dosahový formát — lidi to dokoukají a pošlou dál.",
        structure:
            "Scéna 1 HOOK (0-2s): proud vody dopadá na kapotu, kapky se okamžitě sbalí a sjedou dolů. Scéna 2 (2-5s): makro na perlení v protisvětle, pomalý pohyb kamery podél laku. Scéna 3 (5-8s): odjezd na celé auto, voda stéká sama. Závěrečný text: název produktu + 'hanzgarage.cz'.",
        visualStyle:
            "Protisvětlo, kapky jako světelné body, tmavé pozadí. Zpomalený záběr, mokrý lesk. Žádní lidi v záběru — jen voda, lak a světlo.",
    },
    {
        name: "co_je_v_sade",
        display_name: "Co si vzít",
        emoji: "🧴",
        pillar: "produkt",
        medium: "carousel",
        aspectRatio: "4:5",
        uses_product: true,
        description:
            "Doporučená kombinace produktů na jeden konkrétní úkol (jarní mytí po zimě, příprava před keramikou, rychlá údržba interiéru). Rozhoduje za zákazníka a zvedá průměrnou objednávku.",
        structure:
            "Slide 1 COVER: úkol jako nadpis ('PO ZIMĚ: CO POTŘEBUJEŠ'). Slide 2–4: jeden produkt na slide — název, na co je, jedna věta jak ho použít. Slide 5: pořadí, v jakém to jde za sebou. Slide 6 CTA: 'Všechno na hanzgarage.cz.'",
        visualStyle:
            "Lahve postavené na betonu nebo na kapotě, tvrdé boční světlo, dlouhé stíny, tmavé pozadí. Etikety ostré a čitelné. Čistá kompozice — produkt je hrdina, ne kulisa.",
    },
    {
        name: "novinka_skladem",
        display_name: "Novinka / skladem",
        emoji: "🔥",
        pillar: "produkt",
        medium: "image",
        aspectRatio: "4:5",
        uses_product: true,
        description:
            "Oznámení nového produktu nebo naskladnění. Jedna lahev, jedno tvrzení, jeden důvod, proč to chceš.",
        structure:
            "Hook: co to je a co to řeší, jednou větou ('Iron Remover. Rez z laku, co tam nemá co dělat.') → Body: kdy to použít + co uvidíš (u iron removeru krvavá reakce) → CTA tvrdý: odkaz na eshop.",
        visualStyle:
            "Jedna lahev v centru, dramatické boční nasvícení, vodní mlha nebo kouř kolem, tmavé pozadí. Etiketa čitelná a ostrá. Vypadá to jako filmový plakát, ne jako katalogová fotka.",
    },
    {
        name: "detailing_realita",
        display_name: "Realita mytí",
        emoji: "😂",
        pillar: "humor",
        medium: "image",
        aspectRatio: "1:1",
        uses_product: false,
        description:
            "Meme o tom, co zná každý majitel — umyté auto a hned déšť, hodina na disky, partnerka co nechápe, proč to trvá pět hodin. Sdílí se do DM a přivádí nové lidi.",
        structure:
            "Hook: situace jako meme text ('Umyl jsem auto. Předpověď: déšť za 40 minut.') → Body: krátké rozvedení, 1–2 věty, vtip se nevysvětluje → CTA soft: 'Kdo to má taky? 👇'",
        visualStyle:
            "Klasický meme formát — syrová, nefiltrovaná fotka z garáže nebo parkoviště, bílý pruh s černým textem nahoře nebo text přímo přes fotku. Schválně mobilní kvalita. Žádná produktová estetika.",
    },
    {
        name: "hot_take",
        display_name: "Hot take",
        emoji: "🎤",
        pillar: "humor",
        medium: "image",
        aspectRatio: "1:1",
        uses_product: false,
        description:
            "Vyhraněný názor na péči o auto, který rozdělí komentáře (myčky s kartáči, voskování jednou za rok, mytí hadrem na nádobí). Nejlepší nástroj na komentáře a dosah.",
        structure:
            "Hook: názor bez servítek, jedna věta ('Voskovat auto jednou za rok je jako čistit si zuby jednou za měsíc.') → Body: 2–3 věty proč, vždy s konkrétním důvodem → CTA: 'Souhlas nebo blbost? Do komentů 👇'",
        visualStyle:
            "Typografický post — velké condensed písmo přes celou plochu, tmavé pozadí, jedno klíčové slovo v signální červené. Minimum obrazu, maximum tvrzení. Působí jako plakát nebo výstražná cedule.",
    },
    {
        name: "hanz_v_garazi",
        display_name: "Hanz v garáži",
        emoji: "🔧",
        pillar: "garaz",
        medium: "reel",
        aspectRatio: "9:16",
        uses_product: true,
        description:
            "Hanz sám u auta — noční mytí, příprava na jízdu, jak to dělá on. Ukazuje, že za značkou stojí chlap, co to fakt dělá, ne marketingové oddělení.",
        structure:
            "Scéna 1 HOOK (0-2s): garážová vrata jedou nahoru, za nimi auto ve tmě. Scéna 2 (2-6s): rychlé střihy práce — pěna na laku, rukavice, stírání mikrovláknem. Scéna 3 (6-9s): Hanz couvá s hotovým autem ven do noci. Text: jedna věta o tom, co dneska dělal + 'hanzgarage.cz'.",
        visualStyle:
            "Noční garáž, zářivky a světla auta, mokrý beton s odlesky. Kamera z ruky, syrové. Hanz je vidět při práci, nepózuje. Tmavé tóny, jedno teplé světlo, vysoký kontrast.",
    },
    {
        name: "auto_z_party",
        display_name: "Auto z party",
        emoji: "🏁",
        pillar: "garaz",
        medium: "carousel",
        aspectRatio: "4:5",
        uses_product: false,
        description:
            "Repost auta od zákazníka, který použil naše produkty a poslal fotku. Ukazuje reálné výsledky na reálných autech a motivuje ostatní posílat svoje.",
        structure:
            "Slide 1 COVER: nejlepší fotka auta + text 'AUTO TÝDNE 🏁'. Slide 2: detail, který stojí za to (disky, lak v protisvětle, interiér). Slide 3: co majitel použil a jak dlouho mu to trvalo. Slide 4 CTA: 'Chceš tu být příště? Pošli fotku do DM nebo taguj #hanzgarage.'",
        visualStyle:
            "Reálné zákaznické fotky, ne studio — parkoviště, garáž, večerní světlo. Handle majitele jako jednoduchá grafika přes fotku. Autentické, klidně mobilní kvalita.",
    },
    {
        name: "soutez_o_sadu",
        display_name: "Soutěž o sadu",
        emoji: "🎁",
        pillar: "produkt",
        medium: "image",
        aspectRatio: "4:5",
        uses_product: true,
        manualOnly: true,
        description:
            "Soutěžní post o konkrétní produkt nebo sadu. Pravidla musí být v captionu jako číslované kroky: 1) Dej like, 2) Sleduj profil, 3) Označ v komentáři kámoše s nejšpinavějším autem. Vždy uveď deadline losování. Vizuál: reálná fotka produktu jako hrdina + výrazný nadpis SOUTĚŽ.",
        structure:
            "Hook: 'Rozdáváme {{produkt}}.' → Body: číslovaná pravidla (1) like, 2) follow, 3) tag kámoše) + přesný deadline losování → CTA: 'Losujeme {{datum}}. Kdo nehraje, myje dál nasucho.'",
        visualStyle:
            "Produkt nebo sada uprostřed na tmavém pozadí, ostré nasvícení, obří nápis SOUTĚŽ přes horní třetinu. Klidně clickbaitový kontrast, aby to nikdo při scrollu neminul.",
    },
]

const OVERLAY_BY_TYPE: Record<string, string> = {
    krok_za_krokem: "cover",
    chyba_ktera_nici_lak: "default",
    before_after: "cover",
    beading_porn: "none",
    co_je_v_sade: "cover",
    novinka_skladem: "default",
    detailing_realita: "default",
    hot_take: "full-typo",
    hanz_v_garazi: "none",
    auto_z_party: "cover",
    soutez_o_sadu: "default",
}

const postFormats = Object.fromEntries(
    POST_TYPE_DEFS.map(d => [
        d.name,
        { medium: d.medium, aspectRatio: d.aspectRatio, overlayStyle: OVERLAY_BY_TYPE[d.name] || "default" },
    ]),
) as ClientConfig["postFormats"]

// ─── Config ──────────────────────────────────────────────────────────

const NEW_CONFIG: ClientConfig = {
    id: SLUG,
    name: "HanzGarage",
    website: "https://hanzgarage.cz",
    instagram: "@hanzgarage",
    industry: "e-commerce — autokosmetika a detailing",
    city: "Praha",

    contentFocus:
        "O AUTOKOSMETICE, detailingu a péči o auto. Tipy = konkrétní postupy, správné pořadí kroků, produkty HanzGarage a chyby, kterými si lidi ničí lak.",

    brandVoice: {
        persona: `Jsi voice HanzGarage — českého eshopu s vlastní řadou autokosmetiky, za kterým stojí Hanz.
Hanz je chlap, co má auta v krvi: garáž, noční jízdy, BMW M2, AMG GT R, G-Class.
Nedělá detailing pro Instagram — dělá ho, protože nesnáší špinavé auto.
Řada: autošampon, čističe kol a interiéru, iron remover, tar remover, quick detailer, keramická ochrana, APC.
Mluvíš jako chlap v garáži, co ti fakt poradí: tykáš, jdeš k věci, umíš si dělat srandu ze sebe.
Žádné zázraky v lahvi — řekneš i to, co produkt neumí.
Cíl: naučit lidi mýt auto pořádně a přivést je na hanzgarage.cz.`,
        values: [
            "Funguje > marketing — říkáme, co produkt umí a co ne",
            "Auta jsou koníček, ne byznys plán",
            "Detailing bez gatekeepingu — vysvětlíme to i tomu, kdo drží kbelík poprvé",
            "Autentický, ne korporát — jako rada od kámoše v garáži",
            "Hanz to fakt dělá — není influencer, co produkt jen drží v ruce",
        ],
        voiceTraits: [
            "Tykáme — jsme garáž, ne zákaznická linka",
            "Hovorová čeština (hele, fakt, kámo, brácho, sakra)",
            "Krátké věty — max 10 slov, úderné",
            "Konkrétní čísla a postupy místo prázdných frází (kolik minut, jaké ředění)",
            "Suchý, drsnější humor — ale ne sprosťárny za každou cenu",
            "Detailingový slang přirozeně (beading, swirly, dekontaminace, quick detailer)",
            "Sebeironie — myjeme auto ve dvě ráno a víme, že to není normální",
            "Emoji max 3 na post",
            "Provokativní hot takes o tom, jak si lidi ničí lak",
            "Nikdy nesliboj zázraky — radši řekni 'tohle ti nepomůže'",
        ],
        antiPatterns: [
            "❌ NIKDY nepoužívat 'Mrdke', 'MRDKE GANG', 'gang' ani cokoli ze staré merch značky — HanzGarage s tím nemá nic společného",
            "❌ Merch — trika, mikiny, snapbacky. Neprodáváme oblečení, prodáváme autokosmetiku",
            "❌ Drogové a sexuální narážky — tohle je eshop pro lidi, co řeší svoje auto",
            "❌ Vykání — nikdy",
            "❌ Korporátní jazyk: 'Zakupte si naše kvalitní produkty'",
            "❌ Přehnaný hype: 'NEJLEPŠÍ ŠAMPON NA SVĚTĚ!!!'",
            "❌ Sliby zázraků — 'odstraní všechny škrábance' je lež",
            "❌ Motivační citáty a IG kouč tón",
            "❌ Zmiňovat konkurenční značky autokosmetiky (Liqui Moly, Meguiar's, Koch Chemie, Auto Finesse…)",
            "❌ Cringe boomer humor",
        ],
        ctaVariations: [
            "Celá řada na hanzgarage.cz",
            "Link v biu → hanzgarage.cz",
            "hanzgarage.cz — ať příště nemyješ nadarmo",
            "Ulož si to, až budeš mýt 🔖",
            "Máš to doma? Ukaž výsledek v komentech 👇",
            "Ptej se v komentech, odpovím",
            "Tagni kámoše, co pořád myje auto kruhem",
            "Co používáš ty? Do komentů 👇",
            "Sady najdeš na hanzgarage.cz",
            "Vyzkoušej to a pošli fotku do DM",
        ],
        hookTemplates: [
            {
                pattern: "Tohle ti ničí lak: {{chyba}}",
                example: "Tohle ti ničí lak: myješ ho kruhovými pohyby.",
                bestFor: ["chyba_ktera_nici_lak", "hot_take"],
                trigger: "fear",
            },
            {
                pattern: "POV: {{situace_z_myti}}",
                example: "POV: Domyl jsi auto a začalo pršet.",
                bestFor: ["detailing_realita"],
                trigger: "humor",
            },
            {
                pattern: "{{počet}} minut. Žádná leštička. {{výsledek}}",
                example: "10 minut. Žádná leštička. Voda z laku padá sama.",
                bestFor: ["novinka_skladem", "co_je_v_sade"],
                trigger: "curiosity",
            },
            {
                pattern: "Real talk: {{kontroverzní_názor}}",
                example: "Real talk: Kartáčová myčka je nejdražší úspora, jakou uděláš.",
                bestFor: ["hot_take"],
                trigger: "humor",
            },
            {
                pattern: "Voda na laku takhle nestojí sama od sebe. {{produkt}}",
                example: "Voda na laku takhle nestojí sama od sebe. Keramická ochrana.",
                bestFor: ["beading_porn", "novinka_skladem"],
                trigger: "curiosity",
            },
            {
                pattern: "Než začneš mýt: {{jedna_věc}}",
                example: "Než začneš mýt: nikdy ne na slunci a nikdy ne shora dolů jedním hadrem.",
                bestFor: ["krok_za_krokem"],
                trigger: "empathy",
            },
            {
                pattern: "Tohle auto vypadalo před hodinou takhle 👇",
                example: "Tohle auto vypadalo před hodinou takhle 👇",
                bestFor: ["before_after", "auto_z_party"],
                trigger: "curiosity",
            },
            {
                pattern: "Přestaň {{špatný_zvyk}}. Dělej {{správný_postup}}.",
                example: "Přestaň drhnout disky hadrem. Nech pracovat chemii.",
                bestFor: ["krok_za_krokem", "chyba_ktera_nici_lak"],
                trigger: "hope",
            },
        ],
        toneByPostType: {
            krok_za_krokem: { humorLevel: 2, urgencyLevel: 1, intimacyLevel: 4, educationalLevel: 5 },
            chyba_ktera_nici_lak: { humorLevel: 2, urgencyLevel: 4, intimacyLevel: 3, educationalLevel: 5 },
            before_after: { humorLevel: 2, urgencyLevel: 2, intimacyLevel: 3, educationalLevel: 4 },
            beading_porn: { humorLevel: 1, urgencyLevel: 2, intimacyLevel: 2, educationalLevel: 2 },
            co_je_v_sade: { humorLevel: 2, urgencyLevel: 3, intimacyLevel: 3, educationalLevel: 4 },
            novinka_skladem: { humorLevel: 2, urgencyLevel: 5, intimacyLevel: 3, educationalLevel: 3 },
            detailing_realita: { humorLevel: 5, urgencyLevel: 1, intimacyLevel: 5, educationalLevel: 1 },
            hot_take: { humorLevel: 4, urgencyLevel: 2, intimacyLevel: 4, educationalLevel: 3 },
            hanz_v_garazi: { humorLevel: 3, urgencyLevel: 1, intimacyLevel: 5, educationalLevel: 2 },
            auto_z_party: { humorLevel: 2, urgencyLevel: 1, intimacyLevel: 5, educationalLevel: 2 },
            soutez_o_sadu: { humorLevel: 3, urgencyLevel: 5, intimacyLevel: 4, educationalLevel: 1 },
        },
    },

    brandVoiceExamples: [
        {
            caption:
                "Kartáčová myčka ti za rok udělá z laku brusný papír.\n\nTy kartáče berou písek z auta před tebou a projedou ti ho po kapotě. Proto ten lak na slunci vypadá jak pavučina.\n\nDvě vědra, rukavice z mikrovlákna, shora dolů. Trvá to o dvacet minut dýl a lak ti to vrátí.\n\nDěláš to taky? Přiznej se v komentech 👇",
            note: "Vzor pro návod a hot take — tvrdý start, konkrétní fyzikální důvod, jasné řešení, otázka na konec. Žádné sliby zázraků.",
            postType: "chyba_ktera_nici_lak",
        },
        {
            caption: "Umyl jsem auto. Předpověď: déšť za 40 minut. 🙃\n\nKdo to má taky? 👇",
            note: "Vzor pro humor — dvě věty, vtip se nevysvětluje, měkké CTA.",
            postType: "detailing_realita",
        },
        {
            caption:
                "Voda na laku takhle nestojí sama od sebe.\n\nTohle je Keramická ochrana po deseti minutách práce. Žádná leštička, žádné studio. Nastříkat, rozetřít, setřít.\n\nDrží několik měsíců a příští mytí máš za polovinu času.\n\nCelá řada na hanzgarage.cz",
            note: "Vzor pro produkt — konkrétní benefit a čas místo superlativů, tvrdé CTA až na konci.",
            postType: "novinka_skladem",
        },
        {
            caption:
                "Disky nejsou špinavý. Jsou zarostlý.\n\nTen černej povlak je brzdový prach zapečený do laku disku. Hadrem ho nedostaneš, jenom ho rozetřeš.\n\nKyselý čistič kol nastříkej na suchý disk, nech dvě minuty pracovat a spláchni. Co zbyde, dojede štětec.\n\nUlož si to, až budeš mýt 🔖",
            note: "Vzor pro návod — pojmenuje problém, vysvětlí proč, dá postup s čísly, měkké CTA na uložení.",
            postType: "krok_za_krokem",
        },
    ],

    contentPillars: {
        navod: {
            emoji: "🧼",
            label: "NÁVOD",
            description: "Postupy, správné pořadí kroků, chyby při mytí",
            postTypes: ["krok_za_krokem", "chyba_ktera_nici_lak"],
            ratio: 0.25,
            ctaStrategy: "medium",
            kpi: ["saves", "shares"],
            targetPersona: "Víkendový myč",
            ideaPrompt: `## NÁVOD PILÍŘ — Jak na to pořádně
Generuj nápady na konkrétní postupy a chyby při péči o auto.
Formáty: krok za krokem, "tohle děláš špatně", správné pořadí, kolik to trvá.
Klíč: konkrétnost — čísla, minuty, ředění. Nikdy obecné rady.

Příklady angle:
- "Mytí dvěma kbelíky — proč to není buzerace" → postup
- "V jakém pořadí se auto myje (a proč disky první)" → pořadí kroků
- "Myješ na slunci? Tady je, co to dělá s lakem" → chyba`,
        },
        vysledek: {
            emoji: "✨",
            label: "VÝSLEDEK",
            description: "Před/po, beading, satisfying záběry",
            postTypes: ["before_after", "beading_porn"],
            ratio: 0.25,
            ctaStrategy: "soft",
            kpi: ["reach", "shares", "saves"],
            targetPersona: "Detailing nerd",
            ideaPrompt: `## VÝSLEDEK PILÍŘ — Ať mluví fotka
Generuj nápady, kde je hrdinou viditelný rozdíl.
Formáty: před/po, makro na perlení vody, satisfying proces, detail laku.
Klíč: minimum textu, maximum vizuálního důkazu.

Příklady angle:
- "Disky po zimě vs. po pěti minutách chemie" → před/po
- "Voda na čerstvé keramice v protisvětle" → beading
- "Maska po 400 km dálnice vs. po odstraňovači hmyzu" → před/po`,
        },
        produkt: {
            emoji: "🧴",
            label: "PRODUKT",
            description: "Novinky, sady, co si vzít na jaký úkol",
            postTypes: ["co_je_v_sade", "novinka_skladem", "soutez_o_sadu"],
            ratio: 0.2,
            ctaStrategy: "hard",
            kpi: ["link_clicks", "profile_visits"],
            targetPersona: "Detailing nerd",
            ideaPrompt: `## PRODUKT PILÍŘ — Co si vzít a proč
Generuj nápady na produktové posty, které rozhodují za zákazníka.
Formáty: novinka, sada na konkrétní úkol, "co použít když…", srovnání dvou produktů z řady.
Klíč: jeden úkol → jasná odpověď. Vždy řekni i kdy to NEPOUŽÍVAT.

Příklady angle:
- "Po zimě: šampon, iron remover, dekontaminace — v tomhle pořadí" → sada
- "Quick Detailer: na co to je a na co rozhodně ne" → poctivé vymezení
- "Keramická ochrana za 10 minut bez leštičky" → novinka`,
        },
        humor: {
            emoji: "😂",
            label: "HUMOR",
            description: "Memes, relatable realita mytí, hot takes",
            postTypes: ["detailing_realita", "hot_take"],
            ratio: 0.2,
            ctaStrategy: "soft",
            kpi: ["shares", "comments", "reach"],
            targetPersona: "Chlap, co na to nemá čas",
            ideaPrompt: `## HUMOR PILÍŘ — Sdílitelný a provokativní
Generuj memes a vyhraněné názory o realitě péče o auto.
Formáty: meme, hot take, relatable situace, roast špatných zvyků.
Klíč: suchý humor, sebeironie, nikdy sprosťárny za každou cenu.

Příklady angle:
- "Umyl jsem auto → déšť za 40 minut" → relatable
- "Voskovat jednou za rok je jako čistit zuby jednou za měsíc" → hot take
- "Hodina na disky, pět minut na zbytek auta" → sebeironie`,
        },
        garaz: {
            emoji: "🔧",
            label: "GARÁŽ",
            description: "Hanz, zákaznická auta, zákulisí",
            postTypes: ["hanz_v_garazi", "auto_z_party"],
            ratio: 0.1,
            ctaStrategy: "none",
            kpi: ["comments", "profile_visits"],
            targetPersona: "Víkendový myč",
            ideaPrompt: `## GARÁŽ PILÍŘ — Kdo za tím stojí
Generuj nápady, které ukazují reálné lidi a reálná auta.
Formáty: Hanz v garáži, auto zákazníka, zákulisí, noční jízda po mytí.
Klíč: autenticita, žádné studio, žádná póza.

Příklady angle:
- "Noční mytí M2 před víkendovou jízdou" → Hanz
- "Auto týdne: co majitel použil a jak dlouho mu to trvalo" → zákazník
- "Jak vypadá garáž po celodenním detailingu" → zákulisí`,
        },
    },

    ctaStrategies: {
        hard: [
            "Celá řada na hanzgarage.cz",
            "Link v biu → hanzgarage.cz",
            "Objednej na hanzgarage.cz a měj to do víkendu",
            "hanzgarage.cz — ať příště nemyješ nadarmo",
        ],
        medium: [
            "Víc návodů na hanzgarage.cz",
            "Mrkni na celou řadu 👀",
            "Sady najdeš na hanzgarage.cz",
            "Followni, ať ti neuteče další návod",
        ],
        soft: [
            "Ulož si to, až budeš mýt 🔖",
            "Tagni kámoše, co myje auto kruhem",
            "Co používáš ty? Do komentů 👇",
            "Pošli to někomu, kdo tohle potřebuje vidět",
        ],
        none: ["Souhlas nebo blbost? 👇", "Ptej se v komentech, odpovím", "Ukaž výsledek v komentech 👇"],
    },

    feedAesthetic: {
        feel: "Raw garage detailing — mokrý lak, noční zářivky, beton. Ne sterilní katalog, ale reálná garáž po půlnoci.",
        font: "Bebas Neue — bold condensed uppercase, motorsport/garage poster",
        colorPalette:
            "Černá (#0a0a0a) základ, signální červená (#e10600) jako akcent, bílá a chrom jako doplněk, hluboké mokré odlesky na laku",
        accentColor: "#e10600",
        typographyStyle:
            "bold condensed grotesque, uppercase, motorsport stencil energy — krátká úderná slova, nikdy odstavce",
        textPosition: "CENTER or BOTTOM",
        overlayOpacity: "50-60%",
        phoneModel: "none",
        logoPlacement: "auto",
        customInstructions: `
- Tmavá, syrová estetika — noční garáž, zářivky, mokrý beton, odlesky na laku
- Prostředí: garáž, myčka, podzemní parkoviště, noční ulice po dešti — NIKDY sterilní bílé studio
- Hrdinou obrázku je LAK, VODA nebo PRODUKT — ostré makro, protisvětlo, kapky, pěna
- Textury: mokrý lak, beton, chrom, černé nitrilové rukavice, mikrovlákno, kartáč na disky
- Světlo: tvrdé boční nasvícení nebo protisvětlo, hluboké stíny, vysoký kontrast
- Auta v pozadí: BMW M2 G87 (Zandvoort Blue), Mercedes-AMG GT R (matná zelená), Mercedes G-Class 4x4²
- Produkty HanzGarage jsou lahve s tmavou čistou etiketou — na produktových postech musí být lahev ostrá a čitelná
- NIKDY nezobrazuj loga ani produkty konkurenčních značek autokosmetiky (Liqui Moly, Meguiar's, Koch Chemie, Auto Finesse…)
- NIKDY nezobrazuj oblečení s potiskem, trika, mikiny ani čepice s logem — neprodáváme merch
- Logo značky (stylizovaná lebka s brýlemi) je oficiální znak HanzGarage — vykresluj ho věrně podle přiložené referenční předlohy, nikdy si ho nedomýšlej
- V obrázcích se NIKDY nesmí objevit nápisy 'Mrdke' ani 'gang' — ani na logu, ani nikde jinde
- Žádná čistá korporátní/Apple estetika — tohle je garáž, ne showroom
- Lidé v záběru pracují (rukavice, pěna, hadr v ruce), nepózují jako modelové
`.trim(),
    },

    feedPattern: "checkerboard",

    weekPlan: [
        "krok_za_krokem",
        "detailing_realita",
        "before_after",
        "novinka_skladem",
        "hot_take",
        "beading_porn",
        "auto_z_party",
    ],
    postTypes: POST_TYPE_DEFS.map(d => d.name),
    postTypeDefs: POST_TYPE_DEFS,
    postFormats,
    defaultFormat: { medium: "image", aspectRatio: "4:5", overlayStyle: "default" },

    postsPerWeek: 2,
    productCooldownDays: 14,
    videoTier: "fast",
    psychologist: true,
    autoPublish: false,
    autoReplenishIdeas: true,

    hashtagPools: {
        core: ["#hanzgarage", "#hanzgaragecz"],
        niche: [
            "#autokosmetika",
            "#ceskydetailing",
            "#detailingcz",
            "#autodetailing",
            "#keramickaochrana",
            "#mytiauta",
        ],
        broad: ["#detailing", "#cardetailing", "#carcare", "#cleancar", "#carsofinstagram", "#detailingworld"],
        czech: ["#ceskyinstagram", "#madeinczech", "#ceskaznacka"],
        trending: ["#satisfying", "#beading", "#paintcorrection", "#snowfoam"],
    },

    products: PRODUCTS,

    imageInstructions: {
        _default: "Pozadí: garáž nebo noční ulice, mokrý lak s odlesky.\nText dole: headline.",
        krok_za_krokem:
            "NÁVOD: Pozadí: ruce v černých nitrilových rukavicích při práci, detail na proces. Velké číslo kroku.\nText dole: název kroku.",
        chyba_ktera_nici_lak:
            "CHYBA: Pozadí: extrémní makro na poškozený lak — swirly a hologramy v ostrém bočním světle, okolí ve tmě.\nText: varovný nadpis přes horní třetinu.",
        before_after:
            "PŘED/PO: Pozadí: split screen, identický úhel i světlo na obou stranách, tenká dělící čára.\nText: popisky 'PŘED' a 'PO'.",
        beading_porn:
            "BEADING: Pozadí: makro na kapky vody perlící na tmavém laku v protisvětle. Bez lidí, bez textu navíc.",
        co_je_v_sade:
            "SADA: Pozadí: lahve postavené na betonu nebo kapotě, tvrdé boční světlo, dlouhé stíny, tmavé pozadí.\nText dole: na co to je.",
        novinka_skladem:
            "NOVINKA: Pozadí: jedna lahev v centru, dramatické nasvícení, vodní mlha, tmavé pozadí. Etiketa ostrá a čitelná.\nText dole: název produktu.",
        detailing_realita:
            "MEME — VÝJIMKA: žádný gradient overlay, žádná produktová estetika. Syrová mobilní fotka z garáže nebo parkoviště, klasický meme formát.",
        hot_take:
            "HOT TAKE: Typografický post — velké condensed písmo přes celou plochu, tmavé pozadí, jedno klíčové slovo v signální červené. Minimum obrazu.",
        hanz_v_garazi:
            "HANZ: Pozadí: noční garáž, zářivky, mokrý beton, auto ve tmě. Hanz v akci při práci, nikdy v póze.",
        auto_z_party:
            "ZÁKAZNÍK: Pozadí: reálná zákaznická fotka auta — parkoviště nebo garáž, večerní světlo, autentická kvalita.\nText: handle majitele jako grafika přes fotku.",
        soutez_o_sadu:
            "SOUTĚŽ: Pozadí: produkt nebo sada uprostřed, tmavé pozadí, ostré nasvícení. Obří nápis SOUTĚŽ přes horní třetinu.",
    },

    videoFocus:
        "Detailing v garáži — pěna na laku, mytí dvěma kbelíky, čištění disků, aplikace keramické ochrany, voda perlící na čerstvě ošetřeném laku, před/po. Plus Hanz v garáži a noční jízdy s hotovým autem.",

    characterDescription: `
Hanz — zakladatel a tvář HanzGarage.

VZHLED:
- Zcela holá hlava (oholená), silná statná postava, široká ramena, mohutný krk
- Krátké prošedivělé strniště / šedivá bradka, opálená ošlehaná pleť
- Věk kolem padesáti, výrazné vrásky na čele, ostrý pohled
- Klidný, tvrdý výraz — chlap, co má odjeto. Nikdy přehnaný úsměv.

DOPLŇKY:
- Tmavé hranaté sluneční brýle (venku, přes den)
- Silný zlatý řetěz kolem krku
- Ocelové hodinky s tmavým číselníkem
- NIKDY nezobrazuj loga luxusních značek na brýlích, hodinkách ani oblečení

OBLEČENÍ — pracovní, ne merch:
- Černé tričko nebo mikina BEZ potisku, případně černý pracovní overal
- Černé nitrilové rukavice při práci s chemií
- Tmavé kalhoty, pracovní boty
- ŽÁDNÁ trika s potiskem, žádné čepice s logem, žádné cizí značky

CO DĚLÁ NA FOTKÁCH:
- Myje, pěnuje, stírá, aplikuje produkt — vždy v akci, nikdy v póze
- Drží lahev HanzGarage, pěnovou lanci, mikrovlákno, kartáč na disky
- Kleká si k disku, naklání se přes kapotu, kontroluje lak proti světlu

AUTA (pozadí, lifestyle):
- BMW M2 G87 Competition (Zandvoort Blue)
- Mercedes-AMG GT R (matná zelená)
- Mercedes G-Class 4x4²
- Noční jízdy, podzemní garáže, mokrý asfalt

VIBE: Čech, co má auta v krvi. Garáž ve dvě ráno, ne influencer studio.
`.trim(),

    // LIQUI MOLY logo z původních referencí odstraněno (cizí značka autochemie).
    brandReferenceImages: [
        "https://nyvbxpjkwhcuugwevobu.supabase.co/storage/v1/object/public/audit-screenshots/client-assets/hanzfans/brand-1773869936944.jpg",
        "https://nyvbxpjkwhcuugwevobu.supabase.co/storage/v1/object/public/audit-screenshots/client-assets/hanzfans/brand-1773869953001.jpg",
        "https://nyvbxpjkwhcuugwevobu.supabase.co/storage/v1/object/public/audit-screenshots/client-assets/hanzfans/brand-1773869961892.jpg",
    ],

    audiencePersonas: [
        {
            label: "Víkendový myč",
            ageRange: "25-40",
            painPoints: [
                "Myje auto na dvoře, ale výsledek jsou pořád fleky a šmouhy",
                "Neví, který přípravek je na co a v jakém pořadí",
                "Nechce dát pět tisíc za detailingové studio",
            ],
            triggers: ["Konkrétní postup krok za krokem", "Před/po na běžném autě", "'Tohle děláš špatně'"],
            ctaStyle: "medium",
        },
        {
            label: "Detailing nerd",
            ageRange: "20-35",
            painPoints: [
                "Řeší swirly, hologramy a hloubku laku",
                "Chce hydrofobní efekt, co fakt vydrží",
                "Nesnáší marketingové kecy bez čísel",
            ],
            triggers: ["Makro na beading", "Srovnání produktů", "Technický detail (pH, ředění, výdrž)"],
            ctaStyle: "hard",
        },
        {
            label: "Chlap, co na to nemá čas",
            ageRange: "35-55",
            painPoints: [
                "Auto je špinavé a on nemá půl dne na mytí",
                "Chce viditelný výsledek za dvacet minut",
                "Ví, že myčka ničí lak, ale je to pohodlné",
            ],
            triggers: ["'Za 10 minut a bez leštičky'", "Humor o realitě mytí", "Jednoduché sady bez přemýšlení"],
            ctaStyle: "soft",
        },
    ],

    communicationStyle: {
        headline: "Chlap z garáže, co ti fakt poradí",
        rationale:
            "HanzGarage neprodává zázraky v lahvi — prodává postup, který funguje. Autorita vzniká tím, že řekneš i to, co produkt neumí, a že mluvíš jazykem člověka, co má ruce od pěny. Humor drží dosah, konkrétní návody drží důvěru.",
        dos: [
            "Tykej a mluv hovorově — jsi kámoš v garáži, ne zákaznická linka",
            "Dávej konkrétní čísla: kolik minut, jaké ředění, jak dlouho nechat působit",
            "Pojmenuj chybu tvrdě a hned nabídni řešení",
            "Přiznej, co produkt neumí — buduje to důvěru víc než superlativy",
            "Nech mluvit fotku: mokrý lak, perlení, před/po",
        ],
        donts: [
            "Neslibuj zázraky ('odstraní všechny škrábance')",
            "Nepoužívej nic ze staré merch značky — žádné 'Mrdke', žádný 'gang', žádná trika",
            "Nezmiňuj konkurenční značky autokosmetiky",
            "Nevykej a nepiš korporátně",
            "Nepoužívej drogové a sexuální narážky — tohle je eshop pro majitele aut",
        ],
    },

    // Původní logo zůstává na přání klienta — je to jeho značka. Soubor je
    // traceovaný do Vercel buildu (ověřeno v .next/**/route.js.nft.json),
    // takže se načte i v produkci.
    logoFile: "logo-hanzfans.png",
}

const NEW_CATEGORY_GUIDE = `Vytvoř prémiovou produktovou vizualizaci autokosmetiky pro značku HanzGarage. Produkt má působit jako výrazná, sebevědomá garážová značka — kombinace motorsportu, detailingu a syrové garážové kultury.

Použij tmavé, kontrastní pozadí s industriální atmosférou garáže, betonem, černým lakem auta, mokrým asfaltem nebo detailingovým studiem. Produkt musí být hlavním hrdinou záběru, nasvícený dramatickým studiovým světlem s ostrými odlesky na plastu, kovu, skle nebo laku auta.

Design etikety má působit moderně, agresivně a prémiově. Vizuální styl: černá, signální červená (#e10600), bílá, chrom a šedá jako doplněk. Grafika může obsahovat závodní čáry, warning label, garage badge, špínu, pěnu, kapky vody, kouř nebo lesklý odraz karoserie.

Vyhni se levnému hobby vzhledu. Nikdy nezobrazuj loga konkurenčních značek autochemie ani motivy staré merch značky. Výsledek musí působit jako produkt, který si koupí člověk, co miluje auta, detailing a garážovou kulturu. Fotka realistická, ostrá, komerční — vhodná pro e-shop, Instagram i produktový launch.`

// ─── Run ─────────────────────────────────────────────────────────────

const CONTENT_TABLES_IN_DELETE_ORDER = [
    "ig_generation_log", // → post_id
    "ig_content_calendar", // → post_id, post_type_id
    "ig_posts", // → post_type_id, idea_id, product_id
    "ig_jobs",
    "ig_campaigns",
    "ig_post_ideas",
    "ig_product_ideas",
    "ig_products",
    "ig_post_types",
    "ig_brand_memory",
    "ig_reviews",
]

async function main() {
    console.log(`\n${APPLY ? "🔴 APPLY" : "🟡 DRY RUN"} — rebrand HanzFans → HanzGarage\n`)

    // 1) Záloha
    const backup: Record<string, any> = { takenAt: new Date().toISOString(), clientId: CLIENT_ID }
    backup.clients = await rest(`clients?id=eq.${CLIENT_ID}&select=*`)
    for (const t of [...CONTENT_TABLES_IN_DELETE_ORDER, "ig_product_categories"]) {
        backup[t] = await select(t)
        console.log(`  záloha ${t}: ${backup[t]?.length ?? 0} řádků`)
    }

    const dir = path.join("scripts", "backups")
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `hanzfans-pred-rebrandem-${Date.now()}.json`)
    fs.writeFileSync(file, JSON.stringify(backup, null, 2))
    console.log(`\n💾 Záloha: ${file}\n`)

    if (!APPLY) {
        console.log("Dry run — nic se nezapisuje. Spusť s --apply.\n")
        console.log(`Nový config: ${POST_TYPE_DEFS.length} formátů, ${Object.keys(NEW_CONFIG.contentPillars).length} pilířů, ${PRODUCTS.length} produktů.`)
        const sum = Object.values(NEW_CONFIG.contentPillars).reduce((a, p) => a + p.ratio, 0)
        console.log(`Součet ratio pilířů: ${sum.toFixed(2)} (musí být 1.00)`)
        return
    }

    // 2) Smazat starý obsah
    for (const t of CONTENT_TABLES_IN_DELETE_ORDER) {
        await wipe(t)
        console.log(`  🗑️  ${t} vyčištěno`)
    }

    // 3) Nový config + hlavička klienta
    await rest(`clients?id=eq.${CLIENT_ID}`, {
        method: "PATCH",
        body: JSON.stringify({
            name: "HanzGarage",
            website: "https://hanzgarage.cz",
            instagram: "hanzgarage",
            config: NEW_CONFIG,
        }),
    })
    console.log("  ✅ clients.config přepsán")

    // 4) Produkty
    await rest("ig_products", {
        method: "POST",
        body: JSON.stringify(
            PRODUCTS.map(p => ({
                client_id: CLIENT_ID,
                name: p.name,
                slug: p.slug,
                type: p.type,
                description: p.description,
                price: null, // klient ceny zatím nedodal
                image_urls: [],
            })),
        ),
    })
    console.log(`  ✅ ${PRODUCTS.length} produktů nasazeno`)

    // 5) Formáty do ig_post_types (stejný tvar jako ensurePostTypes)
    await rest("ig_post_types", {
        method: "POST",
        body: JSON.stringify(
            POST_TYPE_DEFS.map(d => ({
                client_id: CLIENT_ID,
                name: d.name,
                display_name: `${d.emoji} ${d.display_name}`,
                emoji: d.emoji,
                description: d.description,
                frequency: "weekly",
                is_active: true,
                uses_product: d.uses_product,
            })),
        ),
    })
    console.log(`  ✅ ${POST_TYPE_DEFS.length} formátů nasazeno`)

    // 6) Design guide kategorie — odstranit "Mrdke"
    await rest(`ig_product_categories?client_id=eq.${CLIENT_ID}&slug=eq.autokosmetika`, {
        method: "PATCH",
        body: JSON.stringify({ design_guide: NEW_CATEGORY_GUIDE }),
    })
    console.log("  ✅ design guide kategorie přepsán")

    console.log("\n🏁 Hotovo.\n")
}

main().catch(e => {
    console.error("\n❌", e.message)
    process.exit(1)
})
