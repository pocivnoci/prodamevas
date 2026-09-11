/**
 * Seedance video client — BytePlus ModelArk (asynchronní úlohy).
 * ================================================================
 * Jediná brána k video modelu. Reel se generuje ve třech krocích, které jsou
 * schválně oddělené, protože každý má jiný životní cyklus v lambdě:
 *
 *   submitVideoTask  → vrátí `taskId` (zaplaceno; recordUnits se volá TADY, jednou)
 *   pollVideoTask    → čeká do `budgetMs`; „ještě běží" NENÍ chyba, ale stav,
 *                      o kterém rozhoduje orchestrátor (zaparkovat, ne selhat)
 *   downloadVideo    → MP4 do bufferu
 *
 * Tvar požadavku a odpovědi ModelArk žije POUZE v `buildTaskBody` a
 * `parseTaskStatus` — volající o tvaru API nic nevědí. Obojí sedí na
 * docs.byteplus.com/en/docs/ModelArk/1520757 a /1521309 (ověřeno 2026-09-11, zatím
 * bez živého volání). Přepínač `ARK_PARAMS_IN_PROMPT=1` posílá parametry starším
 * způsobem (jako `--ratio` v textu promptu), kdyby endpoint top-level pole odmítl — bez deploye.
 *
 * Bez `ARK_API_KEY` je reel nevyrobitelný a orchestrátor to hlásí nahlas
 * (`seedanceEnabled`); nikdy se potichu nepřeklápí na jiný formát.
 */

import { withQualityRetry, withRetry, QualityUnavailableError, isTransientError } from "../utils/retry"
import { recordUnits } from "./usage-meter"
import { videoUnitKey, type VideoResolution } from "../lib/model-pricing"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

export type { VideoResolution }

/** Referenční obrázek pro model — veřejná URL nebo data URL (logo z bufferu). */
export interface SeedanceReference {
    url: string
    /** Role v ModelArk API. Brandové fotky, produkt i logo jsou reference stylu a
     *  subjektu, ne první snímek — první snímek by model přinutil ZAČÍT fotkou. */
    role: "reference_image" | "first_frame" | "last_frame"
    /** Krátký popis, na který se prompt odkazuje („Image 2: the product"). */
    label?: string
}

export interface VideoTaskRequest {
    model: string
    prompt: string
    references: SeedanceReference[]
    durationSeconds: number
    resolution: VideoResolution
    ratio: "9:16"
    /** Nativní zvuková stopa (atmosféra, ruchy). Řeč tam být nesmí — hlídá prompt. */
    generateAudio: boolean
    seed?: number
}

export type PolledTask =
    | { status: "succeeded"; videoUrl: string; usage?: { tokens?: number } }
    | { status: "failed"; error: string }
    | { status: "pending"; lastStatus: string; elapsedMs: number }

/** Kolik referencí posíláme nejvýš. Seedance 2.x jich bere víc, ale každá další
 *  fotka ředí, co model z těch prvních pochopí — pět brandových + produkt + logo. */
export const MAX_REFERENCES = 7

const DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"
const SUBMIT_TIMEOUT_MS = 30_000
const POLL_TIMEOUT_MS = 20_000
const DOWNLOAD_TIMEOUT_MS = 120_000
/** Pod tuhle velikost není MP4 video, ale chybová stránka. */
const MIN_VIDEO_BYTES = 50 * 1024

export function seedanceEnabled(): boolean {
    return Boolean(process.env.ARK_API_KEY)
}

export function arkBaseUrl(): string {
    return (process.env.ARK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

function authHeaders(): Record<string, string> {
    const key = process.env.ARK_API_KEY
    if (!key) throw new Error("Seedance není nakonfigurované: chybí ARK_API_KEY")
    return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
}

/**
 * Tělo požadavku POST /contents/generations/tasks — JEDINÉ místo s názvy polí.
 * Výchozí tvar: parametry jako top-level pole; `ARK_PARAMS_IN_PROMPT=1` je pošle
 * jako příkazy v textu (`--ratio 9:16 --duration 8 …`), což je starší forma API.
 */
export function buildTaskBody(req: VideoTaskRequest): Record<string, unknown> {
    const inPrompt = process.env.ARK_PARAMS_IN_PROMPT === "1"
    const refRole = process.env.ARK_REFERENCE_ROLE || undefined

    const flags = ` --ratio ${req.ratio} --duration ${req.durationSeconds} --resolution ${req.resolution}`
        + (req.seed !== undefined ? ` --seed ${req.seed}` : "")
        + ` --watermark false`
    const text = inPrompt ? `${req.prompt.trim()}${flags}` : req.prompt.trim()

    const content: Record<string, unknown>[] = [
        { type: "text", text },
        ...req.references.slice(0, MAX_REFERENCES).map(ref => ({
            type: "image_url",
            image_url: { url: ref.url },
            role: refRole || ref.role,
        })),
    ]

    const body: Record<string, unknown> = { model: req.model, content }
    if (!inPrompt) {
        body.ratio = req.ratio
        body.duration = req.durationSeconds
        body.resolution = req.resolution
        body.generate_audio = req.generateAudio
        body.watermark = false
        if (req.seed !== undefined) body.seed = req.seed
    }
    return body
}

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

/**
 * Odpověď GET /contents/generations/tasks/{id} — JEDINÉ místo s názvy polí odpovědi.
 * Tvar podle docs.byteplus.com/en/docs/ModelArk/1521309 (ověřeno 2026-09-11): stav
 * queued | running | succeeded | failed | cancelled, po `execution_expires_after`
 * i `expired`; video v `content.video_url`, tokeny v `usage.completion_tokens`.
 * Čte dál tolerantně; neznámý stav se hlásí jako „running", ne jako úspěch —
 * `expired` ale musí být konec, jinak by se vypršelá úloha parkovala donekonečna.
 */
export function parseTaskStatus(json: unknown): { status: TaskStatus; videoUrl?: string; tokens?: number; error?: string } {
    const j = (json ?? {}) as Record<string, unknown>
    const content = (j.content ?? {}) as Record<string, unknown>
    const outputs = Array.isArray(j.outputs) ? (j.outputs as Record<string, unknown>[]) : []
    const result = (j.result ?? {}) as Record<string, unknown>
    const usage = (j.usage ?? {}) as Record<string, unknown>
    const errObj = j.error as Record<string, unknown> | undefined
    const raw = String(j.status ?? j.state ?? "").toLowerCase()
    const status: TaskStatus =
        raw === "succeeded" || raw === "success" || raw === "completed" ? "succeeded"
        : raw === "failed" || raw === "error" || raw === "expired" ? "failed"
        : raw === "cancelled" || raw === "canceled" ? "cancelled"
        : raw === "queued" || raw === "pending" ? "queued"
        : "running"
    const videoUrlRaw = content.video_url ?? j.video_url ?? outputs[0]?.url ?? result.video_url
    const videoUrl = typeof videoUrlRaw === "string" ? videoUrlRaw : undefined
    const tokens = Number(usage.completion_tokens ?? usage.total_tokens)
    const error = errObj ? `${errObj.code ?? ""} ${errObj.message ?? JSON.stringify(errObj)}`.trim()
        : raw === "expired" ? "úloha vypršela dřív, než ji ModelArk zpracoval (execution_expires_after)"
        : undefined
    return { status, videoUrl, tokens: Number.isFinite(tokens) ? tokens : undefined, error }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        return await fetch(url, { ...init, signal: ctrl.signal })
    } finally {
        clearTimeout(t)
    }
}

/** HTTP chyba s prefixem „HTTP <status>", na který reaguje retry v utils/retry.ts. */
async function httpError(prefix: string, resp: Response): Promise<Error> {
    const body = (await resp.text().catch(() => "")).slice(0, 300)
    return new Error(`${prefix}: HTTP ${resp.status} ${resp.statusText} ${body}`.trim())
}

/**
 * Zadá úlohu a ZAÚČTUJE ji (vteřiny × rozlišení). Účtuje se u zadání, ne u
 * stažení: resume z checkpointu zadání přeskakuje, takže se nic nepočítá dvakrát.
 * Přetížení (429/5xx) se zkouší tvrdě; když nepomůže, letí QualityUnavailableError
 * — job se zaparkuje s kreditem, nikdy nejede na horším modelu.
 */
export async function submitVideoTask(req: VideoTaskRequest): Promise<{ taskId: string }> {
    const body = buildTaskBody(req)
    const url = `${arkBaseUrl()}/contents/generations/tasks`

    let taskId: string
    try {
        taskId = await withQualityRetry(async () => {
            const resp = await fetchWithTimeout(url, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) }, SUBMIT_TIMEOUT_MS)
            if (!resp.ok) throw await httpError("Seedance submit", resp)
            const json = await resp.json() as Record<string, unknown>
            const id = json.id ?? json.task_id ?? (json.data as Record<string, unknown> | undefined)?.id
            if (!id) throw new Error(`Seedance submit: odpověď bez id úlohy (${JSON.stringify(json).slice(0, 200)})`)
            return String(id)
        }, { maxRetries: 4, baseDelayMs: 3000, maxDelayMs: 30_000, label: "seedance:submit" })
    } catch (err) {
        if (isTransientError(err)) {
            throw new QualityUnavailableError(`Seedance je přetížené: ${String((err as Error)?.message || err).slice(0, 160)}`)
        }
        throw err
    }

    recordUnits(videoUnitKey(req.model, req.resolution), "seconds", req.durationSeconds, "video")
    console.log(`   🎬 Seedance úloha zadána: ${taskId} (${req.durationSeconds}s, ${req.resolution}, ${req.references.length} referencí)`)
    return { taskId }
}

/** Jedno čtení stavu — bez čekání. Resume i smoke script ho volají přímo. */
export async function getVideoTask(taskId: string): Promise<ReturnType<typeof parseTaskStatus>> {
    const url = `${arkBaseUrl()}/contents/generations/tasks/${encodeURIComponent(taskId)}`
    const resp = await fetchWithTimeout(url, { method: "GET", headers: authHeaders() }, POLL_TIMEOUT_MS)
    if (!resp.ok) throw await httpError("Seedance status", resp)
    return parseTaskStatus(await resp.json())
}

/**
 * Polluje úlohu, dokud nedoběhne nebo nedojde rozpočet. „Ještě běží" po rozpočtu
 * vrací `pending` — rozhodnutí (zaparkovat) patří orchestrátoru, který ví o
 * checkpointu a o počtu kol. Dočasné chyby při čtení stavu se přeskakují (úloha
 * u poskytovatele běží dál), trvalé se hlásí jako `failed`.
 */
export async function pollVideoTask(
    taskId: string,
    opts: { budgetMs: number; intervalMs?: number; maxAttempts?: number; onTick?: (elapsedMs: number, status: string) => Promise<void> | void },
): Promise<PolledTask> {
    const interval = opts.intervalMs ?? 10_000
    const maxAttempts = opts.maxAttempts ?? 60
    const t0 = Date.now()
    let lastStatus = "queued"
    let readErrors = 0

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const elapsed = Date.now() - t0
        if (elapsed > opts.budgetMs) break

        try {
            const st = await getVideoTask(taskId)
            lastStatus = st.status
            readErrors = 0
            if (st.status === "succeeded") {
                if (!st.videoUrl) return { status: "failed", error: "Seedance hlásí úspěch, ale bez video_url" }
                return { status: "succeeded", videoUrl: st.videoUrl, usage: { tokens: st.tokens } }
            }
            if (st.status === "failed" || st.status === "cancelled") {
                return { status: "failed", error: st.error || `Seedance úloha skončila stavem ${st.status}` }
            }
        } catch (err) {
            // Čtení stavu selhalo, úloha běží dál — pár chyb za sebou je síť, ne video.
            readErrors++
            if (!isTransientError(err) || readErrors >= 5) {
                return { status: "failed", error: `Seedance status: ${String((err as Error)?.message || err).slice(0, 200)}` }
            }
        }

        await opts.onTick?.(Date.now() - t0, lastStatus)
        const remaining = opts.budgetMs - (Date.now() - t0)
        if (remaining <= 0) break
        await new Promise(r => setTimeout(r, Math.min(interval, remaining)))
    }

    return { status: "pending", lastStatus, elapsedMs: Date.now() - t0 }
}

/** Stáhne MP4. URL od ModelArk je podepsaná a časově omezená — stahuje se hned. */
export async function downloadVideo(videoUrl: string): Promise<Buffer> {
    return withRetry(async () => {
        const resp = await fetchWithTimeout(videoUrl, { method: "GET" }, DOWNLOAD_TIMEOUT_MS)
        if (!resp.ok) throw await httpError("Seedance download", resp)
        const type = resp.headers.get("content-type") || ""
        const buf = Buffer.from(await resp.arrayBuffer())
        if (buf.length < MIN_VIDEO_BYTES || /text\/html|application\/json/i.test(type)) {
            throw new Error(`Seedance download: odpověď není video (${buf.length} B, ${type || "bez content-type"})`)
        }
        return buf
    }, 3, "seedance:download")
}

/**
 * Celý cyklus v jednom volání — pro smoke script a pro volající BEZ checkpointu.
 * Reelový orchestrátor tohle nepoužívá: potřebuje `taskId` uložit mezi
 * submit a poll, aby pád lambdy nezadal (a nezaplatil) video podruhé.
 */
export async function generateVideoSeedance(req: VideoTaskRequest, opts: { budgetMs: number }): Promise<Buffer> {
    const { taskId } = await submitVideoTask(req)
    const polled = await pollVideoTask(taskId, { budgetMs: opts.budgetMs })
    if (polled.status === "failed") throw new Error(`Seedance selhalo: ${polled.error}`)
    if (polled.status === "pending") throw new Error(`Seedance nedoběhlo v rozpočtu ${Math.round(opts.budgetMs / 1000)} s (úloha ${taskId}, stav ${polled.lastStatus})`)
    return downloadVideo(polled.videoUrl)
}
