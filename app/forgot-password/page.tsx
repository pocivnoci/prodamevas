import { requestPasswordReset } from "@/app/forgot-password/actions"
import Link from "next/link"

const ERROR_MESSAGES: Record<string, string> = {
    missing_email: "Zadej svůj e-mail.",
    rate_limit: "Příliš mnoho pokusů. Zkus to za chvíli znovu.",
    link_expired: "Odkaz pro obnovu vypršel nebo je neplatný. Vyžádej si nový.",
}

export default async function ForgotPasswordPage(props: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const searchParams = await props.searchParams
    const isSent = searchParams?.sent === "1"
    const errorKey = searchParams?.error as string | undefined
    const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] || "Něco se pokazilo." : null

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#050505] p-4 text-white">
            <div className="w-full max-w-md p-8 bg-[#0a0a0a] border border-white/10 rounded-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex rounded-sm bg-aisummit-cinnabar/10 p-3 mb-4 border border-aisummit-cinnabar/20">
                        <svg className="w-6 h-6 text-aisummit-cinnabar" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-black uppercase tracking-widest">Obnova hesla</h1>
                    <p className="text-white/40 mt-2 text-xs font-medium">Zadej e-mail a pošleme ti odkaz pro nastavení nového hesla.</p>
                </div>

                {isSent && (
                    <div className="mb-6 rounded-sm bg-emerald-500/10 p-4 border border-emerald-500/20">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-400">Odkaz odeslán</h3>
                                <div className="mt-1 text-xs text-emerald-400/80">
                                    <p>Pokud účet s tímto e-mailem existuje, poslali jsme na něj odkaz pro obnovu hesla. Zkontroluj i složku se spamem.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {errorMessage && (
                    <div className="mb-6 rounded-sm bg-red-500/10 p-4 border border-red-500/20">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-red-400">Chyba</h3>
                                <div className="mt-1 text-xs text-red-400/80">
                                    <p>{errorMessage}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {!isSent && (
                    <form className="space-y-5">
                        <div>
                            <label htmlFor="email" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Email</label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                required
                                placeholder="tvuj@email.cz"
                                className="w-full px-4 py-2.5 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm"
                            />
                        </div>

                        <button
                            formAction={requestPasswordReset}
                            type="submit"
                            className="w-full relative group overflow-hidden rounded-sm bg-aisummit-cinnabar px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_0_20px_rgba(229,83,63,0.2)] transition-all hover:bg-aisummit-cinnabar/90 mt-2 cursor-pointer"
                        >
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                Poslat odkaz
                                <span className="transition-transform group-hover:translate-x-1">→</span>
                            </span>
                        </button>
                    </form>
                )}

                <div className="mt-6 text-center">
                    <p className="text-xs text-white/30">
                        Vzpomněl sis na heslo?{" "}
                        <Link href="/login" className="text-aisummit-cinnabar hover:text-aisummit-cinnabar/80 transition-colors font-bold uppercase tracking-wider text-[10px]">
                            Přihlas se
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    )
}
