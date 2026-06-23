/**
 * Seed reference brands — create 4 fictional demo clients and (optionally)
 * generate real posts for them via the engine.
 *
 *   npx tsx scripts/seed-reference-clients.ts                 # create configs + buckets only
 *   npx tsx scripts/seed-reference-clients.ts --generate      # also seed ideas + generate 7 posts/brand
 *   npx tsx scripts/seed-reference-clients.ts --generate --count=3
 *
 * Config creation is idempotent (skips brands whose slug already exists).
 * Generation is the slow/expensive part (real Gemini spend) — it spawns the
 * existing CLI once per brand so module-global tenant state can't cross-contaminate.
 *
 * After generation, run:  npx tsx scripts/export-references.ts
 */

import { spawnSync } from "child_process"
import supabaseAdmin from "../supabase/admin"
import {
    buildManualAnalysisCore,
    generateConfigCore,
    saveConfigCore,
    slugify,
    CATEGORY_DEFAULTS,
    type ManualBusinessInfo,
} from "../app/onboarding/core"

// ─── The 4 fictional brands ──────────────────────────────────────────

interface Brand {
    info: ManualBusinessInfo
    website: string
    city: string
}

const BRANDS: Brand[] = [
    {
        info: {
            businessName: "Kavárna Zrno",
            category: "kavarna",
            description: "Nezávislá kavárna v centru města se specialitkovou kávou z lokální pražírny. Místo, kam se chodí na dobré espresso, domácí dortíky a klid k práci i k popovídání.",
            products: "Cappuccino, Flat white, Cold brew, Filtrovaná káva, Domácí cheesecake, Skořicový šnek",
            tone: "vřelý, pohodový, lokální, lidský",
            igHandle: "kavarna.zrno",
            targetAudience: "Milovníci kávy, freelanceři, studenti, lidé 22-45 hledající příjemné místo",
        },
        website: "https://kavarna-zrno.cz",
        city: "Brno",
    },
    {
        info: {
            businessName: "Studio Lumen",
            category: "salon",
            description: "Moderní kadeřnický salon zaměřený na proměny, barvení a péči o vlasy. Důraz na poradenství, kvalitní produkty a pocit, že odejdete jako nejlepší verze sebe.",
            products: "Dámský střih, Pánský střih, Barvení, Melír / Balayage, Péče o vlasy, Svatební účes",
            tone: "elegantní, profesionální, sebevědomý, pečující",
            igHandle: "studio.lumen",
            targetAudience: "Ženy 20-50 a muži 22-45, kteří dbají na svůj vzhled",
        },
        website: "https://studio-lumen.cz",
        city: "Praha",
    },
    {
        info: {
            businessName: "Vinařství Pod Strání",
            category: "vinarstvi",
            description: "Rodinné vinařství z jižní Moravy. Tři generace, vlastní vinice a vína dělaná s respektem k tradici i terroir. Otevřený sklep, degustace a vína, za kterými je příběh.",
            products: "Ryzlink rýnský, Veltlínské zelené, Frankovka, Rosé, Pálava, Degustace ve sklepě",
            tone: "rodinný, hrdý, řemeslný, autentický",
            igHandle: "vinarstvi.podstrani",
            targetAudience: "Milovníci vína, páry, dárci, gastro nadšenci 28-60 let",
        },
        website: "https://vinarstvi-podstrani.cz",
        city: "Mikulov",
    },
    {
        info: {
            businessName: "Forma Fitness",
            category: "fitness",
            description: "Komunitní fitko a studio osobního tréninku. Žádné machrování — funkční tréninky, výživové poradenství a trenéři, kteří vás dotáhnou k výsledkům. Pro začátečníky i pokročilé.",
            products: "Osobní trénink, Skupinové lekce, Funkční trénink, Výživové poradenství, Měsíční permanentka",
            tone: "energický, motivační, přímý, povzbuzující",
            igHandle: "forma.fitness",
            targetAudience: "Aktivní lidé 18-45, začátečníci i pokročilí sportovci",
        },
        website: "https://forma-fitness.cz",
        city: "Ostrava",
    },
    {
        info: {
            businessName: "Flowtask",
            category: "app",
            description: "Česká aplikace na řízení úkolů a projektů pro freelancery a malé týmy. Přehledné plánování, sdílené nástěnky a chytré připomínky — bez zbytečné složitosti. Vše na jednom místě, ať máte čas na práci, ne na organizování práce.",
            products: "Správa úkolů, Sdílené projekty, Kanban nástěnky, Časové plánování, Týmová spolupráce, Mobilní appka",
            tone: "moderní, svižný, přátelský, sebevědomý",
            igHandle: "flowtask.app",
            targetAudience: "Freelanceři, zakladatelé startupů, malé týmy a produktoví lidé 22-40 let",
        },
        website: "https://flowtask.app",
        city: "Praha",
    },
    {
        info: {
            businessName: "Brevia",
            category: "app",
            description: "AI asistent, který za vás shrne dlouhé dokumenty, e-maily a poznámky do pár vět. Ušetří hodiny čtení a pomůže se rozhodovat rychleji. Postaveno pro lidi, kteří mají víc informací než času.",
            products: "AI shrnutí dokumentů, Shrnutí e-mailů, Přepis a souhrn schůzek, Chytré poznámky, Prohledávání znalostí",
            tone: "chytrý, úsporný, profesionální, lidský",
            igHandle: "brevia.ai",
            targetAudience: "Manažeři, konzultanti, studenti a knowledge workeři 24-45 let",
        },
        website: "https://brevia.ai",
        city: "Brno",
    },
]

// ─── Helpers ─────────────────────────────────────────────────────────

async function resolveAdminUserId(): Promise<string | undefined> {
    const emails = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
    if (emails.length === 0) {
        console.warn("⚠️ SUPER_ADMIN_EMAILS not set — clients won't be linked to a dashboard user.")
        return undefined
    }
    const { data, error } = await supabaseAdmin.auth.admin.listUsers()
    if (error || !data) {
        console.warn("⚠️ Could not list users:", error?.message)
        return undefined
    }
    const admin = data.users.find(u => u.email && emails.includes(u.email))
    if (!admin) {
        console.warn(`⚠️ No user found matching SUPER_ADMIN_EMAILS (${emails.join(", ")}). Skipping dashboard link.`)
        return undefined
    }
    console.log(`👤 Linking brands to admin: ${admin.email}`)
    return admin.id
}

async function slugExists(slug: string): Promise<boolean> {
    const { data } = await supabaseAdmin.from("clients").select("id").eq("slug", slug).maybeSingle()
    return !!data
}

function runCli(slug: string, extraArgs: string[]): void {
    const args = ["tsx", "instagram/cli.ts", `--config=${slug}`, ...extraArgs]
    console.log(`   ▶ npx ${args.join(" ")}`)
    const res = spawnSync("npx", args, { stdio: "inherit", env: process.env })
    if (res.status !== 0) {
        console.warn(`   ⚠️ CLI exited with status ${res.status} for ${slug} (${extraArgs.join(" ")})`)
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2)
    const doGenerate = args.includes("--generate")
    const countArg = args.find(a => a.startsWith("--count="))
    const count = countArg ? parseInt(countArg.split("=")[1], 10) : 7

    console.log("\n" + "═".repeat(64))
    console.log("🌱 SEED REFERENCE BRANDS")
    console.log("═".repeat(64))
    console.log(`   Brands: ${BRANDS.length} | Generate: ${doGenerate ? `yes (${count} posts each)` : "no (configs only)"}`)

    const adminUserId = await resolveAdminUserId()
    const createdSlugs: string[] = []

    // ── Phase 1: create configs + buckets ──
    for (const brand of BRANDS) {
        const slug = slugify(brand.info.businessName)
        console.log(`\n── ${brand.info.businessName} (${slug}) ──`)

        if (await slugExists(slug)) {
            // Backfill industry + isReference on already-created brands (idempotent self-heal)
            const { data: existing } = await supabaseAdmin.from("clients").select("id, config").eq("slug", slug).single()
            const cfg = (existing?.config as any) || {}
            const expectedIndustry = CATEGORY_DEFAULTS[brand.info.category]?.industry
            if (existing && (!cfg.industry || cfg.isReference !== true)) {
                cfg.industry = cfg.industry || expectedIndustry
                cfg.isReference = true
                await supabaseAdmin.from("clients").update({ config: cfg }).eq("id", existing.id)
                console.log("   ↩︎ Exists — backfilled industry/isReference.")
            } else {
                console.log("   ↩︎ Slug already exists — skipping config creation.")
            }
            createdSlugs.push(slug)
            continue
        }

        try {
            console.log("   🔍 Building analysis…")
            const analysis = await buildManualAnalysisCore(brand.info)

            console.log("   🧩 Generating config…")
            const config = await generateConfigCore(analysis, {}, brand.website, brand.info.igHandle)
            config.isReference = true
            config.city = brand.city
            config.industry = analysis.industry || CATEGORY_DEFAULTS[brand.info.category]?.industry

            console.log("   💾 Saving (client + bucket + products)…")
            const savedSlug = await saveConfigCore(config, analysis, { userId: adminUserId })
            createdSlugs.push(savedSlug)
            console.log(`   ✅ Created: ${savedSlug}`)
        } catch (err) {
            console.error(`   ❌ Failed for ${brand.info.businessName}:`, (err as Error).message)
        }
    }

    // ── Phase 2: generate ideas + posts (optional, expensive) ──
    if (doGenerate && createdSlugs.length > 0) {
        console.log("\n" + "═".repeat(64))
        console.log(`🎨 GENERATING — ${count} posts per brand (this takes a while + costs API)`)
        console.log("═".repeat(64))
        for (const slug of createdSlugs) {
            console.log(`\n🏢 ${slug}`)
            console.log("   💡 Seeding idea bank…")
            runCli(slug, ["--generate-ideas", "--count=10"])
            await sleep(3000)
            console.log(`   📸 Generating ${count} posts…`)
            runCli(slug, [`--count=${count}`])
            await sleep(3000)
        }
    }

    console.log("\n" + "═".repeat(64))
    console.log("✅ DONE")
    console.log("═".repeat(64))
    console.log(`   Brands ready: ${createdSlugs.join(", ") || "(none)"}`)
    if (!doGenerate) {
        console.log("\n   Next — generate real posts:")
        console.log("     npx tsx scripts/seed-reference-clients.ts --generate")
        console.log("   (or per brand)")
        for (const slug of createdSlugs) {
            console.log(`     npx tsx instagram/cli.ts --config=${slug} --generate-ideas --count=10`)
            console.log(`     npx tsx instagram/cli.ts --config=${slug} --count=7`)
        }
    }
    console.log("\n   Then export for the website:")
    console.log("     npx tsx scripts/export-references.ts\n")
}

main().catch(err => {
    console.error("💥 Seed failed:", err)
    process.exit(1)
})
