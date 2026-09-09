/**
 * Registr oborových showcase kitů — obsah, ne mechanika.
 * ======================================================
 * Mechanika (jak se kit vlepí do jedné generace) žije v `showcase-kit.ts`.
 * Tady je jenom to, CO se ukazuje: devět oborů, devět palet, devět typografií.
 *
 * Oddělené od `scripts/seed-chrlit-showcase.ts` schválně — ten skript se při
 * importu sám spustí, takže by z něj `npm run guard` nemohl číst.
 */

import type { PostTypeDef } from "./configs/types"
import type { ShowcaseKit } from "./showcase-kit"

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
    display_name: "Ukázka pro obor",
    emoji: "🎨",
    description: "Ukázka, jak by vypadal Instagram jednoho oboru — obálka obor představí, další slidy jsou hotové příspěvky v jeho vlastní barevnosti.",
    structure: "Slide 1: obálka — ukázka pro daný obor, v jeho barvách s tmavým pruhem naší značky dole. → Slide 2-4: tři samostatné ukázkové příspěvky té značky, jejím hlasem. → Popisek: přiznat, že jde o koncept.",
    visualStyle: "Obálka: plocha v barvě a typografii oboru, dole tmavý pruh naší značky s logem. Slidy 2-4: čistý feed té značky, bez pruhu a bez naší barvy.",
    pillar: "sales",
    medium: "carousel",
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
        sourceSlug: "agro-invest",
        industryLabel: "Investice do zemědělské půdy",
        brandName: "ORNICE",
        feedAesthetic: {
            typographyStyle: "elegantní vysoce kontrastní serif, velkorysý prostrk, sentence case",
            feel: "Seriózní pozemková držba: ranní světlo nad lány, zlaté detaily, hmatatelná půda. Klidný a doložený, žádný hype.",
        },
        voiceBrief: "věcný, konzervativní, edukativní — mluví o půdě jako o věci, kterou lze vidět a obejít, ne jako o produktu",
        guardrails: "ŽÁDNÁ čísla o zhodnocení, ŽÁDNÉ garance odkupu, ŽÁDNÉ srovnání s jinými třídami aktiv, ŽÁDNÉ sliby jistoty ani bezpečí.",
    },
    {
        key: "hotel",
        sourceSlug: "grandhotel-pupp",
        industryLabel: "Lázeňské hotelnictví",
        brandName: "HOTEL PRAMEN",
        feedAesthetic: {
            typographyStyle: "klasicistní didone serif s vysokým kontrastem, centrovaná sazba, kapitálky",
            feel: "Lázeňská noblesa bez naftalínu: hluboká noční modř, krémový kámen, mosaz a pára nad hladinou.",
        },
        voiceBrief: "zdvořilý, zvoucí, s citem pro detail — popisuje zážitek, ne vybavení",
    },
    {
        key: "vinarstvi",
        sourceSlug: "znovin-znojmo",
        industryLabel: "Rodinné vinařství",
        brandName: "VINAŘSTVÍ POD SKALOU",
        feedAesthetic: {
            typographyStyle: "humanistická antikva s měkkým perem, malá písmena, řídký sazební obraz",
            feel: "Pozdní odpoledne ve vinici: zemitá hlína, prašné listy, čisté nebe. Řemeslo a trpělivost, žádný luxus.",
        },
        voiceBrief: "rodinný, hrdý, konkrétní — mluví o ročníku, trati a počasí, ne o superlativech",
    },
    {
        key: "kadernictvi",
        sourceSlug: "kadernictvi-klier",
        industryLabel: "Kadeřnictví a vlasová péče",
        brandName: "STUDIO VLNA",
        feedAesthetic: {
            typographyStyle: "geometrický grotesk ve velmi lehkém řezu, extrémní prostrk, malá písmena",
            feel: "Tichý městský salon: tlumená fialová v hluboké černi, měkké bodové světlo, lesk vlasů jako jediná textura.",
        },
        voiceBrief: "sebevědomý a pečující, mluví ke klientce jako profesionál k dospělé ženě, bez pusinkování",
    },
    {
        key: "koupelny",
        sourceSlug: "koupelny-ptacek",
        industryLabel: "Koupelnové studio",
        brandName: "KOUPELNY OBZOR",
        feedAesthetic: {
            typographyStyle: "technický grotesk stálé šířky, malé kapitálky, přesné mřížkové zarovnání",
            feel: "Inženýrská přesnost: hluboká modř, chrom, ostrá hrana obkladu. Čistota jako výsledek řemesla, ne stylingu.",
        },
        voiceBrief: "praktický a přímý, mluví v milimetrech a materiálech, prodává jistotu odvedené práce",
    },
    {
        key: "potraviny",
        sourceSlug: "rohlik-cz",
        industryLabel: "Rozvoz potravin",
        brandName: "SPÍŽKA",
        feedAesthetic: {
            typographyStyle: "kulatý bezpatkový tučný řez, sytá spodní dotažnice, přátelské sentence case",
            feel: "Ranní zeleninový pult: sytá zeleň, denní světlo, kapky vody na listu. Svěží, rychlé, bez stylizace.",
        },
        voiceBrief: "svižný, praktický, lidový — mluví o tom, co je dneska čerstvé, a šetří čas",
    },
    {
        key: "reality",
        sourceSlug: "svoboda-williams",
        industryLabel: "Prémiové reality",
        brandName: "DŮM & KLÍČ",
        feedAesthetic: {
            typographyStyle: "úzký modernistický grotesk, kapitálky, velmi jemné vlasové linky",
            feel: "Tiché prémiové bydlení: teplá béžová, terakota, dlouhé stíny přes parkety. Prostor jako hlavní hrdina.",
        },
        voiceBrief: "zdrženlivý a přesný, nechává mluvit dispozici a lokalitu, nikdy nekřičí",
    },
    {
        key: "estetika",
        sourceSlug: "asklepion-institut-klinicke-a-",
        industryLabel: "Estetická medicína",
        brandName: "KLINIKA ZÁŘE",
        feedAesthetic: {
            typographyStyle: "čistý neo-grotesk se středním řezem, klinicky přesné zarovnání vlevo",
            feel: "Klinická čistota s lidským teplem: tyrkysová na bílé, hodně negativního prostoru, měkká pleť v ostrém světle.",
        },
        voiceBrief: "odborný, klidný, střízlivý — vysvětluje zákrok a jeho meze, mluví o péči, ne o proměně",
        guardrails: "ŽÁDNÉ sliby výsledku, ŽÁDNÉ před/po srovnání, ŽÁDNÁ tvrzení o léčbě ani o zdravotním přínosu.",
    },
    {
        key: "autochemie",
        sourceSlug: "liqui-moly",
        industryLabel: "Motorová maziva a autochemie",
        brandName: "OKTAN",
        feedAesthetic: {
            typographyStyle: "extra kondenzovaný industriální grotesk, kurzíva, verzálky, agresivní spád",
            feel: "Dílna za soumraku: závodní modř, ostré světlo na kovu, olej a prach. Výkon jako řemeslo, ne pozlátko.",
        },
        voiceBrief: "drsný odborník z dílny — mluví o motoru konkrétně, technicky, bez marketingové omáčky",
    },
]
