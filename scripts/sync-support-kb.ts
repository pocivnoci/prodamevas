/**
 * Synchronizace znalostní báze agenta podpory.
 *   npx tsx scripts/sync-support-kb.ts                    # jen složí a vypíše přehled
 *   npx tsx scripts/sync-support-kb.ts --out kb.md        # zapíše text do souboru
 *   npx tsx scripts/sync-support-kb.ts --push             # nahraje jako nový dokument
 *
 * Text skládá `lib/support/kb.ts` z kódu (ceník, kredity, nápověda, identita);
 * tenhle skript k němu přidá klientské průvodce z `docs/` a pošle ho do
 * ElevenLabs. **Spustit po každém přecenění** — `scripts/test-support-kb.ts`
 * v `npm run guard` spadne, když se báze rozejde s ceníkem, ale nahrát ji
 * musí člověk.
 *
 * `--push` zakládá NOVÝ dokument (`POST /v1/convai/knowledge-base/text`) a
 * vypíše jeho id. Přepnout na něj agenta a smazat starý je zatím krok v
 * konzoli ElevenLabs: agent má jednu bázi, mění se po přecenění (tedy zřídka)
 * a automatizovat přepis konfigurace agenta kvůli tomu znamená riskovat, že
 * skript přepíše i prompt a nastavení, která se ladila ručně.
 */

import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import { buildSupportKnowledgeBase, type SupportGuide } from "../lib/support/kb"

dotenv.config({ path: ".env.local" })

/**
 * Klientské dokumenty, které patří do báze. **Vědomě jen tyhle** — `docs/` je
 * hlavně interní architektura (RUNBOOK, SYSTEM_MAP, návrhy) a ta do úst podpory
 * nepatří: agent by z ní citoval vnitřnosti systému zákazníkovi.
 */
const GUIDES: { file: string; title: string }[] = [
    { file: "docs/INSTAGRAM_SETUP_GUIDE.md", title: "Propojení Instagramu" },
    { file: "docs/POSTING_GUIDE.md", title: "Jak publikovat" },
]

/** Blogové články — psané pro zákazníka, takže tón i obsah sedí. */
const BLOG_DIR = "content/blog"

function readGuides(): SupportGuide[] {
    const out: SupportGuide[] = []

    for (const g of GUIDES) {
        if (!fs.existsSync(g.file)) {
            console.warn(`⚠️  ${g.file} neexistuje — vynechávám`)
            continue
        }
        out.push({ title: g.title, markdown: fs.readFileSync(g.file, "utf-8") })
    }

    if (fs.existsSync(BLOG_DIR)) {
        for (const name of fs.readdirSync(BLOG_DIR).filter(n => n.endsWith(".md")).sort()) {
            const md = fs.readFileSync(path.join(BLOG_DIR, name), "utf-8")
            // Nadpis z první „# " řádky; jméno souboru je slug, ne titulek.
            const h1 = md.match(/^#\s+(.+)$/m)?.[1]?.trim()
            out.push({ title: `Článek: ${h1 || name.replace(/\.md$/, "")}`, markdown: md })
        }
    }

    return out
}

async function push(text: string): Promise<void> {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim()
    if (!apiKey) {
        console.error("❌ ELEVENLABS_API_KEY není nastavený — nahrát nejde")
        process.exit(1)
    }

    const name = `chrlit-podpora-${new Date().toISOString().slice(0, 10)}`
    const res = await fetch("https://api.elevenlabs.io/v1/convai/knowledge-base/text", {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text, name }),
    })

    if (!res.ok) {
        const detail = (await res.text()).replace(/\s+/g, " ").slice(0, 400)
        console.error(`❌ Nahrání selhalo — HTTP ${res.status}: ${detail}`)
        process.exit(1)
    }

    const body = (await res.json()) as { id?: string; name?: string }
    console.log(`\n✅ Nahráno jako „${body.name || name}“`)
    console.log(`   id: ${body.id}`)
    console.log("\n   Zbývá v konzoli ElevenLabs (Agents → agent → Knowledge base):")
    console.log("   1) přidat tenhle dokument agentovi,")
    console.log("   2) odebrat a smazat předchozí verzi, aby agent neměl dvě ceny.")
}

async function main() {
    const args = process.argv.slice(2)
    const guides = readGuides()
    const text = buildSupportKnowledgeBase({ guides })

    console.log("\n📚 ZNALOSTNÍ BÁZE PODPORY\n")
    console.log(`  zdrojů z kódu: ceník, kredity, nápověda (${text.match(/^\*\*/gm)?.length ?? 0} otázek), identita`)
    console.log(`  přiložených dokumentů: ${guides.length}`)
    for (const g of guides) console.log(`    · ${g.title} (${g.markdown.length} znaků)`)
    console.log(`  celkem: ${text.length} znaků`)

    const outIndex = args.indexOf("--out")
    if (outIndex !== -1) {
        const target = args[outIndex + 1]
        if (!target) {
            console.error("❌ --out chce cestu k souboru")
            process.exit(1)
        }
        fs.writeFileSync(target, text, "utf-8")
        console.log(`\n  zapsáno do ${target}`)
    }

    if (args.includes("--push")) await push(text)
    else console.log("\n  (bez --push se nikam nenahrává)")
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
