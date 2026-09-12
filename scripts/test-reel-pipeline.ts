/**
 * Reelová pipeline — čisté kontroly (bez sítě, bez DB, bez ffmpegu).
 *   npx tsx scripts/test-reel-pipeline.ts
 *
 * Hlídá to, co se v reelu rozbije potichu: velikosti a ceny, časovou osu
 * z naměřené řeči, skládání voiceoveru, titulkové karty a ASS, validaci
 * storyboardu, tvar požadavku na ModelArk, argumenty kompozice a značku
 * „video ještě běží", která musí přežít zabalení do obyčejné chyby.
 */

import { readFileSync } from "fs"
import { MEDIA_CREDITS } from "../lib/credits"
import { REEL_MEDIA, REEL_LIMITS, REEL_TIMELINE, isReelMedium, clampReelDuration, REEL_LABELS, SPOKEN_WORDS_PER_SECOND, plannedNarrationWords, plannedNarrationSentences, narrationWordBudget, clampReelModes, READ_WORDS_PER_SECOND, MIN_CARD_SECONDS } from "../lib/reel-media"
import { parsePostMedia } from "../lib/media-urls"
import { applyFormatClamps } from "../instagram/format-clamps"
import { deliveryTags } from "../instagram/tts/delivery"
import { wavInfo, pcmToWav, buildTimeline, assembleVoiceoverWav, wordCount, TIMELINE_DEFAULTS, trimSilence } from "../instagram/reel-audio"
import { buildTextTimeline, textCardWordBudget } from "../instagram/reel-text-timeline"
import { CLIENT_BUCKET_MIME_TYPES } from "../lib/storage-buckets"
import sharp from "sharp"
import { referenceTooSmall, upscaleReference } from "../instagram/reel-references"
import { chunkForSubtitles, wrapWords, buildAss, assTime, escapeAssText, resolveSubtitleStyle, cardsFromEdits, hexToAssColour, ASS_DEFAULTS, endsWithNoBreakWord, usableHighlight, POP_DEFAULT_ACCENT, wordHighlightEvents, assTagColour } from "../instagram/reel-subtitles"
import { validateStoryboard, parseStoryboard, finalizeVideoPrompt, buildReelDirectorPrompt, type ReelStoryboard } from "../instagram/reel-storyboard"
import { buildTaskBody, parseTaskStatus, MAX_REFERENCES } from "../instagram/seedance-client"
import { buildComposeArgs, escapeFilterPath } from "../instagram/reel-compositor"
import { VideoPendingError, isVideoPending, QualityUnavailableError, isQualityUnavailable } from "../utils/retry"
import { videoUnitKey, costUsdForCall } from "../lib/model-pricing"
import { getModel } from "../instagram/models"
import { buildSpeechRequest, ELEVENLABS_OUTPUT_FORMAT } from "../instagram/tts/elevenlabs"

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}
const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps

console.log("\n🎬 VELIKOSTI A CENY\n")
check("dvě velikosti reelu", REEL_MEDIA.length === 2 && isReelMedium("reel") && isReelMedium("reel_long"))
check("story ani obrázek nejsou reel", !isReelMedium("story") && !isReelMedium("image") && !isReelMedium(undefined))
check("krátký ≤ 8 s, dlouhý ≤ 20 s", REEL_LIMITS.reel.maxSeconds === 8 && REEL_LIMITS.reel_long.maxSeconds === 20)
check("clamp: 30 s u krátkého → 8", clampReelDuration("reel", 30) === 8)
check("clamp: 3 s u dlouhého → 10 (minimum)", clampReelDuration("reel_long", 3) === 10)
check("clamp: bez požadavku výchozí délka", clampReelDuration("reel") === REEL_LIMITS.reel.defaultSeconds && clampReelDuration("reel_long", null) === REEL_LIMITS.reel_long.defaultSeconds)
check("dlouhý reel stojí 2× krátký", MEDIA_CREDITS.reel_long === 2 * MEDIA_CREDITS.reel)
check("popisky obou velikostí", REEL_LABELS.reel.length > 0 && REEL_LABELS.reel_long !== REEL_LABELS.reel)
check("klíč ceny videa nese rozlišení", videoUnitKey("dreamina-seedance-2-5-260628", "480p") === "dreamina-seedance-2-5-260628@480p")

console.log("\n📐 CLAMPY A PARSER MÉDIÍ\n")
const open = { reelsEnabled: true, storiesEnabled: true, log: () => {} }
check("reel_long je vertikální", applyFormatClamps({ medium: "reel_long", aspectRatio: "4:5", overlayStyle: "none" }, open).aspectRatio === "9:16")
check("reels off → reel_long padá na carousel", applyFormatClamps({ medium: "reel_long", aspectRatio: "9:16", overlayStyle: "none" }, { ...open, reelsEnabled: false }).medium === "carousel")
check("účtovaný krátký reel sráží dlouhý na krátký", applyFormatClamps({ medium: "reel_long", aspectRatio: "9:16", overlayStyle: "none" }, { ...open, chargedMedium: "reel" }).medium === "reel")
const parsed = parsePostMedia("https://x/v.mp4|https://x/c.webp", "reel_long")
check("parsePostMedia: reel_long → kind reel, video + cover", parsed.kind === "reel" && parsed.videoUrl === "https://x/v.mp4" && parsed.coverUrl === "https://x/c.webp" && parsed.thumbUrl === "https://x/c.webp")

console.log("\n🎙️ ČASOVÁ OSA Z NAMĚŘENÉ ŘEČI\n")
const wav = (seconds: number) => pcmToWav(Buffer.alloc(Math.round(seconds * 24_000) * 2), 24_000, 1, 16)
check("wavInfo čte délku z hlavičky", near(wavInfo(wav(1.5)).durationSeconds, 1.5, 0.001) && wavInfo(wav(1)).sampleRate === 24_000)
const short = buildTimeline(["Ahoj.", "Druhá věta.", "Ulož si to."], [1.2, 1.8, 1.0], REEL_LIMITS.reel)
check("osa: nájezd 0,5 s, věty za sebou s mezerou", near(short.lines[0].start, 0.5) && near(short.lines[1].start, 0.5 + 1.2 + 0.35))
check("osa: délka videa = ceil(řeč + mezery + dojezd) v mezích", short.durationSeconds === Math.ceil(0.5 + 4 + 0.7 + 1.0) && short.atempo === 1 && !short.tooLong)
check("osa: placements jsou v původním tempu", near(short.placements[2], 0.5 + 1.2 + 0.35 + 1.8 + 0.35))
const tight = buildTimeline(["a", "b", "c"], [2.2, 2.2, 2.2], REEL_LIMITS.reel)
check("osa: mírné přetečení se zrychlí, ne usekne", tight.atempo > 1 && tight.atempo <= 1.15 && !tight.tooLong && tight.durationSeconds === 8, `atempo ${tight.atempo}`)
check("osa: zrychlené časy vět končí před stropem", tight.lines[2].end <= 8 - 1.0 / tight.atempo + 0.01)
const wayTooLong = buildTimeline(["a", "b", "c", "d"], [4, 4, 4, 4], REEL_LIMITS.reel)
check("osa: řeč 16 s do 8 s = tooLong (text se má zkrátit)", wayTooLong.tooLong && wayTooLong.atempo === 1.15)
check("osa: dlouhý reel drží minimum 10 s", buildTimeline(["krátké"], [1], REEL_LIMITS.reel_long).durationSeconds === 10)
let threw = false
try { buildTimeline(["a"], [1, 2], REEL_LIMITS.reel) } catch { threw = true }
check("osa: nesedící počet vět a délek hází", threw)
const mixed = assembleVoiceoverWav([wav(1), wav(0.5)], [0.5, 2.0], 4)
const mixedInfo = wavInfo(mixed)
check("skládání: jedna stopa v délce videa (původní tempo)", near(mixedInfo.durationSeconds, 4, 0.001) && mixedInfo.sampleRate === 24_000)
threw = false
try { assembleVoiceoverWav([wav(1), pcmToWav(Buffer.alloc(48_000), 48_000, 1, 16)], [0, 2], 4) } catch { threw = true }
check("skládání: různý formát klipů hází (žádný tichý resample)", threw)
check("wordCount počítá slova", wordCount(["Ahoj světe", "tři slova tady"]) === 5)
check("osa bere nájezd, mezery, dojezd i zrychlení z jednoho místa (lib/reel-media)", TIMELINE_DEFAULTS.leadInSeconds === REEL_TIMELINE.leadInSeconds && TIMELINE_DEFAULTS.gapSeconds === REEL_TIMELINE.gapSeconds && TIMELINE_DEFAULTS.tailSeconds === REEL_TIMELINE.tailSeconds && TIMELINE_DEFAULTS.maxTempo === REEL_TIMELINE.maxTempo)

console.log("\n✂️ ROZPOČET SLOV NARRACE\n")
// Živý test 11. 9. 2026: obě velikosti reelu padly na „nevejde se ani po zkrácení". Každý TTS
// klip nesl ~0,3 s ticha na začátku a ~0,4 s na konci (počítalo se jako řeč) a cíl
// `délka × 2,3` ignoroval nájezd, mezery i dojezd. Klipy se teď ořezávají (`trimSilence`)
// a čistá řeč má 2,2–2,4 slova/s.
const speechFor = (words: number, rate: number, sentences: number) => Array.from({ length: sentences }, () => words / rate / sentences)
const sentenceLines = (n: number) => Array.from({ length: n }, (_, i) => `věta ${i}`)
check("plánovací tempo čisté řeči z měření (2,0–2,4 slova/s)", SPOKEN_WORDS_PER_SECOND >= 2.0 && SPOKEN_WORDS_PER_SECOND <= 2.4)
for (const [medium, seconds] of [["reel", 8], ["reel", 4], ["reel_long", 15], ["reel_long", 20]] as const) {
    const n = plannedNarrationSentences(seconds)
    const words = plannedNarrationWords(seconds)
    const limits = { minSeconds: REEL_LIMITS[medium].minSeconds, maxSeconds: seconds }
    const planned = buildTimeline(sentenceLines(n), speechFor(words, SPOKEN_WORDS_PER_SECOND, n), limits)
    const slowVoice = buildTimeline(sentenceLines(n), speechFor(words, 2.0, n), limits)
    check(`copywriter ${medium} ${seconds}s: ${words} slov se vejde i pomalejšímu hlasu (2,0 slova/s)`, words >= n && !planned.tooLong && planned.atempo === 1 && !slowVoice.tooLong, `tempo ${slowVoice.atempo}`)
}
// Skutečné případy z testu (neořezané klipy, tempo i s tichem): krátký 18 slov za 11,58 s, dlouhý 46 slov za 23,88 s.
// Rozpočet z naměřeného tempa na tom, jestli klipy ticho nesou, nezávisí.
for (const [medium, words, speech, n] of [["reel", 18, 11.58, 3], ["reel_long", 46, 23.88, 5]] as const) {
    const max = REEL_LIMITS[medium].maxSeconds
    const rate = words / speech
    const oldTarget = Math.floor(max * 2.3)
    const old = buildTimeline(sentenceLines(n), speechFor(oldTarget, rate, n), REEL_LIMITS[medium], { maxTempo: REEL_TIMELINE.condensedMaxTempo })
    const budget = narrationWordBudget({ words, speechSeconds: speech, sentences: n, maxSeconds: max })
    const fits = buildTimeline(sentenceLines(n), speechFor(budget, rate, n), REEL_LIMITS[medium])
    check(`zkrácení ${medium}: cíl z naměřeného tempa (${budget} slov) se vejde, starý (${oldTarget}) ne`, budget < words && budget >= n && !fits.tooLong && old.tooLong, `nový ${fits.totalSeconds}s, starý ${old.totalSeconds}s`)
}
check("rozpočet: aspoň slovo na větu a vždy méně slov, než bylo", narrationWordBudget({ words: 4, speechSeconds: 30, sentences: 3, maxSeconds: 8 }) === 3 && narrationWordBudget({ words: 5, speechSeconds: 2, sentences: 3, maxSeconds: 20 }) === 4)
const orchestratorSrc = readFileSync("instagram/orchestrators/reel-orchestrator.ts", "utf-8")
check("orchestrátor zkracuje podle naměřeného tempa nejvýš dvakrát, ne podle délky × konstanta", /narrationWordBudget\(/.test(orchestratorSrc) && /maxCondenseRounds = 2/.test(orchestratorSrc) && !/WORDS_PER_SECOND/.test(orchestratorSrc))
const captionSrc = readFileSync("instagram/caption-generator.ts", "utf-8")
check("prompt copywritera bere strop slov z plannedNarrationWords, ne z délky × 2,3", /plannedNarrationWords\(/.test(captionSrc) && !/\* 2\.3\)/.test(captionSrc))

console.log("\n🪧 TEXTOVÝ REŽIM — OSA ZE ČTECÍHO TEMPA\n")
// Textový reel nemá zvuk, který by šel změřit: délku karty určuje ČTENÍ. Kdyby se
// tahle osa spočítala špatně, poznalo by se to až na hotovém videu (karta zmizí
// dřív, než ji jde přečíst), a opravit by to šlo jen přerenderováním.
const tri = buildTextTimeline(["Ranní várka", "Šest hodin ráno a kavárna už voní", "Ulož si to"], REEL_LIMITS.reel_long)
check("text: nájezd 0,5 s a karty za sebou s mezerou", near(tri.lines[0].start, REEL_TIMELINE.leadInSeconds) && near(tri.lines[1].start, tri.lines[0].end + REEL_TIMELINE.gapSeconds))
check("text: dlouhá karta trvá déle než krátká (čtecí tempo, ne rovnoměrné dělení)", tri.lines[1].end - tri.lines[1].start > tri.lines[0].end - tri.lines[0].start)
check(`text: karta o ${Math.round(READ_WORDS_PER_SECOND * 2)} slovech trvá ~2 s (${READ_WORDS_PER_SECOND} slova/s)`, (() => {
    const six = buildTextTimeline([Array.from({ length: READ_WORDS_PER_SECOND * 2 }, () => "slovo").join(" ")], REEL_LIMITS.reel_long)
    return near(six.lines[0].end - six.lines[0].start, 2, 0.05)
})())
check(`text: jednoslovná karta drží minimum ${MIN_CARD_SECONDS} s`, (() => {
    const one = buildTextTimeline(["Ano"], REEL_LIMITS.reel_long)
    return near(one.lines[0].end - one.lines[0].start, MIN_CARD_SECONDS)
})())
check("text: délka videa je z osy a sedí do mezí velikosti", tri.durationSeconds >= REEL_LIMITS.reel_long.minSeconds && tri.durationSeconds <= REEL_LIMITS.reel_long.maxSeconds && tri.durationSeconds >= Math.ceil(tri.totalSeconds - 1e-6))
check("text: krátká osa se natáhne na minimum velikosti, ne pod něj", buildTextTimeline(["Ano"], REEL_LIMITS.reel_long).durationSeconds === REEL_LIMITS.reel_long.minSeconds)
const tooMuch = buildTextTimeline(Array.from({ length: 6 }, () => "tohle je hodně dlouhá karta plná slov navíc"), REEL_LIMITS.reel)
check("text: co se nevejde do stropu, hlásí tooLong (zrychlit čtení nejde)", tooMuch.tooLong && tooMuch.durationSeconds === REEL_LIMITS.reel.maxSeconds)
check("text: ani při stahování nejde karta pod minimum", tooMuch.lines.every(l => l.end - l.start >= MIN_CARD_SECONDS - 0.001))
check("text: rozpočet slov vrací vždy míň, než text měl, a aspoň slovo na kartu",
    textCardWordBudget({ words: 60, cards: 4, maxSeconds: 8 }) < 60 && textCardWordBudget({ words: 3, cards: 4, maxSeconds: 8 }) === 4)
check("text: reel bez jediné karty je chyba, ne prázdná osa", (() => {
    try { buildTextTimeline(["   "], REEL_LIMITS.reel); return false } catch { return true }
})())
check("textová osa se nezrychluje (atempo 1) — zrychlit čtení nejde", tri.atempo === 1)

// „Textový režim nevolá TTS" je celý smysl balíku: jedno zapomenuté volání by
// reel bez hlasu stálo o hlas víc a rozbilo by rozpočet (COSTS.ttsVoiceover).
const textBranch = (() => {
    const from = orchestratorSrc.indexOf("async function prepareTextTimeline")
    const to = orchestratorSrc.indexOf("\n}", from)
    return from > 0 && to > from ? orchestratorSrc.slice(from, to) : ""
})()
check("orchestrátor má samostatnou větev textového režimu", textBranch.length > 200 && /buildTextTimeline\(/.test(textBranch))
check("textová větev nevolá TTS ani neúčtuje voiceover", !/synthesizeNarration|ttsVoiceover|assembleVoiceoverWav|deliveryTags/.test(textBranch))
check("textová větev zkracuje nejvýš dvakrát, stejně jako mluvená", /maxCondenseRounds = 2/.test(textBranch))
check("orchestrátor čte režim z checkpointu, ne ze scén (resume nesmí přepnout režim)", /vc\?\.mode \?\? \(captionData\.reelMode === "text"/.test(orchestratorSrc))
check("textový reel nahrává voiceover jen když nějaký je", /if \(prepared\.voiceoverWav\)/.test(orchestratorSrc))
check("video_source nese režim reelu (rekompozice podle něj pozná, že WAV chybět má)", /mode: reelMode/.test(orchestratorSrc))
check("hook do obrazu je v textovém reelu první karta", /captionData\.onScreenHook/.test(orchestratorSrc))
const scriptwriterSrc = readFileSync("instagram/reel-scriptwriter.ts", "utf-8")
check("scriptToScenes značí textové scény, ale kartu nechává v narration (prochází branami)",
    /textOnly: true/.test(scriptwriterSrc) && /narration: textOnly \? \(b\.card \|\| b\.narration\)/.test(scriptwriterSrc))
check("autopilot posílá režim i hook do obrazu orchestrátoru", (() => {
    const src = readFileSync("instagram/autopilot.ts", "utf-8")
    return /captionData\.reelMode = script\.mode/.test(src) && /captionData\.onScreenHook = script\.onScreenHook/.test(src)
})())
check("textový reel má výchozí preset titulků cards, mluvený zůstává na classic",
    resolveSubtitleStyle(undefined, { reelMode: "text" }).style.preset === "cards"
    && resolveSubtitleStyle(undefined, { reelMode: "voiceover" }).style.preset === "pop"
    && resolveSubtitleStyle({ preset: "minimal" }, { reelMode: "text" }).style.preset === "minimal")
check("povolené režimy mají default obojí a prázdný výběr padá na hlas", (() => {
    const both = clampReelModes(undefined)
    return both.length === 2 && both.includes("text") && clampReelModes([]).join() === "voiceover" && clampReelModes(["text", "nesmysl"]).join() === "text"
})())

console.log("\n🔇 TICHO V TTS KLIPECH\n")
const tone = (seconds: number) => {
    const n = Math.round(seconds * 24_000)
    const b = Buffer.alloc(n * 2)
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / 24_000)), i * 2)
    return b
}
const quiet = (seconds: number) => Buffer.alloc(Math.round(seconds * 24_000) * 2)
const trimmed = trimSilence(pcmToWav(Buffer.concat([quiet(0.3), tone(1), quiet(0.4)]), 24_000, 1, 16))
check("trimSilence: ticho před i za řečí pryč, 60 ms dojezd zůstane", near(wavInfo(trimmed).durationSeconds, 1.12, 0.03) && wavInfo(trimmed).sampleRate === 24_000, `${wavInfo(trimmed).durationSeconds}s`)
const silentClip = pcmToWav(quiet(1), 24_000, 1, 16)
check("trimSilence: celý tichý klip vrací beze změny (prázdnotu hlídá volající)", trimSilence(silentClip) === silentClip)
// Volání se přesunulo za rozhraní `TtsProvider` (hlas patří značce, ne enginu) —
// pořadí „nejdřív ořezat, pak měřit" platí dál a hlídá se na novém tvaru.
check("synthesizeNarration měří AŽ oříznutý klip", /trimSilence\(await provider\.synthesize\(/.test(readFileSync("instagram/reel-audio.ts", "utf-8")))

console.log("\n🎙️ PŘEDNES Z NÁLAD SCÉN\n")
check("teplé světlo → teplý přednes", deliveryTags(["warm golden hour, soft bokeh"]).includes("warm"))
check("dramatická scéna → vážný přednes", deliveryTags(["dramatic side lighting, moody"]).includes("serious"))
check("nejvýš dva tagy (víc si u TTS konkuruje)", deliveryTags(["warm golden hour", "bright energetic daylight", "calm minimal studio"]).length <= 2)
check("nic nesedí → žádný tag, ne náhradní nálada", deliveryTags(["nondescript"]).length === 0 && deliveryTags([undefined]).length === 0)

console.log("\n🪣 KLIENTSKÉ BUCKETY\n")
const uploadTypes = [...orchestratorSrc.matchAll(/uploadToBucket\([^)]*"([a-z]+\/[a-z0-9.+-]+)"\)/g)].map(m => m[1])
check("bucket povoluje všechno, co reel nahrává (voiceover WAV i MP4)", uploadTypes.length >= 2 && uploadTypes.every(t => CLIENT_BUCKET_MIME_TYPES.includes(t)), uploadTypes.join(", "))
check("onboarding i create-bucket zakládají buckety z jednoho seznamu typů", ["app/onboarding/core.ts", "scripts/create-bucket.ts"].every(f => {
    const src = readFileSync(f, "utf-8")
    return /allowedMimeTypes: CLIENT_BUCKET_MIME_TYPES/.test(src) && !/allowedMimeTypes: \[/.test(src)
}))

console.log("\n💬 TITULKOVÉ KARTY A ASS\n")
const wrapped = wrapWords("Řekněte to česky s háčky a čárkami".split(" "), 18)
check("zalomení nepřekročí šířku", wrapped.every(l => l.length <= 18) && wrapped.length >= 2, wrapped.join(" | "))
const cards = chunkForSubtitles([
    { text: "Tohle je docela dlouhá věta, která se musí rozdělit na víc karet.", start: 0.5, end: 4.5 },
    { text: "Krátká.", start: 4.9, end: 5.6 },
])
check("karty: dlouhá věta → víc karet, každá ≤ 2 řádky ≤ 18 znaků", cards.length >= 3 && cards.every(c => c.lines.length <= 2 && c.lines.every(l => l.length <= 18)), JSON.stringify(cards))
check("karty: časy jdou za sebou a drží se věty", cards[0].start === 0.5 && cards.every((c, i) => i === 0 || c.start >= cards[i - 1].end) && cards[cards.length - 1].end === 5.6)
check("karty: žádná karta pod 0,8 s ani u krátké věty", cards.every(c => c.end - c.start >= 0.6), JSON.stringify(cards.map(c => c.end - c.start)))
const fast = chunkForSubtitles([{ text: "Jedna dvě tři čtyři pět šest sedm osm devět deset jedenáct dvanáct", start: 0, end: 1.6 }])
check("karty: rychlá věta se slučuje místo blikání", fast.length <= 2, `${fast.length} karet`)
check("assTime: setiny, ne milisekundy", assTime(1.5) === "0:00:01.50" && assTime(61.257) === "0:01:01.26")
check("escapeAssText: složené závorky a nový řádek", escapeAssText("a{b}\nc") === "a(b)\\Nc")
const ass = buildAss(cards)
check("ASS: hlavička, styl s Interem a bezpečná zóna", /PlayResX: 486/.test(ass) && /Style: Chrlit,Inter,40,/.test(ass) && /,2,40,70,290,1$/m.test(ass))
check("ASS: WrapStyle 2 — zalamujeme sami", /WrapStyle: 2/.test(ass))
check("ASS: každá karta je Dialogue s \\N mezi řádky", (ass.match(/^Dialogue: /gm) || []).length === cards.length && ass.includes("\\N"))
check("ASS: diakritika zůstává", ass.includes("rozdělit") || ass.includes("dlouhá"))

console.log("\n✂️ KARTY PODLE ŘEČI, NE PODLE ŠÍŘKY\n")
// Agro-invest 12. 9. 2026: „neprodáte ji / přes noc. Proto" + „odkupu." samo na kartě
// vypadalo jako automatické titulky z telefonu. Konec věty = konec karty, čárka je
// přirozená hranice, předložka/spojka nikdy nekončí kartu ani řádek, sirotek se slije.
const agro = chunkForSubtitles([{ text: "Zemědělská půda není krypto, neprodáte ji přes noc. Proto klientům nabízíme garanci zpětného odkupu.", start: 0.5, end: 6.98 }])
const agroText = agro.map(c => c.lines.join(" "))
check("konec věty ukončí kartu (Proto začíná novou)", agroText.some(t => t.endsWith("přes noc.")) && agroText.some(t => t.startsWith("Proto")), agroText.join(" | "))
check("čárka je hranice karty (krypto, končí kartu)", agroText.some(t => t.endsWith("krypto,")), agroText.join(" | "))
check("žádná karta nekončí předložkou ani spojkou", agro.every(c => !endsWithNoBreakWord(c.lines.join(" ").split(" "))), agroText.join(" | "))
check("žádný jednoslovný sirotek na konci věty", agro.every(c => c.lines.join(" ").split(" ").length >= 2), agroText.join(" | "))
check("řádek nekončí jednopísmennou předložkou (Tohle vám o / půdě) — na šířce presetu pop", wrapWords("Tohle vám o půdě neřeknou.".split(" "), 16).every(l => !endsWithNoBreakWord(l.split(" "))), wrapWords("Tohle vám o půdě neřeknou.".split(" "), 16).join(" | "))
check("šířka řádku je tvrdý strop — předložka zůstane, když by se další řádek nevešel", wrapWords("Tohle vám o půdě neřeknou.".split(" "), 15).every(l => l.length <= 15))
check("řádky pořád nepřetečou přes šířku", agro.every(c => c.lines.every(l => l.length <= 18)))

console.log("\n🟡 ZVÝRAZNĚNÍ SLOVA (preset pop)\n")
const pop = resolveSubtitleStyle({ subtitleStyle: undefined, feedAesthetic: { accentColor: "#d4af37" } })
check("výchozí preset je pop a barvu bere ze značky", pop.style.preset === "pop" && pop.style.accent === "#D4AF37" && pop.assStyle.highlightColour === hexToAssColour("#D4AF37"))
check("bílý, šedý ani skoro černý akcent nezvýrazní nic → žlutá", usableHighlight("#ffffff") === POP_DEFAULT_ACCENT && usableHighlight("#888888") === POP_DEFAULT_ACCENT && usableHighlight("#101010") === POP_DEFAULT_ACCENT && usableHighlight(undefined) === POP_DEFAULT_ACCENT)
check("barva zvýraznění se propíše do uloženého stylu (přerenderování bez configu)", resolveSubtitleStyle(pop.style).assStyle.highlightColour === pop.assStyle.highlightColour)
const popCard = { start: 1, end: 3, lines: ["Tohle vám", "o půdě neřeknou."] }
const popEvents = wordHighlightEvents(popCard, { primaryColour: "&H00FFFFFF", highlightColour: hexToAssColour("#D4AF37") })
check("jedna událost na slovo, navazují bez překryvu", popEvents.length === 5 && popEvents[0].includes(assTime(1)) && popEvents[4].includes(assTime(3)))
check("každá událost nese celou kartu a právě jedno obarvené slovo", popEvents.every(e => (e.match(/\\1c&H37AFD4&/g) || []).length === 1 && e.includes("\\N")))
check("tag barvy: &HBBGGRR& bez alfy", assTagColour("&H00FFFFFF") === "&HFFFFFF&" && assTagColour(hexToAssColour("#FF8800")) === "&H0088FF&")
check("bez barvy zvýraznění je karta jedna událost (classic)", (buildAss([popCard], resolveSubtitleStyle({ preset: "classic" }).assStyle).match(/^Dialogue: /gm) || []).length === 1)

console.log("\n🎨 STYL TITULKŮ A REKOMPOZICE\n")
// Titulek je vypálený do videa — jediná oprava překlepu je složit kompozici znovu.
// Aby to šlo bez nového Seedance videa a bez TTS, musí po reelu zbýt artefakty.
for (const preset of ["pop", "classic", "cards", "minimal"] as const) {
    const r = resolveSubtitleStyle({ subtitleStyle: { preset } })
    const assForPreset = buildAss(chunkForSubtitles([{ text: "Ranní káva má chuť, kterou si pamatujete.", start: 0.5, end: 4 }], r.chunkOpts), r.assStyle)
    const styleLine = (assForPreset.match(/^Style: Chrlit,.*$/m) || [""])[0]
    check(`preset ${preset}: čistá funkce vrací chunkOpts i ASS styl`, r.style.preset === preset && typeof r.chunkOpts.maxCharsPerLine === "number" && typeof r.assStyle.fontSize === "number")
    check(`preset ${preset}: ASS styl má 23 polí, bundlovaný font a platné barvy`,
        styleLine.split(",").length === 23 && /,Inter,/.test(styleLine) && (styleLine.match(/&H[0-9A-F]{8}/g) || []).length === 4, styleLine)
    check(`preset ${preset}: karty se vejdou na svou šířku řádku`,
        chunkForSubtitles([{ text: "Ranní káva má chuť, kterou si pamatujete.", start: 0.5, end: 4 }], r.chunkOpts).every(c => c.lines.every(l => l.length <= r.chunkOpts.maxCharsPerLine!)))
}
const classic = resolveSubtitleStyle({ preset: "classic" })
const cardsPreset = resolveSubtitleStyle({ preset: "cards" })
const minimalPreset = resolveSubtitleStyle({ preset: "minimal" })
check("bez konfigurace je default pop dole ve střední velikosti", resolveSubtitleStyle(undefined).style.preset === "pop" && classic.style.position === "bottom" && classic.style.size === "m")
check("cards: větší písmo, míň znaků na řádek, neprůhledný box", (cardsPreset.assStyle.fontSize ?? 0) > (classic.assStyle.fontSize ?? 0) && (cardsPreset.chunkOpts.maxCharsPerLine ?? 99) < (classic.chunkOpts.maxCharsPerLine ?? 0) && cardsPreset.assStyle.borderStyle === 3)
check("minimal: bez podkladu (plná průhlednost) a tenký obrys", minimalPreset.assStyle.backColour === "&HFF000000" && (minimalPreset.assStyle.outline ?? 9) < (classic.assStyle.outline ?? ASS_DEFAULTS.outline))
check("velikost hýbe písmem i šířkou řádku proti sobě", (() => {
    const s = resolveSubtitleStyle({ preset: "classic", size: "s" }), l = resolveSubtitleStyle({ preset: "classic", size: "l" })
    return (s.assStyle.fontSize ?? 0) < (l.assStyle.fontSize ?? 0) && (s.chunkOpts.maxCharsPerLine ?? 0) > (l.chunkOpts.maxCharsPerLine ?? 0)
})())
check("pozice mění jen MarginV (Alignment zůstává 2 — u 5/8 mění libass význam okrajů)", (() => {
    const margins = (["bottom", "center", "top"] as const).map(position => resolveSubtitleStyle({ preset: "classic", position }).assStyle.marginV)
    return new Set(margins).size === 3 && margins.every(m => typeof m === "number" && m! > 0 && m! < ASS_DEFAULTS.playResY)
})())
check("nesmyslný preset i barva spadnou na default, ne do ASS", (() => {
    const r = resolveSubtitleStyle({ preset: "neon" as never, color: "rgb(1,2,3)" as never, size: "xxl" as never })
    return r.style.preset === "pop" && r.style.size === "m" && r.style.color === undefined && r.assStyle.primaryColour === undefined
})())
check("hex barva → ASS &HAABBGGRR (obrácené pořadí bajtů)", hexToAssColour("#FF8800") === "&H000088FF" && resolveSubtitleStyle({ preset: "classic", color: "#FF8800" }).assStyle.primaryColour === "&H000088FF")
check("upravená karta se zalomí podle NOVÉ šířky řádku, ne podle staré", (() => {
    const out = cardsFromEdits([{ text: "Tohle je nově napsaný delší titulek", start: 1, end: 3 }], cardsPreset.chunkOpts)
    return out.length === 1 && out[0].lines.every(l => l.length <= cardsPreset.chunkOpts.maxCharsPerLine!) && out[0].lines.join(" ").includes("nově")
})())
check("prázdná i obrácená karta se zahodí (nesmyslné časy do ASS nepatří)", cardsFromEdits([{ text: "  ", start: 0, end: 2 }, { text: "ok", start: 3, end: 2 }]).length === 0)

const subsSrc = readFileSync("instagram/reel-subtitles.ts", "utf-8")
const configIdxSrc = readFileSync("instagram/configs/index.ts", "utf-8")
check("subtitleStyle má default ve validateConfig (clamp, ne default-through)", /subtitleStyle: clampSubtitleStyle\(config\.subtitleStyle\)/.test(configIdxSrc))
// Styl se od textového režimu (R4) předává i s režimem: textový reel má jiný
// výchozí preset (`cards`), protože karta tam nese sdělení, ne doprovod řeči.
check("orchestrátor styl SKUTEČNĚ předává do chunkForSubtitles i buildAss", /resolveSubtitleStyle\(config, \{ reelMode \}\)/.test(orchestratorSrc) && /chunkForSubtitles\(vc\.timeline, subtitles\.chunkOpts\)/.test(orchestratorSrc) && /buildAss\(cards, subtitles\.assStyle\)/.test(orchestratorSrc))
check("titulky sahají jen po bundlovaný font", /fontName: "Inter"/.test(subsSrc) && !/fontName: "(?!Inter)/.test(subsSrc))

check("orchestrátor ukládá surové video a voiceover po kompozici NEMAŽE",
    /ig-reels\/\$\{ts\}-raw\.mp4/.test(orchestratorSrc) && /videoSource/.test(orchestratorSrc) && !/storage\.from\(vc\.voiceoverBucket\)\.remove/.test(orchestratorSrc))
check("surové video se hlídá proti kvótě bucketu", /CLIENT_BUCKET_SIZE_LIMIT/.test(orchestratorSrc))
check("autopilot zapisuje video_source na řádek příspěvku", /video_source: renderResult\?\.videoSource \?\? null/.test(readFileSync("instagram/autopilot.ts", "utf-8")))

// Komentáře pryč: modul VYSVĚTLUJE, proč se Seedance ani creditGuard nevolá, a ta
// vysvětlivka by negativní aserci shodila vlastní dokumentací.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const recomposeSrc = stripComments(readFileSync("instagram/reel-recompose.ts", "utf-8"))
check("rekompozice nevolá Seedance, TTS ani jiný model", !/seedance-client|generateVoiceover|synthesizeNarration|gemini-client|directReel/.test(recomposeSrc))
check("rekompozice nic neúčtuje (žádný creditGuard ani trackSpend)", !/creditGuard|recordUnits|trackSpend/.test(recomposeSrc))
check("rekompozice je scoped na client_id (multi-tenancy)", (recomposeSrc.match(/\.eq\("client_id", clientId\)/g) || []).length >= 2)
check("rekompozice zapisuje krok do edit_history se scope subtitles", /scope: "subtitles"/.test(recomposeSrc) && /edit_history/.test(recomposeSrc))
check("rekompozice běží jobem, ne server action (ffmpeg je na desítky sekund)", (() => {
    const route = readFileSync("app/api/ig-run-job/route.ts", "utf-8")
    const action = readFileSync("app/actions/post-edit-actions.ts", "utf-8")
    return /kind === "reel_recompose"/.test(route) && /runReelRecompose/.test(route)
        && /recomposeReelSubtitles/.test(action) && !/runReelRecompose/.test(action)
        && /charged: "none"/.test(action.slice(action.indexOf("recomposeReelSubtitles")))
})())

console.log("\n🎭 STORYBOARD\n")
const good: ReelStoryboard = {
    shots: [
        { start: 0, end: 2.5, visual: "cup on table", camera: "dolly in", referenceIndexes: [1] },
        { start: 2.5, end: 5.5, visual: "barista pours", camera: "handheld", referenceIndexes: [1, 2] },
        { start: 5.5, end: 8, visual: "hold on packaging", camera: "static", referenceIndexes: [3] },
    ],
    audioMood: "warm morning", soundDesign: ["espresso hiss"], coverScene: "cup close-up",
    videoPrompt: "0-2.5s: slow dolly in on the ceramic cup from Image 1 on the wooden table, warm window light. 2.5-5.5s: handheld tracking as the barista from Image 2 pours; 5.5-8s: static hold on the packaging from Image 3. No text, no speech.",
}
check("validní storyboard projde", validateStoryboard(good, { durationSeconds: 8, referenceCount: 3, allowWebsite: false }).length === 0, validateStoryboard(good, { durationSeconds: 8, referenceCount: 3, allowWebsite: false }).join("; "))
const gappy = { ...good, shots: [good.shots[0], { ...good.shots[1], start: 3.5 }, good.shots[2]] }
check("mezera mezi záběry se odmítne", validateStoryboard(gappy, { durationSeconds: 8, referenceCount: 3, allowWebsite: false }).some(p => /gap/.test(p)))
const shortEnd = { ...good, shots: good.shots.map(s => ({ ...s })) }; shortEnd.shots[2].end = 6.5
check("storyboard kratší než video se odmítne", validateStoryboard(shortEnd, { durationSeconds: 8, referenceCount: 3, allowWebsite: false }).some(p => /last shot ends/.test(p)))
check("index reference mimo rozsah se odmítne", validateStoryboard(good, { durationSeconds: 8, referenceCount: 2, allowWebsite: false }).some(p => /out of range/.test(p)))
const withUrl = { ...good, videoPrompt: good.videoPrompt + " Show www.kavarna.cz on the cup." }
check("URL v promptu při zákazu webu se odmítne", validateStoryboard(withUrl, { durationSeconds: 8, referenceCount: 3, allowWebsite: false }).some(p => /URL/.test(p)))
check("URL projde, když politika web dovoluje", !validateStoryboard(withUrl, { durationSeconds: 8, referenceCount: 3, allowWebsite: true }).some(p => /URL/.test(p)))
const parsedSb = parseStoryboard("Here you go:\n```json\n" + JSON.stringify(good) + "\n```")
check("parseStoryboard přežije markdown plot", parsedSb.shots.length === 3 && parsedSb.videoPrompt === good.videoPrompt)
const finalPrompt = finalizeVideoPrompt(good, { durationSeconds: 8, ctaPolicy: { allowWebsite: false } as any })
check("finální prompt nese tvrdé zákazy bez ohledu na model", /no on-screen text/i.test(finalPrompt) && /no speech/i.test(finalPrompt) && /9:16, 8 seconds/.test(finalPrompt) && /No website/.test(finalPrompt))
const directorPrompt = buildReelDirectorPrompt({
    config: { name: "Kavárna", brandVoice: { persona: "přátelský" }, feedAesthetic: { feel: "teplé ráno", colorPalette: "béžová" } } as any,
    clientId: "c", medium: "reel", durationSeconds: 8, hook: "Ranní ticho", cta: "Ulož si to",
    narration: [{ text: "Věta.", start: 0.5, end: 1.7 }], postType: "reel_tip",
    references: [{ index: 1, kind: "photo", url: "u", description: "interiér", tags: ["interiér"] }],
    ctaPolicy: { allowWebsite: false, pillarLabel: "reach" } as any,
}, "", "")
check("prompt režiséra: časy vět, reference, zákaz textu i řeči, zákaz webu", /0\.5s–1\.7s/.test(directorPrompt) && /Image 1 \(photo/.test(directorPrompt) && /NO on-screen text/.test(directorPrompt) && /NO speech/.test(directorPrompt) && /forbids the website/.test(directorPrompt))

console.log("\n📡 MODELARK POŽADAVEK A ODPOVĚĎ\n")
const req = { model: "dreamina-seedance-2-5-260628", prompt: "cup", references: [{ url: "https://a/1.jpg", role: "reference_image" as const }, { url: "data:image/png;base64,AAAA", role: "reference_image" as const }], durationSeconds: 8, resolution: "480p" as const, ratio: "9:16" as const, generateAudio: true }
delete process.env.ARK_PARAMS_IN_PROMPT
const body = buildTaskBody(req) as any
check("tělo: model + content (text + obrázky) + top-level parametry", body.model === "dreamina-seedance-2-5-260628" && body.content.length === 3 && body.content[0].type === "text" && body.content[1].type === "image_url" && body.ratio === "9:16" && body.duration === 8 && body.resolution === "480p" && body.generate_audio === true)
check("tělo: vodoznak vypnutý", body.watermark === false)
process.env.ARK_PARAMS_IN_PROMPT = "1"
const legacy = buildTaskBody(req) as any
check("tělo (legacy přepínač): parametry v textu, ne top-level", /--ratio 9:16 --duration 8 --resolution 480p/.test(legacy.content[0].text) && legacy.ratio === undefined)
delete process.env.ARK_PARAMS_IN_PROMPT
check("reference nad strop se ořežou", (buildTaskBody({ ...req, references: Array.from({ length: 12 }, (_, i) => ({ url: `https://a/${i}.jpg`, role: "reference_image" as const })) }) as any).content.length === 1 + MAX_REFERENCES)
check("stav: succeeded + content.video_url", (() => { const s = parseTaskStatus({ status: "succeeded", content: { video_url: "https://v/x.mp4" }, usage: { completion_tokens: 123 } }); return s.status === "succeeded" && s.videoUrl === "https://v/x.mp4" && s.tokens === 123 })())
check("stav: failed nese chybu", (() => { const s = parseTaskStatus({ status: "failed", error: { code: "E1", message: "bad" } }); return s.status === "failed" && /E1 bad/.test(s.error || "") })())
check("stav: neznámý stav je running, ne úspěch", parseTaskStatus({ status: "whatever" }).status === "running" && parseTaskStatus({}).status === "running")
check("stav: queued/pending", parseTaskStatus({ status: "queued" }).status === "queued" && parseTaskStatus({ state: "pending" }).status === "queued")
check("stav: expired je konec, ne running (jinak se parkuje donekonečna)", (() => { const s = parseTaskStatus({ status: "expired", error: null }); return s.status === "failed" && /vypršela/.test(s.error || "") })())
// Marketingový název modelu ModelArk nezná — endpoint chce verzované ID (…-RRMMDD).
// Sazba visí na stejném řetězci, takže přejmenování jen na jednom místě nechá video neoceněné.
check("video model je verzované ID z ModelArk", /^dreamina-seedance-[a-z0-9-]+-\d{6}$/.test(getModel("video")), getModel("video"))
check("video model má sazbu @480p", costUsdForCall(videoUnitKey(getModel("video"), "480p"), { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, units: { kind: "seconds", n: 1 } }) !== null)

console.log("\n🎞️ KOMPOZICE\n")
const args = buildComposeArgs({ inputVideo: "/t/in.mp4", inputVoiceover: "/t/vo.wav", assPath: "/t/subs.ass", fontsDir: "/var/task/assets/fonts", hasVideoAudio: true, atempo: 1.1, durationSeconds: 8, output: "/t/out.mp4", voiceoverGainDb: 2, ambientLevel: 0.6 })
const fc = args[args.indexOf("-filter_complex") + 1]
check("kompozice: ass s fontsdir, ducking a mix", /ass='\/t\/subs\.ass':fontsdir='\/var\/task\/assets\/fonts'/.test(fc) && /sidechaincompress/.test(fc) && /amix=inputs=2/.test(fc) && /loudnorm/.test(fc))
check("kompozice: atempo jen když ≠ 1", /atempo=1\.100/.test(fc) && !/atempo/.test(buildComposeArgs({ inputVideo: "a", inputVoiceover: "b", fontsDir: "f", hasVideoAudio: true, atempo: 1, durationSeconds: 8, output: "o", voiceoverGainDb: 2, ambientLevel: 0.6 })[3]))
const silent = buildComposeArgs({ inputVideo: "a", inputVoiceover: "b", fontsDir: "f", hasVideoAudio: false, atempo: 1, durationSeconds: 8, output: "o", voiceoverGainDb: 2, ambientLevel: 0.6 })
check("kompozice: němé video nemapuje [0:a]", !silent.join(" ").includes("[0:a]") && silent.join(" ").includes("[1:a]"))
const noAudio = buildComposeArgs({ inputVideo: "a", fontsDir: "f", hasVideoAudio: false, atempo: 1, durationSeconds: 8, output: "o", voiceoverGainDb: 2, ambientLevel: 0.6 })
check("kompozice: bez zvuku vůbec → -an", noAudio.includes("-an"))
// Textový reel jde do ffmpegu BEZ voiceoveru: zvuk videa (hudba a atmosféra ze
// Seedance) je celá stopa — žádný sidechain, jen loudnorm, jinak by se ducking
// pokoušel stlačit hudbu pod řečí, která neexistuje.
const textCompose = buildComposeArgs({ inputVideo: "a", assPath: "/t/subs.ass", fontsDir: "f", hasVideoAudio: true, atempo: 1, durationSeconds: 8, output: "o", voiceoverGainDb: 2, ambientLevel: 1 })
const textFc = textCompose[textCompose.indexOf("-filter_complex") + 1]
check("kompozice textového reelu: titulky, loudnorm, žádný sidechain ani mix", /ass='\/t\/subs\.ass'/.test(textFc) && /loudnorm/.test(textFc) && !/sidechaincompress/.test(textFc) && !/amix/.test(textFc) && !/\[1:a\]/.test(textFc))
check("kompozice textového reelu: zvuk videa se mapuje a nejede -an", textCompose.includes("-map") && !textCompose.includes("-an"))
check("hlasitost atmosféry: pod řečí 0,6, bez řeči naplno", /volume=0\.60/.test(fc) && !/volume=1\.00/.test(textFc))
check("kompozice: délka, faststart, yuv420p", args.includes("-t") && args[args.indexOf("-t") + 1] === "8" && args.includes("+faststart") && args.includes("yuv420p"))
check("escapeFilterPath: dvojtečka i čárka", escapeFilterPath("C:/a,b") === "C\\:/a\\,b")

console.log("\n⏸️ ZNAČKY ODLOŽENÍ\n")
const pending = new VideoPendingError("cgt-1", "still running")
check("VideoPendingError nese taskId a pozná se", pending.taskId === "cgt-1" && isVideoPending(pending))
check("značka přežije zabalení do obyčejné chyby", isVideoPending(new Error(`wrapped: ${pending.message}`)))
check("video pending NENÍ nedostupná kvalita", !isQualityUnavailable(pending) && !isVideoPending(new QualityUnavailableError("x")))

// sharp je asynchronní a soubor běží jako CJS (bez top-level await) — reference proto na konci.
console.log("\n🗣️ ELEVENLABS: TVAR POŽADAVKU A SAZBA\n")
check("ID modelů z registru: v3 primární, Multilingual v2 fallback se stejným hlasem", getModel("ttsElevenlabs") === "eleven_v3" && getModel("ttsElevenlabs", "fallback") === "eleven_multilingual_v2")
check("v3 čte tagy přednesu — anglicky, v závorkách před textem; „clear“ je neutrál bez tagu", buildSpeechRequest("Dobrý den.", "eleven_v3", { tags: ["warm", "clear"] }).text === "[warmly] Dobrý den.")
check("Multilingual v2 by tagy vyslovil, proto je nedostane", buildSpeechRequest("Dobrý den.", "eleven_multilingual_v2", { tags: ["warm"] }).text === "Dobrý den.")
check("language_code se neposílá (v3 ani v2 ho neberou, jazyk poznají z textu)", !("language_code" in buildSpeechRequest("x", "eleven_v3", {})))
check("výstup pcm_24000 — stejná cesta jako Gemini, wavInfo/buildTimeline beze změny", ELEVENLABS_OUTPUT_FORMAT === "pcm_24000" && wavInfo(pcmToWav(Buffer.alloc(48_000), 24_000, 1, 16)).durationSeconds === 1)
const perThousandChars = (m: string) => costUsdForCall(m, { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, units: { kind: "characters", n: 1000 } })
check("sazba za znak pro oba modely (0,10 USD / 1 000 znaků) — bez ní by hlas reelu měřil nulu", near(perThousandChars("eleven_v3") ?? -1, 0.1, 1e-9) && near(perThousandChars("eleven_multilingual_v2") ?? -1, 0.1, 1e-9))

async function asyncChecks() {
    console.log("\n🖼️ REFERENCE PRO SEEDANCE\n")
    const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer()
    check("reference 192×192 (logo z živého testu) je pod minimem, 300×300 ani fotka ne", referenceTooSmall(192, 192) && !referenceTooSmall(300, 300) && !referenceTooSmall(1080, 1350))
    const logo = await upscaleReference(await solid(192, 192))
    const logoMeta = await sharp(logo.buffer).metadata()
    check("malé logo se zvětší na 512×512 a minimem projde", logo.width === 512 && logo.height === 512 && logoMeta.width === 512 && logoMeta.height === 512, `${logoMeta.width}×${logoMeta.height}`)
    const banner = await upscaleReference(await solid(1000, 100))
    const bannerMeta = await sharp(banner.buffer).metadata()
    check("úzký banner narazí na strop 2048 px a dostane průhledný okraj do 300 px", bannerMeta.width === 2048 && bannerMeta.height === 300 && !referenceTooSmall(bannerMeta.width, bannerMeta.height), `${bannerMeta.width}×${bannerMeta.height}`)
    check("orchestrátor zvětšuje malé reference před zadáním videa", /ensureReferenceSize\(/.test(orchestratorSrc) && /upscaleReference\(/.test(orchestratorSrc))
}

asyncChecks().then(() => {
    console.log(`\n${failed === 0 ? "✅" : "❌"} reel pipeline: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}, err => {
    console.error("❌ asynchronní kontroly spadly:", err)
    process.exit(1)
})
