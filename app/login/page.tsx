import { login } from "@/app/login/actions"
import Link from "next/link"

export default async function LoginPage(props: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const searchParams = await props.searchParams
    const isError = searchParams?.error === "invalid_credentials"

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#050505] p-4 text-white">
            <div className="w-full max-w-md p-8 bg-[#0a0a0a] border border-white/10 rounded-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex rounded-sm bg-aisummit-cinnabar/10 p-3 mb-4 border border-aisummit-cinnabar/20">
                        <svg className="w-6 h-6 text-aisummit-cinnabar" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-black uppercase tracking-widest">Přihlášení</h1>
                    <p className="text-white/40 mt-2 text-xs font-medium">Zadej své údaje pro přístup do Chrlit Studia.</p>
                </div>

                {isError && (
                    <div className="mb-6 rounded-sm bg-red-500/10 p-4 border border-red-500/20">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-red-400">Chybné přihlášení</h3>
                                <div className="mt-1 text-xs text-red-400/80">
                                    <p>Neplatný e-mail nebo heslo. Zkus to znovu.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <form className="space-y-5">
                    <div>
                        <label htmlFor="email" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Email</label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            required
                            placeholder="tym@chrlit.cz"
                            className="w-full px-4 py-2.5 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm"
                        />
                    </div>

                    <div>
                        <label htmlFor="password" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Heslo</label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            required
                            className="w-full px-4 py-2.5 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm"
                        />
                    </div>

                    <button
                        formAction={login}
                        type="submit"
                        className="w-full relative group overflow-hidden rounded-sm bg-aisummit-cinnabar px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_0_20px_rgba(229,83,63,0.2)] transition-all hover:bg-aisummit-cinnabar/90 mt-2 cursor-pointer"
                    >
                        <span className="relative z-10 flex items-center justify-center gap-2">
                            Přihlásit se
                            <span className="transition-transform group-hover:translate-x-1">→</span>
                        </span>
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <p className="text-xs text-white/30">
                        Nemáš účet?{" "}
                        <Link href="/register" className="text-aisummit-cinnabar hover:text-aisummit-cinnabar/80 transition-colors font-bold uppercase tracking-wider text-[10px]">
                            Zaregistruj se
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    )
}
