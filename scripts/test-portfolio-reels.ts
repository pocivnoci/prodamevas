/**
 * Reely se z portfolia neukazují — statické kontroly (bez sítě, bez DB).
 *   npx tsx scripts/test-portfolio-reels.ts
 *
 * Reely se neprodávají (viz „přestat prodávat reels, které nefungují"). Dřív
 * v portfoliu zůstávaly s odznakem „BETA", jenže odznak je pořád slib formátu,
 * který si zákazník neobjedná — jen menším písmem. Teď se filtrují v
 * `lib/portfolio.ts` a stránky čtou jenom ten filtrovaný pohled. Data v exportu
 * zůstávají; až reely do nabídky přibudou, vrátí je jeden řádek.
 *
 * Vyrábět nové je věc jiná: reel stojí ~34 Kč proti ~5 Kč za obrázek a jednou už
 * si portfolio takhle vzalo ~1 376 Kč, protože `REELS_ENABLED=1` v env vypadalo
 * jako pokyn. Env říká, co engine UMÍ, ne co je v nabídce — proto to hlídá aserce
 * a ne komentář, který se dá přečíst a přejít.
 */

import { readFileSync } from "fs"
import { resolve } from "path"
import { PORTFOLIO_BRANDS } from "../lib/portfolio-data"
import { PORTFOLIO_VISIBLE_BRANDS, PORTFOLIO_VISIBLE_MEDIA } from "../lib/portfolio"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8")

console.log("\n🎬 REELY SE Z PORTFOLIA NEUKAZUJÍ\n")

// ── 1. Filtr sám ────────────────────────────────────────────────────────────
check(
    "viditelné formáty neobsahují reel",
    !PORTFOLIO_VISIBLE_MEDIA.includes("reel"),
    PORTFOLIO_VISIBLE_MEDIA.join(", ")
)

const leaked = PORTFOLIO_VISIBLE_BRANDS.flatMap(b =>
    b.posts.filter(p => p.mediaType === "reel").map(p => `${b.slug}/${p.id.slice(0, 8)}`)
)
check(
    "žádný reel se nedostane do viditelného portfolia",
    leaked.length === 0,
    leaked.length ? `${leaked.length}: ${leaked.slice(0, 3).join(", ")}…` : undefined
)

// Filtr nesmí vysypat celou stránku — kdyby značka zůstala bez příspěvků,
// vypadne, a portfolio bez značek neprodává nic.
check(
    "po odfiltrování zbývá co ukazovat",
    PORTFOLIO_VISIBLE_BRANDS.length > 0 && PORTFOLIO_VISIBLE_BRANDS.every(b => b.posts.length > 0),
    `${PORTFOLIO_VISIBLE_BRANDS.length} z ${PORTFOLIO_BRANDS.length} značek`
)

// ── 2. Filtr se nedá obejít ─────────────────────────────────────────────────
// Tohle je celá podstata: kdo si naimportuje surový export, dostane i reely.
const consumers = ["app/portfolio/page.tsx", "app/portfolio/[slug]/page.tsx", "app/sitemap.ts"]
for (const file of consumers) {
    const src = read(file)
    check(
        `${file} čte filtrovaný pohled, ne surový export`,
        /PORTFOLIO_VISIBLE_BRANDS/.test(src) && !/\bPORTFOLIO_BRANDS\b/.test(src)
    )
}

const brandPage = read("app/portfolio/[slug]/page.tsx")
const index = read("app/portfolio/page.tsx")
check(
    "stránky už reely nepočítají ani neinzerují",
    !/mediaType\s*===\s*"reel"/.test(brandPage) &&
    !/mediaType\s*===\s*"reel"/.test(index) &&
    !/beta/i.test(index.replace(/^[\s\S]*?\*\//, "")) &&
    !/\bREELS\b/.test(brandPage) && !/\bREELS\b/.test(index)
)

// ── 3. Záchranná síť v mřížce ───────────────────────────────────────────────
// Komponenty umí reel vykreslit dál (data existují a jednou se vrátí). Dokud to
// umí, musí u toho držet i štítek — jinak by návrat reelů tiše slíbil formát,
// který v nabídce není.
const grid = read("components/portfolio/PostGrid.tsx")
check(
    "dlaždice reelu by nesla BETA, kdyby reel přišel",
    /mediaType\s*===\s*"reel"/.test(grid) && /BETA/.test(grid)
)

const modal = read("components/portfolio/PostModal.tsx")
check(
    "detail příspěvku by nesl BETA",
    /mediaType\s*===\s*"reel"/.test(modal) && /BETA/.test(modal)
)

// ── 4. iOS: reel se nesmí vytrhnout na celou obrazovku ──────────────────────
// Bez `playsInline` spustí Safari na iPhonu video fullscreen a uživatel vypadne
// z galerie. Portfolio se posílá prospektům do telefonu, takže to není detail.
check("video má playsInline (jinak iOS přehraje fullscreen)", /playsInline/.test(modal))

// ── 5. Generátor je nesmí vyrábět bez vědomého pokynu ───────────────────────
const seeder = read("scripts/seed-portfolio-clients.ts")
check(
    "generátor spouští CLI s REELS_ENABLED=0",
    /REELS_ENABLED:\s*"0"/.test(seeder)
)
check(
    "zapnutí reelů vyžaduje vědomé --reels",
    /args\.includes\("--reels"\)/.test(seeder) && /reelsEnabled\s*\?\s*process\.env/.test(seeder)
)

// ── 6. Souběžný běh, který zaplatil posty dvakrát ───────────────────────────
check(
    "generátor drží zámek proti souběžnému běhu",
    /acquireLock\(\)/.test(seeder) && /releaseLock\(\)/.test(seeder)
)

// ── 7. Data musí zůstat zobrazitelná ────────────────────────────────────────
const broken = PORTFOLIO_VISIBLE_BRANDS.flatMap(b =>
    b.posts.filter(p => p.images.length === 0).map(p => `${b.slug}/${p.id.slice(0, 8)}`)
)
check(
    "žádný viditelný příspěvek není bez obrázku",
    broken.length === 0,
    broken.length ? `${broken.length}: ${broken.slice(0, 3).join(", ")}…` : undefined
)

const reels = PORTFOLIO_BRANDS.flatMap(b => b.posts.filter(p => p.mediaType === "reel"))
check(
    "každý reel v datech nese video (kdyby se vrátil)",
    reels.every(p => !!p.videoUrl),
    `${reels.filter(p => !p.videoUrl).length} z ${reels.length} bez videa`
)

// Mřížka bere `images[0]` jako náhled, jenže obálku render občas nevyrobí.
// Video se přehraje i tak — mřížka ale musí umět prázdnou obálku, jinak je v ní
// rozbitý obrázek.
check(
    "mřížka ustojí příspěvek bez obálky",
    /post\.images\[0\]\s*\?/.test(grid)
)

console.log("\n" + "─".repeat(50))
console.log(`  ${passed} prošlo | ${failed} selhalo`)
console.log("─".repeat(50) + "\n")

if (failed > 0) process.exit(1)
