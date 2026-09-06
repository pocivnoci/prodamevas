/**
 * Co z portfolia jde ven na web.
 *
 * `lib/portfolio-data.ts` je surový export z databáze a přepisuje ho
 * `scripts/export-portfolio.ts` — ručně se do něj nesahá. Rozhodnutí, co se
 * z těch dat ukáže, tedy musí žít jinde. Tady.
 *
 * **Reely se neukazují.** Neprodávají se (viz `REELS_ENABLED`) a portfolio má
 * ukazovat to, co si zákazník může objednat. Odznak „BETA" na dlaždici to
 * neřešil: pořád to byl slib formátu, který v nabídce není, jen menším písmem.
 * Data se ale nezahazují — až reely do nabídky přibudou, vrátí je sem jeden
 * řádek, ne nový export.
 *
 * Stránky portfolia i sitemapa čtou **jenom** `PORTFOLIO_VISIBLE_BRANDS`.
 * Kdo sáhne rovnou na `PORTFOLIO_BRANDS`, obejde tenhle filtr — hlídá to
 * `scripts/test-portfolio-reels.ts`.
 */

import {
    PORTFOLIO_BRANDS,
    type PortfolioBrand,
    type PortfolioMediaType,
    type PortfolioPost,
} from "./portfolio-data"

/** Formáty, které portfolio ukazuje. `reel` tu chybí schválně. */
export const PORTFOLIO_VISIBLE_MEDIA: readonly PortfolioMediaType[] = ["post", "carousel"]

export function isPortfolioVisible(post: PortfolioPost): boolean {
    return PORTFOLIO_VISIBLE_MEDIA.includes(post.mediaType)
}

/**
 * Kolik příspěvků musí značce zbýt, aby stálo za to ji ukazovat.
 *
 * Prázdná značka vypadávala vždycky. Jenže od chvíle, kdy z výlohy vypadávají
 * i příspěvky označené faktickou bránou (viz scripts/export-portfolio.ts), je
 * reálný i stav „zbyl jeden" — a profil s jedinou dlaždicí prodává hůř než
 * žádný: vypadá jako rozdělaná práce, ne jako ukázka.
 */
export const PORTFOLIO_MIN_POSTS = 3

/**
 * Značky s jenom viditelnými příspěvky. Značka, které by zbylo míň než
 * PORTFOLIO_MIN_POSTS, vypadne celá — poloprázdný profil neprodává a v sitemapě
 * by byl slabý odkaz.
 */
export const PORTFOLIO_VISIBLE_BRANDS: PortfolioBrand[] = PORTFOLIO_BRANDS
    .map(brand => ({ ...brand, posts: brand.posts.filter(isPortfolioVisible) }))
    .filter(brand => brand.posts.length >= PORTFOLIO_MIN_POSTS)

export { PORTFOLIO_DISCLAIMER } from "./portfolio-data"
export type { PortfolioBrand, PortfolioPost, PortfolioMediaType } from "./portfolio-data"
