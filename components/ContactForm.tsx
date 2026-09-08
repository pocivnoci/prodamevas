'use client'

import { useState } from 'react'
import { leaveContact } from '@/app/actions/contact'
import Link from 'next/link'

/**
 * Finální CTA landingu: nechte kontakt, ozve se vám člověk.
 *
 * Nahradilo „Připojit se na Waitlist". Waitlist neslíbil nic konkrétního —
 * a podle toho se s ním zacházelo. Tenhle formulář slibuje hovor, takže se
 * ptá na to, co je k hovoru potřeba: telefon a web. Obojí NEPOVINNĚ, protože
 * povinné pole navíc na hlavním CTA stojí víc odeslání, než kolik přinese
 * vyplněných čísel.
 *
 * Web má vlastní důvod: celý onboarding Chrlitu začíná adresou webu, takže kdo
 * ji nechá, může dostat ukázku ještě před prvním telefonátem.
 *
 * `planId` / `termMonths` nesou volbu z ceníku. Kdo klikne na konkrétní kartu,
 * přichází s rozhodnutím — ztratit ho znamená ptát se znovu na to, co už řekl.
 */
export function ContactForm({ planId, termMonths, subdued = false }: {
    planId?: string | null
    termMonths?: number
    /** Formulář stojí pod jiným, hlavním tlačítkem — nesmí s ním soupeřit barvou. */
    subdued?: boolean
} = {}) {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [errorMsg, setErrorMsg] = useState('')

    async function handleSubmit(formData: FormData) {
        const email = String(formData.get('email') || '').trim()
        // Explicitní kontrola s českou hláškou — nativní bublina prohlížeče se
        // přes React form action nespustí spolehlivě. Server si to ověří znovu.
        if (!email) {
            setStatus('error')
            setErrorMsg('Zadejte e-mailovou adresu.')
            return
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setStatus('error')
            setErrorMsg('Zadejte platnou e-mailovou adresu.')
            return
        }

        setStatus('loading')
        const result = await leaveContact(formData)

        if (result.success) {
            setStatus('success')
        } else {
            setStatus('error')
            setErrorMsg(result.error || 'Něco se pokazilo.')
        }
    }

    if (status === 'success') {
        return (
            <div className="flex flex-col items-center justify-center p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-sm backdrop-blur-xl">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Máme to.</h3>
                {/* Konkrétní lhůta, ne „brzy". Kdo čeká, má vědět do kdy — a nás
                    to drží u toho, že se ozveme (hlídá ranní brief obchodu). */}
                <p className="text-gray-400 text-center text-sm">
                    Ozveme se vám do jednoho pracovního dne. Podíváme se přitom na váš web, ať máme co ukázat.
                </p>
                <div className="mt-6 text-center">
                    <Link href="/register" className="text-xs text-white/50 hover:text-white transition-colors underline decoration-white/30 underline-offset-4">
                        Máte kód pozvánky? Zaregistrujte se
                    </Link>
                </div>
            </div>
        )
    }

    const field = "w-full px-5 py-4 bg-black/60 border border-white/10 rounded-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/50 transition-all text-sm"

    return (
        <div className="w-full max-w-md mx-auto">
            <form action={handleSubmit} className="flex flex-col gap-3">
                <input
                    type="email"
                    name="email"
                    required
                    autoComplete="email"
                    placeholder="vas@email.cz"
                    className={field}
                    disabled={status === 'loading'}
                />
                {/* Web první, telefon druhý: adresa webu je to, z čeho Chrlit
                    vygeneruje ukázku, takže má pro obchod větší cenu než číslo.
                    Dva sloupce i na mobilu — třetí řádek pod sebou by na telefonu
                    odsunul odesílací tlačítko pod okraj obrazovky. */}
                <div className="grid grid-cols-2 gap-3">
                    <input
                        type="text"
                        name="website"
                        inputMode="url"
                        autoComplete="url"
                        placeholder="vasefirma.cz"
                        aria-label="Web (nepovinné)"
                        className={field}
                        disabled={status === 'loading'}
                    />
                    <input
                        type="tel"
                        name="phone"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="telefon"
                        aria-label="Telefon (nepovinné)"
                        className={field}
                        disabled={status === 'loading'}
                    />
                </div>
                {/* Volba z ceníku jede s přihláškou. Skryté pole, ne stav v paměti:
                    server action dostane FormData, ne React kontext. */}
                <p className="text-[10px] text-white/30 -mt-1">Web a telefon nepovinně — díky nim se ozveme rovnou s ukázkou.</p>
                <input type="hidden" name="planInterest" value={planId || ''} />
                <input type="hidden" name="termInterest" value={termMonths ? String(termMonths) : ''} />
                <button
                    type="submit"
                    disabled={status === 'loading'}
                    className={`w-full relative group overflow-hidden rounded-sm px-5 py-4 text-sm font-bold transition-all disabled:opacity-70 uppercase tracking-widest ${
                        subdued
                            ? "bg-white/5 text-white/80 border border-white/15 hover:bg-white/10"
                            : "bg-aisummit-cinnabar text-white shadow-[0_0_25px_rgba(230,57,70,0.3)] hover:bg-aisummit-cinnabar/90"
                    }`}
                >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                        {status === 'loading' ? 'Odesílám...' : 'Ozvěte se mi'}
                        {status !== 'loading' && <span className="transition-transform group-hover:translate-x-1">→</span>}
                    </span>
                </button>
                {status === 'error' && (
                    <p className="text-red-400 text-sm text-center mt-2">{errorMsg}</p>
                )}
            </form>
            <div className="mt-6 text-center space-y-3">
                <Link href="/register" className="block text-xs text-white/50 hover:text-white transition-colors underline decoration-white/30 underline-offset-4">
                    Máte kód pozvánky? Vstupte zde
                </Link>
                {/* Telefon je osobní údaj navíc oproti waitlistu, takže tu musí být
                    vidět, k čemu ho bereme a kde se dá dočíst zbytek. */}
                <p className="text-[10px] text-white/25">
                    Kontakt použijeme jen k tomu, abychom se vám ozvali.{" "}
                    <Link href="/privacy" className="underline decoration-white/20 underline-offset-2 hover:text-white/50">
                        Zpracování údajů
                    </Link>
                </p>
            </div>
        </div>
    )
}
