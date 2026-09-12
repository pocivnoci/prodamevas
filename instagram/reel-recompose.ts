/**
 * Přerenderování titulků reelu — nové MP4 ze STARÉHO videa.
 * ========================================================
 * Instagram u reelu bere jen `video_url` + `caption` + `cover_url`; titulkovou
 * stopu nezná. Titulky jsou proto vypálené do obrazu a „přepiš titulek" znamená
 * složit kompozici znovu. Do 9/2026 to nešlo: surové video ze Seedance drželo
 * jen `renderReel` v paměti a voiceover WAV se po kompozici mazal, takže jediná
 * odpověď na překlep bylo přegenerovat celý reel (5–10 kreditů) — a vrátilo to
 * JINÉ video, protože Seedance není deterministické.
 *
 * Tenhle modul je druhá polovina té opravy: `ig_posts.video_source` (migrace
 * 20260912) říká, kde surové MP4 a WAV leží, a odsud se jen znovu spustí ffmpeg.
 *
 * **Nula kreditů, nula volání modelu.** Nesmí odsud vést cesta na
 * `seedance-client`, `generateVoiceover` ani `creditGuard` — to je celý smysl
 * funkce a hlídá to `scripts/test-reel-pipeline.ts`. Když zdroj chybí (reel před
 * migrací, surové video nad kvótou bucketu), je to jasná chyba s návodem, ne
 * tiché přegenerování za peníze.
 *
 * Multi-tenancy: všechno běží přes `clientId` v `WHERE` (CLAUDE.md) — volající
 * si tenanta překládá ze slugu právě jednou a sem posílá UUID.
 */

import supabaseAdmin from "../supabase/admin"
import { buildAss, cardsFromEdits, chunkForSubtitles, resolveSubtitleStyle } from "./reel-subtitles"
import { composeReel } from "./reel-compositor"
import { parsePostMedia } from "../lib/media-urls"
import type { PostEditHistoryEntry, ReelSubtitleCard, ReelVideoSource } from "../lib/types/database"
import type { SubtitleStyleConfig } from "./configs/types"

/** Kolik kroků zpět si příspěvek pamatuje — stejný strop jako u `editPost`. */
const MAX_HISTORY = 10

export interface ReelRecomposeInput {
    clientId: string
    postId: string
    /** Upravené karty. Prázdné/chybějící = karty se nachunkují znovu z časové osy. */
    cards?: ReelSubtitleCard[]
    /** Jednorázový styl jen pro tenhle reel. Chybějící = styl uložený u reelu. */
    subtitleStyle?: SubtitleStyleConfig
}

export interface ReelRecomposeResult {
    videoUrl: string
    /** Celá hodnota `ig_posts.image_url` (`video|cover`) — UI z ní překreslí přehrávač. */
    imageUrl: string
    cards: ReelSubtitleCard[]
}

/**
 * Stáhne surové video + voiceover, vypálí nové titulky a přepíše `image_url`.
 * Cover se NEMĚNÍ — je to samostatný obrázek v mřížce a titulky s ním nesouvisí.
 */
export async function runReelRecompose(
    input: ReelRecomposeInput,
    report?: (progress: number, message: string) => Promise<void>,
): Promise<ReelRecomposeResult> {
    const { clientId, postId } = input

    const { data: post } = await supabaseAdmin
        .from("ig_posts")
        .select("id, status, image_url, media_type, video_source, edit_history")
        .eq("id", postId)
        .eq("client_id", clientId)
        .maybeSingle()

    if (!post) throw new Error("Příspěvek nenalezen.")
    // Publikovaný reel se na IG už nezmění — přepsat řádek by ho rozešlo s tím,
    // co diváci skutečně vidí (stejné pravidlo jako v editPost).
    if (post.status === "posted" || post.status === "posting") {
        throw new Error("Publikovaný reel už nejde přerenderovat — vytvoř variantu.")
    }

    const source = post.video_source as ReelVideoSource | null
    // Textový reel voiceover nikdy neměl (hudba je rovnou ve videu) — chybějící WAV
    // u něj není chybějící zdroj. U mluveného reelu bez WAV by nová kompozice tiše
    // umlčela narraci, a to je horší než odmítnout.
    const textOnly = source?.mode === "text"
    if (!source?.rawVideoPath || (!textOnly && !source.voiceoverPath)) {
        throw new Error("U tohohle reelu nemáme uložené surové video — titulky jdou změnit jen vygenerováním znovu.")
    }

    const media = parsePostMedia(post.image_url, post.media_type)
    if (media.kind !== "reel") throw new Error("Tenhle příspěvek není reel.")

    // Styl: jednorázový override vyhrává nad tím, se kterým se reel vyrenderoval.
    // Barva zvýraznění (preset `pop`) patří značce: starší reel ji ve stylu uložený
    // nemá, a bez configu by přepnutí na `pop` dalo žlutou místo barvy značky.
    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("config")
        .eq("id", clientId)
        .maybeSingle()
    const brandAccent = (client?.config as { feedAesthetic?: { accentColor?: string } } | null)?.feedAesthetic?.accentColor
    const subtitles = resolveSubtitleStyle(input.subtitleStyle ?? source.subtitleStyle, { reelMode: source.mode, brandAccent })

    // Text je uživatelův, zalomení dělá kód podle NOVÉ šířky řádku — po přepnutí
    // presetu by jinak ručně upravená karta přetekla přes okraj.
    const cards = input.cards?.length
        ? cardsFromEdits(input.cards, subtitles.chunkOpts)
        : chunkForSubtitles(source.timeline, subtitles.chunkOpts)
    if (cards.length === 0) throw new Error("Reel bez jediné titulkové karty — smaž radši text v úpravě, ne všechny karty.")

    await report?.(20, textOnly ? "📥 Stahuji surové video…" : "📥 Stahuji surové video a voiceover…")
    const bucket = source.bucket
    const rawVideo = await downloadFromBucket(bucket, source.rawVideoPath)
    const voiceoverWav = source.voiceoverPath
        ? await downloadFromBucket(source.voiceoverBucket || bucket, source.voiceoverPath)
        : undefined

    await report?.(50, "🎞️ Vypaluji nové titulky…")
    const ass = buildAss(cards, subtitles.assStyle)
    const finalVideo = await composeReel({
        videoBuffer: rawVideo,
        voiceoverWav,
        ass,
        atempo: source.atempo,
        durationSeconds: source.durationSeconds,
        // Textový reel nemá řeč, pod kterou by se hudba tlumila — musí se složit
        // se stejnou hlasitostí jako poprvé, jinak by přerenderování titulků
        // potichu ztišilo zvuk.
        ...(voiceoverWav ? {} : { ambientLevel: 1 }),
    })

    await report?.(80, "📤 Nahrávám video…")
    // Nová cesta, ne přepsání staré: staré video visí v `edit_history` kvůli
    // vrácení zpět a prohlížeče i CDN si URL drží rok (`cacheControl`).
    const ts = Date.now()
    const videoUrl = await uploadToBucket(bucket, `ig-reels/${ts}.mp4`, finalVideo, "video/mp4")

    const nextCards: ReelSubtitleCard[] = cards.map(c => ({ text: c.lines.join(" "), start: c.start, end: c.end }))
    const nextSource: ReelVideoSource = { ...source, cards: nextCards, subtitleStyle: subtitles.style }

    const history: PostEditHistoryEntry[] = Array.isArray(post.edit_history) ? post.edit_history as PostEditHistoryEntry[] : []
    const historyEntry: PostEditHistoryEntry = {
        at: new Date().toISOString(),
        scope: "subtitles",
        instruction: `Přerenderované titulky (${cards.length} karet, styl ${subtitles.style.preset})`,
        preserve: null,
        region: null,
        slide_index: null,
        image_url: post.image_url,
        image_prompt: null,
        image_style: null,
        caption: null,
        hashtags: null,
        video_source: source,
    }

    // Cover zůstává — mění se jen video. Konvence `video|cover` z media-urls.
    const imageUrl = media.coverUrl ? `${videoUrl}|${media.coverUrl}` : videoUrl
    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update({
            image_url: imageUrl,
            video_source: nextSource,
            edit_history: [...history, historyEntry].slice(-MAX_HISTORY),
        })
        .eq("id", postId)
        .eq("client_id", clientId)
    if (error) throw new Error(`Uložení přerenderovaného reelu selhalo: ${error.message}`)

    console.log(`✅ Titulky reelu přerenderované (${cards.length} karet, styl ${subtitles.style.preset}): ${postId}`)
    return { videoUrl, imageUrl, cards: nextCards }
}

async function downloadFromBucket(bucket: string, path: string): Promise<Buffer> {
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(path)
    if (error || !data) throw new Error(`Stažení ${bucket}/${path} selhalo: ${error?.message || "prázdná odpověď"}`)
    return Buffer.from(await data.arrayBuffer())
}

async function uploadToBucket(bucket: string, path: string, body: Buffer, contentType: string): Promise<string> {
    const { error } = await supabaseAdmin.storage.from(bucket).upload(path, body, { contentType, cacheControl: "31536000", upsert: true })
    if (error) throw new Error(`Upload do ${bucket}/${path} selhal: ${error.message}`)
    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path)
    if (!data?.publicUrl) throw new Error(`Bucket ${bucket} nevrátil veřejnou URL pro ${path}`)
    return data.publicUrl
}
