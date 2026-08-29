/**
 * Portfolio nesmí vyrábět ani ukazovat reely — statické kontroly (bez sítě, bez DB).
 *   npx tsx scripts/test-portfolio-reels.ts
 *
 * Reely se neprodávají (viz „přestat prodávat reels, které nefungují"). Portfolio
 * je přesto jednou vyrobilo a vystavilo: 46 ze 118 příspěvků, 39 % obsahu, který
 * si zákazník nemůže koupit — a ~1 376 Kč, protože reel stojí ~34 Kč proti ~5 Kč
 * za obrázek.
 *
 * Ta chyba nebyla v kódu, ale v úsudku: `REELS_ENABLED=1` v env vypadalo jako
 * pokyn. Env říká, co engine UMÍ, ne co se prodává — proto to hlídá aserce a ne
 * komentář, který se dá přečíst a přejít.
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

console.log("\n🎬 PORTFOLIO BEZ REELŮ\n")

// ── 1. Vygenerovaná data ────────────────────────────────────────────────────
const reels = PORTFOLIO_BRANDS.flatMap(b =>
    b.posts.filter(p => p.mediaType === "reel").map(p => `${b.slug}/${p.id.slice(0, 8)}`)
)
check(
    "v portfolio-data.ts není žádný reel",
    reels.length === 0,
    reels.length ? `${reels.length} reelů: ${reels.slice(0, 3).join(", ")}…` : undefined
)

const withVideo = PORTFOLIO_BRANDS.flatMap(b => b.posts.filter(p => !!p.videoUrl))
check("žádný příspěvek nenese video", withVideo.length === 0, `${withVideo.length} s videem`)

// ── 2. Export je nesmí pustit dál ───────────────────────────────────────────
const exporter = read("scripts/export-portfolio.ts")
check(
    "export filtruje mediaType !== \"reel\"",
    /\.filter\(\s*p\s*=>\s*p\.mediaType\s*!==\s*"reel"\s*\)/.test(exporter)
)

// ── 3. Generátor je nesmí vyrobit ───────────────────────────────────────────
const seeder = read("scripts/seed-portfolio-clients.ts")
check(
    "generátor spouští CLI s REELS_ENABLED=0",
    /REELS_ENABLED:\s*"0"/.test(seeder)
)
check(
    "zapnutí reelů je vědomé (--reels), ne výchozí",
    /args\.includes\("--reels"\)/.test(seeder) && /reelsEnabled\s*\?\s*process\.env/.test(seeder)
)

// ── 4. Souběžný běh, který zaplatil posty dvakrát ───────────────────────────
check(
    "generátor drží zámek proti souběžnému běhu",
    /acquireLock\(\)/.test(seeder) && /releaseLock\(\)/.test(seeder)
)

console.log("\n" + "─".repeat(50))
console.log(`  ${passed} prošlo | ${failed} selhalo`)
console.log("─".repeat(50) + "\n")

if (failed > 0) process.exit(1)
