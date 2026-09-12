/**
 * Knihovna hlasů — katalog + casting hlasu na značku.
 * ===================================================
 * Do 12. 9. 2026 mluvily VŠECHNY značky jedním hlasem: `config.ttsVoice || "Kore"`
 * v `reel-orchestrator.ts`, a `ttsVoice` nikdo nikdy nenastavoval. Kavárna,
 * izolatér i realitka tak zněly identicky — a byla to nejčastější stížnost na
 * reely. Hlas patří značce, ne enginu.
 *
 * Tenhle modul je **client-safe** (žádný import z `instagram/`, `supabase/` ani
 * `process.env`): čte ho `validateConfig()` na serveru i výběr hlasu v Nastavení
 * v prohlížeči. Syntéza samotná žije v `instagram/tts/`.
 *
 * Charakteristiky hlasů jsou z veřejné dokumentace Gemini TTS (Bright, Upbeat,
 * Firm…). **Pohlaví Google nedokumentuje** — `gender` je vnímaný dojem a slouží
 * JEN castingu (aby značka nedostala pokaždé stejně znějící typ), ne slibu
 * uživateli. Kdo chce jistotu, poslechne si ukázku v Nastavení.
 */

/** Poskytovatelé syntézy — oba zapojené v `instagram/tts/` (Gemini od začátku,
 *  ElevenLabs od 12. 9. 2026, `docs/DESIGN_reels-v2_2026-09-12.md`, fáze 1). */
export type TtsProviderId = "gemini" | "elevenlabs"

/**
 * Výchozí poskytovatel pro značky bez vlastního výběru: ElevenLabs s rodilými českými
 * hlasy (rozhodnutí 12. 9. 2026 po poslechu — Gemini TTS má anglickou prozodii, což
 * byla nejčastější stížnost na reely). Jedna konstanta, aby se výchozí hlas všech
 * značek nedal změnit omylem uprostřed kódu a aby ho `validateConfig()` i UI četly
 * odsud. Gemini zůstává v knihovně jako volba per značka, ne jako fallback.
 */
export const DEFAULT_TTS_PROVIDER: TtsProviderId = "elevenlabs"

/** Temperament = jak hlas působí. Casting jím vybírá kandidáty pro obor a personu. */
export type VoiceTemperament = "warm" | "energetic" | "calm" | "authoritative" | "playful"

export type VoicePace = "slow" | "medium" | "fast"

export interface VoiceProfile {
    /** ID u poskytovatele: jméno presetu (Gemini), nebo neprůhledné `voice_id` (ElevenLabs). */
    id: string
    provider: TtsProviderId
    /** Zobrazované jméno, když `id` není čitelné (ElevenLabs). Gemini hlasy ho nepotřebují. */
    name?: string
    /** Vnímané pohlaví — nedokumentované, jen pro pestrost castingu. */
    gender: "female" | "male"
    temperament: VoiceTemperament
    pace: VoicePace
    /** Klíčová slova oborů a person, na které hlas sedí (lowercase, bez diakritiky). */
    fits: string[]
    /** Česky, jednou větou — tohle vidí klient v Nastavení. */
    label: string
}

/**
 * 30 prebuilt hlasů Gemini TTS + 12 hlasů ElevenLabs. Pořadí je pořadí dokumentace;
 * casting na něm nestojí (vybírá se hashem, ne indexem), takže doplnění hlasu na
 * konec nepřehází už nacastované značky.
 *
 * ElevenLabs hlasy jsou **rodilí čeští mluvčí** z komunitní knihovny (Voice Library,
 * filtr jazyk „cs"), vybraní 12. 9. 2026 podle ročního využití a pestrosti
 * (6 mužských, 6 ženských; standardní, pražská i moravská dikce) — přesně kvůli
 * české prozodii, která premade hlasům ElevenLabs i Gemini chybí. `id` je globální
 * `voice_id`; hlas musí být přidaný do našeho účtu (`POST /v1/voices/add/…`), jinak
 * TTS vrátí `voice_not_found` a reel se zaparkuje. `name` je zobrazované jméno.
 */
export const VOICE_LIBRARY: VoiceProfile[] = [
    { id: "Zephyr", provider: "gemini", gender: "female", temperament: "energetic", pace: "fast", fits: ["moda", "fitness", "e-commerce", "kavarna"], label: "Jasný, svěží ženský hlas — rychlé tempo, hodí se na módu a lifestyle" },
    { id: "Puck", provider: "gemini", gender: "male", temperament: "playful", pace: "fast", fits: ["gastro", "zabava", "meme", "kavarna"], label: "Hravý mužský hlas s jiskrou — odlehčený obsah, gastro, zábava" },
    { id: "Charon", provider: "gemini", gender: "male", temperament: "authoritative", pace: "medium", fits: ["poradenstvi", "finance", "saas", "reality"], label: "Věcný mužský hlas — vysvětluje, nepřehrává; poradenství a služby" },
    { id: "Kore", provider: "gemini", gender: "female", temperament: "authoritative", pace: "medium", fits: ["poradenstvi", "zdravi", "reality", "vzdelavani"], label: "Pevný ženský hlas — důvěryhodný, bez patosu" },
    { id: "Fenrir", provider: "gemini", gender: "male", temperament: "energetic", pace: "fast", fits: ["fitness", "sport", "zabava", "remeslo"], label: "Nabuzený mužský hlas — energie, sport, výzvy" },
    { id: "Leda", provider: "gemini", gender: "female", temperament: "playful", pace: "fast", fits: ["moda", "krasa", "e-commerce", "zabava"], label: "Mladistvý ženský hlas — lehkost, krása a móda" },
    { id: "Orus", provider: "gemini", gender: "male", temperament: "authoritative", pace: "medium", fits: ["remeslo", "technika", "stavebnictvi", "reality"], label: "Rozhodný mužský hlas — řemeslo, technika, konkrétní sliby" },
    { id: "Aoede", provider: "gemini", gender: "female", temperament: "warm", pace: "medium", fits: ["kavarna", "ubytovani", "interier", "fotografie"], label: "Lehký, vzdušný ženský hlas — útulné podniky a zážitky" },
    { id: "Callirrhoe", provider: "gemini", gender: "female", temperament: "calm", pace: "slow", fits: ["wellness", "zdravi", "ubytovani", "interier"], label: "Klidný, uvolněný ženský hlas — wellness, péče, pomalé tempo" },
    { id: "Autonoe", provider: "gemini", gender: "female", temperament: "energetic", pace: "medium", fits: ["e-commerce", "saas", "vzdelavani", "fitness"], label: "Jasný ženský hlas s tahem — e-shopy a novinky" },
    { id: "Enceladus", provider: "gemini", gender: "male", temperament: "calm", pace: "slow", fits: ["wellness", "fotografie", "interier", "ubytovani"], label: "Tichý, dechový mužský hlas — intimní a pomalé záběry" },
    { id: "Iapetus", provider: "gemini", gender: "male", temperament: "calm", pace: "medium", fits: ["saas", "technika", "vzdelavani", "poradenstvi"], label: "Čistý mužský hlas — srozumitelné vysvětlování bez emocí navíc" },
    { id: "Umbriel", provider: "gemini", gender: "male", temperament: "warm", pace: "slow", fits: ["kavarna", "gastro", "remeslo", "lokalni"], label: "Pohodový mužský hlas — sousedský tón, lokální podniky" },
    { id: "Algieba", provider: "gemini", gender: "male", temperament: "warm", pace: "medium", fits: ["gastro", "vinarstvi", "krasa", "interier"], label: "Hladký mužský hlas — kultivovaný, hodí se k vínu a designu" },
    { id: "Despina", provider: "gemini", gender: "female", temperament: "warm", pace: "medium", fits: ["krasa", "wellness", "moda", "fotografie"], label: "Hebký ženský hlas — péče o sebe, jemné značky" },
    { id: "Erinome", provider: "gemini", gender: "female", temperament: "calm", pace: "medium", fits: ["saas", "poradenstvi", "vzdelavani", "reality"], label: "Zřetelný ženský hlas — návody a vysvětlení" },
    { id: "Algenib", provider: "gemini", gender: "male", temperament: "authoritative", pace: "slow", fits: ["remeslo", "stavebnictvi", "technika", "autoservis"], label: "Drsnější mužský hlas — poctivá práce rukama, žádný lesk" },
    { id: "Rasalgethi", provider: "gemini", gender: "male", temperament: "authoritative", pace: "medium", fits: ["poradenstvi", "finance", "vzdelavani", "zdravi"], label: "Informativní mužský hlas — odborník, který mluví k věci" },
    { id: "Laomedeia", provider: "gemini", gender: "female", temperament: "energetic", pace: "fast", fits: ["zabava", "fitness", "e-commerce", "moda"], label: "Rozjetý ženský hlas — akce, slevy, výzvy" },
    { id: "Achernar", provider: "gemini", gender: "female", temperament: "calm", pace: "slow", fits: ["wellness", "zdravi", "ubytovani", "fotografie"], label: "Tlumený ženský hlas — klid, důvěra, pomalé obrazy" },
    { id: "Alnilam", provider: "gemini", gender: "male", temperament: "authoritative", pace: "medium", fits: ["reality", "finance", "technika", "stavebnictvi"], label: "Pevný mužský hlas — jistota a konkrétní čísla" },
    { id: "Schedar", provider: "gemini", gender: "male", temperament: "calm", pace: "medium", fits: ["saas", "poradenstvi", "reality", "vzdelavani"], label: "Vyrovnaný mužský hlas — neutrální, nikdy nepřehraje" },
    { id: "Gacrux", provider: "gemini", gender: "female", temperament: "warm", pace: "slow", fits: ["gastro", "vinarstvi", "lokalni", "remeslo"], label: "Zralý ženský hlas — zkušenost a tradice" },
    { id: "Pulcherrima", provider: "gemini", gender: "female", temperament: "energetic", pace: "fast", fits: ["moda", "krasa", "zabava", "e-commerce"], label: "Průrazný ženský hlas — tlačí dopředu, hodí se na hook" },
    { id: "Achird", provider: "gemini", gender: "male", temperament: "warm", pace: "medium", fits: ["kavarna", "lokalni", "sluzby", "fitness"], label: "Přátelský mužský hlas — jako když mluví majitel podniku" },
    { id: "Zubenelgenubi", provider: "gemini", gender: "male", temperament: "playful", pace: "medium", fits: ["zabava", "meme", "gastro", "sluzby"], label: "Ležérní mužský hlas — mluví jako člověk, ne jako reklama" },
    { id: "Vindemiatrix", provider: "gemini", gender: "female", temperament: "calm", pace: "slow", fits: ["zdravi", "wellness", "vzdelavani", "interier"], label: "Jemný ženský hlas — citlivá témata a péče" },
    { id: "Sadachbia", provider: "gemini", gender: "female", temperament: "playful", pace: "fast", fits: ["zabava", "e-commerce", "kavarna", "moda"], label: "Živý ženský hlas — svižný, dobře drží pozornost" },
    { id: "Sadaltager", provider: "gemini", gender: "male", temperament: "authoritative", pace: "medium", fits: ["vzdelavani", "saas", "finance", "technika"], label: "Znalý mužský hlas — vysvětlí i složitou věc" },
    { id: "Sulafat", provider: "gemini", gender: "female", temperament: "warm", pace: "medium", fits: ["kavarna", "gastro", "ubytovani", "sluzby"], label: "Vřelý ženský hlas — pozvání dovnitř, pohostinnost" },

    // ── ElevenLabs, rodilí čeští mluvčí (komunitní knihovna, 12. 9. 2026) ─────────
    // `fits` jsou širší než u Gemini schválně: fond má 12 hlasů a casting potřebuje
    // na každé oborové klíčové slovo aspoň 3 kandidáty, jinak vybírá z celé knihovny.
    { id: "KIDKfqJyZ6ASuyzsKfh5", name: "Jan", provider: "elevenlabs", gender: "male", temperament: "calm", pace: "medium", fits: ["poradenstvi", "vzdelavani", "zdravi", "finance", "reality", "technika", "sluzby", "stavebnictvi"], label: "Klidný, laskavý mužský hlas — vysvětluje bez spěchu; poradenství a vzdělávání" },
    { id: "vP4R9CqQI4q0HlVrXJWj", name: "Zdeněk", provider: "elevenlabs", gender: "male", temperament: "authoritative", pace: "slow", fits: ["remeslo", "stavebnictvi", "reality", "autoservis", "technika", "gastro", "lokalni", "vinarstvi"], label: "Silný, hluboký mužský hlas s moravským zabarvením — poctivá práce a jistota" },
    { id: "uYFJyGaibp4N2VwYQshk", name: "Adam", provider: "elevenlabs", gender: "male", temperament: "warm", pace: "medium", fits: ["kavarna", "gastro", "lokalni", "sluzby", "remeslo", "autoservis", "vinarstvi", "ubytovani"], label: "Sametový konverzační mužský hlas — mluví jako majitel podniku, ne jako reklama" },
    { id: "daJ4gHLkIVFskWuoLuDX", name: "Oliver", provider: "elevenlabs", gender: "male", temperament: "warm", pace: "medium", fits: ["saas", "sluzby", "e-commerce", "technika", "remeslo", "autoservis", "interier", "finance"], label: "Hladký, poutavý mužský hlas — moderní služby a produkty" },
    { id: "U48DQ1c9SVmD2BVCSiHL", name: "Zazy", provider: "elevenlabs", gender: "male", temperament: "calm", pace: "slow", fits: ["wellness", "ubytovani", "fotografie", "interier", "vinarstvi", "gastro", "lokalni", "poradenstvi", "vzdelavani"], label: "Čistý vypravěčský mužský hlas s pražskou dikcí — pomalé obrazy a atmosféra" },
    { id: "7FpO7yFcBAfqM6vZJCg7", name: "Jan B.", provider: "elevenlabs", gender: "male", temperament: "energetic", pace: "medium", fits: ["e-commerce", "fitness", "zabava", "sport", "saas", "autoservis"], label: "Jasný mužský hlas s tahem — akce, novinky, výzvy" },
    { id: "MpbYQvoTmXjHkaxtLiSh", name: "Anet", provider: "elevenlabs", gender: "female", temperament: "playful", pace: "fast", fits: ["moda", "krasa", "zabava", "e-commerce", "fitness", "sport", "kavarna"], label: "Mladý, živý ženský hlas — sociální sítě, móda a krása" },
    { id: "bF7C2fCv7Zf30iT84wZ1", name: "Jana", provider: "elevenlabs", gender: "female", temperament: "warm", pace: "medium", fits: ["kavarna", "ubytovani", "interier", "gastro", "lokalni", "krasa", "reality", "wellness"], label: "Vřelý, sebejistý ženský hlas s pražskou dikcí — pozvání dovnitř" },
    { id: "OAAjJsQDvpg3sVjiLgyl", name: "Denisa", provider: "elevenlabs", gender: "female", temperament: "calm", pace: "medium", fits: ["krasa", "wellness", "moda", "fotografie", "interier", "zdravi"], label: "Měkký, vyvážený ženský hlas — péče o sebe a jemné značky" },
    { id: "7JbZPqJGWUfXXBim0T8U", name: "Katty", provider: "elevenlabs", gender: "female", temperament: "energetic", pace: "fast", fits: ["fitness", "e-commerce", "zabava", "sport", "saas", "moda"], label: "Energický, důvěryhodný ženský hlas — sport, slevy, výzvy" },
    { id: "12CHcREbuPdJY02VY7zT", name: "Hanka", provider: "elevenlabs", gender: "female", temperament: "authoritative", pace: "medium", fits: ["vzdelavani", "poradenstvi", "zdravi", "saas", "technika", "finance", "reality", "stavebnictvi"], label: "Přátelský informativní ženský hlas — návody a vysvětlení" },
    { id: "2qbJHyAaz7tHCfVZS6z3", name: "Hana", provider: "elevenlabs", gender: "female", temperament: "calm", pace: "slow", fits: ["zdravi", "wellness", "ubytovani", "vzdelavani", "poradenstvi", "finance", "krasa", "fotografie"], label: "Uklidňující ženský hlas — citlivá témata a péče" },
]

const BY_ID = new Map(VOICE_LIBRARY.map(v => [v.id.toLowerCase(), v]))

export function findVoice(voiceId: string | undefined | null): VoiceProfile | undefined {
    return voiceId ? BY_ID.get(voiceId.trim().toLowerCase()) : undefined
}

export function isKnownVoice(voiceId: string | undefined | null): boolean {
    return findVoice(voiceId) !== undefined
}

export function voicesForProvider(provider: TtsProviderId): VoiceProfile[] {
    return VOICE_LIBRARY.filter(v => v.provider === provider)
}

/** Bez diakritiky a malými písmeny — casting nesmí rozlišovat „Řemeslo" a „remeslo". */
function fold(text: string | undefined): string {
    return (text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

/**
 * Obor → klíčová slova knihovny. Řetězec `config.industry` je volný text z
 * onboardingu („Gastronomie / Kavárna"), takže se hledají podřetězce, ne shoda.
 */
const INDUSTRY_KEYWORDS: Array<[RegExp, string[]]> = [
    [/kavarn|cukrar|bistro|pekar/, ["kavarna", "gastro", "lokalni"]],
    [/restaur|gastro|food|jidl/, ["gastro", "lokalni"]],
    [/vinar|pivovar|destil/, ["vinarstvi", "gastro"]],
    [/kras|salon|kadernic|kosmetik|nehty/, ["krasa", "wellness"]],
    [/fitness|wellness|jog|sport|trener/, ["fitness", "wellness", "sport"]],
    [/e-?commerce|e-?shop|obchod|prodej/, ["e-commerce", "moda"]],
    [/remesl|stavb|stavebn|izolac|instalater|truhlar|malir/, ["remeslo", "stavebnictvi"]],
    [/auto|servis|pneu|mechanik/, ["autoservis", "technika"]],
    [/poraden|kouc|konzult|pravn|ucetn|finan/, ["poradenstvi", "finance"]],
    [/foto|kreativ|video|design/, ["fotografie", "interier"]],
    [/app|saas|software|it |technolog/, ["saas", "technika"]],
    [/ubytov|penzion|hotel|apartm|chalup/, ["ubytovani", "lokalni"]],
    [/zdrav|estetik|klinik|zubn|lekar|fyzio/, ["zdravi", "wellness"]],
    [/realit|nemovit/, ["reality", "finance"]],
    [/skol|kurz|vzdelav|lektor/, ["vzdelavani"]],
    [/interier|nabytek|byt|architek/, ["interier", "moda"]],
    [/mod|obleceni|second|styl/, ["moda", "krasa"]],
]

/** Persona značky (volný text z onboardingu) → preferovaný temperament. */
const PERSONA_TEMPERAMENTS: Array<[RegExp, VoiceTemperament[]]> = [
    [/vtip|hrav|nezavaz|odlehc|parod|drz/, ["playful", "energetic"]],
    [/energi|nabud|motivac|drive|akcn/, ["energetic", "playful"]],
    [/klid|jemn|empat|pecuj|uklidn|laskav/, ["calm", "warm"]],
    [/odborn|expert|profes|autorit|precizn|seriozn/, ["authoritative", "calm"]],
    [/pratelsk|vrel|lidsk|sousedsk|rodinn|poradce/, ["warm", "playful"]],
]

export interface VoiceCastingInput {
    persona?: string
    industry?: string
    audience?: string
    /** Jméno nebo slug značky. Do VÝBĚRU kandidátů nevstupuje, jen do seedu: dvě
     *  značky se stejnou (nebo chybějící) personou a oborem by jinak dostaly týž
     *  hlas — a přesně tím dnešní stav je. */
    brand?: string
}

/**
 * Deterministický casting: stejná značka = vždy stejný hlas, různé značky = různé
 * hlasy. Není to náhoda se seedem ani `VOICE_LIBRARY[0]` — obojí by skončilo zpátky
 * u „všichni mluví Kore".
 *
 * Postup: z oboru a persony se sestaví kandidátský fond — nejdřív hlasy, které sedí
 * OBOJÍM, teprve když jich není dost, sjednocení (shoda oboru nebo temperamentu) —
 * a z fondu vybere FNV-1a hash celého vstupu.
 * Hash, ne pořadí: kdyby se vybíralo první shodou, spadly by všechny kavárny na
 * jeden hlas — kandidátský fond má rozhodovat o VHODNOSTI, ne o výsledku.
 */
export function castVoice(input: VoiceCastingInput, provider: TtsProviderId = DEFAULT_TTS_PROVIDER): string {
    const pool = voicesForProvider(provider)
    if (pool.length === 0) throw new Error(`castVoice: knihovna nemá hlas pro poskytovatele ${provider}`)

    const industry = fold(input.industry)
    const persona = fold(`${input.persona ?? ""} ${input.audience ?? ""}`)

    const keywords = INDUSTRY_KEYWORDS.filter(([re]) => re.test(industry)).flatMap(([, kw]) => kw)
    const temperaments = PERSONA_TEMPERAMENTS.filter(([re]) => re.test(persona)).flatMap(([, t]) => t)

    const byIndustry = keywords.length > 0 ? pool.filter(v => v.fits.some(f => keywords.includes(f))) : []
    const byTemperament = temperaments.length > 0 ? pool.filter(v => temperaments.includes(v.temperament)) : []
    // Nejdřív hlasy, které sedí OBOJÍM: energický trenér nemá dostat klidného vypravěče
    // jen proto, že fitness v knihovně sousedí s wellness. Průnik musí mít aspoň dva
    // kandidáty, aby hash měl z čeho vybírat; jinak sjednocení. Pod třemi kandidáty
    // (neznámý obor i persona — klient napsal obor vlastními slovy) celá knihovna:
    // prázdný fond by shodil casting na výjimku.
    const both = byIndustry.filter(v => byTemperament.includes(v))
    const either = pool.filter(v => byIndustry.includes(v) || byTemperament.includes(v))
    const candidates = both.length >= 2 ? both : either.length >= 3 ? either : pool

    const seed = `${fold(input.brand)}|${fold(input.persona)}|${industry}|${fold(input.audience)}`
    return candidates[hash32(seed) % candidates.length].id
}

/** FNV-1a — stačí na rozprostření a je stejný v prohlížeči i na serveru. */
function hash32(text: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h >>> 0
}
