"use client"

import { useState } from "react"

/**
 * Heslo s okem místo pole „heslo znovu". Kontrolní opis chytí překlep jen
 * naslepo — ukázat člověku, co napsal, chytí ho spolehlivěji a o pole míň.
 */
export function PasswordField({
    label,
    placeholder,
    minLength,
    trailing,
}: {
    label: string
    placeholder?: string
    minLength?: number
    /** Volitelný odkaz vedle labelu (např. „Zapomněl jsi heslo?"). */
    trailing?: React.ReactNode
}) {
    const [visible, setVisible] = useState(false)

    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-[9px] font-bold uppercase tracking-widest text-white/40">
                    {label}
                </label>
                {trailing}
            </div>
            <div className="relative">
                <input
                    id="password"
                    name="password"
                    type={visible ? "text" : "password"}
                    required
                    minLength={minLength}
                    placeholder={placeholder}
                    className="w-full px-4 py-2.5 pr-12 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm"
                />
                <button
                    type="button"
                    onClick={() => setVisible(v => !v)}
                    aria-label={visible ? "Skrýt heslo" : "Zobrazit heslo"}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-white/30 hover:text-white/70 transition-colors cursor-pointer"
                >
                    {visible ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.22A10.5 10.5 0 0 0 1.93 12c1.29 3.62 4.9 6.5 10.07 6.5 1.6 0 3.03-.28 4.28-.76M6.6 6.6A9.9 9.9 0 0 1 12 5.5c5.17 0 8.78 2.88 10.07 6.5a10.6 10.6 0 0 1-3.35 4.62M9.9 9.9a3 3 0 1 0 4.2 4.2M3 3l18 18" />
                        </svg>
                    ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M1.93 12C3.22 8.38 6.83 5.5 12 5.5s8.78 2.88 10.07 6.5c-1.29 3.62-4.9 6.5-10.07 6.5S3.22 15.62 1.93 12z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                    )}
                </button>
            </div>
        </div>
    )
}
