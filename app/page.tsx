/**
 * Landing — server komponenta, která ceník **čte z databáze**.
 *
 * Do minule byly ceny na landingu natvrdo v poli, zatímco dashboard je bral
 * z `subscription_plans`. Dvě pravdy o ceně vydrží přesně do první změny
 * ceníku; pak jedna z nich lže zákazníkovi, který si to přišel ověřit.
 *
 * Markup žije v `components/Landing.tsx` (klient — hooks, framer-motion).
 * Dělba je záměrná: data načte server, interakci obslouží klient.
 *
 * `revalidate` drží stránku statickou a ceny čerstvé do hodiny. Ceník se mění
 * jednou za čtvrt roku, takže dotaz na každý request by byl jen daň za nic —
 * a marketingová stránka nesmí spadnout na tom, že má DB vteřinový výpadek.
 */

import type { Metadata } from "next"
import supabaseAdmin from "@/supabase/admin"
import { Landing } from "@/components/Landing"
import { FALLBACK_PLANS, lowestPriceClaim, type PricingPlan } from "@/lib/pricing"

export const revalidate = 3600

export const metadata: Metadata = {
    description: `Hotový Instagram z vašeho webu — texty, obrázky, carousely i reels. ${lowestPriceClaim()}.`,
}

/**
 * Tarify, které si jde koupit — seřazené od nejlevnějšího.
 *
 * Filtr `price_czk > 0` není kosmetika: v tabulce žijí i nulové tarify
 * (`trial_v2` a legacy `trial` s týdenním intervalem). Ty jsou interní stavy
 * účtu, ne nabídka, a na veřejném ceníku by se vykreslily jako karta „0 Kč“,
 * kterou nejde koupit.
 *
 * Když dotaz selže, vrací se statická kopie ceníku: prázdná sekce s cenami je
 * na marketingové stránce horší než ceny staré o jeden deploy. Aserce v
 * `npm run guard` hlídá, že se ta kopie nerozejde s migrací.
 */
async function loadPlans(): Promise<readonly PricingPlan[]> {
    try {
        const { data, error } = await supabaseAdmin
            .from("subscription_plans")
            .select("id, name, price_czk, features")
            .eq("is_active", true)
            .gt("price_czk", 0)
            .order("price_czk", { ascending: true })

        if (error) throw error
        if (!data || data.length === 0) return FALLBACK_PLANS

        return data.map((p) => {
            const features = p.features as { credits_per_month?: number; allowed_media?: string[] } | null
            return {
                id: p.id,
                name: p.name,
                monthlyHaleru: p.price_czk,
                creditsPerMonth: features?.credits_per_month ?? 0,
                // Chybějící allowed_media = legacy tarif bez omezení (stejné pravidlo
                // jako `canUseMedium` na backendu) — ne „žádná média".
                allowsReels: !features?.allowed_media || features.allowed_media.includes("reel"),
            }
        })
    } catch (err: any) {
        console.warn(`landing: ceník z DB se nenačetl, beru statickou kopii — ${err?.message}`)
        return FALLBACK_PLANS
    }
}

export default async function Home() {
    const plans = await loadPlans()
    // Stav vypínače se čte TADY, na serveru: `REELS_ENABLED` je serverová proměnná
    // a klientský landing k ní nemá přístup. `revalidate = 3600` znamená, že se
    // přepnutí propíše do hodiny — ceník se nemusí sahat, odznak zmizí sám.
    return <Landing plans={plans} reelsEnabled={process.env.REELS_ENABLED === "1"} />
}
