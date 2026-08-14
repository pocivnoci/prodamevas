/**
 * Univerzální rétorické mechanismy — pevná sada, společná VŠEM značkám.
 * =====================================================================
 * Mechanismus není vlastnost značky. „Před a po" funguje květinářství i stěhovákům
 * úplně stejně; co se liší, je NÁMĚT (co se ukazuje) a HLAS (jak to zní) — a obojí
 * už v systému má svého vlastníka (`ig_post_ideas`, `brandVoice`).
 *
 * PROČ PEVNÁ SADA
 * ───────────────
 * Formáty se generovaly per klient a měly být mechanismy. Nebyly. Ani po přepsání
 * promptu, zavedení stropů a strojové sanitizaci hotové copy: model do nich stejně
 * propašoval téma („Průvodce ideálním tarifem", „Magická analýza webu"). Půlka
 * formátů neprošla vlastním testem invariantu — „vyrobím z tohohle 30 RŮZNÝCH
 * příspěvků?".
 *
 * Spoléhat na to, že model dodrží formátovací pravidlo, se ukázalo jako slepá
 * ulička dvakrát po sobě. Tady se invariant nedodržuje — je zaručený konstrukcí,
 * protože text pochází z týhle tabulky a model do něj nemá jak sáhnout.
 *
 * DRUHÝ DŮVOD: PŘEHLEDNOST PRO UŽIVATELE
 * ──────────────────────────────────────
 * Aplikace nabízela tři paralelní seznamy, které říkaly totéž — formát „Průvodce
 * ideálním tarifem", kategorie „Naše tarify", nápad „Výběr správného tarifu".
 * Uživatel neměl jak poznat, co si vybrat a proč to je trojmo. Když je forma
 * univerzální, zbude v aplikaci jediná volba: „o čem".
 *
 * TŘETÍ DŮVOD: MĚŘITELNOST
 * ────────────────────────
 * `ig_post_types.performance_score` byl doteď neporovnatelný — každý klient měl
 * vlastních 8 unikátů. Se sdílenou sadou se dá poprvé zjistit, který mechanismus
 * funguje napříč značkami.
 *
 * JAK SE POUŽÍVÁ
 * ──────────────
 * `PostTypeDef.name` zůstává klíčem pipeline (visí na něm `ig_post_types`,
 * `config.postTypes`, členství v pilířích, `weekPlan` i `post_type_id` už
 * vygenerovaných příspěvků), takže formáty se NERUŠÍ — jen se každému přiřadí
 * `mechanism` a jeho brief se čte odsud místo z configu.
 */

export type MechanismId =
    | "srovnani"
    | "pred_po"
    | "navod"
    | "mytus"
    | "zakulisi"
    | "kviz"
    | "dukaz"
    | "nabidka"

export interface Mechanism {
    id: MechanismId
    emoji: string
    label: string
    /** JAK to funguje na čtenáře a proč zabírá. Nikdy CO je na obrázku. */
    description: string
    /** Sled beatů se zástupnými sloty. Určuje tempo, ne obsah. */
    structure: string
    /** Produkční kvality — kompozice, světlo, tempo, odstup. Nikdy rekvizita. */
    visualStyle: string
}

/**
 * Osm mechanismů pokrývá drtivou většinu toho, co na Instagramu funguje.
 * Sada je schválně MALÁ: víc položek by se začalo překrývat a uživatel by zas
 * řešil, čím se dvě podobné liší.
 */
export const MECHANISMS: Record<MechanismId, Mechanism> = {
    srovnani: {
        id: "srovnani",
        emoji: "⚖️",
        label: "Srovnání dvou možností",
        description: "Postaví dvě možnosti proti sobě a nechá publikum rozhodnout. Rozhodování vtahuje lidi do komentářů.",
        structure: "Cover: obě možnosti proti sobě → beat 2-3: co mluví pro každou z nich → závěr: výzva k hlasování",
        visualStyle: "Dělená kompozice, symetrie, obě strany stejně nasvícené a stejně velké.",
    },
    pred_po: {
        id: "pred_po",
        emoji: "✨",
        label: "Před a po",
        description: "Ukáže výchozí stav a výsledek vedle sebe. Rozdíl je důkaz, který nejde odargumentovat.",
        structure: "Cover: výchozí stav bez vyzrazení výsledku → beat 2: zásah → beat 3: výsledek → závěr: výzva",
        visualStyle: "Stejný úhel a odstup u obou stavů, aby rozdíl vynikl. Kontrast světla mezi 'před' a 'po'.",
    },
    navod: {
        id: "navod",
        emoji: "📐",
        label: "Návod krok za krokem",
        description: "Rozloží něco složitého na kroky, které si jde zopakovat. Praktická hodnota se ukládá a sdílí.",
        structure: "Cover: slib konkrétního výsledku → beaty: jednotlivé kroky, jeden krok = jeden beat → závěr: výzva k uložení",
        visualStyle: "Čisté, dobře nasvícené detailní záběry na jednu věc. Klidné tempo, žádné rušivé pozadí.",
    },
    mytus: {
        id: "mytus",
        emoji: "🎭",
        label: "Vyvrácení mýtu",
        description: "Pojmenuje rozšířený omyl a otočí ho. Napětí mezi tím, čemu lidé věří, a tím, co platí, drží pozornost.",
        structure: "Cover: mýtus jako tvrzení → beat 2: proč tomu lidé věří → beat 3: co platí doopravdy → závěr: výzva",
        visualStyle: "Výrazný kontrast a tvrdší světlo. Kompozice staví tvrzení do popředí, kontext ustupuje.",
    },
    zakulisi: {
        id: "zakulisi",
        emoji: "🔧",
        label: "Zákulisí procesu",
        description: "Ukáže práci, kterou zákazník normálně nevidí. Odhalené řemeslo buduje důvěru silněji než tvrzení o kvalitě.",
        structure: "Cover: nečekaný detail z procesu → beat 2-3: postup od rozdělaného k hotovému → závěr: lidský moment",
        visualStyle: "Dokumentární odstup, přirozené světlo, ruce a materiál v detailu. Autenticita před vyhlazeností.",
    },
    kviz: {
        id: "kviz",
        emoji: "❓",
        label: "Kvíz nebo hádanka",
        description: "Položí otázku, na kterou publikum zná půlku odpovědi. Chuť si tipnout je nejlevnější cesta ke komentářům.",
        structure: "Cover: otázka nebo záhadný detail → beat 2: nápovědy → beat 3: druhý pohled → závěr: výzva k tipování",
        visualStyle: "Výřez nebo neobvyklý úhel, který zadržuje celek. Čitelná typografie, hravé prvky.",
    },
    dukaz: {
        id: "dukaz",
        emoji: "📈",
        label: "Důkaz výsledkem",
        description: "Doloží tvrzení číslem, zkušeností nebo cizím hlasem. Důkaz zvenčí váží víc než vlastní slib.",
        structure: "Cover: konkrétní výsledek → beat 2: z čeho se vycházelo → beat 3: co k němu vedlo → závěr: výzva",
        visualStyle: "Střízlivá kompozice, výsledek v popředí. Čísla a citace čitelné na první pohled.",
    },
    nabidka: {
        id: "nabidka",
        emoji: "🏷️",
        label: "Nabídka",
        description: "Přímo pojmenuje, co se dá koupit a pro koho to je. Bez toho se z profilu stane galerie bez obchodu.",
        structure: "Cover: pro koho to je a co to řeší → beat 2: co je součástí → beat 3: proč právě teď → závěr: výzva k akci",
        visualStyle: "Předmět nabídky jasně a celý, dost prostoru kolem. Světlo vede oko k němu.",
    },
}

export const MECHANISM_IDS = Object.keys(MECHANISMS) as MechanismId[]

export function isMechanismId(value: unknown): value is MechanismId {
    return typeof value === "string" && value in MECHANISMS
}

export function getMechanism(id: unknown): Mechanism | undefined {
    return isMechanismId(id) ? MECHANISMS[id] : undefined
}
