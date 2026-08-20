/**
 * Adminská brána — čisté kontroly (bez sítě, bez DB).
 *   npx tsx scripts/test-super-admins.ts
 *
 * Brána při neshodě jen tiše vrátí `false`. Chyba se proto neprojeví výjimkou,
 * ale tím, že adminovi zmizí celá admin sekce a vypadá to, jako by tam nikdy
 * nebyla. Případy níž jsou skutečné tvary, ve kterých hodnota končí ve Vercelu.
 */

import { superAdminEmails, isSuperAdminEmail, looksLikeEmail } from "../lib/super-admins"
import { readFileSync } from "fs"
import { resolve } from "path"

let passed = 0
let failed = 0
const fails: string[] = []

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; fails.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

/** Nastaví env na dobu jednoho případu. */
function withEnv(value: string | undefined, fn: () => void) {
    const before = process.env.SUPER_ADMIN_EMAILS
    if (value === undefined) delete process.env.SUPER_ADMIN_EMAILS
    else process.env.SUPER_ADMIN_EMAILS = value
    try { fn() } finally {
        if (before === undefined) delete process.env.SUPER_ADMIN_EMAILS
        else process.env.SUPER_ADMIN_EMAILS = before
    }
}

const ME = "thomas.pocar@gmail.com"

console.log("\n🔑 ADMINSKÁ BRÁNA\n")

withEnv(ME, () => {
    check("čistá hodnota projde", isSuperAdminEmail(ME))
    check("cizí adresa neprojde", !isSuperAdminEmail("kdokoliv@jinde.cz"))
})

// Tohle je ta past: `dotenv` uvozovky sundá, nástěnka Vercelu ne. Lokálně to
// funguje, v produkci ne, a rozdíl není nikde vidět.
withEnv(`"${ME}"`, () => {
    check("uvozovky z nástěnky Vercelu nevadí", isSuperAdminEmail(ME))
})
withEnv(`'${ME}'`, () => {
    check("apostrofy nevadí", isSuperAdminEmail(ME))
})
withEnv(`"${ME}`, () => {
    check("nepárová uvozovka nevadí", isSuperAdminEmail(ME))
})

withEnv("Thomas.Pocar@Gmail.com", () => {
    check("velká písmena v env nevadí", isSuperAdminEmail(ME))
})
withEnv(ME, () => {
    check("velká písmena v adrese uživatele nevadí", isSuperAdminEmail("Thomas.Pocar@Gmail.com"))
})

withEnv(`  ${ME} , druhy@chrlit.cz `, () => {
    check("mezery kolem položek nevadí", isSuperAdminEmail(ME))
    check("druhý admin v seznamu projde", isSuperAdminEmail("druhy@chrlit.cz"))
    check("seznam se načte celý", superAdminEmails().length === 2)
})

withEnv(`"${ME}","druhy@chrlit.cz"`, () => {
    check("uvozovky u každé položky nevadí", isSuperAdminEmail("druhy@chrlit.cz"))
})

// Prázdné vstupy nesmí nikoho pustit dovnitř.
withEnv(undefined, () => {
    check("bez env nikdo není admin", !isSuperAdminEmail(ME))
    check("bez env je seznam prázdný", superAdminEmails().length === 0)
})
withEnv("", () => check("prázdná hodnota nikoho nepustí", !isSuperAdminEmail(ME)))
withEnv('""', () => check("hodnota jen z uvozovek nikoho nepustí", !isSuperAdminEmail(ME)))
withEnv(", ,", () => check("hodnota jen z oddělovačů nikoho nepustí", !isSuperAdminEmail(ME)))
withEnv(ME, () => {
    check("prázdná adresa neprojde", !isSuperAdminEmail(""))
    check("null adresa neprojde", !isSuperAdminEmail(null))
    check("undefined adresa neprojde", !isSuperAdminEmail(undefined))
})

// Kdyby normalizace zahodila příliš, prošel by kdokoliv — tohle to hlídá.
withEnv(ME, () => {
    check("podobná adresa neprojde", !isSuperAdminEmail("thomas.pocar@gmail.com.evil.cz"))
    check("prefix neprojde", !isSuperAdminEmail("thomas.pocar@gmail.co"))
})

check("looksLikeEmail pozná adresu", looksLikeEmail(ME))
check("looksLikeEmail pozná zbytek po uvozovkách", !looksLikeEmail("thomas.pocar"))

// Obě kopie normalizace musí zůstat stejné — beta-access.ts nesmí importovat,
// takže se hlídá textově.
const ROOT = resolve(__dirname, "..")
const access = readFileSync(resolve(ROOT, "lib/beta-access.ts"), "utf-8")
check(
    "beta-access normalizuje stejně",
    access.includes(`replace(/["']/g`) && access.includes("toLowerCase()"),
    "kopie normalizace v lib/beta-access.ts se rozešla s lib/super-admins.ts",
)

console.log()
console.log("─".repeat(50))
console.log(`  ✅ ${passed} prošlo | ❌ ${failed} selhalo`)
console.log("─".repeat(50))

if (failed > 0) {
    console.log(`\n⚠️  Selhalo: ${fails.join(", ")}\n`)
    process.exit(1)
}
console.log()
process.exit(0)
