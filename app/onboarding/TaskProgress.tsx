'use client'

/**
 * Skutečný průběh dlouhé onboardingové úlohy, čtený z `agent_tasks`.
 *
 * Nahrazuje čtyři pevné „kroky", které se odbavovaly samy podle časovače a
 * uživateli tvrdily něco, co se možná vůbec nedělo. Když práce trvá minuty,
 * jediná poctivá věc je ukázat, co zrovna běží.
 *
 * Sdílené oběma průvodci (`page.tsx` i `tabs/OnboardTab.tsx`) — z dvojníků
 * v onboardingu už bylo dost.
 */
export function TaskProgress({ progress, message, accent }: {
    progress: number
    message: string
    /** Tailwind třída pro výplň lišty, ať si každý krok drží svou barvu. */
    accent: string
}) {
    return (
        <div className="max-w-sm mx-auto">
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                    className={`h-full ${accent} transition-all duration-700 ease-out`}
                    style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
                />
            </div>
            <p className="mt-5 text-sm text-gray-400 min-h-[1.25rem]">{message || 'Startuji…'}</p>
            <p className="mt-2 text-[10px] uppercase tracking-widest font-bold text-gray-600">
                Běží na serveru — tohle okno můžeš nechat být
            </p>
        </div>
    )
}
