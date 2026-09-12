/**
 * Znění lifecycle e-mailů — čistá funkce, žádná DB.
 * =================================================
 * Oddělené od `lifecycle.ts` ze stejného důvodu jako `notice-templates.ts`:
 * sken kandidátů sahá na Supabase, ale text e-mailu musí jít vyrenderovat
 * v guardu bez `.env.local`. Tam se totiž pozná prosáklé „?", rodové příčestí
 * i druhý hlas — a jinde se to nepozná vůbec, protože tyhle zprávy nejsou
 * v registru šablon.
 */

import { siteUrl, studioDeepLink } from "@/lib/mail/links"

export type LifecycleKind =
    | "activation_nudge" | "credit_low" | "winback" | "waitlist_drip"
    | "dormant" | "ig_disconnected"

/**
 * Jeden hlas pro všechny zprávy: vykání, mluví firma („my"), otevírá „Dobrý den,",
 * podepisuje „Tým Chrlit" a **nikdy nepoužije rodové příčestí o adresátovi**
 * („založil jste si") — e-mail neví, komu píše, a půlce příjemců se netrefí do
 * rodu. Do 9/2026 se tyhle zprávy od zbytku pošty lišily ve všech čtyřech bodech
 * najednou, takže od téže firmy chodily dva různé hlasy.
 *
 * Název značky stojí VŽDY v apozici za pomlčkou, nikdy uvnitř věty: čeština názvy
 * skloňuje a my je skloňovat neumíme („nevzniklo pro Kavárna Alchymista").
 *
 * `null` = zprávu neposílat. Chybějící čísla u docházejících kreditů nejsou
 * kosmetická vada: „zbývá málo z ?" je horší než mlčení.
 */
export function buildLifecycleEmail(
    kind: LifecycleKind,
    vars: { clientName?: string | null; clientId?: string | null; creditsRemaining?: number; creditsTotal?: number },
): { subject: string; body: string } | null {
    const brand = vars.clientName?.trim() || null
    /** „ — Kavárna Alchymista" v apozici, nebo nic. */
    const tag = brand ? ` — ${brand}` : ""
    const studio = (section: string) =>
        vars.clientId ? studioDeepLink(vars.clientId, section) : `${siteUrl()}/dashboard/instagram`
    const sign = "\n\nTým Chrlit"

    switch (kind) {
        case "activation_nudge":
            return {
                subject: `Váš obsah čeká — spusťte první kampaň${tag}`,
                body: `Dobrý den,\n\n` +
                    `do Chrlitu jste se zaregistrovali${brand ? ` se značkou <strong>${brand}</strong>` : ""}, ale vlastní kampaň zatím nejela. Ukázkové příspěvky na vás čekají ve studiu.\n\n` +
                    `Stačí jedno kliknutí a připravíme celý týdenní plán obsahu — texty, obrázky, kalendář.\n\n` +
                    `<a href="${studio("plan")}">Otevřít studio →</a>${sign}`,
            }
        case "credit_low": {
            // Bez obou čísel by ve zprávě zůstalo „málo z ?". Radši nic.
            if (typeof vars.creditsRemaining !== "number" || typeof vars.creditsTotal !== "number") return null
            return {
                subject: `Kredity skoro vyčerpané${tag}`,
                body: `Dobrý den,\n\n` +
                    `v plánu${brand ? ` pro značku <strong>${brand}</strong>` : ""} zbývá ${vars.creditsRemaining} z ${vars.creditsTotal} kreditů. Aby obsah nepřestal vycházet, navyšte prosím plán nebo si dokupte kredity.\n\n` +
                    `<a href="${studio("subscription")}">Spravovat předplatné →</a>${sign}`,
            }
        }
        case "winback":
            return {
                subject: `Instagram mezitím spí — vraťte se do Chrlitu${tag}`,
                body: `Dobrý den,\n\n` +
                    `předplatné${brand ? ` pro značku <strong>${brand}</strong>` : ""} vypršelo a účet přestal dostávat nový obsah. Nastavení, značku i naučené preference máme uložené — návrat je otázka jednoho kliknutí.\n\n` +
                    `<a href="${studio("subscription")}">Obnovit předplatné →</a>${sign}`,
            }
        case "dormant":
            return {
                subject: `Váš Instagram je pár kliknutí od dalšího týdne obsahu${tag}`,
                body: `Dobrý den,\n\n` +
                    `za poslední dva týdny nevznikl${brand ? ` pro značku <strong>${brand}</strong>` : ""} žádný nový příspěvek — a účet, který přestane publikovat, ztrácí dosah rychleji, než ho jde pak získat zpátky.\n\n` +
                    `Značku i naučené preference máme uložené, takže týdenní plán vznikne na jedno kliknutí.\n\n` +
                    `<a href="${studio("plan")}">Vygenerovat obsah →</a>${sign}`,
            }
        case "ig_disconnected":
            return {
                subject: `Propojení s Instagramem je potřeba obnovit${tag}`,
                body: `Dobrý den,\n\n` +
                    `účet${brand ? ` značky <strong>${brand}</strong>` : ""} nemá funkční propojení s Instagramem — přístup od Meta po čase vyprší a je potřeba ho jednou za čas potvrdit.\n\n` +
                    `Dokud je odpojený, příspěvky se sice vygenerují, ale nemají se kam publikovat. Obnovení je otázka dvou kliknutí:\n\n` +
                    `<a href="${studio("settings")}">Připojit Instagram →</a>${sign}`,
            }
        case "waitlist_drip":
            return {
                subject: "Nezapomněli jsme na vás",
                body: `Dobrý den,\n\n` +
                    `máme vás na čekací listině Chrlit Studia. Pouštíme dovnitř postupně, aby každý nový účet dostal plnou kvalitu — další vlna pozvánek je na cestě.\n\n` +
                    `Díky za trpělivost. Ozveme se, jakmile na vás přijde řada.${sign}`,
            }
    }
}

