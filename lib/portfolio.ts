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
 * **Vyhlášená soutěž se neukazuje.** Portfolio jsou nevyžádané koncepty pro
 * firmy, se kterými nemáme vztah. Příspěvek, který slibuje ceny, je na našem
 * webu vyhlášením soutěže, kterou nikdo nevypsal a nikdo neproplatí — a čte se
 * jako soutěž té značky. Ostatní tvrzení v portfoliu si stojí za svým obsahem;
 * tohle jediné slibuje plnění třetí straně.
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

/**
 * Slibuje příspěvek ceny?
 *
 * Nechytá slovo „vyhrát" v běžné větě („Který střih vyhraje?"), ale vyhlášení:
 * soutěž, slosování, výzvu „vyhrajte". Napříč všemi značkami sedí dneska na
 * jediný příspěvek — a přesně proto to hlídá aserce a ne dobrá vůle. Značky
 * mají mezi kategoriemi „Soutěže o produkty", takže další takový příspěvek
 * vznikne při každém dalším generování.
 */
const GIVEAWAY = /soutěž|slosován|vyhrajte|giveaway/i

export function announcesGiveaway(post: PortfolioPost): boolean {
    return GIVEAWAY.test([post.hook, post.body, post.cta, ...post.hashtags].join(" "))
}

export function isPortfolioVisible(post: PortfolioPost): boolean {
    return PORTFOLIO_VISIBLE_MEDIA.includes(post.mediaType) && !announcesGiveaway(post)
}

/**
 * Značky s jenom viditelnými příspěvky. Značka, ze které by nezbylo nic,
 * vypadne celá — prázdný profil neprodává a v sitemapě by byl slepý odkaz.
 */
export const PORTFOLIO_VISIBLE_BRANDS: PortfolioBrand[] = PORTFOLIO_BRANDS
    .map(brand => ({ ...brand, posts: brand.posts.filter(isPortfolioVisible) }))
    .filter(brand => brand.posts.length > 0)

export { PORTFOLIO_DISCLAIMER } from "./portfolio-data"
export type { PortfolioBrand, PortfolioPost, PortfolioMediaType } from "./portfolio-data"
