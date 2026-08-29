/**
 * Přesoudí hotové posty portfolia — bez přegenerování
 * ===================================================
 * Když soudce během generování spadne na slabší model (došlý kredit, výpadek),
 * posty vzniknou pod horší kontrolou, než na jakou je pipeline stavěná. Přegenerovat
 * všechno je nejdražší možná reakce: post stojí ~26 Kč, přesouzení jednotky korun.
 *
 * Tenhle skript proto vezme existující posty, pustí na ně `scorePost()` (tedy tentýž
 * kritik, jen teď na Claudovi) a řekne, KTERÉ jsou slabé. Teprve ty má smysl
 * přegenerovat.
 *
 *   npx tsx scripts/audit-portfolio-quality.ts                    # všechny portfolio značky
 *   npx tsx scripts/audit-portfolio-quality.ts --only=portu
 *   npx tsx scripts/audit-portfolio-quality.ts --threshold=8      # přísnější laťka
 *
 * NIC NEMĚNÍ — jen čte a skóruje. Přegenerování je vědomý druhý krok.
 */

import supabaseAdmin from "../supabase/admin"
import { loadConfig } from "../instagram/configs"
import { scorePost } from "../instagram/caption-generator"

interface Row {
    id: string
    caption: string | null
    call_to_action: string | null
    hashtags: string[] | null
    media_type: string | null
}

/**
 * V DB je `caption` jeden řetězec — hook a body oddělené prázdným řádkem, tak
 * jak se skládá při publikaci. Kritik je chce zvlášť, takže je rozdělíme zpátky.
 */
function splitCaption(caption: string): { hook: string; body: string } {
    const parts = caption.split(/\n\s*\n/)
    return { hook: (parts[0] ?? "").trim(), body: parts.slice(1).join("\n\n").trim() }
}

async function main() {
    const args = process.argv.slice(2)
    const onlyArg = args.find(a => a.startsWith("--only="))
    const only = onlyArg ? onlyArg.split("=")[1].split(",").map(v => v.trim()).filter(Boolean) : null
    const thrArg = args.find(a => a.startsWith("--threshold="))
    const threshold = thrArg ? Number(thrArg.split("=")[1]) : 7

    const { data: clients } = await supabaseAdmin
        .from("clients").select("id, slug, name, config").order("created_at", { ascending: true })

    const portfolio = (clients ?? [])
        .filter(c => ((c.config ?? {}) as any).isPortfolio)
        .filter(c => !only || only.includes(c.slug))

    if (portfolio.length === 0) {
        console.error("❌ Žádné portfolio značky nenalezeny.")
        process.exit(1)
    }

    console.log("\n" + "═".repeat(72))
    console.log(`🔍 AUDIT KVALITY — laťka ${threshold}/10`)
    console.log("═".repeat(72))
    console.log("   Jen čte a skóruje. Nic nepřegenerovává.\n")

    const weak: { slug: string; id: string; score: number; hook: string; fix: string }[] = []
    let scored = 0
    let sum = 0

    for (const c of portfolio) {
        const config = await loadConfig(c.slug)
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select("id, caption, call_to_action, hashtags, media_type")
            .eq("client_id", c.id)
            .is("revision_of", null)
            .order("created_at", { ascending: true })

        const rows = (posts ?? []) as Row[]
        const scores: number[] = []

        for (const p of rows) {
            if (!p.caption) continue
            const { hook, body } = splitCaption(p.caption)
            try {
                const res = await scorePost(config, {
                    hook,
                    body,
                    cta: p.call_to_action ?? "",
                    hashtags: p.hashtags ?? [],
                }, p.media_type ?? undefined)
                scores.push(res.score)
                scored++
                sum += res.score
                if (res.score < threshold) {
                    weak.push({
                        slug: c.slug, id: p.id, score: res.score, hook: hook.slice(0, 58),
                        fix: (res.detail as any)?.fix?.join("; ")?.slice(0, 90) ?? res.feedback.slice(0, 90),
                    })
                }
            } catch (err: any) {
                console.warn(`   ⚠️ ${c.slug}/${p.id.slice(0, 8)}: ${String(err?.message).slice(0, 80)}`)
            }
        }

        const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0
        const below = scores.filter(s => s < threshold).length
        console.log(
            `${c.slug.padEnd(32)} ${String(scores.length).padStart(3)} postů` +
            `  průměr ${avg.toFixed(1)}` +
            `  pod laťkou ${below}`
        )
    }

    console.log("\n" + "─".repeat(72))
    console.log(`Ohodnoceno ${scored} postů · celkový průměr ${(sum / Math.max(1, scored)).toFixed(2)}/10`)
    console.log(`Pod laťkou ${threshold}: ${weak.length} postů`)

    if (weak.length > 0) {
        console.log("\nSLABÉ POSTY (kandidáti na přegenerování):")
        for (const w of weak.sort((a, b) => a.score - b.score)) {
            console.log(`  ${String(w.score).padStart(2)}/10  ${w.slug.padEnd(26)} ${w.hook}`)
            if (w.fix) console.log(`         → ${w.fix}`)
        }
    }
    console.log("")
}

main().catch(err => {
    console.error("💥 Audit selhal:", err)
    process.exit(1)
})
