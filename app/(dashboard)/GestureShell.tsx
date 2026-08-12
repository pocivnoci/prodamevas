"use client"

import { useRef, type ReactNode } from "react"
import { RefreshCw } from "lucide-react"

import { useStudio } from "./StudioContext"
import { useSwipeSections, usePullToRefresh } from "./useStudioGestures"

/**
 * Obal obsahu, který nese dotyková gesta. Sám nic nevykresluje kolem —
 * jen drží uzel, na kterém gesta žijí, a ukazatel tažení nad ním.
 */
export function GestureShell({ children }: { children: ReactNode }) {
    const { bumpRefresh, refreshSubscription } = useStudio()
    const contentRef = useRef<HTMLDivElement>(null)
    const indicatorRef = useRef<HTMLDivElement>(null)

    useSwipeSections(contentRef)
    usePullToRefresh(indicatorRef, () => {
        // Obnova bez načtení stránky: `refreshNonce` sedí v `key` obsahu, takže
        // se otevřený tab přemountuje a načte si data znovu — bez jediné úpravy
        // ve dvaceti tabech.
        bumpRefresh()
        refreshSubscription()
    })

    return (
        <>
            <div
                ref={indicatorRef}
                aria-hidden
                className="lg:hidden fixed top-[env(safe-area-inset-top)] inset-x-0 z-30 flex justify-center pt-2 opacity-0 pointer-events-none"
            >
                <span className="w-9 h-9 rounded-full bg-[#0a0a0a] border border-white/10 flex items-center justify-center text-white/60 shadow-lg">
                    <RefreshCw className="w-4 h-4" />
                </span>
            </div>

            <div ref={contentRef}>{children}</div>
        </>
    )
}
