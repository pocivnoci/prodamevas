"use client"

import { LogoPV } from "@/components/LogoPV"
import { useStudio, useStudioNavigate } from "./StudioContext"

/**
 * Hlavička pro telefon — **jen tam**, na počítači ji nahrazuje postranní sloupec.
 *
 * Když navigace odešla dolů do lišty, zůstal nahoře jen holý nadpis sekce:
 * žádná značka a hlavně žádný zbývající kredit, protože ten se ukazuje ve widgetu
 * předplatného, který je na mobilu schovaný pod „Více". Tohle obojí vrací.
 *
 * Není `sticky` schválně: `SettingsTab` má vlastní přilepenou lištu s Uložit
 * (`sticky top-0`) a dvě přilepené vrstvy nad sebou by se překryly.
 *
 * `mt-5` odsazuje lištu od horní hrany. Nalepená úplně nahoře působila rozmazaně —
 * v nainstalované aplikaci pod ni zasahuje průsvitný stavový řádek (`viewportFit:
 * cover` + black-translucent) a na tabletu za ni padá dekorativní záře z layoutu.
 * `env(safe-area-inset-top)` na `main` řeší jen výřez, ne tenhle optický překryv.
 */
export function MobileTopBar() {
    const { subscription, subscriptionLoading } = useStudio()
    const navigate = useStudioNavigate()

    // Trial s obsahovou kvótou počítá příspěvky, ne kredity — stejné rozlišení
    // jako widget v postranním panelu, aby si čísla neodporovala.
    const planLimit = subscription?.planPostsLimit ?? 0
    const usePostQuota = subscription?.status === "trialing"
        && subscription.creditsTotal === 0
        && planLimit > 0
    const remaining = !subscription
        ? null
        : usePostQuota
            ? Math.max(0, planLimit - (subscription.planPostsUnlocked ?? 0))
            : subscription.creditsRemaining
    const unit = usePostQuota ? "příspěvků" : "kreditů"
    const isLow = remaining !== null && remaining <= 3

    return (
        <div className="lg:hidden flex items-center justify-between gap-3 mt-5 mb-4">
            <button
                onClick={() => navigate("dashboard")}
                aria-label="Přehled"
                className="flex items-center gap-2 cursor-pointer"
            >
                <LogoPV className="h-6 w-auto" />
                <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/30">Studio</span>
            </button>

            {subscriptionLoading ? (
                <span className="h-6 w-20 rounded-sm bg-white/5 animate-pulse" />
            ) : remaining !== null ? (
                <button
                    onClick={() => navigate("settings")}
                    className={`flex items-baseline gap-1.5 px-2.5 min-h-[32px] rounded-sm border transition-colors cursor-pointer ${
                        isLow
                            ? "border-aisummit-cinnabar/30 bg-aisummit-cinnabar/10 text-aisummit-cinnabar"
                            : "border-white/10 bg-[#0a0a0a] text-white/60"
                    }`}
                >
                    <span className="text-xs font-black tabular-nums">{remaining}</span>
                    <span className="text-[8px] font-bold uppercase tracking-widest opacity-70">{unit}</span>
                </button>
            ) : (
                <button
                    onClick={() => navigate("settings")}
                    className="px-2.5 min-h-[32px] rounded-sm border border-aisummit-cinnabar/30 bg-aisummit-cinnabar/10 text-aisummit-cinnabar text-[9px] font-bold uppercase tracking-widest cursor-pointer"
                >
                    Vybrat plán
                </button>
            )}
        </div>
    )
}
