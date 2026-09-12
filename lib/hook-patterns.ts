/**
 * Hook vzory pro reely — klientsky bezpečný modul (žádný server import).
 * ======================================================================
 * Reel má jediný úkol: zastavit palec a udržet pozornost do CTA
 * (docs/DESIGN_reels-v2_2026-09-12.md). O tom, jestli se to povede, rozhodne
 * PRVNÍ VĚTA. Do 9/2026 ji psal copywriter v mega promptu bez jakékoli struktury,
 * takže značka jela pořád stejnou figuru („Víte, že…?") a nikdo neuměl říct, která
 * figura u téhle značky funguje — vzor se nikam neukládal, takže ani měřit nešel.
 *
 * Tenhle registr dělá z hooku **měřitelný zdroj obsahu**: scenárista dostane
 * pojmenovanou paletu vzorů, zvolený vzor se uloží k postu (`design_brief.hookPattern`)
 * a příští výběr je VÁŽENÝ podle naměřeného výkonu — stejná mechanika jako u nápadů
 * a recenzí (`getWeightedIdeas` v instagram/service.ts). To je invariant „nový zdroj
 * obsahu potřebuje performance_score + váženou selekci" ze skillu `content-engine`:
 * bez něj se učicí smyčka přetrhne a paleta by byla jen delší seznam náhod.
 *
 * Příklady jsou schválně ze DVOU různých oborů (kavárna, řemeslo), aby model z nich
 * nevyčetl obor, ale MECHANIKU vzoru — jednooborové příklady se obtiskly do výstupu.
 */

/** Jeden hook vzor. `recipe` je to jediné, co se dostane do promptu jako příkaz. */
export interface HookPattern {
    /** Stabilní klíč — ukládá se k postu, takže se NIKDY nepřejmenovává. */
    id: string
    /** Český název do promptu i do dashboardu. */
    label: string
    /** Co vzor dělá s divákem (proč zastaví palec). */
    description: string
    /** Návod na první větu — tvar, ne obsah. */
    recipe: string
    /** Ukázky ze dvou nesouvisejících oborů — mechanika, ne téma. */
    examples: { kavarna: string; remeslo: string }
}

export const HOOK_PATTERNS: HookPattern[] = [
    {
        id: "pov",
        label: "POV",
        description: "Divák je vtažen do situace jako její účastník, ne divák.",
        recipe: "První věta postaví diváka do konkrétní scény v přítomném čase („Je 6:40 a…\"). Žádné vysvětlování, rovnou uvnitř děje.",
        examples: {
            kavarna: "Je 6:40 a mlýnek slyšíš dřív než sebe.",
            remeslo: "Stojíš na střeše a dole prší do kbelíku.",
        },
    },
    {
        id: "before_after",
        label: "Před a po",
        description: "Kontrast dvou stavů; divák čeká na proměnu a zůstane do konce.",
        recipe: "První věta pojmenuje stav PŘED tak, aby bylo vidět, co je špatně. Proměna přijde až v posledním beatu — neprozrazuj ji v hooku.",
        examples: {
            kavarna: "Tenhle pult jsme před rokem nechtěli ani fotit.",
            remeslo: "Tahle terasa držela vodu jako síto.",
        },
    },
    {
        id: "myth",
        label: "Mýtus vs. realita",
        description: "Rozbití rozšířené domněnky — divák si ověřuje, jestli ji taky má.",
        recipe: "První věta vysloví rozšířenou domněnku oboru a druhý beat ji vyvrátí. Domněnka musí být opravdu rozšířená, ne vymyšlená.",
        examples: {
            kavarna: "Tmavé pražení prý znamená silnější kafe.",
            remeslo: "Novou izolaci prý poznáš, až když zateče.",
        },
    },
    {
        id: "three_things",
        label: "Tři věci",
        description: "Slíbený počet drží pozornost — divák si dopočítává, kolik zbývá.",
        recipe: "První věta slíbí PŘESNÝ počet (dvě, tři) a každý další beat dodá jednu položku. Počet beatů musí slibu odpovídat.",
        examples: {
            kavarna: "Tři věci, které poznáš na espressu dřív než ho ochutnáš.",
            remeslo: "Tři místa, kudy do domu leze vlhkost.",
        },
    },
    {
        id: "customer_story",
        label: "Příběh zákazníka",
        description: "Konkrétní člověk s konkrétním problémem — nejsilnější důkaz, jaký značka má.",
        recipe: "První věta uvede zákazníka a jeho problém (bez jména, pokud ho nemáš ověřené). Vychází z recenze nebo doložené zakázky, nikdy z fikce.",
        examples: {
            kavarna: "Přišla si pro čaj, protože kafe jí prý nedělá dobře.",
            remeslo: "Volal nám v neděli večer, strop už kapal do ložnice.",
        },
    },
    {
        id: "question",
        label: "Otázka",
        description: "Otázka, na kterou si divák odpoví v duchu — a tím zůstane.",
        recipe: "První věta je jedna krátká otázka mířená na diváka, ne řečnická vata. Odpověď dodej až v posledním beatu.",
        examples: {
            kavarna: "Kolik kafe vyhodíš, než trefíš to svoje?",
            remeslo: "Víš, kdy tvoje střecha naposledy viděla revizi?",
        },
    },
    {
        id: "nobody_tells_you",
        label: "Nikdo vám neřekne",
        description: "Kontrast mezi tím, co se říká, a tím, co je vidět v praxi.",
        recipe: "První věta oznámí zamlčovanou nevýhodu nebo nepohodlnou pravdu oboru. Musí být doložená vlastní praxí, ne pomluva konkurence.",
        examples: {
            kavarna: "O téhle části pražení se v kavárnách nemluví.",
            remeslo: "Tohle ti při nabídce na fasádu nikdo neřekne.",
        },
    },
    {
        id: "process",
        label: "Jak to vzniká",
        description: "Proces sám o sobě je podívaná; divák chce vidět konec.",
        recipe: "První věta pojmenuje výsledek a slíbí cestu k němu („Než tohle vznikne, …\"). Beaty pak jdou po krocích v pořadí.",
        examples: {
            kavarna: "Než se tahle dávka dostane do šálku, projde čtyřma rukama.",
            remeslo: "Než na střechu přijde první šindel, strhneme tři vrstvy.",
        },
    },
    {
        id: "number_shock",
        label: "Konkrétní číslo",
        description: "Jedno překvapivé číslo z vlastní praxe — konkrétnost zastaví scrollování.",
        recipe: "První věta nese JEDNO číslo z ověřených faktů značky. Když ověřené číslo nemáš, tenhle vzor nepoužívej — vymyšlené číslo shodí celý reel na faktické bráně.",
        examples: {
            kavarna: "Osmnáct gramů. Na tom stojí celý dnešek.",
            remeslo: "Čtyři dny. Tak dlouho schne podklad, než smí přijít izolace.",
        },
    },
    {
        id: "mistake",
        label: "Častá chyba",
        description: "Divák se v chybě pozná a chce vědět, jestli ji dělá taky.",
        recipe: "První věta popíše chybu, kterou dělá většina lidí. Druhý beat ukáže, co dělat místo toho — poučení, ne posměch.",
        examples: {
            kavarna: "Většina lidí zalije filtr hned. A tím to zabije.",
            remeslo: "Nejčastější chyba? Zatlouct hřebík skrz izolaci.",
        },
    },
]

export const HOOK_PATTERN_IDS: string[] = HOOK_PATTERNS.map(p => p.id)

export function hookPatternById(id: string | null | undefined): HookPattern | undefined {
    if (!id) return undefined
    return HOOK_PATTERNS.find(p => p.id === id)
}

/** Propustí jen známý vzor — neznámé ID z modelu nesmí doputovat do statistik. */
export function isHookPatternId(value: unknown): value is string {
    return typeof value === "string" && HOOK_PATTERN_IDS.includes(value)
}

/** Naměřený výkon jednoho vzoru u JEDNOHO klienta. */
export interface HookPatternStat {
    id: string
    /** Průměrná síla příspěvku (lib/engagement.ts `engagementScore`) přes reely s tímhle vzorem. */
    performanceScore: number
    /** Kolik reelů s tímhle vzorem má vůbec naměřeno. Nula = nevyzkoušený. */
    timesUsedWithMetrics: number
}

/** Jeden reel tak, jak leží v `ig_posts` — jen to, co výkon vzoru potřebuje. */
export interface ScoredReel {
    hookPattern?: string | null
    /** `engagementScore(post)`; `null` = post nemá naměřeno. */
    score?: number | null
}

/**
 * Výkon vzorů z reelů klienta. Průměr, ne součet: vzor použitý pětkrát by jinak
 * vyhrál nad lepším vzorem použitým jednou, a paleta by zamrzla na tom, co se
 * shodou okolností nasadilo první.
 */
export function hookPatternStats(reels: ScoredReel[]): HookPatternStat[] {
    const acc = new Map<string, { sum: number; n: number }>()
    for (const r of reels) {
        if (!isHookPatternId(r.hookPattern)) continue
        if (r.score == null || !Number.isFinite(r.score)) continue
        const cur = acc.get(r.hookPattern) ?? { sum: 0, n: 0 }
        cur.sum += r.score
        cur.n += 1
        acc.set(r.hookPattern, cur)
    }
    return HOOK_PATTERNS.map(p => {
        const a = acc.get(p.id)
        return {
            id: p.id,
            performanceScore: a && a.n > 0 ? a.sum / a.n : 0,
            timesUsedWithMetrics: a?.n ?? 0,
        }
    })
}

export interface PickHookPatternsInput {
    /** Naměřený výkon vzorů u klienta (prázdné = studený start, všechny stejně). */
    stats?: HookPatternStat[]
    /** Vzory posledních reelů — anti-repeat, do nabídky se vůbec nedostanou. */
    exclude?: string[]
    /** Kolik vzorů nabídnout scenáristovi. */
    count?: number
    /** Injektovatelný generátor — testy potřebují determinismus, produkce ne. */
    random?: () => number
}

/**
 * Vážený výběr vzorů k nabídnutí scenáristovi.
 *
 * Váhy jsou schválně TÉTÉŽ tvaru jako u nápadů a recenzí (`getWeightedIdeas`):
 * nevyzkoušený vzor dostane 2× (optimismus pod nejistotou — jinak by paleta
 * navždy zamrzla na tom, co se vyzkoušelo první), nadprůměrný 2×, výrazně
 * nadprůměrný 3×, podprůměrný 1×. Losuje se až NAD těmihle váhami — holý
 * `Math.random()` bez vah by zpětnou vazbu zahodil.
 */
/**
 * Kolik lístků má který vzor v osudí. Oddělené od losování schválně: váhy jsou to
 * jediné, co nese zpětnou vazbu, takže musí jít ověřit bez náhody.
 */
export function hookPatternWeights(pool: HookPattern[], stats: HookPatternStat[]): Map<string, number> {
    const statById = new Map(stats.map(s => [s.id, s]))
    const measured = pool
        .map(p => statById.get(p.id))
        .filter((s): s is HookPatternStat => Boolean(s) && (s as HookPatternStat).timesUsedWithMetrics > 0)
    const avg = measured.length > 0
        ? measured.reduce((sum, s) => sum + s.performanceScore, 0) / measured.length
        : 0

    return new Map(pool.map(p => {
        const s = statById.get(p.id)
        if (!s || s.timesUsedWithMetrics === 0) return [p.id, 2]   // nevyzkoušený — průzkum
        if (avg > 0 && s.performanceScore > avg * 1.5) return [p.id, 3]
        if (avg > 0 && s.performanceScore > avg) return [p.id, 2]
        return [p.id, 1]                                            // prokazatelně slabší
    }))
}

export function pickHookPatterns(input: PickHookPatternsInput = {}): HookPattern[] {
    const count = Math.max(1, input.count ?? 4)
    const rnd = input.random ?? Math.random
    const excluded = new Set(input.exclude?.filter(Boolean) ?? [])
    const statById = new Map((input.stats ?? []).map(s => [s.id, s]))

    const candidates = HOOK_PATTERNS.filter(p => !excluded.has(p.id))
    // Anti-repeat nesmí vyprázdnit paletu: když by zákaz nechal míň vzorů, než
    // kolik jich nabízíme, bereme celý registr — opakování je menší vada než
    // scenárista bez vzoru.
    const pool = candidates.length >= count ? candidates : HOOK_PATTERNS
    if (pool.length <= count) return [...pool]

    const weights = hookPatternWeights(pool, input.stats ?? [])
    const weighted = pool.flatMap(p => Array.from({ length: weights.get(p.id) ?? 1 }, () => p))

    const picks: HookPattern[] = []
    const seen = new Set<string>()
    const bag = [...weighted]
    while (picks.length < count && bag.length > 0) {
        const i = Math.floor(rnd() * bag.length)
        const [pattern] = bag.splice(Math.min(i, bag.length - 1), 1)
        if (seen.has(pattern.id)) continue
        seen.add(pattern.id)
        picks.push(pattern)
    }
    return picks
}

/** Blok do promptu — jediné místo, kde se vzory formátují pro model. */
export function formatHookPatterns(patterns: HookPattern[]): string {
    return patterns
        .map(p => `- **${p.id}** (${p.label}) — ${p.description}\n  Jak: ${p.recipe}\n  Ukázky mechaniky: „${p.examples.kavarna}" / „${p.examples.remeslo}"`)
        .join("\n")
}
