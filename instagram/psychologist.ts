/**
 * Psycholog — deterministická vrstva prodejní psychologie pro copywritera.
 *
 * Záměrně NEPŘIDÁVÁ žádné AI volání ani nový krok do pipeline: vrací řízený blok
 * principů, který se vkládá do mega promptu (`buildMegaPrompt` v caption-generator.ts).
 * Tím každý caption píše s tahy prodejní psychologie od první věty — bez další latence,
 * nákladu nebo failure-mode. Vypnutelné přes `ClientConfig.psychologist === false`.
 *
 * Návazný nápad (živý review-agent, který hotový caption ještě přepíše) je zaparkovaný
 * v brain/Ideas.md — tahle vrstva je bezpečný první krok.
 */

import type { AudiencePersona } from "./configs/types"

/** Persuazní páky zvýrazněné podle intenzity CTA dané persony. */
function leversFor(ctaStyle?: AudiencePersona["ctaStyle"]): string[] {
    if (ctaStyle === "hard") {
        return [
            "Loss aversion — pojmenuj, o co čtenář přijde, když nezareaguje (věcně, bez strašení)",
            "Scarcity / urgence — ale JEN pokud je skutečná (reálný termín, počet kusů, sezóna)",
            "Sociální důkaz — kolik lidí to už dělá / kupuje / si rezervovalo",
        ]
    }
    if (ctaStyle === "soft") {
        return [
            "Reciprocita — dej hodnotu nebo tip zadarmo dřív, než o cokoliv požádáš",
            "Liking & relatabilita — buď lidský, pojmenuj společný pocit, sdílej kus zákulisí",
            "Autorita — ukaž řemeslo a know-how, ne aroganci",
        ]
    }
    // medium / bez persony
    return [
        "Sociální důkaz — lidé chtějí to, co chtějí ostatní",
        "Autorita / expertíza — proč zrovna vy",
        "Reciprocita — nejdřív dej, pak teprve žádej",
    ]
}

/**
 * Blok prodejní psychologie do copywriterova promptu.
 * @param persona  Náhodně vybraná cílová persona pro tento post (volitelná) — ladí páky.
 */
export function buildPsychologistSection(persona?: AudiencePersona): string {
    const levers = leversFor(persona?.ctaStyle)
    return `
## 🧠 PSYCHOLOGIE PRODEJE (jak to napsat, aby to prodávalo)
Nepiš popis. Piš tak, aby čtenář něco POCÍTIL a něco UDĚLAL.

**Základ:**
- Prodávej VÝSLEDEK a pocit, ne vlastnosti („jak se po tom bude mít", ne „co to je").
- Mluv k JEDNÉ osobě (ty/vy). Jeden post = jedna myšlenka = jedno CTA.
- Hook otevírá smyčku (curiosity gap) — první věta nutí přečíst druhou.
- Konkrétní > obecné. Čísla, detail, smysly. Žádné prázdné fráze („kvalita", „tradice").
- Pojmenuj bolest → ukaž úlevu → pozvi k akci.

**Pro tento post zvýrazni tyhle páky:**
${levers.map((l) => `- ${l}`).join("\n")}

**⚠️ Hranice (povinné):** Psychologie ANO, klamání NE. NIKDY si nevymýšlej falešnou
urgenci, fake recenze, smyšlená čísla ani sliby, které značka nesplní. Důvěra je
dlouhodobě cennější než jeden klik.
`
}
