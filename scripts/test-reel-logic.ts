/**
 * Reel pipeline math — pure-function checks (no DB, no network, no ffmpeg run).
 *   npx tsx scripts/test-reel-logic.ts
 *
 * Covers the parts that fail silently in production: clip planning, subtitle
 * timing/wrapping/escaping, WAV header math, duration-aware credits, media-URL
 * parsing (the "video|cover" vs carousel-slides ambiguity).
 */

import {
    pcmToWav,
    wavDurationSec,
    scenesToSubtitles,
    wrapSubtitleText,
    escapeDrawtext,
    buildSubtitleFilters,
    planClips,
    groupScenesIntoClips,
} from "../instagram/video-processor"
import { creditsForReel, creditsForMedia, REEL_ALLOWED_DURATIONS } from "../lib/credits"
import { parsePostMedia } from "../lib/media-urls"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

function eq<T>(name: string, actual: T, expected: T) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    check(name, a === e, `expected ${e}, got ${a}`)
}

console.log("\n🎬 REEL LOGIC\n")

// ── planClips ──
console.log("planClips:")
eq("8s → single clip", planClips(8), [8])
eq("5s → single clip", planClips(5), [5])
eq("16s → two 8s clips", planClips(16), [8, 8])
eq("24s → three 8s clips", planClips(24), [8, 8, 8])
eq("20s → even split within 5-8", planClips(20), [7, 7, 6])
eq("garbage → default 8", planClips(0), [8])
eq("tiny → clamped to 5", planClips(2), [5])
check("every plan sums to input for allowed durations",
    REEL_ALLOWED_DURATIONS.every(d => planClips(d).reduce((a, b) => a + b, 0) === d))
check("every clip within 5-8s for allowed durations",
    REEL_ALLOWED_DURATIONS.every(d => planClips(d).every(c => c >= 5 && c <= 8)))

// ── groupScenesIntoClips ──
console.log("\ngroupScenesIntoClips:")
{
    const scenes = [
        { timeRange: "0-3s", id: "a" },
        { timeRange: "3-8s", id: "b" },
        { timeRange: "8-12s", id: "c" },
        { timeRange: "12-16s", id: "d" },
    ]
    const groups = groupScenesIntoClips(scenes, [8, 8])
    eq("scenes split by timeline midpoint",
        groups.map(g => g.scenes.map(s => s.id)), [["a", "b"], ["c", "d"]])
    eq("clip offsets cumulative", groups.map(g => g.startSec), [0, 8])
}
{
    // All scenes land in clip 1 → clip 2 must steal one.
    const scenes = [
        { timeRange: "0-2s", id: "a" },
        { timeRange: "2-4s", id: "b" },
        { timeRange: "4-6s", id: "c" },
    ]
    const groups = groupScenesIntoClips(scenes, [8, 8])
    check("no clip left empty", groups.every(g => g.scenes.length > 0),
        JSON.stringify(groups.map(g => g.scenes.length)))
    eq("stealing takes the boundary-nearest scene",
        groups.map(g => g.scenes.map(s => s.id)), [["a", "b"], ["c"]])
}
{
    const scenes = [{ timeRange: "celý reel", id: "a" }, { timeRange: "???", id: "b" }]
    const groups = groupScenesIntoClips(scenes, [8, 8])
    check("malformed timeRanges distribute proportionally, none empty",
        groups.every(g => g.scenes.length === 1))
}

// ── scenesToSubtitles ──
console.log("\nscenesToSubtitles:")
{
    const subs = scenesToSubtitles([
        { timeRange: "0-2s", narration: "Ahoj" },
        { timeRange: "2-5.5s", narration: "Světe" },
        { timeRange: "5.5-8s" },                       // no narration → dropped
        { timeRange: "nesmysl", narration: "X" },      // malformed → dropped
        { timeRange: "5-3s", narration: "Y" },         // end <= start → dropped
    ])
    eq("valid narrated scenes only", subs.map(s => s.text), ["Ahoj", "Světe"])
    eq("decimal seconds parsed", subs[1].startTime, 2)
    eq("decimal end parsed", subs[1].endTime, 5.5)
}

// ── wrapSubtitleText ──
console.log("\nwrapSubtitleText:")
eq("short text = one line", wrapSubtitleText("Krátký titulek"), ["Krátký titulek"])
eq("wraps at word boundary",
    wrapSubtitleText("Tohle je delší věta která se zalomí", 22, 2),
    ["Tohle je delší věta", "která se zalomí"])
{
    const lines = wrapSubtitleText("jedna dva tři čtyři pět šest sedm osm devět deset", 10, 2)
    check("respects maxLines by merging overflow", lines.length === 2, JSON.stringify(lines))
    check("no words lost on overflow", lines.join(" ").split(" ").length === 10)
}
eq("empty input → no lines", wrapSubtitleText("   "), [])
{
    const longWord = "nejneobhospodařovávatelnějšímu"
    eq("single overlong word survives unbroken", wrapSubtitleText(longWord, 10, 2), [longWord])
}

// ── escapeDrawtext ──
console.log("\nescapeDrawtext:")
eq("apostrophe double-escaped", escapeDrawtext("don't"), "don\\\\\\'t")
eq("colon escaped", escapeDrawtext("Pozor: sleva"), "Pozor\\\\: sleva")
eq("comma escaped once (graph level)", escapeDrawtext("jedna, dva"), "jedna\\, dva")
eq("backslash quadrupled", escapeDrawtext("a\\b"), "a\\\\\\\\b")
eq("brackets escaped", escapeDrawtext("[tag]"), "\\[tag\\]")
eq("semicolon escaped", escapeDrawtext("a;b"), "a\\;b")
eq("plain czech text untouched", escapeDrawtext("Příliš žluťoučký kůň"), "Příliš žluťoučký kůň")

// ── buildSubtitleFilters ──
console.log("\nbuildSubtitleFilters:")
{
    const filters = buildSubtitleFilters(
        [{ startTime: 0, endTime: 2, text: "Ahoj, světe: tady" }],
        "/task/fonts/Inter-Bold.ttf"
    )
    check("one filter per rendered line", filters.length === 1)
    check("expansion disabled (literal % safe)", filters[0].includes("expansion=none"))
    check("enable window with escaped commas", filters[0].includes("enable=between(t\\,0.00\\,2.00)"))
    check("text escaped inside filter", filters[0].includes("Ahoj\\, světe\\\\: tady"))
    const two = buildSubtitleFilters(
        [{ startTime: 1, endTime: 3, text: "Tohle je delší věta která se zalomí" }],
        "/f.ttf"
    )
    check("two lines → two stacked drawtexts", two.length === 2)
    check("second line offset below first",
        /y=1470/.test(two[0]) && /y=1546/.test(two[1]))
}

// ── pcmToWav / wavDurationSec ──
console.log("\npcmToWav / wavDurationSec:")
{
    const oneSecond = Buffer.alloc(24000 * 2) // 1s of 16-bit mono @ 24kHz
    const wav = pcmToWav(oneSecond)
    eq("RIFF magic", wav.toString("ascii", 0, 4), "RIFF")
    eq("WAVE format", wav.toString("ascii", 8, 12), "WAVE")
    eq("header is 44 bytes", wav.length, 44 + oneSecond.length)
    eq("sample rate in header", wav.readUInt32LE(24), 24000)
    eq("roundtrip duration 1s", wavDurationSec(wav), 1)
    const twoSec48k = pcmToWav(Buffer.alloc(48000 * 2 * 2), { sampleRate: 48000 })
    eq("custom sample rate roundtrip", wavDurationSec(twoSec48k), 2)
    eq("malformed buffer → 0", wavDurationSec(Buffer.from("not a wav file at all")), 0)
    eq("empty buffer → 0", wavDurationSec(Buffer.alloc(0)), 0)
}

// ── creditsForReel / creditsForMedia ──
console.log("\ncredits:")
eq("8s reel = base 5", creditsForReel(8), 5)
eq("5s reel = base 5", creditsForReel(5), 5)
eq("16s reel = 9", creditsForReel(16), 9)
eq("24s reel = 13", creditsForReel(24), 13)
eq("missing duration = base", creditsForReel(undefined), 5)
eq("garbage duration = base", creditsForReel(NaN), 5)
eq("creditsForMedia reel w/ duration", creditsForMedia("reel", 16), 9)
eq("creditsForMedia reel legacy call", creditsForMedia("reel"), 5)
eq("creditsForMedia carousel ignores duration", creditsForMedia("carousel", 16), 3)
eq("creditsForMedia unknown = image", creditsForMedia("whatever"), 1)

// ── parsePostMedia ──
console.log("\nparsePostMedia:")
{
    const reel = parsePostMedia("https://x/v.mp4|https://x/c.webp", "reel")
    eq("reel kind", reel.kind, "reel")
    eq("reel video url", reel.videoUrl, "https://x/v.mp4")
    eq("reel cover url", reel.coverUrl, "https://x/c.webp")
    eq("reel thumb = cover, never mp4", reel.thumbUrl, "https://x/c.webp")
    eq("reel slideCount 0", reel.slideCount, 0)

    const coverless = parsePostMedia("https://x/v.mp4", "reel")
    eq("coverless reel thumb null", coverless.thumbUrl, null)
    eq("coverless reel keeps video", coverless.videoUrl, "https://x/v.mp4")

    const carousel = parsePostMedia("https://x/1.png|https://x/2.png|https://x/3.png", "carousel")
    eq("carousel kind", carousel.kind, "carousel")
    eq("carousel slides", carousel.slideCount, 3)
    eq("carousel thumb = first slide", carousel.thumbUrl, "https://x/1.png")

    const legacy = parsePostMedia("https://x/1.png|https://x/2.png", null)
    eq("legacy pipe without media_type → carousel", legacy.kind, "carousel")

    const image = parsePostMedia("https://x/1.png", "image")
    eq("image kind", image.kind, "image")
    eq("image thumb", image.thumbUrl, "https://x/1.png")

    const empty = parsePostMedia(null, "reel")
    eq("null url → no video, no thumb", [empty.videoUrl, empty.thumbUrl], [undefined, null])
    eq("empty string → image kind, empty urls", parsePostMedia("", null).urls, [])
}

console.log(`\n${"─".repeat(40)}\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
