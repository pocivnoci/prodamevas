/**
 * Vyrenderuje všechny e-mailové šablony z ukázkových dat do `.email-preview/`.
 *
 *   npx tsx scripts/preview-emails.ts
 *
 * K čemu to je: změnu tokenu nebo bloku je potřeba vidět na všech šablonách
 * naráz, ne na té jedné, kterou zrovna upravuju. Otevři `.email-preview/index.html`.
 *
 * Zároveň projede tytéž kontroly jako aserce sekce 29 v `npm run guard`, takže
 * problém spadne tady a ne až v testu.
 */

import fs from "fs"
import path from "path"
import { vatNotice } from "@/lib/legal"
import { EMAIL_TEMPLATES, GROUP_LABELS } from "@/lib/mail/registry"
import { GMAIL_CLIP_LIMIT_KB } from "@/lib/mail/tokens"

const OUT = path.join(process.cwd(), ".email-preview")
const SAMPLE_RECIPIENT = "ukazka@chrlit.cz"

function main() {
    fs.mkdirSync(OUT, { recursive: true })
    const rows: string[] = []
    const problems: string[] = []

    for (const t of EMAIL_TEMPLATES) {
        const { subject, html, text } = t.render(t.sample, SAMPLE_RECIPIENT)
        const kb = Buffer.byteLength(html, "utf8") / 1024

        if (!subject.trim() || !html.trim() || !text.trim()) problems.push(`${t.id}: prázdný render`)
        const leak = /undefined|\bnull\b|\[object Object\]|NaN/.exec(subject + text)
        if (leak) problems.push(`${t.id}: prosákla proměnná — „${leak[0]}"`)
        if (kb >= GMAIL_CLIP_LIMIT_KB) problems.push(`${t.id}: ${Math.round(kb)} KB, Gmail stříhá`)

        const quotesPrice = /\d[\d  ]*Kč/.test(text)
        if (quotesPrice !== Boolean(t.pricing)) {
            problems.push(`${t.id}: pricing=${Boolean(t.pricing)}, ale text ${quotesPrice ? "cenu uvádí" : "cenu neuvádí"}`)
        }
        if (t.pricing && !text.includes(vatNotice())) problems.push(`${t.id}: cena bez věty o DPH`)

        const hasUnsub = /api\/email\/unsubscribe\?e=/.test(html)
        if (t.kind === "notification" && !hasUnsub) problems.push(`${t.id}: oznámení bez odhlášení`)
        if (t.kind === "transactional" && hasUnsub) problems.push(`${t.id}: z transakční zprávy se nelze odhlašovat`)

        fs.writeFileSync(path.join(OUT, `${t.id}.html`), html)
        fs.writeFileSync(path.join(OUT, `${t.id}.txt`), text)
        rows.push(
            `<tr><td><a href="./${t.id}.html">${t.id}</a></td><td>${GROUP_LABELS[t.group]}</td>` +
            `<td>${t.kind}</td><td>${subject}</td><td align="right">${Math.round(kb)} KB</td>` +
            `<td><a href="./${t.id}.txt">text</a></td></tr>`,
        )
    }

    fs.writeFileSync(path.join(OUT, "index.html"),
        `<!doctype html><meta charset="utf-8"><title>Náhled e-mailů</title>
<body style="font:14px/1.6 -apple-system,sans-serif;max-width:900px;margin:40px auto;padding:0 20px">
<h1 style="text-transform:uppercase;letter-spacing:-.02em">Náhled e-mailů</h1>
<p>${EMAIL_TEMPLATES.length} šablon vyrenderovaných z ukázkových dat.</p>
<table cellpadding="8" style="border-collapse:collapse;width:100%">
<tr style="text-align:left;border-bottom:2px solid #000"><th>Šablona</th><th>Skupina</th><th>Druh</th><th>Předmět</th><th>Velikost</th><th>Text</th></tr>
${rows.join("\n")}
</table></body>`)

    console.log(`✅ ${EMAIL_TEMPLATES.length} šablon → ${OUT}/index.html`)
    if (problems.length > 0) {
        console.error(`\n❌ ${problems.length} problémů:`)
        for (const p of problems) console.error(`   · ${p}`)
        process.exit(1)
    }
    console.log("✅ Kontroly prošly (velikost, DPH, odhlášení, prosáklé proměnné)")
}

main()
