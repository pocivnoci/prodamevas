/**
 * Reely v portfoliu musí být označené jako beta — statické kontroly (bez sítě, bez DB).
 *   npx tsx scripts/test-portfolio-reels.ts
 *
 * Reely se neprodávají (viz „přestat prodávat reels, které nefungují"), ale
 * v portfoliu zůstávají, protože je čím ukázat, co engine umí. Bez štítku by ale
 * slibovaly formát, který si zákazník nekoupí — stejná past jako tvrdit, že ty
 * značky jsou klienti.
 *
 * Vyrábět nové je věc jiná: reel stojí ~34 Kč proti ~5 Kč za obrázek a jednou už
 * si portfolio takhle vzalo ~1 376 Kč, protože `REELS_ENABLED=1` v env vypadalo
 * jako pokyn. Env říká, co engine UMÍ, ne co je v nabídce — proto to hlídá aserce
 * a ne komentář, který se dá přečíst a přejít.
 */

import { readFileSync } from "fs"
import { resolve } from "path"
import { PORTFOLIO_BRANDS } from "../lib/portfolio-data"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8")

console.log("\n🎬 REELY V PORTFOLIU JSOU BETA\n")

// ── 1. Štítek tam, kde je reel vidět ────────────────────────────────────────
const grid = read("components/portfolio/PostGrid.tsx")
check(
    "dlaždice reelu nese BETA",
    /mediaType\s*===\s*"reel"/.test(grid) && /BETA/.test(grid)
)

const modal = read("components/portfolio/PostModal.tsx")
check(
    "detail příspěvku nese BETA",
    /mediaType\s*===\s*"reel"/.test(modal) && /BETA/.test(modal)
)

const brandPage = read("app/portfolio/[slug]/page.tsx")
check(
    "stránka značky vysvětluje, že reely nejsou v nabídce",
    /beta/i.test(brandPage) && /v nabídce zatím nejsou/.test(brandPage)
)

const index = read("app/portfolio/page.tsx")
check(
    "přehled značí reely jako beta",
    /\(beta\)/.test(index) && /v nabídce zatím nejsou/.test(index)
)

// ── 2. iOS: reel se nesmí vytrhnout na celou obrazovku ──────────────────────
// Bez `playsInline` spustí Safari na iPhonu video fullscreen a uživatel vypadne
// z galerie. Portfolio se posílá prospektům do telefonu, takže to není detail.
check("video má playsInline (jinak iOS přehraje fullscreen)", /playsInline/.test(modal))

// ── 3. Generátor je nesmí vyrábět bez vědomého pokynu ───────────────────────
const seeder = read("scripts/seed-portfolio-clients.ts")
check(
    "generátor spouští CLI s REELS_ENABLED=0",
    /REELS_ENABLED:\s*"0"/.test(seeder)
)
check(
    "zapnutí reelů vyžaduje vědomé --reels",
    /args\.includes\("--reels"\)/.test(seeder) && /reelsEnabled\s*\?\s*process\.env/.test(seeder)
)

// ── 4. Souběžný běh, který zaplatil posty dvakrát ───────────────────────────
check(
    "generátor drží zámek proti souběžnému běhu",
    /acquireLock\(\)/.test(seeder) && /releaseLock\(\)/.test(seeder)
)

// ── 5. Data musí zůstat zobrazitelná ────────────────────────────────────────
const broken = PORTFOLIO_BRANDS.flatMap(b =>
    b.posts.filter(p => p.images.length === 0 && !p.videoUrl).map(p => `${b.slug}/${p.id.slice(0, 8)}`)
)
check(
    "žádný příspěvek není bez média",
    broken.length === 0,
    broken.length ? `${broken.length}: ${broken.slice(0, 3).join(", ")}…` : undefined
)

const reels = PORTFOLIO_BRANDS.flatMap(b => b.posts.filter(p => p.mediaType === "reel"))
check(
    "každý reel nese video",
    reels.every(p => !!p.videoUrl),
    `${reels.filter(p => !p.videoUrl).length} z ${reels.length} bez videa`
)

// Mřížka bere `images[0]` jako náhled, jenže obálku render občas nevyrobí (dnes
// jeden reel). Video se přehraje i tak, takže se příspěvek nezahazuje — mřížka
// ale musí umět prázdnou obálku, jinak je v ní rozbitý obrázek.
check(
    "mřížka ustojí reel bez obálky",
    /post\.images\[0\]\s*\?/.test(grid)
)

console.log("\n" + "─".repeat(50))
console.log(`  ${passed} prošlo | ${failed} selhalo`)
console.log("─".repeat(50) + "\n")

if (failed > 0) process.exit(1)
