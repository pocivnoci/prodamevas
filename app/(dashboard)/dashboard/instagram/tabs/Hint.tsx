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

export function Hint({ children, label = "proč to je důležité" }: { children: React.ReactNode; label?: string }) {
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
                {label}
            </button>
            {open && (
                <span className="mt-2 block max-w-prose rounded-sm border border-white/10 bg-[#080808] px-3 py-2 text-[11px] leading-relaxed text-white/50">
                    {children}
                </span>
            )}
        </span>
    )
}

/**
 * Texty na jednom místě, ne rozeseté po JSX.
 *
 * Důvod je praktický: tohle je jediné místo, kde se dá přečíst, co všechno
 * zákazníkovi slibujeme — a při změně chování se to musí přepsat spolu s kódem.
 */
export const HINTS = {
    tone: "Z tónu se učí každý budoucí příspěvek, ne jen ten nejbližší. Změna se projeví až u nově generovaného obsahu — hotové příspěvky přepsat nejde, jen přegenerovat za kredit.",

    pillars: "Pilíře rozhodují, o čem se vůbec bude psát. Bez nich plán sklouzne k náhodným příspěvkům, které nikam nevedou. Tři až pět je ideál; víc jich značka neuhraje.",

    voiceExamples: "Jeden až tři příspěvky, které se vám opravdu líbí, drží tón silněji než jakékoli nastavení výš — model se učí z ukázky, ne z popisu.",

    formats: "Formát určuje cenu: obrázek 1 kredit, story 2, carousel 3, reel 5. Zapnout všechno znamená vyčerpat měsíční příděl rychleji, než čekáte.",

    cadence: "Kadence má odpovídat tomu, co reálně stihnete zveřejnit. Vygenerovaný a nezveřejněný příspěvek stál kredit a nevydělal nic.",

    autoPublish: "Zapnutím se příspěvky zveřejní samy podle kalendáře, bez vašeho schválení. Zpátky to vzít nejde — smazat post na Instagramu můžete, ale kdo ho viděl, ten ho viděl.",

    credits: "Kredity se obnovují každý měsíc a nevyčerpané propadají — i u předplatného zaplaceného na rok dopředu. Vybírejte tarif podle toho, kolik reálně zveřejníte.",

    products: "Katalog je živý zdroj pro produktové vizualizace. Co v něm chybí, o tom engine neumí psát konkrétně — a obecný příspěvek o produktu neprodává.",

    instagram: "Bez propojení účtu se nedá měřit výkon, takže se učicí smyčka nemá z čeho učit a doporučení zůstanou obecná.",

    term: "Delší období platíte dopředu a cenu tím zamykáte na celou dobu. Kredity se ale i tak obnovují každý měsíc — předplacením roku je nedostáváte dopředu.",
} as const
