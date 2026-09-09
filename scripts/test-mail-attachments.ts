/**
 * Přílohy odchozích e-mailů — čisté kontroly (bez sítě, bez DB).
 *   npx tsx scripts/test-mail-attachments.ts
 *
 * Příloha je jediné místo v Mailingu, kam se dá vložit obsah zvenčí a rovnou ho
 * poslat pod hlavičkou Chrlitu. Chyba v ověření se přitom neprojeví výjimkou —
 * projeví se buď odmítnutou rozesílkou (příliš přísné), nebo tím, že Resend
 * spolkne 20 MB a rozesílka se zadrhne uprostřed (příliš volné).
 */

import { readFileSync } from "fs"
import { resolve } from "path"
import {
    validateAttachments, base64Bytes,
    ATTACH_MAX_FILES, ATTACH_MAX_FILE_BYTES, ATTACH_MAX_TOTAL_BYTES,
} from "../lib/mail/attachments"

let passed = 0
let failed = 0
const fails: string[] = []

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; fails.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

/** Vrátí chybovou hlášku, nebo null, když funkce prošla. */
function rejects(fn: () => unknown): string | null {
    try { fn(); return null } catch (e) { return e instanceof Error ? e.message : String(e) }
}

/** Base64 o zadané délce v bajtech (bez odsazení, ať sedí i délka řetězce). */
const payload = (bytes: number) => Buffer.alloc(bytes, 0x41).toString("base64")

console.log("\n📎 PŘÍLOHY E-MAILU\n")

// ── Prázdno není chyba ──
check("bez příloh → prázdné pole", validateAttachments(undefined).length === 0)
check("prázdný seznam → prázdné pole", validateAttachments([]).length === 0)

// ── Velikost ──
console.log("\nVelikost:")
check("base64Bytes sedí na skutečnou délku", base64Bytes(payload(1234)) === 1234,
    `got ${base64Bytes(payload(1234))}`)
check("base64Bytes zvládne obojí odsazení",
    base64Bytes(payload(1)) === 1 && base64Bytes(payload(2)) === 2 && base64Bytes(payload(3)) === 3)

check("soubor pod stropem projde",
    validateAttachments([{ filename: "prezentace.pdf", content: payload(1024) }]).length === 1)
check("soubor nad stropem neprojde",
    (rejects(() => validateAttachments([{ filename: "velky.pdf", content: payload(ATTACH_MAX_FILE_BYTES + 1024) }])) || "").includes("strop"))

const halfMax = Math.floor(ATTACH_MAX_TOTAL_BYTES / 2) + 1024
check("součet nad celkovým stropem neprojde",
    (rejects(() => validateAttachments([
        { filename: "a.pdf", content: payload(halfMax) },
        { filename: "b.pdf", content: payload(halfMax) },
    ])) || "").includes("dohromady"))

// ── Počet ──
console.log("\nPočet:")
const many = Array.from({ length: ATTACH_MAX_FILES + 1 }, (_, i) => ({ filename: `f${i}.pdf`, content: payload(16) }))
check("víc souborů, než dovoluje strop, neprojde",
    (rejects(() => validateAttachments(many)) || "").includes("Nejvýš"))
check("přesně na stropu projde",
    validateAttachments(many.slice(0, ATTACH_MAX_FILES)).length === ATTACH_MAX_FILES)

// ── Název souboru ──
console.log("\nNázev souboru:")
check("cesta se z názvu ořízne (unix)",
    validateAttachments([{ filename: "../../etc/passwd", content: payload(16) }])[0].filename === "passwd")
check("cesta se z názvu ořízne (windows)",
    validateAttachments([{ filename: "C:\\Users\\x\\nabidka.pdf", content: payload(16) }])[0].filename === "nabidka.pdf")
check("prázdný název neprojde",
    (rejects(() => validateAttachments([{ filename: "   ", content: payload(16) }])) || "").includes("název"))
check("dlouhý název se ořízne, ne odmítne",
    validateAttachments([{ filename: `${"a".repeat(300)}.pdf`, content: payload(16) }])[0].filename.length === 120)

// ── Obsah ──
console.log("\nObsah:")
check("prázdný obsah neprojde",
    (rejects(() => validateAttachments([{ filename: "a.pdf", content: "" }])) || "").includes("prázdná"))
check("obsah, který není base64, neprojde",
    (rejects(() => validateAttachments([{ filename: "a.pdf", content: "data:application/pdf;base64,AAAA" }])) || "").includes("base64"))
check("bílé znaky v base64 nevadí (zalomený řetězec)",
    validateAttachments([{ filename: "a.pdf", content: `${payload(64).slice(0, 40)}\n${payload(64).slice(40)}` }]).length === 1)
check("contentType se nese dál, když přijde",
    validateAttachments([{ filename: "a.pdf", content: payload(16), contentType: "application/pdf" }])[0].contentType === "application/pdf")
check("contentType se nevymýšlí, když nepřijde",
    validateAttachments([{ filename: "a.pdf", content: payload(16) }])[0].contentType === undefined)

// ── Stropy musí sedět pod strop server akce ──
console.log("\nMeze vůči Nextu:")
{
    const ROOT = resolve(__dirname, "..")
    const config = readFileSync(resolve(ROOT, "next.config.ts"), "utf-8")
    const limit = config.match(/bodySizeLimit:\s*"(\d+)mb"/)
    const limitBytes = limit ? Number(limit[1]) * 1024 * 1024 : 0
    check("next.config.ts má bodySizeLimit", limitBytes > 0)
    // Base64 nafoukne obsah o třetinu — celkový strop se musí vejít i po nafouknutí,
    // jinak Next request odmítne dřív, než se k ověření vůbec dostane.
    check("celkový strop se vejde do těla server akce i po base64",
        ATTACH_MAX_TOTAL_BYTES * 4 / 3 < limitBytes,
        `${ATTACH_MAX_TOTAL_BYTES} × 4/3 vs ${limitBytes}`)
    check("na samotnou zprávu zbyde místo",
        limitBytes - ATTACH_MAX_TOTAL_BYTES * 4 / 3 > 1024 * 1024)
    check("jeden soubor se do celkového stropu vejde",
        ATTACH_MAX_FILE_BYTES <= ATTACH_MAX_TOTAL_BYTES)
}

// ── Nikdo si limity neopisuje podruhé ──
console.log("\nJeden zdroj pravdy:")
{
    const ROOT = resolve(__dirname, "..")
    const ui = readFileSync(resolve(ROOT, "app/(dashboard)/dashboard/instagram/tabs/MailingTab.tsx"), "utf-8")
    check("formulář si stropy importuje, neopisuje",
        ui.includes('from "@/lib/mail/attachments"')
        && ui.includes("ATTACH_MAX_FILE_BYTES")
        && !/ATTACH_MAX_FILE_BYTES\s*=/.test(ui))

    const actions = readFileSync(resolve(ROOT, "app/actions/mailing-actions.ts"), "utf-8")
    const send = actions.slice(actions.indexOf("export async function sendBroadcast"))
    check("rozesílka ověří přílohy dřív, než pošle první e-mail",
        send.indexOf("validateAttachments") < send.indexOf("for (const email of batch)"))
    check("test sobě jde taky s přílohou",
        actions.slice(actions.indexOf("export async function sendTestEmail")).includes("validateAttachments"))
}

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
