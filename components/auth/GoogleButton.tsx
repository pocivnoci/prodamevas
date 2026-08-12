/**
 * Tlačítko „přes Google". Bílá plocha s barevným G je to, co lidi poznají —
 * proto se jako jediný prvek přihlašovacích stránek vymyká tmavé paletě.
 */
export function GoogleButton({
    action,
    label,
    formNoValidate,
}: {
    action: (formData: FormData) => void | Promise<void>
    label: string
    /** Formulář sdílený s e-mailovou cestou — jinak by prázdná pole blokovala odeslání. */
    formNoValidate?: boolean
}) {
    return (
        <button
            formAction={action}
            formNoValidate={formNoValidate}
            type="submit"
            className="w-full flex items-center justify-center gap-3 rounded-sm bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#1f1f1f] transition-all hover:bg-white/90 cursor-pointer"
        >
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0" aria-hidden="true">
                <path fill="#4285F4" d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.18-2 3.44-4.96 3.44-8.56z" />
                <path fill="#34A853" d="M12 23.5c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.03-6.45-4.75H1.7v2.98A11.5 11.5 0 0 0 12 23.5z" />
                <path fill="#FBBC05" d="M5.55 14.17a6.9 6.9 0 0 1 0-4.34V6.85H1.7a11.5 11.5 0 0 0 0 10.3l3.85-2.98z" />
                <path fill="#EA4335" d="M12 4.75c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.72 1.27 15.11.25 12 .25 7.5.25 3.6 2.84 1.7 6.85l3.85 2.98C6.46 7.11 9 4.75 12 4.75z" />
            </svg>
            {label}
        </button>
    )
}

/** Oddělovač mezi rychlou cestou (Google) a tou pomalou (e-mail a heslo). */
export function AuthDivider({ label }: { label: string }) {
    return (
        <div className="flex items-center gap-3 my-6">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[8px] font-bold uppercase tracking-widest text-white/25">{label}</span>
            <span className="h-px flex-1 bg-white/10" />
        </div>
    )
}
