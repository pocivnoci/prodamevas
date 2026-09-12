/**
 * Reel Orchestrator — audio-first video pipeline
 * ==============================================
 * narrace (scenárista) → TTS po větách + měření → časová osa → režisér (Claude:
 * storyboard + prompt) → voiceover stopa do bucketu → CHECKPOINT → Seedance
 * (ModelArk, async) → CHECKPOINT s taskId → polling v rozpočtu lambdy → stažení
 * → kompozice (ffmpeg: ducking + ASS titulky) → upload → native cover.
 *
 * Proč v tomhle pořadí: délku videa určuje NAMLUVENÝ text, ne naopak. Titulky
 * i střihy tak sedí na skutečnou řeč a TTS, které nejde, zastaví reel dřív, než
 * se za video zaplatí. Dvě uložení checkpointu znamenají, že pád lambdy nebo
 * vyčerpaný rozpočet („video ještě renderuje") nikdy nezadá video podruhé —
 * `VideoPendingError` job zaparkuje a resume dopolluje.
 *
 * Textový reel (`captionData.reelMode === "text"`) jde touž cestou, jen bez zvuku:
 * osu staví ČTECÍ tempo karet (`reel-text-timeline.ts`), TTS se nevolá vůbec,
 * hudbu a atmosféru dodá rovnou Seedance a karty vypaluje týž ASS engine.
 *
 * Nic se tu nepolyká: selhání videa, kompozice nebo uploadu je selhání jobu
 * (refund), nedostupná kvalita (TTS, Pro ladder, přetížené Seedance) parkuje.
 * Reel za 5–10 kreditů bez voiceoveru a titulků není dodávka.
 */

import supabaseAdmin from "../../supabase/admin"
import { generateImage } from "../gemini-client"
import { pickBrandPhotos } from "../brand-photo-match"
import { getConfigBrandImageObjects } from "../configs/types"
import { COSTS, getPostTypeDef } from "../caption-generator"
import { getModel } from "../models"
import { REEL_LIMITS, REEL_TIMELINE, isReelMedium, narrationWordBudget, type ReelMode } from "../../lib/reel-media"
import { RENDER_BUDGET_MS, MAX_VIDEO_POLL_ROUNDS } from "../../lib/job-park"
import { VideoPendingError } from "../../utils/retry"
import { seedanceEnabled, submitVideoTask, pollVideoTask, downloadVideo, MAX_REFERENCES, type SeedanceReference } from "../seedance-client"
import { directReel, condenseNarration, finalizeVideoPrompt, type ReelReference } from "../reel-director"
import { synthesizeNarration, buildTimeline, assembleVoiceoverWav, wordCount, type TimedLine } from "../reel-audio"
import { buildTextTimeline, textCardWordBudget } from "../reel-text-timeline"
import { deliveryTags } from "../tts"
import { referenceTooSmall, upscaleReference } from "../reel-references"
import sharp from "sharp"
import { createHash } from "crypto"
import { chunkForSubtitles, buildAss, resolveSubtitleStyle } from "../reel-subtitles"
import { CLIENT_BUCKET_SIZE_LIMIT } from "../../lib/storage-buckets"
import type { ReelVideoSource } from "../../lib/types/database"
import { composeReel } from "../reel-compositor"
import { loadLogo } from "../logo-loader"
import type { RenderContext, RenderResult, VideoCheckpoint } from "./types"
import { rethrowIfQualityUnavailable } from "./types"
import { contentLanguage, exactTextRule } from "../language"

const RESOLUTION = "480p" as const
/** Hlasitost zvuku ze Seedance v textovém reelu. Pod voiceoverem jede atmosféra na
 *  0,6, aby nepřebíjela řeč; bez řeči je hudba celý zvuk a jede naplno. */
const TEXT_AMBIENT_LEVEL = 1
/** Rezerva za pollingem na stažení, kompozici, upload a cover. */
const POST_VIDEO_RESERVE_MS = 120_000
const MIN_POLL_BUDGET_MS = 15_000
const FETCH_TIMEOUT_MS = 20_000

export async function renderReel(ctx: RenderContext): Promise<RenderResult> {
    const { config, captionData, format, selectedType, report } = ctx
    if (!isReelMedium(format.medium)) throw new Error(`renderReel: médium ${format.medium} není reel`)
    if (!seedanceEnabled()) {
        throw new Error("Reel nejde vyrobit: chybí ARK_API_KEY (Seedance přes BytePlus ModelArk). Nastav klíč, nebo vypni REELS_ENABLED.")
    }

    const medium = format.medium
    const limits = REEL_LIMITS[medium]
    const model = getModel("video")
    const bucket = config.storageBucket || "audit-screenshots"
    const deadlineAt = ctx.deadlineAt ?? Date.now() + RENDER_BUDGET_MS
    let cost = 0
    let vc: VideoCheckpoint | undefined = ctx.videoCheckpoint
    // Režim rozhoduje o TTS, o promptu pro Seedance i o kompozici, takže se čte
    // JEDNOU a z checkpointu přednostně: resume nesmí přepnout režim uprostřed
    // reelu (voiceover WAV by pak chyběl, nebo by se platil podruhé).
    const reelMode: ReelMode = vc?.mode ?? (captionData.reelMode === "text" ? "text" : "voiceover")

    if (vc) {
        cost += vc.costUsd
        console.log(`♻️ Reel: navazuji z video checkpointu (${vc.taskId ? `úloha ${vc.taskId}, kolo ${vc.pollRounds}` : "před zadáním videa"}, ${vc.durationSeconds}s)`)
        await report("video", 50, vc.taskId ? "♻️ Navazuji na běžící render videa…" : "♻️ Navazuji — zadávám video…")
    } else {
        // ── 1. Věty: narrace (voiceover), nebo textové karty (text) ──
        // Obojí prošlo kritikem, redakcí i faktickou bránou — textový režim není
        // obchvat bran, jen jiný způsob doručení téže věty (`scriptToScenes`).
        const sceneLines = (captionData.scenes ?? []).map(s => (s.narration || "").trim()).filter(Boolean)
        // Hook do obrazu je v textovém reelu PRVNÍ karta: v prvních 1,5 s není co
        // slyšet, takže když nic nesvítí, divák neví, o čem video je.
        const hookCard = (captionData.onScreenHook || "").trim()
        const lines = reelMode === "text" && hookCard && hookCard !== sceneLines[0]
            ? [hookCard, ...sceneLines]
            : sceneLines
        if (lines.length === 0) {
            throw new Error(reelMode === "text"
                ? "Textový reel bez jediné karty — scenárista nevrátil žádný text na obraz"
                : "Reel bez narrace — copywriter nevrátil žádnou větu k namluvení")
        }

        // ── 2. Časová osa: z naměřené řeči, nebo ze čtecího tempa karet ──
        const prepared = reelMode === "text"
            ? await prepareTextTimeline(lines, limits, report, contentLanguage(ctx.config).code)
            : await prepareVoiceoverTimeline(ctx, lines, limits, report)
        cost += prepared.cost
        const durationSeconds = prepared.durationSeconds

        // ── 3. Reference: brandové fotky + produkt + logo ──
        const references = await loadReelReferences(ctx)
        console.log(`   📸 Reference: ${references.map(r => `${r.index}:${r.kind}`).join(", ") || "žádné"}`)

        // ── 4. Režisér: storyboard zarovnaný na osu + prompt pro Seedance ──
        await report("video", 48, "🎬 Režisér skládá storyboard…")
        const typeDef = getPostTypeDef(config, selectedType.name)
        const textOnly = reelMode === "text"
        const { storyboard } = await directReel({
            config, clientId: ctx.clientUuid, medium, durationSeconds,
            hook: captionData.hook, narration: prepared.timeline, scenes: captionData.scenes,
            cta: captionData.cta, postType: selectedType.name, typeDef,
            ctaPolicy: ctx.ctaPolicy, selectedProduct: ctx.selectedProduct, references, textOnly,
        })
        cost += COSTS.reelDirector
        const videoPrompt = finalizeVideoPrompt(storyboard, { durationSeconds, ctaPolicy: ctx.ctaPolicy, textOnly })

        // ── 5. Voiceover stopa do bucketu — přežije parkování jobu ──
        let voiceoverPath: string | undefined
        if (prepared.voiceoverWav) {
            voiceoverPath = `ig-reels/${Date.now()}-vo.wav`
            await uploadToBucket(bucket, voiceoverPath, prepared.voiceoverWav, "audio/wav")
        }

        vc = {
            provider: "seedance", model, resolution: RESOLUTION, durationSeconds, atempo: prepared.atempo,
            timeline: prepared.timeline, storyboard, videoPrompt,
            referenceUrls: references.map(r => r.url),
            mode: reelMode,
            ...(voiceoverPath ? { voiceoverBucket: bucket, voiceoverPath } : {}),
            pollRounds: 0, costUsd: cost,
        }
        await ctx.saveVideoCheckpoint?.(vc)
    }

    // ── 6. Zadání videa (poprvé, nebo resume po pádu mezi TTS a zadáním) ──
    if (!vc.taskId) {
        await report("video", 52, `🎬 Zadávám ${vc.durationSeconds}s video (Seedance)…`)
        const { taskId } = await submitVideoTask({
            model: vc.model,
            prompt: vc.videoPrompt,
            references: vc.referenceUrls.slice(0, MAX_REFERENCES).map((url): SeedanceReference => ({ url, role: "reference_image" })),
            durationSeconds: vc.durationSeconds,
            resolution: vc.resolution,
            ratio: "9:16",
            generateAudio: true,
        })
        cost += COSTS.videoPerSecond * vc.durationSeconds
        vc = { ...vc, taskId, submittedAt: new Date().toISOString(), costUsd: cost }
        await ctx.saveVideoCheckpoint?.(vc)
    }
    const taskId = vc.taskId
    if (!taskId) throw new Error("renderReel: po zadání videa chybí taskId")

    // ── 7. Polling v rozpočtu lambdy — po vyčerpání se job zaparkuje, ne zabije ──
    const budgetMs = Math.max(MIN_POLL_BUDGET_MS, deadlineAt - Date.now() - POST_VIDEO_RESERVE_MS)
    await report("video", 55, `🎬 Seedance renderuje ${vc.durationSeconds}s video…`)
    console.log(`   ⏳ Polling úlohy ${taskId} (rozpočet ${Math.round(budgetMs / 1000)} s)…`)
    const polled = await pollVideoTask(taskId, {
        budgetMs,
        onTick: async (ms, st) => {
            // Každý tick = heartbeat ig_jobs.updated_at (reaper) i lease kampaně (worker).
            await report("video", Math.min(75, 55 + Math.floor(ms / 15_000)), `🎬 Seedance renderuje ${vc!.durationSeconds}s video… (${st}, ${Math.round(ms / 1000)} s)`)
        },
    })
    if (polled.status === "failed") {
        throw new Error(`Seedance selhalo (úloha ${taskId}): ${polled.error}`)
    }
    if (polled.status === "pending") {
        const rounds = vc.pollRounds + 1
        if (rounds >= MAX_VIDEO_POLL_ROUNDS) {
            throw new Error(`Seedance úloha ${taskId} nedoběhla ani po ${rounds} kolech (stav ${polled.lastStatus}) — zásek u poskytovatele`)
        }
        await ctx.saveVideoCheckpoint?.({ ...vc, pollRounds: rounds })
        throw new VideoPendingError(taskId, `úloha ${taskId} je ${polled.lastStatus} po ${Math.round(polled.elapsedMs / 1000)} s, kolo ${rounds}/${MAX_VIDEO_POLL_ROUNDS}`)
    }

    // ── 8. Stažení + voiceover z bucketu ──
    await report("video", 78, "📥 Stahuji video…")
    const rawVideo = await downloadVideo(polled.videoUrl)
    console.log(`   ✓ Video staženo (${(rawVideo.length / 1024 / 1024).toFixed(1)} MB)`)
    const voiceoverWav = vc.voiceoverPath
        ? await downloadFromBucket(vc.voiceoverBucket || bucket, vc.voiceoverPath)
        : undefined

    // ── 9. Kompozice: ducking + ASS titulky ──
    await report("video", 82, voiceoverWav ? "🎞️ Skládám video, voiceover a titulky…" : "🎞️ Vypaluji textové karty do videa…")
    // Styl titulků patří ZNAČCE, ne enginu: `buildAss` override uměl od začátku,
    // ale nikdo mu ho nedával, takže každý reel každého klienta vypadal stejně.
    // Textový reel má jiný výchozí preset (`cards`) — karta tam nese sdělení, ne
    // doprovod řeči.
    const subtitles = resolveSubtitleStyle(config, { reelMode })
    const cards = chunkForSubtitles(vc.timeline, subtitles.chunkOpts)
    const ass = buildAss(cards, subtitles.assStyle)
    let finalVideo: Buffer
    try {
        finalVideo = await composeReel({
            videoBuffer: rawVideo, voiceoverWav, ass, atempo: vc.atempo, durationSeconds: vc.durationSeconds,
            // Bez řeči není co potlačovat: hudba a atmosféra ze Seedance jsou celá
            // stopa a jedou naplno, místo 0,6 pod voiceoverem.
            ...(voiceoverWav ? {} : { ambientLevel: TEXT_AMBIENT_LEVEL }),
        })
    } catch (composeErr) {
        // Tvrdé selhání — reel bez titulků a voiceoveru se nedodává. Ale ať je v Sentry
        // vidět, že padla KOMPOZICE, ne model (jiná oprava, jiný člověk).
        await captureReelError(composeErr, "compose", ctx, { taskId, cards: cards.length })
        throw composeErr
    }
    console.log(`   ✓ Kompozice hotová (${(finalVideo.length / 1024 / 1024).toFixed(1)} MB, ${cards.length} titulkových karet)`)

    // ── 10. Upload ──
    await report("video", 88, "📤 Nahrávám video…")
    const ts = Date.now()
    const videoUrl = await uploadToBucket(bucket, `ig-reels/${ts}.mp4`, finalVideo, "video/mp4")
    console.log(`   ✓ Video URL: ${videoUrl}`)

    // ── 10b. Zdrojové artefakty pro pozdější přerenderování titulků ──
    // Titulky jsou vypálené (IG u reelu titulkovou stopu nebere), takže oprava
    // překlepu = složit kompozici znovu. Bez surového videa a voiceoveru by to
    // stálo celý reel znovu (5–10 kreditů) a vrátilo JINÉ video — proto se surové
    // MP4 ukládá a voiceover se už NEMAŽE. Dohromady ~2× velikost hotového reelu,
    // u 480p jednotky MB.
    let rawVideoPath: string | undefined
    if (rawVideo.length <= CLIENT_BUCKET_SIZE_LIMIT) {
        try {
            rawVideoPath = `ig-reels/${ts}-raw.mp4`
            await uploadToBucket(bucket, rawVideoPath, rawVideo, "video/mp4")
        } catch (rawErr) {
            // Reel je hotový a nahraný — neuložený zdroj je ztráta pohodlí, ne dodávky.
            // Ale musí to být vidět: bez něj se titulky editovat nedají (CLAUDE.md).
            rawVideoPath = undefined
            console.warn(`   ⚠️ Surové video se neuložilo (${String((rawErr as Error)?.message || rawErr).substring(0, 120)}) — titulky u tohohle reelu půjdou změnit jen přegenerováním`)
        }
    } else {
        console.warn(`   ⚠️ Surové video má ${(rawVideo.length / 1024 / 1024).toFixed(1)} MB a nevejde se do kvóty bucketu (${CLIENT_BUCKET_SIZE_LIMIT / 1024 / 1024} MB) — titulky u tohohle reelu půjdou změnit jen přegenerováním`)
    }
    const videoSource: ReelVideoSource = {
        bucket,
        rawVideoPath,
        // Textový reel voiceover nemá — `null` by rekompozici říkalo „chybí zdroj",
        // proto se pole rovnou vynechává a pravdu o něm nese `mode`.
        ...(vc.voiceoverPath ? { voiceoverPath: vc.voiceoverPath } : {}),
        ...(vc.voiceoverPath && vc.voiceoverBucket && vc.voiceoverBucket !== bucket ? { voiceoverBucket: vc.voiceoverBucket } : {}),
        timeline: vc.timeline.map(l => ({ text: l.text, start: l.start, end: l.end })),
        cards: cards.map(c => ({ text: c.lines.join(" "), start: c.start, end: c.end })),
        atempo: vc.atempo,
        durationSeconds: vc.durationSeconds,
        subtitleStyle: subtitles.style,
        storyboard: vc.storyboard,
        mode: reelMode,
    }

    // ── 11. Cover pro mřížku (native, s hookem) ──
    await report("video", 92, "🖼️ Generuji cover…")
    let coverUrl: string | undefined
    try {
        const coverScene = vc.storyboard.coverScene || captionData.scenes?.[0]?.visual || captionData.hook
        let coverBuffer: Buffer | undefined
        try {
            coverBuffer = await renderNativeReelCover(ctx, coverScene)
            cost += COSTS.designerBrief + COSTS.imageQA
        } catch (nativeErr) {
            rethrowIfQualityUnavailable(nativeErr, "reel-cover")
            console.warn(`   ⚠️ Native cover failed: ${String((nativeErr as Error)?.message || nativeErr).substring(0, 80)} — fallback na text-free cover`)
        }
        if (!coverBuffer) {
            // Náhradní cover je BEZ HOOKU — v mřížce neprodává, jen ilustruje. Degradace
            // musí být vidět (CLAUDE.md: kvalita se nedegraduje potichu).
            console.warn("   ⚠️ Cover bez hooku — návrhový cover neprošel kontrolou, jedu text-free náhradu")
            coverBuffer = await generateImage(`Instagram Reel cover image, 9:16 vertical. Scene: ${coverScene}. Style: ${config.feedAesthetic?.feel || "modern, professional"}. NO TEXT in image.`, { aspectRatio: "9:16" })
        }
        coverUrl = await uploadToBucket(bucket, `ig-reels/${ts}-cover.webp`, coverBuffer, "image/webp")
        cost += COSTS.imageGeneration
        console.log(`   ✓ Cover: ${coverUrl}`)
    } catch (coverErr) {
        rethrowIfQualityUnavailable(coverErr, "reel-cover")
        console.warn("   ⚠️ Cover generation failed:", coverErr)
    }

    return {
        imageUrl: coverUrl ? `${videoUrl}|${coverUrl}` : videoUrl,
        cost,
        imageStyle: `seedance:${vc.model}@${vc.resolution}`,
        imageModel: vc.model,
        videoSource,
    }
}

// ─── Časová osa ─────────────────────────────────────────────────────────────

interface PreparedTimeline {
    /** Věty po případném zkrácení. */
    lines: string[]
    /** Věty s časy, jak zazní/se ukážou ve videu. */
    timeline: TimedLine[]
    durationSeconds: number
    atempo: number
    /** USD utracené za tuhle fázi (TTS a případná kola zkracování). */
    cost: number
    /** Složená voiceover stopa; textový reel žádnou nemá. */
    voiceoverWav?: Buffer
}

/**
 * Mluvený reel: TTS po větách → naměřené délky → osa. Když se řeč nevejde ani se
 * zrychlením, text se zkrátí a namluví znovu (nejvýš dvakrát) — cíl se počítá
 * z NAMĚŘENÉHO tempa hlasu a z času, který na řeč zbude po nájezdu, mezerách a
 * dojezdu; `délka × 2,3 slova/s` sliboval o třetinu víc řeči a obě velikosti
 * reelu na tom padaly.
 */
async function prepareVoiceoverTimeline(
    ctx: RenderContext,
    initialLines: string[],
    limits: { minSeconds: number; maxSeconds: number },
    report: RenderContext["report"],
): Promise<PreparedTimeline> {
    const { config, captionData } = ctx
    // Hlas značky je v configu (casting ve `validateConfig()`), ne tady — jediný
    // sdílený preset „Kore" byl nejčastější stížnost na reely. Přednes se odvozuje
    // z nálad scén přes `deliveryTags()`: `scenes[].mood` popisuje SVĚTLO, takže
    // se z něj bere jen to, co dává smysl hlasu (dřív se posílalo celé, i s
    // natvrdo předřazeným „professional" pro všechny).
    const voice = config.voice
    if (!voice?.voiceId) throw new Error("Reel bez hlasu značky: config.voice doplňuje validateConfig() — tenhle config přišel mimo loadConfig()")
    const ttsOpts = {
        provider: voice.provider,
        voiceId: voice.voiceId,
        style: voice.style,
        tags: deliveryTags((captionData.scenes || []).map(s => s.mood)),
    }

    let lines = initialLines
    let cost = 0
    await report("video", 40, `🎙️ Namlouvám narraci (${lines.length} vět)…`)
    console.log(`🎙️ TTS po větách (${lines.length}) — délka videa se odvodí z řeči…`)
    const language = contentLanguage(config).code
    let tts = await synthesizeNarration(lines, ttsOpts, language)
    cost += COSTS.ttsVoiceover
    let timeline = buildTimeline(lines, tts.durations, limits)
    const maxCondenseRounds = 2
    for (let round = 1; timeline.tooLong && round <= maxCondenseRounds; round++) {
        const maxWords = narrationWordBudget({
            words: wordCount(lines),
            speechSeconds: tts.durations.reduce((a, b) => a + b, 0),
            sentences: lines.length,
            maxSeconds: limits.maxSeconds,
        })
        console.log(`   ✂️ Narrace ${timeline.totalSeconds.toFixed(1)}s > strop ${limits.maxSeconds}s — zkracuji na ~${maxWords} slov (kolo ${round}/${maxCondenseRounds})`)
        await report("video", 44, "✂️ Narrace je delší než strop reelu — zkracuji…")
        lines = await condenseNarration(lines, maxWords, language)
        cost += COSTS.reelDirector / 2
        tts = await synthesizeNarration(lines, ttsOpts, language)
        cost += COSTS.ttsVoiceover
        timeline = buildTimeline(lines, tts.durations, limits, { maxTempo: REEL_TIMELINE.condensedMaxTempo })
    }
    if (timeline.tooLong) {
        throw new Error(`Narrace se do ${limits.maxSeconds}s nevejde ani po zkrácení (${timeline.totalSeconds.toFixed(1)}s) — reel neuseknu uprostřed CTA`)
    }
    const durationSeconds = timeline.durationSeconds
    console.log(`   ✓ Osa: ${lines.length} vět, řeč do ${timeline.totalSeconds.toFixed(1)}s, video ${durationSeconds}s${timeline.atempo !== 1 ? `, tempo ×${timeline.atempo}` : ""}`)

    return {
        lines,
        timeline: timeline.lines,
        durationSeconds,
        atempo: timeline.atempo,
        cost,
        voiceoverWav: assembleVoiceoverWav(tts.clips, timeline.placements, durationSeconds * timeline.atempo),
    }
}

/**
 * Textový reel: žádné TTS, žádný voiceover, žádný `COSTS.ttsVoiceover`. Osa se
 * počítá ze čtecího tempa karet (`buildTextTimeline`) a délku videa určuje ona,
 * stejně jako u řeči. Když se karty nevejdou, zkracuje se text (nejvýš dvakrát) —
 * zrychlit čtení nejde.
 *
 * Tahle větev je záměrně samostatná funkce: „textový režim nevolá TTS" je aserce
 * v `scripts/test-reel-pipeline.ts` nad jejím TĚLEM, ne nad celým souborem.
 */
async function prepareTextTimeline(
    initialCards: string[],
    limits: { minSeconds: number; maxSeconds: number },
    report: RenderContext["report"],
    language: ReturnType<typeof contentLanguage>["code"],
): Promise<PreparedTimeline> {
    let lines = initialCards
    let cost = 0
    await report("video", 40, `🪧 Skládám osu z ${lines.length} textových karet (bez hlasu)…`)
    console.log(`🪧 Textový reel — osa ze čtecího tempa (${lines.length} karet), žádné TTS…`)
    let timeline = buildTextTimeline(lines, limits)
    const maxCondenseRounds = 2
    for (let round = 1; timeline.tooLong && round <= maxCondenseRounds; round++) {
        const maxWords = textCardWordBudget({ words: wordCount(lines), cards: lines.length, maxSeconds: limits.maxSeconds })
        console.log(`   ✂️ Karty ${timeline.totalSeconds.toFixed(1)}s > strop ${limits.maxSeconds}s — zkracuji na ~${maxWords} slov (kolo ${round}/${maxCondenseRounds})`)
        await report("video", 44, "✂️ Textu je na reel moc — zkracuji karty…")
        lines = await condenseNarration(lines, maxWords, language)
        cost += COSTS.reelDirector / 2
        timeline = buildTextTimeline(lines, limits)
    }
    if (timeline.tooLong) {
        throw new Error(`Textové karty se do ${limits.maxSeconds}s nevejdou ani po zkrácení (${timeline.totalSeconds.toFixed(1)}s) — reel neuseknu uprostřed CTA`)
    }
    console.log(`   ✓ Osa: ${lines.length} karet do ${timeline.totalSeconds.toFixed(1)}s, video ${timeline.durationSeconds}s`)
    return {
        lines,
        timeline: timeline.lines,
        durationSeconds: timeline.durationSeconds,
        atempo: 1,
        cost,
    }
}

// ─── Reference (fotky značky, produkt, logo) ────────────────────────────────

async function fetchImage(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
        const resp = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t))
        if (!resp.ok) return null
        const mimeType = resp.headers.get("content-type")?.split(";")[0] || (url.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg")
        return { buffer: Buffer.from(await resp.arrayBuffer()), mimeType }
    } catch {
        return null
    }
}

/**
 * Očíslované reference pro režiséra (vidí je) i pro Seedance (dostane URL).
 * Pořadí: brandové fotky (týž výběr jako u obrázků — `pickBrandPhotos`), produkt,
 * logo. Logo nemá veřejnou URL nutně — zkusí se cesta z onboardingu, jinak data URL.
 */
export async function loadReelReferences(ctx: RenderContext): Promise<ReelReference[]> {
    const { config, captionData } = ctx
    const out: ReelReference[] = []
    const photoBudget = MAX_REFERENCES - (ctx.selectedProduct?.imageUrls?.[0] ? 1 : 0) - (config.logoFile ? 1 : 0)

    const brandObjects = getConfigBrandImageObjects(config)
    if (brandObjects.length > 0 && photoBudget > 0) {
        const { picks, mode } = pickBrandPhotos(
            brandObjects,
            [captionData.hook, captionData.scenes?.map(s => s.visual).join(" "), captionData.videoScript],
            Math.min(5, photoBudget),
        )
        if (mode === "random") console.log("   🎲 Nic se netrefilo — náhodné fotky")
        for (const pick of picks) {
            const img = await fetchImage(pick.url)
            out.push({ index: out.length + 1, kind: "photo", url: pick.url, description: pick.description || "brand photo", tags: pick.tags || [], buffer: img?.buffer, mimeType: img?.mimeType })
        }
    }

    const productUrl = ctx.selectedProduct?.imageUrls?.[0]
    if (productUrl) {
        const img = await fetchImage(productUrl)
        out.push({ index: out.length + 1, kind: "product", url: productUrl, description: `${ctx.selectedProduct!.name} (${ctx.selectedProduct!.type})`, tags: ["produkt"], buffer: img?.buffer, mimeType: img?.mimeType })
    }

    if (config.logoFile) {
        const logo = await loadLogo(config.logoFile)
        if (logo) {
            const url = await logoUrlForSeedance(config.logoFile, logo)
            if (url) out.push({ index: out.length + 1, kind: "logo", url, description: `brand logo of ${config.name}`, tags: ["logo"], buffer: logo, mimeType: "image/png" })
        }
    }
    const bucket = config.storageBucket || "audit-screenshots"
    return Promise.all(out.slice(0, MAX_REFERENCES).map(ref => ensureReferenceSize(ref, bucket)))
}

/**
 * Seedance odmítá referenci pod 300 px na stranu — rovnou HTTP 400 při zadání, bez úlohy.
 * Typicky je to logo (u chrlit 192×192). Malou referenci zvětšíme a nahrajeme do bucketu
 * značky pod otiskem obsahu, takže další reel použije týž soubor. Bez bufferu (stažení
 * selhalo) ji necháme být a rozhodne API.
 */
async function ensureReferenceSize(ref: ReelReference, bucket: string): Promise<ReelReference> {
    if (!ref.buffer) return ref
    const meta = await sharp(ref.buffer).metadata().catch(() => null)
    if (!meta?.width || !meta?.height || !referenceTooSmall(meta.width, meta.height)) return ref
    const up = await upscaleReference(ref.buffer)
    const hash = createHash("sha1").update(ref.buffer).digest("hex").slice(0, 16)
    const url = await uploadToBucket(bucket, `ig-reels/refs/${hash}-${up.width}x${up.height}.png`, up.buffer, "image/png")
    console.log(`   🔍 Reference ${ref.index} (${ref.kind}) ${meta.width}×${meta.height} px je pod minimem Seedance — zvětšena na ${up.width}×${up.height}`)
    return { ...ref, url }
}

/** Veřejná URL loga (cesta z onboardingu), jinak data URL — pokud ji API bere. */
async function logoUrlForSeedance(logoFile: string, logo: Buffer): Promise<string | null> {
    const slug = logoFile.replace(/^logo-/, "").replace(/\.png$/i, "")
    const { data } = supabaseAdmin.storage.from("audit-screenshots").getPublicUrl(`client-assets/${slug}/logo.png`)
    if (data?.publicUrl) {
        try {
            const ctrl = new AbortController()
            const t = setTimeout(() => ctrl.abort(), 8_000)
            const head = await fetch(data.publicUrl, { method: "HEAD", signal: ctrl.signal }).finally(() => clearTimeout(t))
            if (head.ok) return data.publicUrl
        } catch { /* spadne na data URL */ }
    }
    if (process.env.ARK_ALLOW_DATA_URLS === "0") return null
    return `data:image/png;base64,${logo.toString("base64")}`
}

// ─── Storage ────────────────────────────────────────────────────────────────

async function uploadToBucket(bucket: string, path: string, body: Buffer, contentType: string): Promise<string> {
    const { error } = await supabaseAdmin.storage.from(bucket).upload(path, body, { contentType, cacheControl: "31536000", upsert: true })
    if (error) throw new Error(`Upload do ${bucket}/${path} selhal: ${error.message}`)
    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path)
    if (!data?.publicUrl) throw new Error(`Bucket ${bucket} nevrátil veřejnou URL pro ${path}`)
    return data.publicUrl
}

async function downloadFromBucket(bucket: string, path: string): Promise<Buffer> {
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(path)
    if (error || !data) throw new Error(`Stažení ${bucket}/${path} selhalo: ${error?.message || "prázdná odpověď"}`)
    return Buffer.from(await data.arrayBuffer())
}

async function captureReelError(err: unknown, step: string, ctx: RenderContext, extra: Record<string, unknown>): Promise<void> {
    try {
        const Sentry = await import("@sentry/nextjs")
        Sentry.captureException(err, { tags: { area: "reel", step }, extra: { clientId: ctx.clientUuid, postType: ctx.selectedType.name, ...extra } })
    } catch { /* Sentry unavailable (CLI run) — the console error stands */ }
}

// ─── Cover ──────────────────────────────────────────────────────────────────

/**
 * Native reel cover: AI Designer mini-brief → Nano Banana Pro renders the cover
 * with the Czech hook + logo → one vision QA pass + one corrective edit.
 * Throws / returns undefined on failure — caller falls back to the text-free cover.
 */
async function renderNativeReelCover(ctx: RenderContext, coverScene: string): Promise<Buffer | undefined> {
    const { config, captionData, selectedType } = ctx
    const {
        generateDesignBrief,
        buildNativeImagePrompt,
        verifyNativeImage,
    } = await import("../image-pipeline")
    const { generateImageWithReferences, editExistingImage } = await import("../gemini-client")

    console.log("🎨 AI Designer — native reel cover...")
    const typeDef = getPostTypeDef(config, selectedType.name)
    const brief = await generateDesignBrief({
        config,
        clientId: ctx.clientUuid,
        captionData: {
            hook: captionData.hook,
            imagePrompt: coverScene,
        },
        postType: selectedType.name,
        formatBrief: typeDef ? { description: typeDef.description, visualStyle: typeDef.visualStyle } : undefined,
        recentBriefs: ctx.recentBriefs ?? [],
        bannedArchetypes: ctx.recentArchetypes ?? [],
    })

    const prompt = `${buildNativeImagePrompt(brief, config)}

## FORMAT:
This is an Instagram REEL COVER — 9:16 vertical, bold and readable even as a small feed thumbnail.`

    const refs: { buffer: Buffer; mimeType?: string; label?: string }[] = []
    if (config.logoFile) {
        const logo = await loadLogo(config.logoFile)
        if (logo) {
            refs.push({
                buffer: logo,
                mimeType: "image/png",
                label: "brand logo — reproduce faithfully with exact shapes and colors, do not redraw",
            })
        }
    }

    let coverBuffer = await generateImageWithReferences(prompt, refs, { aspectRatio: "9:16", resolution: "2K" })

    const qaExpectation = {
        headline: captionData.hook,
        logoExpected: refs.length > 0,
        language: contentLanguage(ctx.config).code,
    }
    const qa = await verifyNativeImage(coverBuffer, qaExpectation)
    if (!qa.ok) {
        console.log(`   ⚠️ Cover QA: ${qa.issues.join("; ")} → korektivní edit`)
        const fixed = await editExistingImage(coverBuffer, `Fix ONLY the text and logo problems — keep composition, photo, style and layout EXACTLY the same.
Render the headline as this ${exactTextRule(contentLanguage(ctx.config))}: "${captionData.hook}"
${qa.fixHint ? `Specific fix: ${qa.fixHint}` : ""}`, {
            mimeType: "image/png",
            aspectRatio: "9:16",
            resolution: "2K",
        })
        const qa2 = await verifyNativeImage(fixed, qaExpectation)
        if (!qa2.ok) {
            console.log(`   ❌ Cover neprošel QA ani po opravě`)
            return undefined
        }
        coverBuffer = fixed
    }
    console.log(`   ✅ Native cover OK (${(coverBuffer.length / 1024).toFixed(0)} KB)`)
    return coverBuffer
}
