"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Languages } from "lucide-react"

import { setUiLocale } from "@/app/actions/locale-actions"
import { UI_LOCALES, UI_LOCALE_NAMES } from "@/lib/i18n/locales"

/**
 * Přepínač jazyka UI. `router.refresh()` po zápisu cookie překreslí serverové
 * komponenty s novými zprávami a nechá stav klienta (otevřený tab, rozepsaný
 * formulář) na místě — tvrdé přenačtení by ho zahodilo.
 */
export function LanguageSwitcher({ variant = "nav" }: { variant?: "nav" | "compact" }) {
    const locale = useLocale()
    const t = useTranslations("common")
    const router = useRouter()
    const [pending, startTransition] = useTransition()

    const select = (
        <select
            value={locale}
            disabled={pending}
            aria-label={t("language")}
            onChange={e => {
                const next = e.target.value
                startTransition(async () => {
                    await setUiLocale(next)
                    router.refresh()
                })
            }}
            className={variant === "nav"
                ? "flex-1 appearance-none bg-transparent text-[11px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70 focus:outline-none cursor-pointer"
                : "appearance-none bg-transparent text-[9px] font-bold uppercase tracking-widest text-white/30 hover:text-white/60 focus:outline-none cursor-pointer"}
        >
            {UI_LOCALES.map(l => (
                <option key={l} value={l} className="bg-[#0a0a0a] text-white">{UI_LOCALE_NAMES[l]}</option>
            ))}
        </select>
    )

    if (variant === "compact") {
        return (
            <div className="flex items-center justify-center gap-1.5 text-white/30">
                <Languages className="w-3 h-3" aria-hidden />
                {select}
            </div>
        )
    }

    return (
        <label className="group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-sm text-white/40 hover:text-white/70 transition-all cursor-pointer">
            <Languages className="w-4 h-4 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" aria-hidden />
            {select}
        </label>
    )
}
