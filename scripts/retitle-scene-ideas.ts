/**
 * Přepíše názvy nápadů, které zůstaly popiskem scény, na hooky.
 *
 *   npx tsx scripts/retitle-scene-ideas.ts                # read-only report, všichni klienti
 *   npx tsx scripts/retitle-scene-ideas.ts --slug=<slug>  # jen jeden klient
 *   npx tsx scripts/retitle-scene-ideas.ts --fix          # zapíše
 *
 * PROČ
 * ────
 * Převod formátů na invarianty (#12) přestěhoval konkrétnost ze storyboardů do
 * `ig_post_ideas` — správně. Názvy těch nápadů ale zůstaly popiskem scény:
 * „Záhada z pavlače", „Pauza v kavárně", „Detail finální stuhy", „Ranní káva
 * na schodech". To nejsou hooky, to je natáčecí plán.
 *
 * A vadí to konkrétně: do mega promptu jde nápad jako `**název**: obsah`, tedy
 * název tučně a první, takže ho model čte jako hlavní myšlenku. „Záhada z pavlače"
 * přitom v obsahu žádnou pavlač nemá — název slibuje kulisu, kterou nápad
 * neobsahuje, a model ji pak do postu domyslí.
 *
 * Mění se VÝHRADNĚ `title`. `content` zůstává nedotčený — je konkrétní a je to
 * přesně to, co se v nápadu má schovávat.
 *
 * Laťkou jsou nápady od generátoru: „POV: Partner měl během vaší dovolené zalévat
 * kytky", „Crash test: Vinohradská tramvaj vs. kytice pro paní učitelku".
 */

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import supabaseAdmin from "../supabase/admin"
import { generateTextQuality } from "../instagram/gemini-client"
import { getModel, hasFallback } from "../instagram/models"

const args = process.argv.slice(2)
const FIX = args.includes("--fix")
const SLUG = args.find(a => a.startsWith("--slug="))?.split("=")[1]

/** Kolik nápadů posílat modelu naráz. Víc než tucet = dlouhé přemýšlení nad jedním
 *  požadavkem, spojení spadne na `fetch failed` a retry je pak drahý. */
const BATCH = Number(args.find(a => a.startsWith("--batch="))?.split("=")[1]) || 10

const SCHEMA = {
    type: "object",
    properties: {
        changes: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    reason: { type: "string" },
                },
                required: ["id", "title", "reason"],
            },
        },
    },
    required: ["changes"],
}

function buildPrompt(brand: string, ideas: { id: string; title: string; content: string }[]): string {
    return `Jsi editor obsahu značky "${brand}". Dostaneš nápady na instagramové příspěvky.

U každého nápadu posuď JEHO NÁZEV:

• HOOK = zastaví palec při scrollování. Slibuje konkrétní užitek, napětí nebo emoci.
  Příklady dobrých názvů: "POV: Partner měl během vaší dovolené zalévat kytky",
  "Crash test: Vinohradská tramvaj vs. kytice pro paní učitelku",
  "Mýty vs. Fakta: Funguje mince ve váze nebo Sprite v kytici?"

• POPISEK SCÉNY = pojmenovává záběr nebo kulisu, ne důvod ke sledování.
  Příklady špatných názvů: "Záhada z pavlače", "Pauza v kavárně",
  "Detail finální stuhy", "Ranní káva na schodech", "Klidný nedělní večer"

Vrať POUZE nápady, jejichž název je popisek scény, a ke každému nový název, který:
1. vychází z OBSAHU nápadu — nesmí slibovat kulisu, rekvizitu ani místo, které v obsahu není,
2. je česky, maximálně 70 znaků, bez uvozovek a bez hashtagů,
3. zní jako hook, ne jako název kapitoly.

Nápad, jehož název už hookem je, do odpovědi NEDÁVEJ.

NÁPADY:
${ideas.map(i => `[${i.id}]\nnázev: ${i.title}\nobsah: ${i.content}`).join("\n\n")}`
}

async function main() {
    let q = supabaseAdmin.from("clients").select("id, slug, name")
    if (SLUG) q = q.eq("slug", SLUG)
    const { data: clients, error } = await q
    if (error) throw new Error(error.message)

    const models = [getModel("textPro")]
    if (hasFallback("textPro")) models.push(getModel("textPro", "fallback"))

    console.log(`\n✏️  NÁZVY NÁPADŮ → HOOKY${FIX ? "" : "   (read-only report)"}`)
    console.log(`   klientů: ${clients?.length ?? 0}\n`)

    let total = 0
    const skipped: string[] = []

    for (const c of clients ?? []) {
        const { data: ideas } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("id, title, content")
            .eq("client_id", c.id)
            .eq("is_active", true)

        if (!ideas || ideas.length === 0) continue

        // PO DÁVKÁCH. Celý zásobník najednou znamená, že model přemýšlí nad desítkami
        // nápadů v jednom požadavku — spojení to nevydrží a spadne to na `fetch failed`
        // až po minutách, takže i retry je drahý. Menší dávka odpoví rychle a případný
        // výpadek stojí jen ji.
        //
        // Jeden nedostupný model navíc NESMÍ shodit zbytek — ostatní klienti za to
        // nemůžou. Přeskočené vypíšeme na konec, ať je vidět, co dojet znovu.
        const changes: { id: string; title: string; reason: string }[] = []
        let batchFailed = false

        for (let i = 0; i < ideas.length; i += BATCH) {
            const batch = ideas.slice(i, i + BATCH)
            let raw: string
            try {
                raw = await generateTextQuality(buildPrompt(c.name, batch as any), {
                    models,
                    responseSchema: SCHEMA,
                    label: `retitle:${c.slug}:${i / BATCH + 1}`,
                })
            } catch (err: any) {
                console.warn(`   ⏭️  dávka ${i / BATCH + 1}: ${String(err?.message || err).slice(0, 80)}`)
                batchFailed = true
                continue
            }
            try {
                changes.push(...(JSON.parse(raw)?.changes ?? []).filter((ch: any) => ch?.id && ch?.title))
            } catch {
                console.warn(`   ⏭️  dávka ${i / BATCH + 1}: odpověď nešla rozparsovat`)
                batchFailed = true
            }
        }

        if (batchFailed) skipped.push(c.slug)

        // Model smí navrhnout jen nápady, které dostal — jinak bychom psali cizímu klientovi.
        const known = new Map(ideas.map((i: any) => [i.id, i.title]))
        const accepted = changes.filter(ch => known.has(ch.id) && ch.title.trim() !== known.get(ch.id))

        if (accepted.length === 0) {
            console.log(`✅ ${c.slug}: názvy jsou v pořádku (${ideas.length} nápadů)`)
            continue
        }

        total += accepted.length
        console.log(`⚠️  ${c.slug} (${c.name}) — ${accepted.length} z ${ideas.length}`)
        for (const ch of accepted) {
            console.log(`   „${known.get(ch.id)}"`)
            console.log(`   → „${ch.title}"   (${ch.reason})`)
        }

        if (FIX) {
            for (const ch of accepted) {
                const { error: uErr } = await supabaseAdmin
                    .from("ig_post_ideas")
                    .update({ title: ch.title.trim() })
                    .eq("id", ch.id)
                    .eq("client_id", c.id) // multi-tenant: nikdy nesahat mimo klienta
                if (uErr) console.error(`   ❌ ${ch.id}: ${uErr.message}`)
            }
            console.log(`   ✅ přepsáno`)
        }
        console.log()
    }

    console.log("─".repeat(60))
    if (total === 0) console.log("Nic k přepsání.")
    else if (FIX) console.log(`Přepsáno ${total} názvů.`)
    else console.log(`Nalezeno ${total} scénických názvů. Zápis: přidej --fix.`)
    if (skipped.length > 0) console.log(`Přeskočeno (model nedostupný): ${skipped.join(", ")} — pusť znovu.`)
    console.log()
}

void main().catch(err => { console.error("❌", err.message); process.exit(1) })
