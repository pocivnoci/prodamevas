'use client'

import { useState } from 'react'
import { joinWaitlist } from '@/app/actions/waitlist'
import Link from 'next/link'

export function WaitlistForm() {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [errorMsg, setErrorMsg] = useState('')

    async function handleSubmit(formData: FormData) {
        setStatus('loading')
        const result = await joinWaitlist(formData)
        
        if (result.success) {
            setStatus('success')
        } else {
            setStatus('error')
            setErrorMsg(result.error || 'Něco se pokazilo.')
        }
    }

    if (status === 'success') {
        return (
            <div className="flex flex-col items-center justify-center p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl backdrop-blur-xl">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Jste na seznamu!</h3>
                <p className="text-gray-400 text-center text-sm">
                    Dáme vám vědět hned, jakmile otevřeme další místa v Autopilotovi.
                </p>
                <div className="mt-6 text-center">
                    <Link href="/register" className="text-xs text-white/50 hover:text-white transition-colors underline decoration-white/30 underline-offset-4">
                        Máte kód pozvánky? Zaregistrujte se
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="w-full max-w-md mx-auto">
            <form action={handleSubmit} className="flex flex-col gap-3">
                <div className="relative">
                    <input 
                        type="email" 
                        name="email"
                        required
                        placeholder="tvuj@email.cz"
                        className="w-full px-5 py-4 bg-black/60 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/50 transition-all text-sm"
                        disabled={status === 'loading'}
                    />
                </div>
                <button 
                    type="submit"
                    disabled={status === 'loading'}
                    className="w-full relative group overflow-hidden rounded-xl bg-aisummit-cinnabar px-5 py-4 text-sm font-bold text-white shadow-[0_0_25px_rgba(230,57,70,0.3)] transition-all hover:bg-aisummit-cinnabar/90 disabled:opacity-70 uppercase tracking-widest"
                >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                        {status === 'loading' ? 'Odesílám...' : 'Připojit se na Waitlist'}
                        {status !== 'loading' && <span className="transition-transform group-hover:translate-x-1">→</span>}
                    </span>
                </button>
                {status === 'error' && (
                    <p className="text-red-400 text-sm text-center mt-2">{errorMsg}</p>
                )}
            </form>
            <div className="mt-6 text-center">
                <Link href="/register" className="text-xs text-white/50 hover:text-white transition-colors underline decoration-white/30 underline-offset-4">
                    Máte kód pozvánky? Vstupte zde
                </Link>
            </div>
        </div>
    )
}
