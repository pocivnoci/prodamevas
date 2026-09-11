/**
 * Reelová pipeline — čisté kontroly (bez sítě, bez DB, bez ffmpegu).
 *   npx tsx scripts/test-reel-pipeline.ts
 *
 * Hlídá to, co se v reelu rozbije potichu: velikosti a ceny, časovou osu
 * z naměřené řeči, skládání voiceoveru, titulkové karty a ASS, validaci
 * storyboardu, tvar požadavku na ModelArk, argumenty kompozice a značku
 * „video ještě běží", která musí přežít zabalení do obyčejné chyby.
 */

import { MEDIA_CREDITS } from "../lib/credits"
import { REEL_MEDIA, REEL_LIMITS, isReelMedium, clampReelDuration, REEL_LABELS } from "../lib/reel-media"
import { parsePostMedia } from "../lib/media-urls"
import { applyFormatClamps } from "../instagram/format-clamps"
import { wavInfo, pcmToWav, buildTimeline, assembleVoiceoverWav, wordCount, WORDS_PER_SECOND } from "../instagram/reel-audio"
import { chunkForSubtitles, wrapWords, buildAss, assTime, escapeAssText } from "../instagram/reel-subtitles"
import { validateStoryboard, parseStoryboard, finalizeVideoPrompt, buildReelDirectorPrompt, type ReelStoryboard } from "../instagram/reel-storyboard"
import { buildTaskBody, parseTaskStatus, MAX_REFERENCES } from "../instagram/seedance-client"
import { buildComposeArgs, escapeFilterPath } from "../instagram/reel-compositor"
import { VideoPendingError, isVideoPending, QualityUnavailableError, isQualityUnavailable } from "../utils/retry"
import { videoUnitKey, costUsdForCall } from "../lib/model-pricing"
import { getModel } from "../instagram/models"

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
check("slova za vteřinu ~2,3 a wordCount počítá slova", WORDS_PER_SECOND === 2.3 && wordCount(["Ahoj světe", "tři slova tady"]) === 5)

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
check("kompozice: délka, faststart, yuv420p", args.includes("-t") && args[args.indexOf("-t") + 1] === "8" && args.includes("+faststart") && args.includes("yuv420p"))
check("escapeFilterPath: dvojtečka i čárka", escapeFilterPath("C:/a,b") === "C\\:/a\\,b")

console.log("\n⏸️ ZNAČKY ODLOŽENÍ\n")
const pending = new VideoPendingError("cgt-1", "still running")
check("VideoPendingError nese taskId a pozná se", pending.taskId === "cgt-1" && isVideoPending(pending))
check("značka přežije zabalení do obyčejné chyby", isVideoPending(new Error(`wrapped: ${pending.message}`)))
check("video pending NENÍ nedostupná kvalita", !isQualityUnavailable(pending) && !isVideoPending(new QualityUnavailableError("x")))

console.log(`\n${failed === 0 ? "✅" : "❌"} reel pipeline: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
