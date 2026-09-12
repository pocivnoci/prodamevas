"use client"

import { Component, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { TriangleAlert } from "lucide-react"

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("Dashboard error:", error, errorInfo)
    }

    render() {
        if (this.state.hasError) {
            return (
                <ErrorFallback
                    error={this.state.error}
                    onReload={() => {
                        this.setState({ hasError: false, error: undefined })
                        window.location.reload()
                    }}
                    onRetry={() => this.setState({ hasError: false, error: undefined })}
                />
            )
        }

        return this.props.children
    }
}

/** Třída hooky nemá — překlady bere vnořená funkční komponenta. */
function ErrorFallback({ error, onReload, onRetry }: { error?: Error; onReload: () => void; onRetry: () => void }) {
    const t = useTranslations("shell.error")
    return (
                <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
                    <div className="w-16 h-16 bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm flex items-center justify-center mb-6">
                        <TriangleAlert className="w-6 h-6" />
                    </div>
                    <h2 className="text-xl font-black uppercase tracking-widest text-white mb-3">
                        {t("title")}
                    </h2>
                    <p className="text-white/40 text-sm max-w-md mb-8">
                        {t("body")}
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={onReload}
                            className="px-6 py-3 bg-aisummit-cinnabar text-white rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-aisummit-cinnabar/90 transition-all"
                        >
                            {t("reload")}
                        </button>
                        <button
                            onClick={onRetry}
                            className="px-6 py-3 border border-white/10 text-white/60 rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-white/5 transition-all"
                        >
                            {t("retry")}
                        </button>
                    </div>
                    {error && (
                        <details className="mt-8 text-left max-w-lg w-full">
                            <summary className="text-[10px] text-white/20 cursor-pointer uppercase tracking-widest font-bold">
                                {t("details")}
                            </summary>
                            <pre className="mt-2 p-4 bg-[#0a0a0a] border border-white/5 rounded-sm text-[10px] text-white/30 overflow-auto max-h-32">
                                {error.message}
                            </pre>
                        </details>
                    )}
                </div>
    )
}
