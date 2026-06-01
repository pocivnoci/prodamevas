'use client'

import { useSearchParams } from 'next/navigation'
import { useState, Suspense } from 'react'

export default function MockPaymentPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center"><div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}>
            <MockPaymentContent />
        </Suspense>
    )
}

function MockPaymentContent() {
    const searchParams = useSearchParams()
    const transId = searchParams.get('transId') || ''
    const amount = searchParams.get('amount') || '0'
    const label = searchParams.get('label') || 'Platba'
    const clientId = searchParams.get('clientId') || ''
    const [processing, setProcessing] = useState(false)

    const amountCZK = (parseInt(amount) / 100).toLocaleString('cs-CZ')

    async function handlePay() {
        setProcessing(true)
        try {
            // Simulate callback to our own API
            const form = new URLSearchParams()
            form.set('transId', transId)
            form.set('status', 'PAID')
            form.set('refId', `mock-${clientId}`)
            form.set('method', 'MOCK')

            await fetch('/api/payments/callback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form.toString(),
            })

            // Redirect to dashboard with success
            window.location.href = '/dashboard/instagram?payment=success'
        } catch {
            window.location.href = '/dashboard/instagram?payment=error'
        }
    }

    function handleCancel() {
        window.location.href = '/dashboard/instagram?payment=cancelled'
    }

    return (
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
            <div className="relative bg-[#0f0f0f] border border-white/10 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
                {/* DEMO badge */}
                <div className="absolute top-4 right-4 z-10">
                    <span className="px-3 py-1 bg-amber-500/20 border border-amber-500/30 rounded-full text-[10px] font-black uppercase tracking-widest text-amber-400">
                        DEMO
                    </span>
                </div>

                {/* Glow */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[100px] bg-emerald-500/15 blur-[80px] pointer-events-none" />

                <div className="relative p-8 space-y-6">
                    {/* Header */}
                    <div className="text-center">
                        <div className="w-16 h-16 mx-auto mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center">
                            <span className="text-3xl">💳</span>
                        </div>
                        <h1 className="text-xl font-black uppercase tracking-tight text-white mb-1">
                            Platební brána
                        </h1>
                        <p className="text-white/40 text-xs">
                            Simulace platby — žádné peníze nebudou strženy
                        </p>
                    </div>

                    {/* Payment details */}
                    <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5 space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Produkt</span>
                            <span className="text-sm text-white font-bold">{decodeURIComponent(label)}</span>
                        </div>
                        <div className="h-px bg-white/5" />
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Částka</span>
                            <span className="text-2xl text-white font-black">{amountCZK} Kč</span>
                        </div>
                        <div className="h-px bg-white/5" />
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">ID transakce</span>
                            <span className="text-[10px] text-white/30 font-mono">{transId}</span>
                        </div>
                    </div>

                    {/* Mock card input (decorative) */}
                    <div className="space-y-3">
                        <div className="px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white/20 text-sm">
                            •••• •••• •••• 4242
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white/20 text-sm">
                                12/29
                            </div>
                            <div className="px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white/20 text-sm">
                                •••
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={handlePay}
                            disabled={processing}
                            className="flex-1 py-4 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-500 transition-all shadow-[0_0_25px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:cursor-wait"
                        >
                            {processing ? 'Zpracovávám...' : `✓ Zaplatit ${amountCZK} Kč`}
                        </button>
                        <button
                            onClick={handleCancel}
                            disabled={processing}
                            className="px-6 py-4 border border-white/10 text-white/40 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-white/5 transition-all"
                        >
                            Zrušit
                        </button>
                    </div>

                    {/* Footer */}
                    <p className="text-center text-[9px] text-white/20 font-bold uppercase tracking-widest">
                        🔒 Toto je demo prostředí — žádná reálná platba neprobíhá
                    </p>
                </div>
            </div>
        </div>
    )
}
