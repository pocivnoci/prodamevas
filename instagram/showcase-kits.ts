/**
 * Registr oborových showcase kitů — obsah, ne mechanika.
 * ======================================================
 * Mechanika (jak se kit vlepí do jedné generace) žije v `showcase-kit.ts`.
 * Tady je jenom to, CO se ukazuje: devět oborů, devět palet, devět typografií.
 *
 * Oddělené od `scripts/seed-chrlit-showcase.ts` schválně — ten skript se při
 * importu sám spustí, takže by z něj `npm run guard` nemohl číst.
 */

import type { FeedAesthetic, PostTypeDef } from "./configs/types"
import type { ShowcaseKit } from "./showcase-kit"
import { INDUSTRY_VISUAL_PROFILES } from "./industry-visual-profiles"

/**
 * Vizuální identita oboru se bere ze SDÍLENÉHO registru, ne z kopie tady.
 *
 * Tytéž dvě věty (jak se v oboru svítí a jakým řezem se v něm sází) potřebuje
 * i engine pro platícího klienta z toho oboru — a dvě kopie by se rozešly už při
 * první opravě. Registr je autorita, kit z něj jen čerpá; `dominantColor`,
 * `visualMode` a hlas zůstávají autorské, protože to je volba PRO UKÁZKU, ne
 * vlastnost oboru.
 */
function visualOf(key: keyof typeof INDUSTRY_VISUAL_PROFILES): Partial<FeedAesthetic> {
    const p = INDUSTRY_VISUAL_PROFILES[key]
    return { typographyStyle: p.typographyStyle, feel: p.lightingBrief }
}

export const SHOWCASE_TYPE = "ukazka_oboru"

/** Formát je jeden pro celou sérii — obor se mění přes kit a `topic`.
 *
 *  Brief schválně nejmenuje ani nás, ani obor: `warnOnScenicFormats` hlásí
 *  vlastní jméno uvnitř plynulého textu jako storyboard jednoho postu, a má
 *  pravdu — konkrétnost patří do kitu, ne do šablony.
 *  Dvanáct téměř stejných formátů je přesně ta patologie, kterou hlídá
 *  `warnOnScenicFormats` a která u `chrlit` už jednou vyrobila 170 postů z 8 formátů.
 *
 *  `manualOnly` je nutnost, ne opatrnost: bez kitu by autopilot tenhle formát
 *  vygeneroval v chrlití červené a s textem o oboru, který si vymyslel.
 *  `mechanism` schválně chybí — s ním by se brief četl ze sdílené tabulky
 *  místo z `structure`/`visualStyle` níž. */
export const SHOWCASE_TYPE_DEF: PostTypeDef = {
    name: SHOWCASE_TYPE,
    display_name: "Ukázka práce pro obor",
    emoji: "🎨",
    description: "Hotový příspěvek pro značku z jednoho oboru, v její vlastní barevnosti a typografii. Ukázka práce, ne příspěvek o nás.",
    structure: "Hook a text NA OBRÁZKU = reklamní sdělení té značky jejím zákazníkům, o nás ani slovo. → Tělo a CTA v POPISKU = náš hlas: pro jaký obor, že jde o koncept, že značka neexistuje, teprve pak nabídka.",
    visualStyle: "Plnohodnotná kompozice jako u platícího klienta — fotka vede, text uvnitř kompozice. Žádná plochá barva se vsazenou fotkou, žádný pruh.",
    pillar: "sales",
    medium: "image",
    aspectRatio: "4:5",
    uses_product: false,
    manualOnly: true,
}

// ─── Registr kitů ────────────────────────────────────────────────────
//
// Devět oborů = tři plné řádky mřížky. Záměrně chybí Olympia Fitness
// (#121212 + #c62828) a Ambiente (#c8102e): obě jsou černočervené jako Chrlit
// sám, takže by v mřížce nedokázaly nic, co má série dokázat.
//
// Typografie je autorská a schválně rozprostřená co nejdál od chrlitího
// „bold condensed grotesque, uppercase" — ta vzdálenost JE ten důkaz.

export const KITS: ShowcaseKit[] = [
    {
        key: "agropuda",
        benefit: "cas",
        persona: "Hospodář, který půdu vlastní a obchází ji. Mluví o hektarech, hlíně a cyklu, ne o portfoliu. Kdo hledá rychlý výnos, tomu to rozmluví.",
        voiceTraits: ["věcný", "konzervativní", "trpělivý", "bez patosu"],
        visualMode: "photo", // krajina a půda unesou celoplošnou fotku
        dominantColor: "#78D039", // slunná travní zeleň
        sourceSlug: "agro-invest",
        industryLabel: "Investice do zemědělské půdy",
        brandName: "ORNICE",
        feedAesthetic: {
            ...visualOf("agropuda"),
        },
        voiceBrief: "věcný, konzervativní, edukativní — mluví o půdě jako o věci, kterou lze vidět a obejít, ne jako o produktu",
        guardrails: "ŽÁDNÁ čísla o zhodnocení, ŽÁDNÉ garance odkupu, ŽÁDNÉ srovnání s jinými třídami aktiv, ŽÁDNÉ sliby jistoty ani bezpečí.",
    },
    {
        key: "hotel",
        benefit: "znalost",
        persona: "Concierge, který dům zná do posledního schodu. Zve, nevnucuje, a o ceně mluví až když se zeptáte.",
        voiceTraits: ["zdvořilý", "zvoucí", "smysl pro detail", "nenápadně hrdý"],
        visualMode: "photo", // interiér je produkt
        dominantColor: "#3AADDF", // jasná lázeňská modř
        sourceSlug: "grandhotel-pupp",
        industryLabel: "Lázeňské hotelnictví",
        brandName: "HOTEL PRAMEN",
        feedAesthetic: {
            ...visualOf("hotel"),
        },
        voiceBrief: "zdvořilý, zvoucí, s citem pro detail — popisuje zážitek, ne vybavení",
    },
    {
        key: "vinarstvi",
        benefit: "cena",
        persona: "Vinař třetí generace, který mluví o trati, ročníku a počasí. O víně říká, co v něm je, ne co byste měli cítit.",
        voiceTraits: ["rodinný", "hrdý", "konkrétní", "bez vinařského žargonu"],
        visualMode: "photo", // split/blok — láhev proti terroir
        dominantColor: "#E67737", // zářivá terakota
        sourceSlug: "znovin-znojmo",
        industryLabel: "Rodinné vinařství",
        brandName: "VINAŘSTVÍ POD SKALOU",
        feedAesthetic: {
            ...visualOf("vinarstvi"),
        },
        voiceBrief: "rodinný, hrdý, konkrétní — mluví o ročníku, trati a počasí, ne o superlativech",
    },
    {
        key: "kadernictvi",
        benefit: "konzistence",
        persona: "Kadeřnice, která klientce řekne pravdu o jejích vlasech. Mluví k dospělé ženě, ne k holčičce.",
        voiceTraits: ["sebevědomý", "pečující", "přímý", "bez pusinkování"],
        visualMode: "photo", // salon prodává postoj, ne katalog
        dominantColor: "#BE4DDB", // sytá orchidejová
        sourceSlug: "kadernictvi-klier",
        industryLabel: "Kadeřnictví a vlasová péče",
        brandName: "STUDIO VLNA",
        feedAesthetic: {
            ...visualOf("kadernictvi"),
        },
        voiceBrief: "sebevědomý a pečující, mluví ke klientce jako profesionál k dospělé ženě, bez pusinkování",
    },
    {
        key: "koupelny",
        benefit: "cas",
        persona: "Řemeslník, co koupelnu staví, ne prodává. Mluví v milimetrech, materiálech a v tom, co vydrží.",
        voiceTraits: ["praktický", "přímý", "technický", "spolehlivý"],
        visualMode: "photo", // technická mřížka, materiálové bloky
        dominantColor: "#3687E2", // čistá azurová
        sourceSlug: "koupelny-ptacek",
        industryLabel: "Koupelnové studio",
        brandName: "KOUPELNY OBZOR",
        feedAesthetic: {
            ...visualOf("koupelny"),
        },
        voiceBrief: "praktický a přímý, mluví v milimetrech a materiálech, prodává jistotu odvedené práce",
    },
    {
        key: "potraviny",
        benefit: "znalost",
        persona: "Někdo z ranní směny u pultu. Řekne, co je dneska čerstvé, a nechá to být.",
        voiceTraits: ["svižný", "lidový", "praktický", "bez nadsázky"],
        visualMode: "photo", // čerstvost je vidět jen na fotce
        dominantColor: "#2BD455", // svěží listová zeleň
        sourceSlug: "rohlik-cz",
        industryLabel: "Rozvoz potravin",
        brandName: "SPÍŽKA",
        feedAesthetic: {
            ...visualOf("potraviny"),
        },
        voiceBrief: "svižný, praktický, lidový — mluví o tom, co je dneska čerstvé, a šetří čas",
    },
    {
        key: "reality",
        benefit: "cena",
        persona: "Makléř, který nechá mluvit dispozici a lokalitu. Nikdy nekřičí a nikdy nepřehání.",
        voiceTraits: ["zdrženlivý", "přesný", "věcný", "diskrétní"],
        visualMode: "photo", // prostor musí dýchat celoplošně
        dominantColor: "#EAAB3E", // medová jantarová
        sourceSlug: "svoboda-williams",
        industryLabel: "Prémiové reality",
        brandName: "DŮM & KLÍČ",
        feedAesthetic: {
            ...visualOf("reality"),
        },
        voiceBrief: "zdrženlivý a přesný, nechává mluvit dispozici a lokalitu, nikdy nekřičí",
    },
    {
        key: "estetika",
        benefit: "konzistence",
        persona: "Lékař, který vysvětlí zákrok i jeho meze. Mluví o péči, ne o proměně.",
        voiceTraits: ["odborný", "klidný", "střízlivý", "bez slibů"],
        visualMode: "photo", // klid a bílý prostor, ne před/po
        dominantColor: "#36D9C3", // svěží tyrkys
        sourceSlug: "asklepion-institut-klinicke-a-",
        industryLabel: "Estetická medicína",
        brandName: "KLINIKA ZÁŘE",
        feedAesthetic: {
            ...visualOf("estetika"),
        },
        voiceBrief: "odborný, klidný, střízlivý — vysvětluje zákrok a jeho meze, mluví o péči, ne o proměně",
        guardrails: "ŽÁDNÉ sliby výsledku, ŽÁDNÉ před/po srovnání, ŽÁDNÁ tvrzení o léčbě ani o zdravotním přínosu.",
    },
    {
        key: "autochemie",
        benefit: "cas",
        persona: "Mechanik z dílny. Mluví o motoru konkrétně a technicky, marketingovou omáčku nesnáší.",
        voiceTraits: ["drsný", "odborný", "úsečný", "bez omáčky"],
        visualMode: "photo", // dílenský plakát, ostré bloky
        dominantColor: "#3E5EE0", // zářivá závodní modř
        sourceSlug: "liqui-moly",
        industryLabel: "Motorová maziva a autochemie",
        brandName: "OKTAN",
        feedAesthetic: {
            ...visualOf("autochemie"),
        },
        voiceBrief: "drsný odborník z dílny — mluví o motoru konkrétně, technicky, bez marketingové omáčky",
    },
    {
        key: "vietnamska_restaurace",
        benefit: "znalost",
        visualMode: "photo",
        dominantColor: "#EECD2B", // limetkově žlutá
        persona: "Usměvavý vietnamský kuchař první generace, který se s nadšením dělí o tajné rodinné recepty.",
        voiceTraits: ["pohostinný", "autentický", "neformální", "srdečný"],
        industryLabel: "Vietnamská restaurace",
        brandName: "MISTR KORIANDR",
        feedAesthetic: {
            colorPalette: "#FFC107 (zlatý vývar), #34A853 (svěží koriandr), #1A1A1A (černý sezam)",
            accentColor: "#34A853",
            ...visualOf("vietnamska_restaurace"),
        },
        voiceBrief: "jako když vás oblíbený strýček s úsměvem zve k bohatě prostřenému stolu a okamžitě vám podává horkou misku nudlí",
    },
    {
        key: "tvorba_bazenu",
        benefit: "cena",
        visualMode: "photo",
        dominantColor: "#23CCE7", // bazénová cyan
        persona: "Zkušený bazénový architekt, který spojuje precizní stavařinu s vizí dokonalé letní relaxace.",
        voiceTraits: ["odborný", "přímočarý", "osvěžující", "spolehlivý"],
        industryLabel: "Tvorba bazénů",
        brandName: "AZUROVÉ BAZÉNY",
        feedAesthetic: {
            colorPalette: "#00B4D8 (Letní tyrkys), #03045E (Noční hladina), #FFD166 (Sluneční svit)",
            accentColor: "#FFD166",
            ...visualOf("tvorba_bazenu"),
        },
        voiceBrief: "vysvětluje stavební i technologické detaily zcela srozumitelně a vždy s ohledem na budoucí zážitek z bezstarostného koupání",
    },
    {
        key: "investice_do_zlata",
        benefit: "konzistence",
        visualMode: "graphic",
        dominantColor: "#E6B333", // ryzí zlatá
        persona: "Konzervativní správce rodinného majetku, který pamatuje ekonomické krize a ví, co si dlouhodobě drží skutečnou hodnotu.",
        voiceTraits: ["klidný", "faktický", "seriózní", "rozvážný"],
        industryLabel: "Investice do zlata",
        brandName: "AURUM REZERVA",
        feedAesthetic: {
            colorPalette: "#681126 (Tmavě bordó), #D4AF37 (Zlatý okr), #F4EAD5 (Světlý pergamen)",
            accentColor: "#D4AF37",
            ...visualOf("investice_do_zlata"),
        },
        voiceBrief: "vysvětluje principy uchování bohatství s rozvahou a důrazem na ochranu kupní síly.",
        guardrails: "Nesmí slibovat zaručené zisky, nesmí tvrdit, že cena zlata může jen růst, a nesmí zamlčovat kurzová rizika nebo poplatky spojené s nákupem a úschovou slitků.",
    },
    {
        key: "zahradnictvi_a_udrzba_ze",
        benefit: "cas",
        visualMode: "photo",
        dominantColor: "#47CC33", // šťavnatá zeleň
        persona: "Zkušený zahradník s mozolnatýma rukama, který detailně zná přírodní cykly a má letitou praxi v terénu.",
        voiceTraits: ["zemitý", "praktický", "upřímný", "povzbuzující"],
        industryLabel: "Zahradnictví a údržba zeleně",
        brandName: "ZELENÁ ŘEMESLA",
        feedAesthetic: {
            colorPalette: "#538B31 - sytá trávová zeleň, #8B5A2B - zemitá hněď, #F4D03F - sluneční žlutá",
            accentColor: "#F4D03F",
            ...visualOf("zahradnictvi"),
        },
        voiceBrief: "předává srozumitelné a léty ověřené rady přímo od hlíny, s hlubokou úctou ke každé rostlině",
    },
    {
        key: "cestovni_kancelar",
        benefit: "znalost",
        visualMode: "photo",
        dominantColor: "#F06D4C", // korálová
        persona: "Zkušený světoběžník a nadšený průvodce, který se s vámi dělí o tajné kouty planety.",
        voiceTraits: ["inspirativní", "hřejivý", "nadšený", "vyprávěcí"],
        industryLabel: "Cestovní kancelář",
        brandName: "ZA OBZOR",
        feedAesthetic: {
            colorPalette: "#FF6F59 (korálový západ slunce), #254441 (hluboký stín džungle), #FFF3E3 (světlý písek)",
            accentColor: "#254441",
            ...visualOf("cestovni_kancelar"),
        },
        voiceBrief: "líčí zážitky z cest s nakažlivým nadšením a láká k objevování nepoznaného.",
    },
    {
        key: "ucetni_kancelar",
        benefit: "cena",
        visualMode: "typography",
        dominantColor: "#6851D6", // indigová
        persona: "Zkušený a pečlivý hlavní účetní, který má v číslech neotřesitelný systém a dokáže klienta chránit před úředními nástrahami",
        voiceTraits: ["věcný", "exaktní", "srozumitelný", "uklidňující"],
        industryLabel: "Účetní kancelář",
        brandName: "AKURÁT ÚČETNICTVÍ",
        feedAesthetic: {
            colorPalette: "#155D67 (hluboká petrolejová), #D97736 (tlumená oranžová), #F4F6F7 (kancelářská šedobílá)",
            accentColor: "#D97736",
            ...visualOf("ucetni_kancelar"),
        },
        voiceBrief: "překládá složitý jazyk daňových zákonů do jasných a praktických rad bez zbytečného úřednického balastu",
        guardrails: "Nesmí garantovat konkrétní výši daňových vratek, slibovat beztrestnost u finančního úřadu ani poskytovat právní rady přesahující rámec daňové evidence",
    },
    {
        key: "cisteni_dlazeb_a_fasad",
        benefit: "konzistence",
        visualMode: "graphic",
        dominantColor: "#26D997", // mátově zelená
        persona: "Pragmatický a fyzicky pracující řemeslník, pro kterého je jediným skutečným argumentem hmatatelný a okamžitě viditelný výsledek.",
        voiceTraits: ["pragmatický", "rázný", "hrdý", "úderný"],
        industryLabel: "Čištění dlažeb a fasád",
        brandName: "BEZMECHU",
        feedAesthetic: {
            colorPalette: "#8E44AD (Průmyslová fialová), #F39C12 (Výstražná oranžová), #E5E7E9 (Hrubý beton)",
            accentColor: "#F39C12",
            ...visualOf("cisteni_fasad"),
        },
        voiceBrief: "Mluví v krátkých a úderných větách bez zbytečné omáčky, přímo k věci a s absolutním zaměřením na jasně odvedenou práci.",
    },
]
