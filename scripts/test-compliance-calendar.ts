/**
 * Testy daňového kalendáře — datová logika a hlasitost.
 *
 *   npx tsx scripts/test-compliance-calendar.ts
 *
 * Proč zvlášť: termíny se počítají z data, takže chyba se neprojeví jako pád,
 * ale jako e-mail, který přišel o měsíc pozdě — nebo nepřišel vůbec. To se pozná
 * jen tím, že se agent spustí pro konkrétní dny a zkontroluje, co vrátil.
 *
 * Režim DPH se pravidlům předává **parametrem**, ne přes `process.env` — `lib/legal.ts`
 * snímá env při importu, takže přepis po importu by neudělal nic a test by tiše
 * kontroloval pořád tentýž stav. Díky tomu sekce 6 ukazuje skutečnou konfiguraci.
 */

import { config } from "dotenv"
config({ path: ".env.local" })

let passed = 0
let failed = 0

function check(ok: boolean, name: string, detail = "") {
    if (ok) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

/** UTC datum, ať test nezávisí na časové zóně stroje. */
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12))

async function main() {
    const { buildComplianceReport } = await import("../lib/agents/compliance-calendar")

    console.log("\n📅 Daňový kalendář\n" + "─".repeat(52))

    // Pravidlo se testuje přímo s režimem „identified", ne přes buildComplianceReport —
    // ten čte skutečnou konfiguraci (dnes „none"), takže by tyhle aserce testovaly
    // jen to, že neplátce mlčí, a měsíční logika by zůstala nepokrytá.
    const { monthlyVatItem } = await import("../lib/agents/compliance-calendar")
    const vatOn = (d: Date) => monthlyVatItem(d, "identified")

    console.log("\n1) Měsíční přiznání k DPH (identifikovaná osoba)")
    {
        // 22. 8. → termín 25. 8. je za 3 dny, tedy v pětidenním okně a „now".
        const vat = vatOn(day(2026, 8, 22))
        check(!!vat, "tři dny před 25. se ozve")
        check(vat?.urgency === "now", "je označené jako urgentní", vat?.urgency)
        check(!!vat?.deadline.includes("25. 8. 2026"), "termín je 25. 8. 2026", vat?.deadline)
        // Období je předchozí měsíc, ne ten probíhající — klasická záměna.
        check(!!vat?.action.includes("července"), "účtuje se za PŘEDCHOZÍ měsíc (červenec)", vat?.action)
    }
    check(vatOn(day(2026, 8, 10)) === null, "15 dní předem zbytečně nebudí")
    // Po 25. se musí přeskočit na příští měsíc, ne hlásit termín v minulosti.
    check(vatOn(day(2026, 8, 27)) === null, "den po termínu už neupozorňuje na propásnutý termín")
    check(
        !!vatOn(day(2026, 9, 23))?.deadline.includes("25. 9. 2026"),
        "další měsíc počítá 25. 9.",
        vatOn(day(2026, 9, 23))?.deadline
    )
    // Přelom roku. 27. 12. je do 25. 1. ještě 29 dní, takže se správně MLČÍ —
    // okno je pětidenní, ne „hlas se, jak se blíží konec roku".
    check(vatOn(day(2026, 12, 27)) === null, "mezi Vánoci a Novým rokem nebudí (do termínu je 29 dní)")
    {
        // Skutečný přelom: 22. 1. 2027 → období prosinec 2026, termín 25. 1. 2027.
        // Tady by se chyba v přetečení měsíce projevila rokem 2026 nebo únorem.
        const vat = vatOn(day(2027, 1, 22))
        check(!!vat?.deadline.includes("25. 1. 2027"), "v lednu míří na 25. 1. 2027", vat?.deadline)
        check(!!vat?.action.includes("prosince 2026"), "a účtuje za prosinec PŘEDCHOZÍHO roku", vat?.action)
    }

    console.log("\n2) Režim DPH rozhoduje, jestli se vůbec ozve")
    {
        // Pravidlo se volá přímo s režimem, ne přes env — lib/legal snímá env při
        // importu, takže přepsání process.env po importu nic neudělá (na tom
        // tenhle test původně selhal a tiše by kontroloval pořád stejný stav).
        const { monthlyVatItem } = await import("../lib/agents/compliance-calendar")
        const when = day(2026, 8, 22)
        check(monthlyVatItem(when, "none") === null, "neplátce nemá co podávat → mlčí")
        check(monthlyVatItem(when, "identified") !== null, "identifikovaná osoba dostane upozornění")
        check(monthlyVatItem(when, "payer") !== null, "plátce taky")
        check(
            !!monthlyVatItem(when, "identified")?.why.includes("ze zahraničí"),
            "identifikované osobě vysvětlí, že jde o nákupy ze zahraničí"
        )
        check(
            !!monthlyVatItem(when, "payer")?.why.includes("každé období"),
            "plátci vysvětlí, že se podává vždy"
        )
    }

    console.log("\n3) Roční termíny v okně předstihu")
    {
        const r = await buildComplianceReport(day(2026, 4, 10))
        check(r.items.some(i => i.action.includes("daňové přiznání")), "3 týdny před 2. 5. hlásí přiznání")
    }
    {
        const r = await buildComplianceReport(day(2026, 3, 1))
        check(!r.items.some(i => i.action.includes("daňové přiznání")), "dva měsíce předem ještě mlčí")
    }
    {
        const r = await buildComplianceReport(day(2027, 1, 5))
        check(r.items.some(i => i.action.includes("paušálního režimu")), "začátkem ledna hlásí paušální režim")
    }
    {
        // Po 10. lednu je rozhodnutí odložené o rok — nesmí hlásit letošní termín.
        const r = await buildComplianceReport(day(2027, 1, 20))
        const p = r.items.find(i => i.action.includes("paušálního režimu"))
        check(!p, "po 10. lednu už paušální režim neurguje")
    }
    {
        const r = await buildComplianceReport(day(2026, 5, 20))
        check(r.items.some(i => i.action.includes("Přehled o příjmech")), "před 2. 6. hlásí přehledy pro ČSSZ/pojišťovnu")
    }

    console.log("\n4) Hlasitost — ticho, když není co řešit")
    {
        // Klidný den: mimo všechna okna. 15. 10. nemá roční termín ani DPH okno.
        const r = await buildComplianceReport(day(2026, 10, 15))
        const loud = r.items.filter(i => i.urgency !== "info")
        check(!r.needsAttention, "klidný den nepošle e-mail", `hlasitých položek: ${loud.length} (${loud.map(i => i.action).join("; ")})`)
        // „info" položky (chybějící údaj) samy o sobě e-mail spustit nesmí.
        check(r.items.every(i => i.urgency === "info") || r.items.length === 0,
            "zbývají jen položky bez termínu")
    }

    console.log("\n5) Sledování obratu vůči hranici DPH")
    {
        const r = await buildComplianceReport(day(2026, 10, 15))
        check(typeof r.turnover12m === "number" && r.turnover12m >= 0, "obrat se spočítal", String(r.turnover12m))
        check(r.thresholdRatio >= 0, "podíl na hranici je nezáporný", String(r.thresholdRatio))
    }
    {
        // Obrat květinářství se MUSÍ přičítat — hranice je za osobu, ne za činnost.
        process.env.LEGAL_OTHER_TURNOVER_CZK = "1900000"
        const mod = await import(`../lib/agents/compliance-calendar?turnover=${Date.now()}`)
        const r = await mod.buildComplianceReport(day(2026, 10, 15))
        check(r.turnover12m >= 1_900_000, "obrat ostatních činností se přičte", String(r.turnover12m))
        check(r.items.some((i: any) => i.action.includes("plátcovství DPH")),
            "nad 90 % hranice hlásí přechod na plátcovství")
        check(r.needsAttention, "a je to dost vážné na e-mail")
        delete process.env.LEGAL_OTHER_TURNOVER_CZK
    }

    // Živý stav podle dnešního data a reálné databáze — ne aserce, ale to, co by
    // agent poslal, kdyby běžel teď. Užitečné po každé změně termínů.
    console.log("\n6) Co by agent poslal dnes (živá data)")
    {
        const { buildComplianceReport: build, renderComplianceEmail } =
            await import("../lib/agents/compliance-calendar")
        const r = await build()
        console.log(`  needsAttention: ${r.needsAttention}${r.needsAttention ? "" : "  → dnes neposílá nic"}`)
        console.log(`  obrat 12 m: ${r.turnover12m.toLocaleString("cs-CZ")} Kč = ${Math.round(r.thresholdRatio * 100)} % hranice DPH`)
        if (r.items.length === 0) console.log("  (žádné položky)")
        for (const i of r.items) {
            console.log(`  · [${i.urgency}] ${i.action}${i.deadline ? ` — ${i.deadline}` : ""}`)
        }
        if (r.needsAttention) console.log(`  předmět: ${renderComplianceEmail(r).subject}`)
    }

    console.log("\n" + "─".repeat(52))
    console.log(`  Celkem: ${passed + failed} | ✅ ${passed} | ❌ ${failed}`)
    console.log("─".repeat(52) + "\n")
    process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => { console.error("❌", err); process.exit(1) })
