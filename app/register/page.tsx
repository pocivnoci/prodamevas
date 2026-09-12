import Link from "next/link"
import { signup } from "@/app/register/actions"
import { signUpWithGoogle } from "@/app/auth/actions"
import { AuthDivider, GoogleButton } from "@/components/auth/GoogleButton"
import { AuthNotice } from "@/components/auth/AuthNotice"
import { PasswordField } from "@/components/auth/PasswordField"
import { googleAuthEnabled } from "@/lib/auth-providers"
import { inviteRequired } from "@/lib/beta-access"
import { getTranslations } from "next-intl/server"
import { UiLocaleProvider } from "@/components/i18n/UiLocaleProvider"
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher"

export default async function RegisterPage(props: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const searchParams = await props.searchParams
    const t = await getTranslations("auth")
    const errorKey = searchParams?.error as string | undefined
    const isSuccess = searchParams?.success === "check_email"
    const errorMessage = errorKey
        ? (t.has(`register.errors.${errorKey}`) ? t(`register.errors.${errorKey}`) : t("register.fallbackError"))
        : null
    const gateClosed = inviteRequired()

    // Odkaz z pozvánky (waitlist, předání značky) nese kód i adresu. Předvyplnění
    // je celý rozdíl mezi „klikni a jsi uvnitř" a přepisováním kódu z e-mailu —
    // a u předání ještě rozhoduje o tom, že účet vznikne na TU adresu, na kterou
    // značka čeká. Server si obojí stejně ověřuje sám, tohle je jen pohodlí.
    const prefillCode = (typeof searchParams?.code === "string" ? searchParams.code : "").toUpperCase().trim()
    const prefillEmail = typeof searchParams?.email === "string" ? searchParams.email.trim() : ""

    return (
        <UiLocaleProvider>
        <div className="min-h-screen flex items-center justify-center bg-[#050505] p-4 text-white">
            <div className="w-full max-w-md p-8 bg-[#0a0a0a] border border-white/10 rounded-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex rounded-sm bg-emerald-500/10 p-3 mb-4 border border-emerald-500/20">
                        <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-black uppercase tracking-widest">{t("register.title")}</h1>
                    <p className="text-white/40 mt-2 text-xs font-medium">{t("register.subtitle")}</p>
                </div>

                {isSuccess && (
                    <AuthNotice tone="success" title={t("register.successTitle")}>
                        {t("register.successBody")}
                    </AuthNotice>
                )}

                {errorMessage && (
                    <AuthNotice tone="error" title={t("common.error")}>{errorMessage}</AuthNotice>
                )}

                {!isSuccess && (
                    <form className="space-y-4">
                        {/* Kód je brána — stojí nahoře, protože platí pro obě cesty dál.
                            Po otevření registrace pole mizí celé: nechat ho tu jako
                            nepovinné by vypadalo, že něco chybí, a lidi by se ptali,
                            kde kód vzít. */}
                        {gateClosed && (
                            <div>
                                <label htmlFor="inviteCode" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">{t("register.inviteCode")}</label>
                                <input
                                    id="inviteCode"
                                    name="inviteCode"
                                    type="text"
                                    required
                                    defaultValue={prefillCode}
                                    placeholder={t("register.invitePlaceholder")}
                                    className="w-full px-4 py-2.5 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm uppercase"
                                />
                            </div>
                        )}

                        {googleAuthEnabled() && (
                            <>
                                {/* formNoValidate: e-mail a heslo pod tím jsou pro tuhle cestu prázdné schválně. */}
                                <GoogleButton action={signUpWithGoogle} label={t("common.google")} formNoValidate />
                                <AuthDivider label={t("common.orEmail")} />
                            </>
                        )}

                        <div>
                            <label htmlFor="email" className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">{t("common.email")}</label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                required
                                defaultValue={prefillEmail}
                                autoComplete="email"
                                placeholder={t("register.emailPlaceholder")}
                                className="w-full px-4 py-2.5 rounded-sm bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/40 focus:border-aisummit-cinnabar/50 transition-all text-sm"
                            />
                        </div>

                        <PasswordField label={t("common.password")} placeholder={t("register.passwordPlaceholder")} minLength={6} />

                        <button
                            formAction={signup}
                            type="submit"
                            className="w-full relative group overflow-hidden rounded-sm bg-emerald-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all hover:bg-emerald-500 mt-2 cursor-pointer"
                        >
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                {t("register.submit")}
                                <span className="transition-transform group-hover:translate-x-1">→</span>
                            </span>
                        </button>
                    </form>
                )}

                <div className="mt-6 text-center">
                    <p className="text-xs text-white/30">
                        {t("register.hasAccount")}{" "}
                        <Link href="/login" className="text-aisummit-cinnabar hover:text-aisummit-cinnabar/80 transition-colors font-bold uppercase tracking-wider text-[10px]">
                            {t("register.login")}
                        </Link>
                    </p>
                </div>
                <div className="mt-4">
                    <LanguageSwitcher variant="compact" />
                </div>
            </div>
        </div>
        </UiLocaleProvider>
    )
}
