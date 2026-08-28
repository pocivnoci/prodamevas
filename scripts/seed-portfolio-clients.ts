/**
 * Portfolio na skutečných značkách — jako projekty v dashboardu
 * =============================================================
 * Z webu veřejně známé firmy udělá plnohodnotného klienta: engine se učí ze
 * skutečné stránky (barvy, produkty, tón), takže feed jde v aplikaci procházet,
 * upravovat i po jednom přegenerovat. Fiktivní značky
 * (`seed-reference-clients.ts`) ukazují obor; tyhle ukazují schopnost.
 *
 *   npx tsx scripts/seed-portfolio-clients.ts --dry-run           # co by běželo
 *   npx tsx scripts/seed-portfolio-clients.ts --configs-only      # jen klienti, bez postů
 *   npx tsx scripts/seed-portfolio-clients.ts                     # klienti + 12 postů each
 *   npx tsx scripts/seed-portfolio-clients.ts --only=portu,znovin --count=4
 *   npx tsx scripts/seed-portfolio-clients.ts --parallel=5     # kolik značek najednou (výchozí 3)
 *
 * ⚠️ TYHLE FIRMY NEJSOU KLIENTI a nevědí o tom. Zakládají se s
 * `config.isPortfolio = true` a ZÁMĚRNĚ BEZ `isReference` — ten příznak sbírá
 * `export-references.ts` na marketingovou zeď, kde by z cizích značek udělal
 * případové studie. Kdekoli se tyhle posty ukážou, musí u nich být řečeno, že
 * jde o nevyžádaný koncept.
 *
 * Zakládání configu je levné, generování postů je ta drahá část — proto `--only=`
 * a `--count=`. Skutečnou cenu vypisuje engine do logu (`💰 …`); rozpočet si
 * ověř jedním během `--only=<slug> --count=1`, ne odhadem.
 */

import { spawn } from "child_process"
import { createWriteStream, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import supabaseAdmin from "../supabase/admin"
import { scrapeBrandBasics } from "../lib/agents/sales/brand-scrape"
import { analyzeBrand } from "../lib/agents/sales/preview"
import { generateConfigCore, saveConfigCore } from "../app/onboarding/core"

interface Target {
    key: string
    company: string
    industry: string
    website: string
    city: string
    igHandle: string
}

/**
 * Deset značek, jedna na obor z `docs/portfolio/segmenty-cz.md`. Všechny ověřené
 * `scrapeBrandBasics()` — vracejí titulek i použitelný text.
 * Nepoužitelné a proč: Notino a SIKO vracejí 403, Košík renderuje až v prohlížeči,
 * Baťa a Sonberk timeoutují.
 */
const TARGETS: Target[] = [
    { key: "ambiente", company: "Ambiente", industry: "Gastronomie", website: "https://www.ambi.cz/", city: "Praha", igHandle: "ambi.cz" },
    { key: "klier", company: "Kadeřnictví Klier", industry: "Beauty / Kadeřnictví", website: "https://www.klier.cz/", city: "Praha", igHandle: "kadernictvi_klier" },
    { key: "rohlik", company: "Rohlik.cz", industry: "E-commerce", website: "https://www.rohlik.cz/", city: "Praha", igHandle: "rohlik.cz" },
    { key: "koupelny-ptacek", company: "Koupelny Ptáček", industry: "Řemeslo / Bydlení", website: "https://www.koupelny-ptacek.cz/", city: "Praha", igHandle: "koupelnyptacek" },
    { key: "form-factory", company: "Form Factory", industry: "Fitness / Wellness", website: "https://www.formfactory.cz/", city: "Praha", igHandle: "formfactory" },
    { key: "grandhotel-pupp", company: "Grandhotel Pupp", industry: "Ubytování / Hotel", website: "https://www.pupp.cz/", city: "Karlovy Vary", igHandle: "grandhotelpupp" },
    { key: "znovin", company: "Znovín Znojmo", industry: "Vinařství", website: "https://www.znovin.cz/", city: "Znojmo", igHandle: "znovinznojmo" },
    { key: "asklepion", company: "Asklepion", industry: "Zdraví / Estetika", website: "https://www.asklepion.cz/", city: "Praha", igHandle: "asklepion" },
    { key: "svoboda-williams", company: "Svoboda & Williams", industry: "Reality", website: "https://www.svoboda-williams.com/", city: "Praha", igHandle: "svobodawilliams" },
    { key: "portu", company: "Portu", industry: "Finance / Investice", website: "https://www.portu.cz/", city: "Praha", igHandle: "portu.cz" },
]

async function resolveAdminUserId(): Promise<string | undefined> {
    const emails = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
    if (emails.length === 0) {
        console.warn("⚠️ SUPER_ADMIN_EMAILS není nastavené — projekty se nepřipojí k žádnému uživateli dashboardu.")
        return undefined
    }
    const { data, error } = await supabaseAdmin.auth.admin.listUsers()
    if (error || !data) {
        console.warn("⚠️ Nepodařilo se načíst uživatele:", error?.message)
        return undefined
    }
    const admin = data.users.find(u => u.email && emails.includes(u.email))
    if (!admin) {
        console.warn(`⚠️ Žádný uživatel neodpovídá SUPER_ADMIN_EMAILS (${emails.join(", ")}).`)
        return undefined
    }
    console.log(`👤 Projekty se připojí k: ${admin.email}`)
    return admin.id
}

/** Hledá podle webu, ne podle jména — slug se odvozuje z názvu, který může driftovat. */
async function existingSlugFor(website: string): Promise<string | null> {
    const { data } = await supabaseAdmin
        .from("clients").select("slug").eq("website", website).maybeSingle()
    return data?.slug ?? null
}

/**
 * Pustí CLI a počká na konec. Výstup jde do souboru, ne na terminál — při
 * souběžném běhu by se hlášky deseti značek proplétaly do nečitelné kaše.
 */
function runCli(slug: string, extraArgs: string[], logPath: string): Promise<number> {
    return new Promise(resolve => {
        const args = ["tsx", "instagram/cli.ts", `--config=${slug}`, ...extraArgs]
        const log = createWriteStream(logPath, { flags: "a" })
        log.write(`\n$ npx ${args.join(" ")}\n`)
        const child = spawn("npx", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] })
        child.stdout.pipe(log)
        child.stderr.pipe(log)
        child.on("close", code => { log.end(); resolve(code ?? 1) })
    })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Zpracuje značky souběžně. Každé volání CLI je vlastní proces, takže modulově
 * globální `setActiveProject()` nemůže zkřížit tenanty — to platí jen uvnitř
 * jednoho procesu. Sekvenčně by 12 postů na 10 značek běželo přes dvacet hodin.
 */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
    let next = 0
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++
            await worker(items[i])
        }
    })
    await Promise.all(runners)
}

async function main() {
    const args = process.argv.slice(2)
    const dry = args.includes("--dry-run")
    const configsOnly = args.includes("--configs-only")
    const countArg = args.find(a => a.startsWith("--count="))
    const count = countArg ? parseInt(countArg.split("=")[1], 10) : 12
    const parallelArg = args.find(a => a.startsWith("--parallel="))
    const parallel = Math.max(1, parallelArg ? parseInt(parallelArg.split("=")[1], 10) : 3)
    const onlyArg = args.find(a => a.startsWith("--only="))
    const only = onlyArg ? onlyArg.split("=")[1].split(",").map(v => v.trim()).filter(Boolean) : null

    const targets = only ? TARGETS.filter(t => only.includes(t.key)) : TARGETS
    if (only && targets.length === 0) {
        console.error(`❌ --only=${only.join(",")} nesedí na žádnou značku.`)
        console.error(`   Dostupné: ${TARGETS.map(t => t.key).join(", ")}`)
        process.exit(1)
    }

    console.log("\n" + "═".repeat(66))
    console.log("🖼  PORTFOLIO — skutečné značky jako projekty v dashboardu")
    console.log("═".repeat(66))
    console.log(`   Značek: ${targets.length}${only ? ` z ${TARGETS.length}` : ""} · posty: ${configsOnly ? "ne (jen configy)" : `${count} na značku`}`)
    console.log("   Nejsou to klienti — zakládá se s isPortfolio, bez isReference.\n")

    if (dry) {
        for (const t of targets) console.log(`   · ${t.key.padEnd(18)} ${t.company.padEnd(22)} ${t.website}`)
        console.log("\n   Nic nezaloženo. Spusť bez --dry-run.\n")
        return
    }

    const adminUserId = await resolveAdminUserId()
    const readySlugs: string[] = []

    // ── Fáze 1: klienti z reálných webů ──
    for (const t of targets) {
        console.log(`\n── ${t.company} (${t.industry}) ──`)

        const existing = await existingSlugFor(t.website)
        if (existing) {
            console.log(`   ↩︎ Už existuje jako ${existing} — přeskakuji zakládání.`)
            readySlugs.push(existing)
            continue
        }

        try {
            console.log("   🔍 Stahuji web…")
            const basics = await scrapeBrandBasics(t.website)
            if (!basics) throw new Error(`web ${t.website} se nepodařilo načíst`)

            console.log("   🧠 Analyzuji značku…")
            const analysis = await analyzeBrand(basics)

            console.log("   🧩 Skládám konfiguraci…")
            const config = await generateConfigCore(analysis, {}, t.website, t.igHandle)
            config.isPortfolio = true
            config.city = t.city
            config.industry = analysis.industry || t.industry

            console.log("   💾 Ukládám (klient + bucket + produkty)…")
            const slug = await saveConfigCore(config, analysis, { userId: adminUserId })
            readySlugs.push(slug)
            console.log(`   ✅ Založeno: ${slug}`)
        } catch (err) {
            console.error(`   ❌ ${t.company}: ${(err as Error).message}`)
        }
    }

    // ── Fáze 2: nápady + posty, souběžně přes značky ──
    if (!configsOnly && readySlugs.length > 0) {
        const logDir = join(tmpdir(), "chrlit-portfolio")
        mkdirSync(logDir, { recursive: true })

        console.log("\n" + "═".repeat(66))
        console.log(`🎨 GENERUJI — ${count} postů na značku, ${parallel} značek souběžně`)
        console.log("═".repeat(66))
        console.log(`   Logy: ${logDir}/<slug>.log`)
        console.log("   Trvá to hodiny a stojí to peníze. Průběh sleduj v logách.\n")

        const started = Date.now()
        let done = 0
        await pool(readySlugs, parallel, async slug => {
            const logPath = join(logDir, `${slug}.log`)
            console.log(`   ▶ ${slug} — start`)
            const a = await runCli(slug, ["--generate-ideas", `--count=${Math.max(count, 10)}`], logPath)
            if (a !== 0) console.warn(`   ⚠️ ${slug}: nápady skončily se statusem ${a}`)
            await sleep(2000)
            const b = await runCli(slug, [`--count=${count}`], logPath)
            if (b !== 0) console.warn(`   ⚠️ ${slug}: posty skončily se statusem ${b}`)
            done++
            const min = ((Date.now() - started) / 60000).toFixed(0)
            console.log(`   ✅ ${slug} — hotovo (${done}/${readySlugs.length}, ${min} min od startu)`)
        })
    }

    console.log("\n" + "═".repeat(66))
    console.log("✅ HOTOVO")
    console.log("═".repeat(66))
    console.log(`   Projekty: ${readySlugs.join(", ") || "(žádné)"}`)
    if (configsOnly) {
        console.log("\n   Posty dogenerovat:")
        for (const slug of readySlugs) {
            console.log(`     npx tsx instagram/cli.ts --config=${slug} --count=${count}`)
        }
    }
    console.log("")
}

main().catch(err => {
    console.error("💥 Portfolio selhalo:", err)
    process.exit(1)
})
