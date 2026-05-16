"use client"

import { Component, type ReactNode } from "react"

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
                <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
                    <div className="w-16 h-16 bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm flex items-center justify-center mb-6">
                        <span className="text-3xl">⚠️</span>
                    </div>
                    <h2 className="text-xl font-black uppercase tracking-widest text-white mb-3">
                        Něco se pokazilo
                    </h2>
                    <p className="text-white/40 text-sm max-w-md mb-8">
                        Došlo k neočekávané chybě. Zkuste obnovit stránku. Pokud problém přetrvává, kontaktujte podporu.
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={() => {
                                this.setState({ hasError: false, error: undefined })
                                window.location.reload()
                            }}
                            className="px-6 py-3 bg-aisummit-cinnabar text-white rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-aisummit-cinnabar/90 transition-all"
                        >
                            Obnovit stránku
                        </button>
                        <button
                            onClick={() => this.setState({ hasError: false, error: undefined })}
                            className="px-6 py-3 border border-white/10 text-white/60 rounded-sm font-bold text-xs uppercase tracking-widest hover:bg-white/5 transition-all"
                        >
                            Zkusit znovu
                        </button>
                    </div>
                    {this.state.error && (
                        <details className="mt-8 text-left max-w-lg w-full">
                            <summary className="text-[10px] text-white/20 cursor-pointer uppercase tracking-widest font-bold">
                                Technické detaily
                            </summary>
                            <pre className="mt-2 p-4 bg-[#0a0a0a] border border-white/5 rounded-sm text-[10px] text-white/30 overflow-auto max-h-32">
                                {this.state.error.message}
                            </pre>
                        </details>
                    )}
                </div>
            )
        }

        return this.props.children
    }
}
