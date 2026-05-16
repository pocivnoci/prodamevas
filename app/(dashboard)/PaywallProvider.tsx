"use client"

import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from "react"
import { useStudio } from "@/app/(dashboard)/StudioContext"
import { CheckCircle2, X, Zap, AlertTriangle } from "lucide-react"

// ─── Toast System ────────────────────────────────────────────

interface Toast {
    id: string
    type: "success" | "error" | "warning" | "info"
    message: string
    duration?: number
}

interface PaywallContextType {
    showUpgradeModal: (reason: string, requiredPlan?: string) => void
    showToast: (type: Toast["type"], message: string) => void
}

const PaywallContext = createContext<PaywallContextType>({
    showUpgradeModal: () => {},
    showToast: () => {},
})

export function usePaywall() {
    return useContext(PaywallContext)
}

export function PaywallProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const [modal, setModal] = useState<{ show: boolean; reason: string; requiredPlan?: string }>({
        show: false,
        reason: "",
    })

    const showToast = useCallback((type: Toast["type"], message: string, duration = 5000) => {
        const id = Math.random().toString(36).slice(2)
        setToasts(prev => [...prev, { id, type, message, duration }])
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id))
        }, duration)
    }, [])

    const showUpgradeModal = useCallback((reason: string, requiredPlan?: string) => {
        setModal({ show: true, reason, requiredPlan })
    }, [])

    // Check URL for payment result
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const payment = params.get("payment")
        if (payment) {
            // Clean URL
            const url = new URL(window.location.href)
            url.searchParams.delete("payment")
            window.history.replaceState({}, "", url.toString())

            switch (payment) {
                case "success":
                    showToast("success", "Platba úspěšná! Váš plán byl aktivován. 🎉")
                    break
                case "cancelled":
                    showToast("warning", "Platba byla zrušena.")
                    break
                case "pending":
                    showToast("info", "Platba se zpracovává. Plán bude aktivován po potvrzení.")
                    break
                case "error":
                    showToast("error", "Při platbě došlo k chybě. Zkuste to znovu.")
                    break
            }
        }
    }, [showToast])

    return (
        <PaywallContext.Provider value={{ showUpgradeModal, showToast }}>
            {children}

            {/* Toast notifications */}
            <div className="fixed top-4 right-4 z-[100] space-y-2 pointer-events-none">
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        className={`pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-sm border backdrop-blur-xl shadow-2xl animate-in slide-in-from-right duration-300 max-w-sm ${
                            toast.type === "success"
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                : toast.type === "error"
                                ? "bg-red-500/10 border-red-500/20 text-red-400"
                                : toast.type === "warning"
                                ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                                : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                        }`}
                    >
                        {toast.type === "success" && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                        {toast.type === "error" && <AlertTriangle className="w-4 h-4 shrink-0" />}
                        {toast.type === "warning" && <AlertTriangle className="w-4 h-4 shrink-0" />}
                        {toast.type === "info" && <Zap className="w-4 h-4 shrink-0" />}
                        <span className="text-xs font-bold">{toast.message}</span>
                        <button
                            onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                            className="ml-auto text-white/30 hover:text-white/60 transition-colors"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                ))}
            </div>

            {/* Upgrade Modal */}
            {modal.show && (
                <UpgradeModal
                    reason={modal.reason}
                    requiredPlan={modal.requiredPlan}
                    onClose={() => setModal({ show: false, reason: "" })}
                />
            )}
        </PaywallContext.Provider>
    )
}

// ─── Upgrade Modal ───────────────────────────────────────────

function UpgradeModal({
    reason,
    requiredPlan,
    onClose,
}: {
    reason: string
    requiredPlan?: string
    onClose: () => void
}) {
    const { setActiveSection } = useStudio()

    return (
        <div className="fixed inset-0 z-[99] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-[#0a0a0a] border border-white/10 rounded-sm max-w-md w-full mx-4 overflow-hidden shadow-2xl">
                {/* Glow */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[100px] bg-aisummit-cinnabar/20 blur-[80px] pointer-events-none" />

                <div className="relative p-8 text-center">
                    {/* Icon */}
                    <div className="w-16 h-16 mx-auto mb-6 bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm flex items-center justify-center">
                        <Zap className="w-8 h-8 text-aisummit-cinnabar" />
                    </div>

                    <h2 className="text-xl font-black uppercase tracking-tight text-white mb-3">
                        Upgradujte plán
                    </h2>

                    <p className="text-white/50 text-sm mb-6 max-w-xs mx-auto">
                        {reason}
                    </p>

                    {requiredPlan && (
                        <div className="bg-white/5 border border-white/5 rounded-sm px-4 py-3 mb-6">
                            <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">Doporučený plán</span>
                            <p className="text-white font-black text-lg mt-1">{requiredPlan}</p>
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            onClick={() => {
                                setActiveSection("settings")
                                onClose()
                            }}
                            className="flex-1 py-3 bg-aisummit-cinnabar text-white rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_25px_rgba(230,57,70,0.3)]"
                        >
                            🚀 Vybrat plán
                        </button>
                        <button
                            onClick={onClose}
                            className="px-6 py-3 border border-white/10 text-white/40 rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-white/5 transition-all"
                        >
                            Zavřít
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
