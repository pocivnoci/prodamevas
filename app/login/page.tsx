import Link from "next/link"
import { login } from "@/app/login/actions"
import { signInWithGoogle } from "@/app/auth/actions"
import { AuthDivider, GoogleButton } from "@/components/auth/GoogleButton"
import { AuthNotice } from "@/components/auth/AuthNotice"
import { PasswordField } from "@/components/auth/PasswordField"
import { googleAuthEnabled } from "@/lib/auth-providers"

const ERROR_MESSAGES: Record<string, string> = {
    invalid_credentials: "Neplatný e-mail nebo heslo. Zkus to znovu.",
    google_unavailable: "Přihlášení přes Google se teď nepodařilo spustit. Zkus to znovu, nebo použij e-mail.",
    no_access: "Chrlit je zatím v uzavřené betě. Tenhle účet do ní nemá přístup — pokud si myslíš, že jde o omyl, napiš nám.",
    // `middleware.ts` na chráněné cestě selhává zavřeně a posílá sem tenhle klíč.
    // Bez překladu z něj bylo obecné „Přihlášení se nepodařilo." u člověka, kterému
    // jen vypršela session — a ten pak zkouší heslo, které je správné.
    session_error: "Přihlášení vypršelo. Přihlas se prosím znovu.",
}

export default async function LoginPage(props: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const searchParams = await props.searchParams
    const errorKey = searchParams?.error as string | undefined
    const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] || "Přihlášení se nepodařilo." : null

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
                    <p className="text-white/40 mt-2 text-xs font-medium">Vítej zpátky v Chrlit Studiu.</p>
                </div>

                {errorMessage && (
                    <AuthNotice tone="error" title="Nepovedlo se">{errorMessage}</AuthNotice>
                )}

                {googleAuthEnabled() && (
                    <>
                        <form>
                            <GoogleButton action={signInWithGoogle} label="Pokračovat přes Google" />
                        </form>
                        <AuthDivider label="nebo e-mailem" />
                    </>
                )}

                <form className="space-y-5">
                    <div>
                        <label htmlFor="email" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Email</label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            required
                            autoComplete="email"
                            placeholder="tym@chrlit.cz"
                            className="w-full px-4 py-2.5 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm"
                        />
                    </div>

                    <PasswordField
                        label="Heslo"
                        trailing={
                            <Link href="/forgot-password" className="text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-aisummit-cinnabar transition-colors">
                                Zapomněl jsi heslo?
                            </Link>
                        }
                    />

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
