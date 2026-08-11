/**
 * Obchodní agent — čisté kontroly (bez sítě, bez DB, bez volání modelu).
 *   npx tsx scripts/test-sales-agent.ts
 *
 * Kvalifikace rozhoduje, komu se napíše. Musí být proto vysvětlitelná a hlavně
 * konzistentní — model by odpověděl pokaždé trochu jinak a důvod by se nedal
 * doložit, kdyby se někdo zeptal, proč jsme mu psali.
 */

import { qualifyLead, isRoleAddress, daysSince, openingLine, segmentOf, QUALIFY_THRESHOLD } from "../lib/agents/sales/qualify"
import { composeMessage, pickAngle, judgeRubric, MAX_WORDS } from "../lib/agents/sales/templates"
import { extractColors, extractText, extractEmails } from "../lib/agents/sales/brand-scrape"
import { readFileSync } from "fs"
import { resolve } from "path"

let passed = 0
let failed = 0
const fails: string[] = []

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; fails.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const NOW = new Date("2026-08-11T12:00:00Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

/** Lead, který projde — základ, ze kterého se odvozují varianty. */
const good = {
    company: "Kavárna U Kohouta",
    igHandle: "@kavarnaukohouta",
    website: "https://ukohouta.cz",
    email: "info@ukohouta.cz",
    lastPostAt: daysAgo(95),
    followers: 1800,
}

console.log("\n🎯 VYŘAZOVACÍ PODMÍNKY\n")

check("bez kontaktní adresy se lead zahodí — není kam napsat",
    qualifyLead({ ...good, email: null }, NOW).rejectReason === "no_contact")

check("osobní adresa se zahodí UŽ v kvalifikaci, ne až před odesláním",
    qualifyLead({ ...good, email: "jan.novak@ukohouta.cz" }, NOW).rejectReason === "personal_email")

check("soukromý profil se zahodí — nejde posoudit",
    qualifyLead({ ...good, isPrivate: true }, NOW).rejectReason === "private")

// Opraveno po ostrém ověření: web NENÍ podmínka. Vyřazoval reálné květinářství,
// jehož Instagram nemá web v biu — ale jehož WEB má info@ adresu.
check("firma bez webu projde, když má kontakt odjinud",
    qualifyLead({ ...good, website: null }, NOW).qualified)

// Opraveno: „aktivní = zahodit" byl dohad. Kdo postuje, dokázal, že mu na
// Instagramu záleží — a přesně ten čas mu produkt vrací.
check("aktivní profil se NEZAHAZUJE, jen se označí segmentem", (() => {
    const r = qualifyLead({ ...good, lastPostAt: daysAgo(3) }, NOW)
    return r.qualified && r.segment === "aktivni"
})())

check("segment se pozná podle kadence", 
    segmentOf({ ...good, lastPostAt: daysAgo(200) }, NOW) === "spici" &&
    segmentOf({ ...good, lastPostAt: daysAgo(15) }, NOW) === "nepravidelny" &&
    segmentOf({ ...good, lastPostAt: daysAgo(2) }, NOW) === "aktivni" &&
    segmentOf({ ...good, lastPostAt: null }, NOW) === "neznamy")

check("spící i aktivní skórují srovnatelně — rozhodnou data, ne můj odhad", (() => {
    const spici = qualifyLead({ ...good, lastPostAt: daysAgo(200) }, NOW).score
    const aktiv = qualifyLead({ ...good, lastPostAt: daysAgo(2) }, NOW).score
    return Math.abs(spici - aktiv) <= 10 && spici >= QUALIFY_THRESHOLD && aktiv >= QUALIFY_THRESHOLD
})())

console.log("\n📇 ROZPOZNÁNÍ FIREMNÍ ADRESY\n")

for (const e of ["info@x.cz", "kontakt@x.cz", "obchod@x.cz", "info-praha@x.cz", "info.brno@x.cz", "REZERVACE@X.CZ"])
    check(`firemní: ${e}`, isRoleAddress(e))

for (const e of ["jan.novak@x.cz", "novak@x.cz", "j.svoboda@x.cz", "petra@x.cz"])
    check(`osobní: ${e}`, !isRoleAddress(e))

console.log("\n📊 SKÓRE\n")

const q = qualifyLead(good, NOW)
check("dobrý lead projde", q.qualified && q.score >= QUALIFY_THRESHOLD, `skóre ${q.score}`)
check("skóre nese slovní zdůvodnění", q.reasons.length >= 2, `důvodů: ${q.reasons.length}`)
check("mezi důvody je spící profil", q.reasons.some(r => /dn[ií]/.test(r)))

check("velký účet skóruje níž — obvykle má vlastní tým",
    qualifyLead({ ...good, followers: 200_000 }, NOW).score <
    qualifyLead({ ...good, followers: 1_800 }, NOW).score)

check("hobby účet skóruje níž než firma",
    qualifyLead({ ...good, followers: 40 }, NOW).score <
    qualifyLead({ ...good, followers: 1_800 }, NOW).score)

check("skóre nikdy nepřeteče 0–100", (() => {
    const hi = qualifyLead({ ...good, lastPostAt: daysAgo(9999) }, NOW).score
    const lo = qualifyLead({ ...good, followers: 0, company: null, lastPostAt: daysAgo(400) }, NOW).score
    return hi <= 100 && lo >= 0
})())

check("tentýž vstup dá vždy totéž skóre", (() => {
    const a = qualifyLead(good, NOW), b = qualifyLead(good, NOW)
    return a.score === b.score && JSON.stringify(a.reasons) === JSON.stringify(b.reasons)
})())

console.log("\n✍️  PRVNÍ VĚTA MAILU\n")

const line = openingLine(good, NOW)
// Název firmy uvnitř věty čeština skloňuje a my to neumíme — patří do předmětu,
// kde stojí v apozici. Konkrétní je ČÍSLO, ne jméno.
check("název firmy NENÍ uvnitř věty (čeština by ho skloňovala)",
    !line.includes("Kavárna U Kohouta"), line)
check("první věta zmiňuje, jak dlouho je ticho", /95 dní/.test(line), line)
check("bez názvu firmy věta pořád dává smysl", openingLine({ ...good, company: null }, NOW).length > 20)
check("dvě různě staré firmy dostanou různou první větu",
    openingLine(good, NOW) !== openingLine({ ...good, lastPostAt: daysAgo(200) }, NOW))
check("věta by neseděla komukoli — obsahuje údaj z profilu",
    /\d+\s*dní|půl roku/.test(openingLine(good, NOW)))

console.log("\n📨 ZPRÁVA\n")

const url = "https://chrlit.cz/ukazka/abc123"
const m = composeMessage(good, url, NOW)

check("zpráva se vejde do limitu", m.wordCount <= MAX_WORDS, `${m.wordCount} slov`)
check("obsahuje odkaz na ukázku", m.text.includes(url))
check("předmět jmenuje firmu v apozici za pomlčkou",
    m.subject.startsWith("Kavárna U Kohouta —"), m.subject)

// Regrese: „Instagram Kavárna Alchymista vypadá…" prozradí šablonu na první pohled.
for (const angle of ["cas","penize","vyloha"] as const) {
    const s3 = angle === "vyloha" ? { ...good, lastPostAt: daysAgo(300) }
             : angle === "penize" ? { ...good, followers: 8000 } : good
    const subj = composeMessage(s3, url, NOW).subject
    check(`předmět „${angle}" nemá název uprostřed věty`,
        /^Kavárna U Kohouta — /.test(subj), subj)
}

// Doručitelnost: v mailu nesmí být obrázek ani příloha.
check("žádné HTML ani obrázek v těle", !/<img|<html|<table|base64/i.test(m.text))

// Identifikace odesílatele — povinná u obchodního sdělení.
check("podpis nese IČO", /IČO\s*\d{8}/.test(m.text), "chybí IČO")
check("IČO se nepíše natvrdo v šabloně", !/21263990/.test(
    readFileSync(resolve(__dirname, "../lib/agents/sales/templates.ts"), "utf-8")))

// Nejdůležitější pravidlo: neslibovat výsledky.
const forbidden = /porostete|zaručuj|garantuj|víc sledujících|zvýšíme dosah|nárůst prodej/i
for (const angle of ["cas", "penize", "vyloha"] as const) {
    const s2 = angle === "vyloha" ? { ...good, lastPostAt: daysAgo(300) }
             : angle === "penize" ? { ...good, followers: 8000 } : good
    const mm = composeMessage(s2, url, NOW)
    check(`varianta „${angle}" neslibuje výsledky`, !forbidden.test(mm.text))
    check(`varianta „${angle}" se vejde do limitu`, mm.wordCount <= MAX_WORDS, `${mm.wordCount} slov`)
}

check("dlouho spící profil dostane variantu vyloha",
    pickAngle({ ...good, lastPostAt: daysAgo(300) }, NOW) === "vyloha")
check("větší účet dostane variantu o penězích",
    pickAngle({ ...good, followers: 8000 }, NOW) === "penize")

console.log("\n⚖️  RUBRIKA SOUDCE\n")
const rub = judgeRubric(m, good)
check("rubrika trvá na konkrétnosti první věty", /KONKRÉTNOST/.test(rub))
check("rubrika zakazuje sliby výsledků", /SLIBY/.test(rub) && /dosah/.test(rub))
check("rubrika vyžaduje identifikaci s IČO", /IDENTIFIKACE/.test(rub) && /IČO/.test(rub))
check("jediné porušení znamená zamítnutí", /jediný bod porušený[\s\S]*false/.test(rub))

console.log("\n🎨 SCRAPE ZNAČKY (čisté funkce, bez sítě)\n")

const htmlSample = `
<html><head><style>.a{color:#e63946}.b{background:#1d3557}.c{color:#e63946}
.bg{background:#ffffff}.txt{color:#111111}.grey{color:#808080}</style>
<script>var x = "#ff00ff";</script></head>
<body><h1>Kavárna</h1><p>Pražíme vlastní kávu.&nbsp;Každý den.</p></body></html>`

const cols = extractColors(htmlSample)
check("barvy značky se najdou", cols.includes("#e63946") && cols.includes("#1d3557"), cols.join(" "))
check("nejčastější barva je první", cols[0] === "#e63946", cols.join(" "))
check("bílá se zahodí — je to pozadí, ne značka", !cols.includes("#ffffff"))
check("skoro černá se zahodí", !cols.includes("#111111"))
check("šedá se zahodí — nenese identitu", !cols.includes("#808080"))

// Nalezeno naostro: web květinářství vracel jako PRIMÁRNÍ barvu zelenou WhatsAppu
// z chatovacího tlačítka. Ukázka by pak byla v barvách cizí služby.
const social = extractColors(`<style>.wa{background:#25d366}.wa2{color:#25d366}
.fb{color:#1877f2}.ig{color:#e4405f}.yt{color:#ff0000}.brand{color:#c97c8e}</style>`)
check("zelená WhatsAppu se nevydává za barvu značky", !social.includes("#25d366"), social.join(" "))
check("modrá Facebooku taky ne", !social.includes("#1877f2"))
check("skutečná barva značky přežije", social.includes("#c97c8e"), social.join(" "))

const txt = extractText(htmlSample)
check("text nezahrnuje skripty", !txt.includes("var x"))
check("text nezahrnuje styly", !txt.includes("background"))
check("text nese obsah stránky", txt.includes("Pražíme vlastní kávu"))
check("nezlomitelná mezera se přeloží", !txt.includes("&nbsp;"))
check("text se ořízne na limit", extractText("x".repeat(9999), 100).length === 100)

console.log("\n📧 KONTAKT Z WEBU (to, co v první verzi úplně chybělo)\n")

const mailCases: [string, string, string[]][] = [
    ["escapovaná adresa z JS bloku", `<a href="mailto:info@firma.cz\\">x</a>`, ["info@firma.cz"]],
    ["zástupný text z formuláře", `tvuj@email.cz a info@firma.cz`, ["info@firma.cz"]],
    ["email.cz je skutečný poskytovatel", `novak@email.cz`, ["novak@email.cz"]],
    ["role adresa má přednost", `jan.novak@firma.cz info@firma.cz`, ["info@firma.cz", "jan.novak@firma.cz"]],
    ["zamaskovaný zápis", `napište na info (at) firma.cz`, ["info@firma.cz"]],
    ["obrázky nejsou adresy", `logo@2x.png info@firma.cz`, ["info@firma.cz"]],
]
for (const [name, html, exp] of mailCases) {
    const got = extractEmails(html, "firma.cz")
    check(name, JSON.stringify(got.slice(0, exp.length)) === JSON.stringify(exp), JSON.stringify(got))
}

console.log("\n🕓 POMOCNÉ\n")
check("daysSince počítá správně", daysSince(daysAgo(10), NOW) === 10)
check("daysSince bez data vrací null", daysSince(null, NOW) === null)

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`)
if (failed) { console.log("   " + fails.join("\n   ")); process.exit(1) }
console.log()
