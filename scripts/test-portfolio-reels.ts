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

// ── 1. Stránky musí štítek vykreslit ────────────────────────────────────────
const detail = read("app/portfolio/[slug]/page.tsx")
check(
    "detail značky vykresluje BETA štítek u reelu",
    /mediaType\s*===\s*"reel"\s*&&\s*<BetaBadge\s*\/>/.test(detail) && /BETA/.test(detail)
)
check(
    "detail vysvětluje, že reely nejsou v nabídce",
    /Reely jsou beta/.test(detail) && /nemáme v nabídce/.test(detail)
)

const index = read("app/portfolio/page.tsx")
check(
    "přehled značí reely jako beta",
    /reel \(beta\)/.test(index) && /zatím nejsou v nabídce/.test(index)
)

// ── 2. Generátor je nesmí vyrábět bez vědomého pokynu ───────────────────────
const seeder = read("scripts/seed-portfolio-clients.ts")
check(
    "generátor spouští CLI s REELS_ENABLED=0",
    /REELS_ENABLED:\s*"0"/.test(seeder)
)
check(
    "zapnutí reelů vyžaduje vědomé --reels",
    /args\.includes\("--reels"\)/.test(seeder) && /reelsEnabled\s*\?\s*process\.env/.test(seeder)
)

// ── 3. Souběžný běh, který zaplatil posty dvakrát ───────────────────────────
check(
    "generátor drží zámek proti souběžnému běhu",
    /acquireLock\(\)/.test(seeder) && /releaseLock\(\)/.test(seeder)
)

// ── 4. Data musí zůstat zobrazitelná ────────────────────────────────────────
const broken = PORTFOLIO_BRANDS.flatMap(b =>
    b.posts.filter(p => p.images.length === 0 && !p.videoUrl).map(p => `${b.slug}/${p.id.slice(0, 8)}`)
)
check(
    "žádný příspěvek není bez média",
    broken.length === 0,
    broken.length ? `${broken.length}: ${broken.slice(0, 3).join(", ")}…` : undefined
)

const reels = PORTFOLIO_BRANDS.flatMap(b => b.posts.filter(p => p.mediaType === "reel"))
const reelsWithoutVideo = reels.filter(p => !p.videoUrl)
check(
    "každý reel nese video",
    reelsWithoutVideo.length === 0,
    `${reelsWithoutVideo.length} z ${reels.length} bez videa`
)

console.log("\n" + "─".repeat(50))
console.log(`  ${passed} prošlo | ${failed} selhalo`)
console.log("─".repeat(50) + "\n")

if (failed > 0) process.exit(1)
