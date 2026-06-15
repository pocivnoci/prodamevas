import { updatePassword } from "@/app/reset-password/actions"
import { createClient } from "@/supabase/server"
import Link from "next/link"

const ERROR_MESSAGES: Record<string, string> = {
    password_too_short: "Heslo musí mít alespoň 6 znaků.",
    password_mismatch: "Hesla se neshodují.",
    same_password: "Nové heslo musí být jiné než to staré.",
    update_failed: "Změna hesla selhala. Zkus to znovu.",
}

export default async function ResetPasswordPage(props: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const searchParams = await props.searchParams
    const errorKey = searchParams?.error as string | undefined
    const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] || "Něco se pokazilo." : null

    // Recovery relaci vytvořil /auth/callback. Bez ní je odkaz neplatný/vypršel.
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#050505] p-4 text-white">
            <div className="w-full max-w-md p-8 bg-[#0a0a0a] border border-white/10 rounded-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex rounded-sm bg-aisummit-cinnabar/10 p-3 mb-4 border border-aisummit-cinnabar/20">
                        <svg className="w-6 h-6 text-aisummit-cinnabar" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-black uppercase tracking-widest">Nové heslo</h1>
                    <p className="text-white/40 mt-2 text-xs font-medium">Nastav si nové heslo pro přístup do Chrlit Studia.</p>
                </div>

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

                {user ? (
                    <form className="space-y-4">
                        <div>
                            <label htmlFor="password" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Nové heslo</label>
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

                        <button
                            formAction={updatePassword}
                            type="submit"
                            className="w-full relative group overflow-hidden rounded-sm bg-aisummit-cinnabar px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_0_20px_rgba(229,83,63,0.2)] transition-all hover:bg-aisummit-cinnabar/90 mt-2 cursor-pointer"
                        >
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                Nastavit heslo
                                <span className="transition-transform group-hover:translate-x-1">→</span>
                            </span>
                        </button>
                    </form>
                ) : (
                    <div className="space-y-4">
                        <div className="rounded-sm bg-amber-500/10 p-4 border border-amber-500/20">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-amber-400">Odkaz vypršel</h3>
                            <p className="mt-1 text-xs text-amber-400/80">Odkaz pro obnovu hesla je neplatný nebo vypršel. Vyžádej si nový.</p>
                        </div>
                        <Link
                            href="/forgot-password"
                            className="w-full flex items-center justify-center gap-2 rounded-sm bg-aisummit-cinnabar px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-aisummit-cinnabar/90"
                        >
                            Vyžádat nový odkaz →
                        </Link>
                    </div>
                )}
            </div>
        </div>
    )
}
