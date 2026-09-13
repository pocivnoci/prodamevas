"use client"

/**
 * Vysvětlivka u pole, kde špatné nastavení něco stojí.
 * ===================================================
 * Vědomě **není** obecná nápověda ke všemu. Nastavení má skoro dva tisíce řádků
 * a vysvětlivka u samozřejmého pole je šum, který lidi naučí přestat je číst.
 * Patří jen tam, kde chyba stojí peníze (kredity, strhnutá platba) nebo kvalitu
 * (tón, pilíře, formáty) — a řekne PROČ, ne co pole dělá. „Tón komunikace"
 * nikdo vysvětlovat nepotřebuje; že se z něj učí každý budoucí příspěvek, ano.
 *
 * Otevírá se kliknutím, ne najetím myší: na dotyku hover neexistuje a nápověda,
 * kterou nejde na telefonu otevřít, je horší než žádná.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ALL_MEDIA, MEDIA_CREDITS } from "@/lib/credits"

export function Hint({ children, label }: { children: React.ReactNode; label?: string }) {
    const t = useTranslations("help.hint")
    const [open, setOpen] = useState(false)

    return (
        <span className="inline-flex flex-col">
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                aria-expanded={open}
                className="self-start inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-white/60 transition-colors"
            >
                <span className="w-3.5 h-3.5 rounded-full border border-current inline-flex items-center justify-center text-[8px] leading-none">?</span>
                {label ?? t("defaultLabel")}
            </button>
            {open && (
                <span className="mt-2 block max-w-prose rounded-sm border border-white/10 bg-[#080808] px-3 py-2 text-[11px] leading-relaxed text-white/50">
                    {children}
                </span>
            )}
        </span>
    )
}

type HelpTranslator = ReturnType<typeof useTranslations<"help">>

/**
 * „obrázek 1 · story 2 · carousel 3 · reel 5 · dlouhý reel 10" v jazyce uživatele.
 *
 * Lokalizovaná obdoba `mediaCreditsSentence()` z lib/credits.ts: váhy jsou tatáž
 * tabulka `MEDIA_CREDITS` (nikdy z ruky), jen názvy médií jdou z messages
 * (`help.media.*`) místo z českého slovníku knihovny.
 */
export function localizedMediaCreditsSentence(t: HelpTranslator): string {
    return ALL_MEDIA.map((m) => `${t(`media.${m}`)} ${MEDIA_CREDITS[m]}`).join(" · ")
}

/**
 * Texty na jednom místě, ne rozeseté po JSX.
 *
 * Důvod je praktický: tohle je jediné místo, kde se dá přečíst, co všechno
 * zákazníkovi slibujeme — a při změně chování se to musí přepsat spolu s kódem.
 * Znění žije v `messages/<locale>/help.json` (`help.hint.*`); tenhle hook ho
 * vrací v jazyce uživatele. Volá se uvnitř komponenty: `const hints = useHints()`.
 */
export function useHints() {
    const t = useTranslations("help")
    return {
        tone: t("hint.tone"),
        pillars: t("hint.pillars"),
        facts: t("hint.facts"),
        voiceExamples: t("hint.voiceExamples"),
        formats: t("hint.formats", { media: localizedMediaCreditsSentence(t) }),
        cadence: t("hint.cadence"),
        autoPublish: t("hint.autoPublish"),
        credits: t("hint.credits"),
        products: t("hint.products"),
        instagram: t("hint.instagram"),
        term: t("hint.term"),
    }
}
