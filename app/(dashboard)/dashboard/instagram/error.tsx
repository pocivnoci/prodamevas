"use client"

import { RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"

export default function InstagramError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    const t = useTranslations("shell.error.page")
    return (
        <div className="min-h-[60vh] flex items-center justify-center">
            <div className="text-center space-y-4 max-w-md">
                <p className="text-4xl">⚠️</p>
                <h2 className="text-xl font-bold text-white">{t("title")}</h2>
                <p className="text-sm text-gray-400">
                    {error?.message || t("fallback")}
                </p>
                {error?.digest && (
                    <p className="text-xs text-gray-600 font-mono">{t("digest", { digest: error.digest })}</p>
                )}
                <button
                    onClick={reset}
                    className="inline-flex items-center gap-1.5 justify-center px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-xl transition-all shadow-lg"
                ><RefreshCw className="w-3.5 h-3.5 shrink-0" />{t("retry")}</button>
            </div>
        </div>
    )
}
