"use client"

import { RefreshCw } from "lucide-react"

export default function InstagramError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    return (
        <div className="min-h-[60vh] flex items-center justify-center">
            <div className="text-center space-y-4 max-w-md">
                <p className="text-4xl">⚠️</p>
                <h2 className="text-xl font-bold text-white">Chyba při načítání</h2>
                <p className="text-sm text-gray-400">
                    {error?.message || "Nepodařilo se načíst Instagram stránku."}
                </p>
                {error?.digest && (
                    <p className="text-xs text-gray-600 font-mono">Digest: {error.digest}</p>
                )}
                <button
                    onClick={reset}
                    className="inline-flex items-center gap-1.5 justify-center px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-xl transition-all shadow-lg"
                ><RefreshCw className="w-3.5 h-3.5 shrink-0" />Zkusit znovu</button>
            </div>
        </div>
    )
}
