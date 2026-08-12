import Link from "next/link"
import { signup } from "@/app/register/actions"
import { signUpWithGoogle } from "@/app/auth/actions"
import { AuthDivider, GoogleButton } from "@/components/auth/GoogleButton"
import { AuthNotice } from "@/components/auth/AuthNotice"
import { PasswordField } from "@/components/auth/PasswordField"
import { googleAuthEnabled } from "@/lib/auth-providers"

const ERROR_MESSAGES: Record<string, string> = {
    missing_fields: "Vyplň email i heslo.",
    password_too_short: "Heslo musí mít alespoň 6 znaků.",
    already_exists: "Účet s tímto emailem už existuje. Přihlas se.",
    signup_failed: "Registrace selhala. Zkus to znovu.",
    invalid_invite: "Neplatný nebo vyčerpaný kód pozvánky.",
    invite_required: "Chrlit je zatím na pozvánky. Vyplň kód a klikni na Google znovu.",
    google_unavailable: "Registrace přes Google se teď nepodařila spustit. Zkus to znovu, nebo použij e-mail.",
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
                    <AuthNotice tone="success" title="Registrace úspěšná!">
                        Zkontroluj svůj email a klikni na potvrzovací odkaz.
                    </AuthNotice>
                )}

                {errorMessage && (
                    <AuthNotice tone="error" title="Chyba">{errorMessage}</AuthNotice>
                )}

                {!isSuccess && (
                    <form className="space-y-4">
                        {/* Kód je brána — stojí nahoře, protože platí pro obě cesty dál. */}
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

                        {googleAuthEnabled() && (
                            <>
                                {/* formNoValidate: e-mail a heslo pod tím jsou pro tuhle cestu prázdné schválně. */}
                                <GoogleButton action={signUpWithGoogle} label="Pokračovat přes Google" formNoValidate />
                                <AuthDivider label="nebo e-mailem" />
                            </>
                        )}

                        <div>
                            <label htmlFor="email" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">Email</label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                required
                                autoComplete="email"
                                placeholder="tvuj@email.cz"
                                className="w-full px-4 py-2.5 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm"
                            />
                        </div>

                        <PasswordField label="Heslo" placeholder="Min. 6 znaků" minLength={6} />

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
