"use client"

/**
 * Titulky reelu v detailu příspěvku — přepsat a přerenderovat bez kreditů.
 *
 * Titulky jsou vypálené do videa (Instagram u reelu titulkovou stopu nebere), takže
 * překlep se do 9/2026 dal opravit jedině přegenerováním celého reelu za 5–10 kreditů
 * — a vrátilo to jiné video. Tenhle panel místo toho pošle job `reel_recompose`:
 * staré surové video + voiceover z bucketu, nové ASS titulky, nové MP4. Cover se nemění.
 *
 * Časy se jen ukazují. Karta sedí na skutečně namluvené řeči (`reel-audio.ts`) a
 * posunout ji ručně by znamenalo rozejít titulek s hlasem — text se přepsat dá,
 * načasování řeči ne.
 */

import { useState } from "react"
import { recomposeReelSubtitles } from "@/app/actions/post-edit-actions"
import { SUBTITLE_PRESET_OPTIONS } from "@/lib/subtitle-presets"
import type { IGPost, ReelSubtitleCard } from "@/lib/types/database"
import type { SubtitlePreset } from "@/instagram/configs/types"

const POLL_MS = 2000
/** Strop čekání na ffmpeg. Dvacetivteřinový reel se skládá jednotky až desítky sekund. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000

export function ReelSubtitlesPanel({ post, projectId, onDone }: {
    post: IGPost
    projectId: string
    /** Nové `image_url` a karty — detail si jimi překreslí přehrávač, aniž by se zavřel. */
    onDone: (imageUrl: string, cards: ReelSubtitleCard[]) => void
}) {
    const source = post.video_source ?? null
    const canRecompose = !!source?.rawVideoPath && !!source?.voiceoverPath
    const locked = post.status === "posted" || post.status === "posting"

    const [cards, setCards] = useState<ReelSubtitleCard[]>(() => source?.cards ?? [])
    const [preset, setPreset] = useState<SubtitlePreset>(source?.subtitleStyle?.preset ?? "classic")
    // Stav, který je právě vypálený ve videu. Po přerenderování se posune, aby
    // tlačítko zase zšedlo — jinak by lákalo skládat totéž video pořád dokola.
    const [baseline, setBaseline] = useState<{ cards: ReelSubtitleCard[]; preset: SubtitlePreset }>(
        () => ({ cards: source?.cards ?? [], preset: source?.subtitleStyle?.preset ?? "classic" }),
    )
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const dirty = preset !== baseline.preset || cards.some((c, i) => c.text !== (baseline.cards[i]?.text ?? ""))

    if (!source) return null

    const run = async () => {
        if (busy || !canRecompose) return
        setBusy(true); setError(null); setStatus("Zakládám úlohu…")

        const created = await recomposeReelSubtitles(post.id, projectId, {
            cards: cards.map(c => ({ text: c.text, start: c.start, end: c.end })),
            subtitleStyle: { ...(source.subtitleStyle ?? {}), preset },
        })
        if (!created.success || !created.jobId) {
            setBusy(false); setStatus(null); setError(created.error || "Úlohu se nepodařilo založit.")
            return
        }

        // Spuštění i sledování jde stejnou cestou jako generování příspěvku:
        // ffmpeg patří do routy s 800s stropem, ne do server action.
        fetch("/api/ig-run-job", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: created.jobId }),
        }).catch(() => { /* výsledek stejně čteme z pollingu */ })

        const startedAt = Date.now()
        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, POLL_MS))
            try {
                const res = await fetch(`/api/ig-job-status?id=${created.jobId}`)
                const job = await res.json()
                if (job.status === "done") {
                    setBusy(false); setStatus(null)
                    const done = job.result as { imageUrl?: string; cards?: ReelSubtitleCard[] } | null
                    const next = done?.cards ?? cards
                    setCards(next)
                    setBaseline({ cards: next, preset })
                    if (done?.imageUrl) onDone(done.imageUrl, next)
                    return
                }
                if (job.status === "failed") {
                    setBusy(false); setStatus(null)
                    setError(job.error || "Přerenderování selhalo.")
                    return
                }
                if (job.agentMessage) setStatus(job.agentMessage)
            } catch { /* výpadek pollingu není výsledek — zkusíme znovu */ }
        }
        setBusy(false); setStatus(null)
        setError("Přerenderování trvá nezvykle dlouho. Zavřete detail a za chvíli ho otevřete znovu.")
    }

    return (
        <div className="px-4 sm:px-6 py-3 border-t border-white/10 bg-[#030303] space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/60">Titulky</span>
                <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/70">bez kreditů</span>
                <span className="text-[10px] text-white/30">· vypálené do videa, mění se přerenderováním</span>
            </div>

            {!canRecompose ? (
                <p className="text-[10px] text-amber-400/80 leading-relaxed">
                    Tenhle reel vznikl dřív, než jsme si začali schovávat surové video — titulky u něj jdou
                    změnit jen vygenerováním znovu. U nových reelů to už půjde tady.
                </p>
            ) : locked ? (
                <p className="text-[10px] text-white/40 leading-relaxed">
                    Publikovaný reel už na Instagramu nezměníme — titulky jdou upravit jen u varianty.
                </p>
            ) : (
                <>
                    {/* Preset stylu — výchozí pro celou značku se nastavuje v Nastavení. */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {SUBTITLE_PRESET_OPTIONS.map(o => (
                            <button
                                key={o.id}
                                onClick={() => setPreset(o.id)}
                                disabled={busy}
                                title={o.description}
                                className={`px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border transition-all disabled:opacity-40 ${
                                    preset === o.id
                                        ? "bg-white/10 text-white border-white/20"
                                        : "bg-transparent text-white/40 border-white/10 hover:text-white/70"
                                }`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {cards.length === 0 && (
                            <p className="text-[10px] text-white/30">Tenhle reel nemá uložené žádné karty.</p>
                        )}
                        {cards.map((card, i) => (
                            <div key={i} className="flex items-start gap-2">
                                <span className="text-[9px] font-mono text-white/25 pt-2 w-20 shrink-0 tabular-nums">
                                    {card.start.toFixed(1)}–{card.end.toFixed(1)} s
                                </span>
                                <input
                                    value={card.text}
                                    disabled={busy}
                                    onChange={(e) => setCards(prev => prev.map((c, j) => j === i ? { ...c, text: e.target.value } : c))}
                                    className="flex-1 bg-[#0a0a0a] border border-white/10 rounded-sm px-2 py-1.5 text-xs text-white/90 focus:border-white/30 focus:outline-none disabled:opacity-40"
                                />
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            onClick={run}
                            disabled={busy || !dirty}
                            className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/20 bg-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            {busy ? "Renderuji…" : "Přerenderovat titulky (bez kreditů)"}
                        </button>
                        {!dirty && !busy && <span className="text-[10px] text-white/25">Změňte text nebo styl</span>}
                        {status && <span className="text-[10px] text-white/50">{status}</span>}
                    </div>

                    {error && <p className="text-[10px] text-red-400/80 leading-relaxed">{error}</p>}
                    <p className="text-[9px] text-white/25 leading-relaxed">
                        Časy sedí na namluvené řeči a měnit je nejde — jinak by se titulek rozešel s hlasem.
                        Nové video nahradí staré; předchozí verzi vrátí „Vrátit zpět&ldquo;.
                    </p>
                </>
            )}
        </div>
    )
}
