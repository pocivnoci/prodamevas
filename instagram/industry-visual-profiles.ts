/**
 * Registr oborových vizuálních profilů — obsah, ne mechanika.
 * ==========================================================
 * Čistá data + jedna čistá funkce. Žádná DB, žádné `server-only`: čte to engine
 * (`image-pipeline.ts`), `validateConfig()`, showcase kity i onboarding.
 *
 * PROČ VŮBEC EXISTUJE. Art director dostával obor jen nepřímo (barva + „feel"
 * z webu) a kvalitu snímku měl předepsanou JEDINOU natvrdo zapsanou větou
 * „editorial, cinematic lighting, real depth" — stejnou pro vinařství, izolatéra
 * i účetní. Feed napříč klienty proto vypadal jako jedna značka s vyměněným hexem.
 * Naměřeno při auditu 9/2026: `config.industry` se v `image-pipeline.ts`
 * nevyskytoval ani jednou.
 *
 * ⚠️ PŘEDEPISUJ IDENTITU, NIKDY KOMPOZICI. Tahle past už jednou zabila ukázkovou
 * sérii (viz komentář u `applyShowcaseKit` v `showcase-kit.ts`): první verze
 * diktovala rozvržení — plochá výplň od kraje ke kraji, fotka jako inset, dole
 * pruh — a devět oborů se proměnilo v jednu šablonu. Proto tady smí být jen žánr,
 * světlo, řez a princip palety. Záběr, měřítko a rozvržení patří designérovi
 * a rotačním archetypům (`LAYOUT_ARCHETYPES`), ne sem.
 *
 * JAZYK. Hodnoty jsou česky schválně: vlévají se do `## BRAND KIT:` vedle
 * `feedAesthetic.feel` a `typographyStyle`, které jsou česky odjakživa. Míchat
 * do jedné sekce dva jazyky by znamenalo přeložit i je — a překlad autorského
 * popisu světla je přesně ten druh tiché ztráty, kterou tenhle modul řeší.
 */

import type { IndustryVisual } from "./configs/types"

interface ProfileEntry extends IndustryVisual {
    /**
     * Podřetězce, kterými se profil hledá v `config.industry`. VŽDY bez diakritiky
     * a malými písmeny — `resolveIndustryVisual` normalizuje vstup stejně, takže
     * „Gastronomie / Vinařství" i „vinarstvi" trefí tentýž profil.
     *
     * Vyhrává NEJDELŠÍ shoda, ne první v pořadí: „investice do zemědělské půdy"
     * obsahuje i „invest", ale „zemedel" je delší, takže půda nespadne do zlata.
     */
    match: string[]
}

/** Klíč = obor. Hodnoty jsou zadání pro model, ne popis pro člověka. */
export const INDUSTRY_VISUAL_PROFILES: Record<string, ProfileEntry> = {
    // ─── Obory převzaté z ukázkové série (`showcase-kits.ts` je odsud čte) ───
    agropuda: {
        match: ["zemedel", "pudni", "orna puda", "agro", "farmarstvi"],
        photographicGenre: "krajinářská fotografie velkého formátu — pole, hlína a obzor; člověk až na druhém místě",
        lightingBrief: "Poledne nad polem: ostré slunce, sytá zeleň až k obzoru, vzduch se chvěje. Otevřené a prosvětlené.",
        typographyStyle: "elegantní vysoce kontrastní serif, velkorysý prostrk, sentence case",
        palettePrinciple: "zemité zelené a hnědé; akcent bere z prosvícené plodiny, nikdy z barevného panelu za ní",
    },
    hotel: {
        match: ["hotel", "lazn", "ubytov", "penzion", "resort", "apartma"],
        photographicGenre: "interiérová a architektonická fotografie — prostor, kámen a voda jsou produkt",
        lightingBrief: "Lázně za jasného dopoledne: světlo se láme na hladině, bílý kámen, sklo. Vzdušné a svěží, nikdy noční.",
        typographyStyle: "klasicistní didone serif s vysokým kontrastem, centrovaná sazba, kapitálky",
        palettePrinciple: "světlý kámen, sklo a len; jediný akcent přichází z odlesku na vodě",
    },
    vinarstvi: {
        match: ["vinar", "vino", "vinic", "sommel"],
        photographicGenre: "terroir a zátiší — láhev proti vinici, ruce, hlína, sklo v protisvětle",
        lightingBrief: "Vinice v plném slunci: rozpálená hlína, listy prosvícené naskrz, čisté nebe. Živé a teplé.",
        typographyStyle: "humanistická antikva s měkkým perem, malá písmena, řídký sazební obraz",
        palettePrinciple: "barva vína a hlíny; pozadí zůstává tlumené, aby sklo mohlo svítit",
    },
    kadernictvi: {
        match: ["kader", "vlas", "salon", "barber", "kosmetick", "nehtov"],
        photographicGenre: "beauty portrét v salonu — vlas, lesk a postoj; nikdy katalogová póza",
        lightingBrief: "Salon zalitý denním světlem z velkého okna. Lesk vlasů, bílé plochy, sytý akcent. Svěží, ne noční klub.",
        typographyStyle: "geometrický grotesk ve velmi lehkém řezu, extrémní prostrk, malá písmena",
        palettePrinciple: "bílý a pleťový základ s jedním sytým akcentem — barvu nese vlas, ne pozadí",
    },
    koupelny: {
        match: ["koupeln", "obklad", "instalater", "sanitarn"],
        photographicGenre: "realizační a materiálová fotografie interiéru — detail spoje, hrana obkladu, chrom",
        lightingBrief: "Koupelna v ranním světle: voda, chrom a bílý obklad plné odlesků. Čisté, prosvětlené, ostré.",
        typographyStyle: "technický grotesk stálé šířky, malé kapitálky, přesné mřížkové zarovnání",
        palettePrinciple: "bílá, chrom a jeden studený tón; barevnost dodává materiál, ne filtr",
    },
    potraviny: {
        match: ["potravin", "rozvoz jidla", "farmarsk", "pekar", "reznic", "mlekar"],
        photographicGenre: "food fotografie od pultu — čerstvost, kapky vody, ruka u zboží",
        lightingBrief: "Zeleninový pult v dopoledním slunci: kapky vody, syté barvy, denní světlo. Svěží a rychlé.",
        typographyStyle: "kulatý bezpatkový tučný řez, sytá spodní dotažnice, přátelské sentence case",
        palettePrinciple: "barvu nese samotná surovina; pozadí je dřevo, papír nebo bílá",
    },
    reality: {
        match: ["realit", "nemovit", "makler", "developer"],
        photographicGenre: "architektonická fotografie prázdného prostoru — široký úhel bez zkreslení, rovné svislice",
        lightingBrief: "Byt zalitý sluncem: dlouhá světlá okna, teplé dřevo, vzduch. Otevřené a prostorné, nikdy šero.",
        typographyStyle: "úzký modernistický grotesk, kapitálky, velmi jemné vlasové linky",
        palettePrinciple: "teplé neutrály a dřevo; barvu dodává světlo z okna, ne grading",
    },
    estetika: {
        match: ["estetick", "klinik", "dermat", "medicin", "zdrav", "lekar", "dental", "stomatolog"],
        photographicGenre: "klinický portrét a detail pleti v bílém prostoru — nikdy před/po koláž",
        lightingBrief: "Klinika v plném denním světle: bílý prostor, sytý akcent, čistá pleť. Svěží, ne sterilně studené.",
        typographyStyle: "čistý neo-grotesk se středním řezem, klinicky přesné zarovnání vlevo",
        palettePrinciple: "bílá a pleťová s jedním chladným akcentem; žádné dramatické stíny",
    },
    autochemie: {
        match: ["autochem", "maziv", "autoservis", "pneuserv", "motorov"],
        photographicGenre: "dílenská produktová fotografie — kov, lak, olej a ostrý odlesk",
        lightingBrief: "Dílna s otevřenými vraty do slunce: lesklý lak, sytá modř, ostré světlo na kovu. Energické, ne šero.",
        typographyStyle: "extra kondenzovaný industriální grotesk, kurzíva, verzálky, agresivní spád",
        palettePrinciple: "tmavý kov jako podklad, jedna signální barva jako v technické normě",
    },
    vietnamska_restaurace: {
        match: ["vietnam", "asijsk", "sushi", "ramen"],
        photographicGenre: "food reportáž z tržnice a kuchyně — pára, bylinky, ruce nad miskou",
        lightingBrief: "Rušná a voňavá atmosféra asijské tržnice plná páry, svěžích bylinek a bezprostředního pouličního ruchu.",
        typographyStyle: "výrazný markerový font s texturou tahu připomínající ručně psané denní menu, přirozeně nepravidelný prostrk, sentence case pro autentický a organický vzhled",
        palettePrinciple: "teplá zlatá a bylinková zeleň na tmavém podkladu; barvu nese jídlo",
    },
    tvorba_bazenu: {
        match: ["bazen", "sauna", "wellness stavb"],
        photographicGenre: "architektonická fotografie u vody — hladina, dlažba a odraz jako hlavní motiv",
        lightingBrief: "Snímek evokuje horké letní odpoledne u zrcadlově čisté vody, dominantní tyrkysovou rozbíjí jen teplé odlesky slunce dopadající na luxusní dlažbu.",
        typographyStyle: "široký architektonický grotesk v polotučném řezu, velká počáteční písmena všech slov (Title Case), velmi těsný prostrk evokující celistvost vodní hladiny",
        palettePrinciple: "tyrkys vody proti teplému kameni; obloha nese světlé plochy",
    },
    investice_do_zlata: {
        match: ["zlat", "drahe kov", "invest", "vynos", "financ", "pojist", "uver"],
        photographicGenre: "zátiší s hmotným detailem — kov, hrana, ryzí povrch v makru",
        lightingBrief: "Snímek kombinuje hluboké matné plochy s ostře řezanými hranami a drobnými zlatavými detaily evokujícími bezpečí bankovního trezoru.",
        typographyStyle: "robustní egyptienka se silnými patkami ve středním řezu, běžná velikost písmen, přirozený prostrk evokující fyzickou hmotnost a neotřesitelnou stabilitu",
        palettePrinciple: "tmavý bordó a pergamen; zlato je akcent, ne výplň",
    },
    zahradnictvi: {
        match: ["zahrad", "zelen", "sadov", "travnik", "arborist"],
        photographicGenre: "zemitá dokumentární fotografie v terénu — hlína, kůra, ruce v rukavicích",
        lightingBrief: "Snímek působí zemitě a svěže, s důrazem na ranní měkké světlo, sytou živou zeleň a hmatatelnou drsnou texturu kůry a vlhké hlíny.",
        typographyStyle: "hrubší dřevorytný serif v polotučném řezu, běžná velikost písmen s nepravidelnými okraji tahů, zahuštěný prostrk evokující hustý organický porost",
        palettePrinciple: "trávová zeleň a zemitá hněď; sluneční žlutá jen jako akcent",
    },
    cestovni_kancelar: {
        match: ["cestovn", "zajezd", "turist", "dovolen"],
        photographicGenre: "cestovatelská reportáž — místo, člověk v něm a měřítko krajiny",
        lightingBrief: "Prosluněná a hřejivá atmosféra, ze které sálá energie dálav a příslib letního dobrodružství.",
        typographyStyle: "čistý humanistický grotesk střídající lehký a velmi tučný řez, klasická velikost písmen s jemně rozšířeným prostrkem evokujícím volný prostor",
        palettePrinciple: "korálové západy proti hlubokému stínu; písek drží světlé plochy",
    },
    ucetni_kancelar: {
        match: ["ucetn", "danov", "mzdov", "audit"],
        photographicGenre: "grafická sazba dokumentu a čísla — fotografie ustupuje, řád je téma",
        // Původní znění z ukázkového kitu předepisovalo i rozvržení („kompozice
        // založená na ostrých liniích barevných bloků"). Jako sdílený oborový profil
        // by to každé účetní kanceláři nadiktovalo tentýž obrázek, takže tu zbylo
        // jen světlo a atmosféra.
        lightingBrief: "Rovnoměrné kancelářské světlo bez dramatu: čisté plochy, ostré hrany, žádný tvrdý stín. Atmosféra naprostého pořádku, systematičnosti a bezpečí.",
        typographyStyle: "Racionální statické bezpatkové písmo se zřetelnou kresbou číslic, polotučný řez, klasická velikost písmen (sentence case), standardní prostrk zajišťující maximální čitelnost strukturovaných dat",
        palettePrinciple: "petrolejová a šedobílá s jedním teplým akcentem; barva odděluje data, nezdobí",
    },
    cisteni_fasad: {
        match: ["cisten", "fasad", "dlazb", "uklid", "tlakov myti"],
        photographicGenre: "industriální dokumentace výsledku — textura materiálu zblízka, hrubá síla v záběru",
        lightingBrief: "Drsná a industriální atmosféra s ostrým denním světlem, které nekompromisně odhaluje texturu materiálu a demonstruje hrubou sílu.",
        typographyStyle: "Masivní šablonové písmo (stencil) v tučném řezu, sázené verzálkami se standardním prostrkem, evokující drsné průmyslové značení a techniku.",
        palettePrinciple: "beton a výstražná barva jako na stavbě; žádné pastely",
    },

    // ─── Kategorie z onboardingu (`CATEGORY_DEFAULTS` v app/onboarding/core.ts) ───
    kavarna: {
        match: ["kavarn", "barist", "cukrar", "kava"],
        photographicGenre: "kavárenská reportáž — šálek, pára, ruce baristy, dřevo a denní světlo",
        lightingBrief: "Dopolední světlo z velkého okna: teplé dřevo, pára nad šálkem, měkké dlouhé stíny.",
        typographyStyle: "měkký humanistický grotesk, malá písmena, klidný prostrk",
        palettePrinciple: "teplé hnědé a krémové tóny; akcent z keramiky nebo zeleně v podniku",
    },
    restaurace: {
        // „gastro" tu schválně NENÍ: kategorie z onboardingu zní „Gastronomie / Vinařství"
        // i „Gastronomie / Kavárna" a jako nejdelší shoda by obě stáhlo k restauraci.
        match: ["restaurac", "bistro", "hospod", "pivnic", "jideln", "catering"],
        photographicGenre: "gastro reportáž — talíř shora i z úrovně stolu a kuchyně v pohybu",
        lightingBrief: "Jeden teplý zdroj nad stolem, zbytek scény ustupuje do měkkého šera; pára a lesk omáčky nesou lesklá místa.",
        typographyStyle: "serif s výrazným kontrastem pro nadpis, grotesk pro doprovod",
        palettePrinciple: "barvu nese jídlo; stůl, keramika a dřevo zůstávají tlumené",
    },
    fitness: {
        match: ["fitness", "posilov", "trener", "joga", "sport", "wellness"],
        photographicGenre: "sportovní reportáž v pohybu — pot, textura kůže, krátký čas závěrky",
        lightingBrief: "Tvrdé boční světlo do potu a svalu, kontrastní stíny, syté barvy náčiní. Energie, ne studiový klid.",
        typographyStyle: "extra kondenzovaný grotesk, verzálky, těsný prostrk",
        palettePrinciple: "tmavý podklad s jedním syrovým signálním akcentem, nikdy pastel",
    },
    eshop: {
        match: ["e-commerce", "ecommerce", "eshop", "e-shop", "prodejn", "obchod"],
        photographicGenre: "produktová fotografie na čistém pozadí prokládaná lifestylovým záběrem produktu v ruce",
        lightingBrief: "Měkké studiové světlo s jedním čitelným zdrojem a čistým stínem pod produktem.",
        typographyStyle: "neutrální grotesk se středním řezem a jasnou hierarchií názvu a ceny",
        palettePrinciple: "neutrální pozadí, barvu nese sám produkt",
    },
    remeslo: {
        // „sluzby" tu schválně NENÍ: kategorie „jine" má obor „Služby" a neznámý obor
        // nesmí dostat řemeslný žánr — cizí žánr je horší než žádný.
        match: ["remesl", "stavb", "stavebn", "izolac", "strech", "zateplen", "elektro", "truhlar", "montaz", "rekonstrukc"],
        photographicGenre: "dokumentární reportáž z místa práce — ruce, materiál, hotové dílo",
        lightingBrief: "Přirozené světlo na stavbě: prach ve vzduchu, tvrdý kontrast mezi stínem a prosvětleným místem.",
        typographyStyle: "technický grotesk, verzálky, pevná mřížka",
        palettePrinciple: "barvy materiálu a pracovního oděvu; akcent ze značkové signální barvy",
    },
    poradenstvi: {
        match: ["poraden", "koucin", "konzult", "mentor", "skolen", "vzdel", "advokat", "pravn"],
        photographicGenre: "portrét a reportáž ze schůzky — člověk, gesto, zápisník",
        lightingBrief: "Klidné denní světlo v kanceláři, měkký kontrast, žádný tvrdý stín.",
        typographyStyle: "vážný serif v nadpisu, grotesk v doprovodu, klidná hierarchie",
        palettePrinciple: "tlumené modré a šedé tóny s jediným teplým akcentem",
    },
    fotografie: {
        match: ["fotograf", "kreativ", "videoprodukc", "filmov"],
        photographicGenre: "ukázka vlastní práce — snímek ze zakázky je sám obsahem postu",
        lightingBrief: "Světlo je téma samo: protisvětlo, silueta nebo měkké okno, vždy autorsky vedené.",
        typographyStyle: "minimalistický grotesk v lehkém řezu, hodně prostoru, malá velikost",
        palettePrinciple: "monochrom nebo tlumená paleta, aby typografie nepřebila fotku",
    },
    saas: {
        match: ["saas", "aplikac", "software", "technolog", "startup"],
        photographicGenre: "snímky rozhraní a mockupy zasazené do reálné scény, ne do prázdna",
        lightingBrief: "Čisté rovnoměrné světlo bez dramat; obrazovka je nejjasnější místo snímku.",
        typographyStyle: "geometrický grotesk, vysoká čitelnost, mřížka jako v samotném produktu",
        palettePrinciple: "jedna sytá značková barva na neutrálním podkladu a hodně prázdného prostoru",
    },
}

/**
 * Kategorie onboardingu (`CATEGORY_DEFAULTS`) → klíč profilu.
 *
 * Ruční tabulka schválně: kategorie jsou uživatelská volba z dlaždic, kdežto
 * `resolveIndustryVisual` hádá z volného textu. Kde se obor kryje (salon =
 * kadeřnictví, ubytování = hotel, zdraví = estetika), ukazují obě cesty na týž
 * profil. „jine" tu chybí úmyslně — neznámý obor nemá dostat cizí žánr.
 */
export const CATEGORY_VISUAL_KEYS: Record<string, keyof typeof INDUSTRY_VISUAL_PROFILES> = {
    kavarna: "kavarna",
    restaurace: "restaurace",
    vinarstvi: "vinarstvi",
    salon: "kadernictvi",
    fitness: "fitness",
    eshop: "eshop",
    remeslnik: "remeslo",
    poradce: "poradenstvi",
    fotograf: "fotografie",
    app: "saas",
    ubytovani: "hotel",
    zdravi: "estetika",
    reality: "reality",
}

/** Bez `match` — do configu se ukládá jen profil, ne hledací klíče. Pole se vypisují
 *  ručně schválně: rozprostření celého záznamu by do `clients.config` propašovalo
 *  i interní hledací podřetězce a ty by pak jeden po druhém tekly do promptu. */
export function toIndustryVisual(entry: ProfileEntry): IndustryVisual {
    return {
        photographicGenre: entry.photographicGenre,
        lightingBrief: entry.lightingBrief,
        typographyStyle: entry.typographyStyle,
        palettePrinciple: entry.palettePrinciple,
    }
}

/** Profil podle klíče registru (kategorie onboardingu, showcase kit). */
export function industryVisualByKey(key: string): IndustryVisual | undefined {
    const entry = INDUSTRY_VISUAL_PROFILES[key]
    return entry ? toIndustryVisual(entry) : undefined
}

const ascii = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

/**
 * Profil z volného textu `config.industry` („Gastronomie / Kavárna", „e-commerce").
 *
 * Vyhrává NEJDELŠÍ shoda, ne první nalezená: pořadí klíčů v objektu není smluvní
 * a „invest" uvnitř „investice do zemědělské půdy" by jinak vyhrálo nad „zemedel".
 * Nic nenajde = `undefined` = dnešní chování, nikdy náhradní obor.
 */
export function resolveIndustryVisual(industry?: string | null): IndustryVisual | undefined {
    const hay = ascii((industry || "").trim())
    if (!hay) return undefined
    let best: { entry: ProfileEntry; len: number } | undefined
    for (const entry of Object.values(INDUSTRY_VISUAL_PROFILES)) {
        for (const m of entry.match) {
            if (hay.includes(m) && (!best || m.length > best.len)) best = { entry, len: m.length }
        }
    }
    return best ? toIndustryVisual(best.entry) : undefined
}
