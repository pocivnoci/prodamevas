/**
 * Portfolio na skutečných značkách — jako projekty v dashboardu
 * =============================================================
 * Z webu veřejně známé firmy udělá plnohodnotného klienta: engine se učí ze
 * skutečné stránky (barvy, produkty, tón), takže feed jde v aplikaci procházet,
 * upravovat i po jednom přegenerovat. To je ten rozdíl proti `portfolio-previews.ts`,
 * které vyrobí jen tři obrázky mimo dashboard.
 *
 *   npx tsx scripts/seed-portfolio-clients.ts --dry-run           # co by běželo
 *   npx tsx scripts/seed-portfolio-clients.ts --configs-only      # jen klienti, bez postů
 *   npx tsx scripts/seed-portfolio-clients.ts                     # klienti + 12 postů each
 *   npx tsx scripts/seed-portfolio-clients.ts --only=portu,znovin --count=4
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

import { spawnSync } from "child_process"
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

function runCli(slug: string, extraArgs: string[]): void {
    const args = ["tsx", "instagram/cli.ts", `--config=${slug}`, ...extraArgs]
    console.log(`   ▶ npx ${args.join(" ")}`)
    const res = spawnSync("npx", args, { stdio: "inherit", env: process.env })
    if (res.status !== 0) {
        console.warn(`   ⚠️ CLI skončilo se statusem ${res.status} pro ${slug} (${extraArgs.join(" ")})`)
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
    const args = process.argv.slice(2)
    const dry = args.includes("--dry-run")
    const configsOnly = args.includes("--configs-only")
    const countArg = args.find(a => a.startsWith("--count="))
    const count = countArg ? parseInt(countArg.split("=")[1], 10) : 12
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

    // ── Fáze 2: nápady + posty ──
    if (!configsOnly && readySlugs.length > 0) {
        console.log("\n" + "═".repeat(66))
        console.log(`🎨 GENERUJI — ${count} postů na značku (trvá dlouho a stojí peníze)`)
        console.log("═".repeat(66))
        for (const slug of readySlugs) {
            console.log(`\n🏢 ${slug}`)
            console.log("   💡 Plním zásobník nápadů…")
            runCli(slug, ["--generate-ideas", `--count=${Math.max(count, 10)}`])
            await sleep(3000)
            console.log(`   📸 Generuji ${count} postů…`)
            runCli(slug, [`--count=${count}`])
            await sleep(3000)
        }
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
