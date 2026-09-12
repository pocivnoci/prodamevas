/**
 * Přednes: nálada scény → tagy pro TTS.
 * =====================================
 * `scenes[].mood` od copywritera popisuje SVĚTLO A OBRAZ („warm golden hour, soft
 * bokeh", „dramatic side lighting, moody"). Do 12. 9. 2026 se tenhle text posílal
 * do TTS jako `audioTags` — hlas tedy dostával pokyn „soft bokeh" a před ním
 * natvrdo `[professional]` pro všechny značky a všechny věty. Proto zněl každý
 * reel stejně úředně.
 *
 * Tady se z vizuální nálady vytáhne to, co má smysl pro HLAS (teplo, energie,
 * klid, důraz), a zbytek se zahodí. Žádné volání modelu — je to mapa, ne agent.
 */

/** Tagy, kterým Gemini TTS rozumí a které mění přednes, ne obsah. */
const MOOD_TAGS: Array<[RegExp, string]> = [
    [/warm|golden|cozy|inviting|soft light|sunset/i, "warm"],
    [/energetic|vibrant|dynamic|fast|action|bold|bright/i, "upbeat"],
    [/calm|serene|quiet|gentle|minimal|still|slow/i, "calm"],
    [/dramatic|moody|cinematic|contrast|intense|night/i, "serious"],
    [/playful|fun|quirky|colorful|cheerful/i, "playful"],
    [/clean|studio|professional|crisp|neutral/i, "clear"],
]

/**
 * Nejvýš dva tagy: tři a víc si u Gemini TTS konkurují a přednes se zplošťuje zpět
 * do neutrálu (stejně jako když se pošlou popisy světla). Když nic nesedí, vrací
 * prázdno — hlas pak mluví svým výchozím přednesem, což je pořád lepší než cizí
 * pokyn.
 */
export function deliveryTags(moods: (string | undefined)[], limit = 2): string[] {
    const text = moods.filter(Boolean).join(" ")
    const out: string[] = []
    for (const [re, tag] of MOOD_TAGS) {
        if (re.test(text) && !out.includes(tag)) out.push(tag)
        if (out.length >= limit) break
    }
    return out
}
