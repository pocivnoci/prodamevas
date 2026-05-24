"use client"

import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from "react"
import { useStudio } from "@/app/(dashboard)/StudioContext"
import { CheckCircle2, X, Zap, AlertTriangle, Lock } from "lucide-react"

// ─── Toast System ────────────────────────────────────────────

interface Toast {
    id: string
    type: "success" | "error" | "warning" | "info"
    message: string
    duration?: number
}

interface PaywallContextType {
    showUpgradeModal: (reason: string, requiredPlan?: string) => void
    showPlanUnlockModal: () => void
    showToast: (type: Toast["type"], message: string) => void
}

const PaywallContext = createContext<PaywallContextType>({
    showUpgradeModal: () => {},
    showPlanUnlockModal: () => {},
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
    const [planUnlockModal, setPlanUnlockModal] = useState(false)

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

    const showPlanUnlockModal = useCallback(() => {
        setPlanUnlockModal(true)
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
        <PaywallContext.Provider value={{ showUpgradeModal, showPlanUnlockModal, showToast }}>
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

            {/* Upgrade Modal (credits) */}
            {modal.show && (
                <UpgradeModal
                    reason={modal.reason}
                    requiredPlan={modal.requiredPlan}
                    onClose={() => setModal({ show: false, reason: "" })}
                />
            )}

            {/* Plan Unlock Modal (trial → paid) */}
            {planUnlockModal && (
                <PlanUnlockModal onClose={() => setPlanUnlockModal(false)} />
            )}
        </PaywallContext.Provider>
    )
}

// ─── Upgrade Modal (credits) ─────────────────────────────────

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
                        Dobijte kredity
                    </h2>

                    <p className="text-white/50 text-sm mb-6 max-w-xs mx-auto">
                        {reason}
                    </p>

                    {requiredPlan && (
                        <div className="bg-white/5 border border-white/5 rounded-sm px-4 py-3 mb-6">
                            <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">Dobíjecí kredity</span>
                            <p className="text-white font-black text-lg mt-1">15 Kč / kredit</p>
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
                            💳 Dobijte kredity
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

// ─── Plan Unlock Modal (trial → paid) ────────────────────────

function PlanUnlockModal({ onClose }: { onClose: () => void }) {
    const { subscription, projectId } = useStudio()
    const [loading, setLoading] = useState(false)

    const handleActivate = async () => {
        if (!projectId) return
        setLoading(true)
        try {
            const resp = await fetch("/api/payments/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId: projectId, planId: "chrlit" }),
            })
            const data = await resp.json()
            if (data.redirectUrl) {
                window.location.href = data.redirectUrl
            }
        } catch {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[99] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

            <div className="relative bg-[#0a0a0a] border border-white/10 rounded-sm max-w-lg w-full mx-4 overflow-hidden shadow-2xl">
                {/* Glow */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[120px] bg-gradient-to-r from-aisummit-cinnabar/20 to-orange-500/20 blur-[80px] pointer-events-none" />

                <div className="relative p-8">
                    {/* Icon */}
                    <div className="w-16 h-16 mx-auto mb-6 bg-gradient-to-br from-aisummit-cinnabar/20 to-orange-600/20 border border-aisummit-cinnabar/30 rounded-sm flex items-center justify-center">
                        <Lock className="w-8 h-8 text-aisummit-cinnabar" />
                    </div>

                    <h2 className="text-xl font-black uppercase tracking-tight text-white mb-2 text-center">
                        Odemkněte svůj plán
                    </h2>

                    <p className="text-white/40 text-sm mb-6 text-center max-w-sm mx-auto">
                        Váš měsíční plán obsahuje {subscription?.planPostsTotal || 30} příspěvků.
                        Aktivujte předplatné a odemkněte je všechny.
                    </p>

                    {/* What you get */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-sm p-4 mb-6 space-y-3">
                        <div className="flex items-center gap-3">
                            <span className="text-base">📋</span>
                            <div>
                                <p className="text-[10px] text-white/70 font-bold">Měsíční plán (~30 příspěvků)</p>
                                <p className="text-[9px] text-white/30">Caption, hashtags, obrázek — vše vygenerováno</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-base">⚡</span>
                            <div>
                                <p className="text-[10px] text-white/70 font-bold">30 kreditů na tvorbu navíc</p>
                                <p className="text-[9px] text-white/30">Extra posty, varianty, nápady, produkty</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-base">📊</span>
                            <div>
                                <p className="text-[10px] text-white/70 font-bold">Plná analytika</p>
                                <p className="text-[9px] text-white/30">Výkon příspěvků, doporučení, trendy</p>
                            </div>
                        </div>
                    </div>

                    {/* Price */}
                    <div className="text-center mb-6">
                        <span className="text-3xl font-black text-white">490 Kč</span>
                        <span className="text-white/30 text-sm font-bold ml-1">/ měsíc</span>
                    </div>

                    {/* CTA */}
                    <div className="flex gap-3">
                        <button
                            onClick={handleActivate}
                            disabled={loading}
                            className="flex-1 py-3.5 bg-gradient-to-r from-aisummit-cinnabar to-orange-600 text-white rounded-sm font-black text-xs uppercase tracking-widest hover:opacity-90 transition-all shadow-[0_0_30px_rgba(229,83,63,0.3)] disabled:opacity-50"
                        >
                            {loading ? "Přesměrování..." : "💳 Aktivovat nyní"}
                        </button>
                        <button
                            onClick={onClose}
                            className="px-6 py-3.5 border border-white/10 text-white/40 rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-white/5 transition-all"
                        >
                            Později
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
