/**
 * Skládání zpráv pro jeden jazyk.
 * ==============================
 * Texty žijí v `messages/<locale>/<soubor>.json`; každý soubor nese jeden nebo
 * víc namespace (top-level klíčů). Jeden soubor na tab: migrace tabu = nový
 * soubor + řádek tady, žádné zásahy do cizích textů a žádné konflikty v jednom
 * obřím JSONu. Parity klíčů mezi jazyky hlídá `scripts/test-i18n.ts`.
 *
 * `core` = společné (common, nav, sections, shell), `auth` = přihlašování.
 */

import type { UiLocale } from "./locales"

export const MESSAGE_FILES = [
    "core",
    "auth",
    "mail",
    // taby studia — jeden soubor na tab (namespace = jméno souboru)
    "settings",
    "generate",
    "posts",
    "dashboard",
    "plan",
    "inspiration",
    "brand",
    "performance",
    "help",
    "shared",
    "billing",
    "products",
    "adminOnboard",
    "adminOps",
    "adminGrowth",
    // průvodce novým zákazníkem (app/onboarding)
    "onboarding",
    // hlášky ze server actions (app/actions) — jazyk toho, kdo klikl
    "actionsPlan",
    "actionsContent",
    "actionsAccount",
    "actionsAdmin",
    // hlášky z API rout, které čte prohlížeč (joby, onboarding, platby, most IG)
    "api",
    // oznámení zákazníkům z agentů (lib/agents) — jazyk příjemce, ne request
    "notices",
    // workery bez requestu: digest kampaně, průběh onboardingových úloh
    "worker",
] as const

export type Messages = Record<string, unknown>

export async function loadMessages(locale: UiLocale): Promise<Messages> {
    const parts = await Promise.all(
        MESSAGE_FILES.map(async file => (await import(`../../messages/${locale}/${file}.json`)).default as Messages),
    )
    return Object.assign({}, ...parts)
}
