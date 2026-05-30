import { signup } from "@/app/register/actions"
import Link from "next/link"

const ERROR_MESSAGES: Record<string, string> = {
    missing_fields: "Vyplň email i heslo.",
    password_mismatch: "Hesla se neshodují.",
    password_too_short: "Heslo musí mít alespoň 6 znaků.",
    already_exists: "Účet s tímto emailem už existuje. Přihlas se.",
    signup_failed: "Registrace selhala. Zkus to znovu.",
    invalid_invite: "Neplatný nebo vyčerpaný kód pozvánky.",
}

export default async function RegisterPage(props: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const searchParams = await props.searchParams
    const errorKey = searchParams?.error as string | undefined
    const isSuccess = searchParams?.success === "check_email"
    const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] || "Registrace selhala." : null

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#050505] p-4 text-white">
            <div className="w-full max-w-md p-8 bg-[#0a0a0a] border border-white/10 rounded-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex rounded-sm bg-emerald-500/10 p-3 mb-4 border border-emerald-500/20">
                        <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-black uppercase tracking-widest">Registrace</h1>
                    <p className="text-white/40 mt-2 text-xs font-medium">Vytvoř si účet pro přístup do Chrlit Studia.</p>
                </div>

                {isSuccess && (
                    <div className="mb-6 rounded-sm bg-emerald-500/10 p-4 border border-emerald-500/20">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-400">Registrace úspěšná!</h3>
                                <div className="mt-1 text-xs text-emerald-400/80">
                                    <p>Zkontroluj svůj email a klikni na potvrzovací odkaz.</p>
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

                {!isSuccess && (
                    <form className="space-y-4">
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

                        <div>
                            <label htmlFor="password" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Heslo</label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                required
                                minLength={6}
                                placeholder="Min. 6 znaků"
                                className="w-full px-4 py-2.5 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm"
                            />
                        </div>

                        <div>
                            <label htmlFor="passwordConfirm" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Heslo znovu</label>
                            <input
                                id="passwordConfirm"
                                name="passwordConfirm"
                                type="password"
                                required
                                minLength={6}
                                placeholder="Zopakuj heslo"
                                className="w-full px-4 py-2.5 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm"
                            />
                        </div>

                        <div>
                            <label htmlFor="inviteCode" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Kód pozvánky</label>
                            <input
                                id="inviteCode"
                                name="inviteCode"
                                type="text"
                                required
                                placeholder="Např. BETA-VIP"
                                className="w-full px-4 py-2.5 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm uppercase"
                            />
                        </div>

                        <button
                            formAction={signup}
                            type="submit"
                            className="w-full relative group overflow-hidden rounded-sm bg-emerald-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all hover:bg-emerald-500 mt-2 cursor-pointer"
                        >
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                Vytvořit účet
                                <span className="transition-transform group-hover:translate-x-1">→</span>
                            </span>
                        </button>
                    </form>
                )}

                <div className="mt-6 text-center">
                    <p className="text-xs text-white/30">
                        Už máš účet?{" "}
                        <Link href="/login" className="text-aisummit-cinnabar hover:text-aisummit-cinnabar/80 transition-colors font-bold uppercase tracking-wider text-[10px]">
                            Přihlas se
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    )
}
