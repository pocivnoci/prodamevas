"use client"

/**
 * Galerie e-mailových šablon — všechny naráz, z ukázkových dat.
 *
 * K čemu to je: změnu tokenu nebo bloku je potřeba vidět na všech šablonách
 * najednou. Renderuje server týmž kódem jako ostré odeslání, takže náhled není
 * napodobenina — je to doslova to, co dorazí do schránky.
 */

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { getEmailGallery, type GalleryEntry } from "@/app/actions/mailing-actions"

export function EmailsTab() {
    const t = useTranslations("adminGrowth.emails")
    // Názvy šablon sdílí s pickerem v Mailingu — jeden text, jeden klíč.
    const tm = useTranslations("adminGrowth.mailing")
    const [entries, setEntries] = useState<GalleryEntry[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [openText, setOpenText] = useState<string | null>(null)

    useEffect(() => {
        getEmailGallery()
            .then(setEntries)
            .catch(e => setError(e?.message || t("loadFailed")))
    }, [t])

    /** Název šablony z messages; šablona, kterou UI nezná, si nechá label z registru. */
    const templateLabel = (e: GalleryEntry) => tm.has(`templates.${e.id}`) ? tm(`templates.${e.id}`) : e.label
    /** Skupiny bere z registru (`GROUP_LABELS`), tady jen překlad podle hodnoty. */
    const groupLabel = (group: string) => t.has(`groups.${group}`) ? t(`groups.${group}`) : group

    if (error) {
        return (
            <div className="bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm p-4 text-sm text-aisummit-cinnabar font-bold">
                ⚠️ {error}
            </div>
        )
    }

    if (!entries) {
        return <p className="text-xs text-white/30 font-medium">{t("rendering")}</p>
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8">
            <div>
                <h2 className="text-base font-black uppercase tracking-widest text-white">{t("title")}</h2>
                <p className="text-[10px] text-white/30 font-medium mt-1 uppercase tracking-widest">
                    {t("subtitle", { count: entries.length })}
                </p>
            </div>

            {entries.map(e => (
                <div key={e.id} className="space-y-2">
                    <div className="flex items-baseline justify-between flex-wrap gap-2">
                        <div className="flex items-baseline gap-2">
                            <span className="text-xs font-black uppercase tracking-widest text-white">{templateLabel(e)}</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm border bg-white/5 text-white/40 border-white/10">
                                {groupLabel(e.group)}
                            </span>
                            <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm border ${e.kind === "notification"
                                ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}`}>
                                {t(`kind.${e.kind}`)}
                            </span>
                        </div>
                        <div className="flex items-baseline gap-3">
                            <span className={`text-[9px] font-bold uppercase tracking-widest ${e.kb > 90 ? "text-aisummit-cinnabar" : "text-white/25"}`}>
                                {Math.round(e.kb)} KB
                            </span>
                            <button
                                onClick={() => setOpenText(openText === e.id ? null : e.id)}
                                className="text-[9px] text-white/40 hover:text-white/80 uppercase tracking-widest font-bold transition-colors"
                            >
                                {openText === e.id ? t("hideText") : tm("preview.textVersion")}
                            </button>
                        </div>
                    </div>
                    <p className="text-[10px] text-white/30 font-medium">{e.subject}</p>
                    {openText === e.id ? (
                        <pre className="p-4 bg-[#050505] border border-white/10 rounded-sm text-[11px] text-white/50 whitespace-pre-wrap leading-relaxed max-h-[460px] overflow-y-auto">{e.text}</pre>
                    ) : (
                        <iframe
                            title={templateLabel(e)}
                            srcDoc={e.html}
                            sandbox=""
                            loading="lazy"
                            className="w-full h-[460px] bg-white border border-white/10 rounded-sm"
                        />
                    )}
                </div>
            ))}
        </div>
    )
}
