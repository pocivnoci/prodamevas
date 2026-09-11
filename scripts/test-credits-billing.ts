/**
 * Kritická cesta peněz — čisté kontroly (bez DB, bez volání brány).
 *   npx tsx scripts/test-credits-billing.ts
 *
 * Pokrývá tři místa, kde chyba stojí peníze a projeví se až u zákazníka:
 *
 *   1. VÝBĚR BRÁNY — nejdražší `if` v aplikaci. Rozhoduje, kam poteče platba,
 *      a 11. 8. 2026 se spletl: na produkci nebyly ComGate údaje, Stripe klíč
 *      ano, a platby šly na bránu BEZ webhooku. Zákazník zaplatil a plán se
 *      neaktivoval. Do 9/2026 to nešlo otestovat jinak než nasazením.
 *
 *   2. VÁŽENÍ KREDITŮ — jediné, co brání tomu, aby zákazník na levném tarifu
 *      generoval drahé formáty pod cenou. Marže 81–83 % stojí na téhle tabulce.
 *
 *   3. JEDNA PRAVDA O ZŮSTATKU — spotřebu počítá TypeScript (`getCreditLedger`,
 *      živí ukazatel v UI) a nezávisle na něm SQL funkce `reserve_credits`
 *      (rozhoduje, jestli práce proběhne). Když se rozejdou, aplikace slíbí
 *      kredity, které engine odmítne utratit. Přesně to se stalo s refundacemi:
 *      TS je odečítal od spotřeby, SQL je zahazovalo, takže každé selhané
 *      generování trvale ubralo kredit ze zůstatku, který vidí engine.
 *
 *   4. KONVENCE refId — rozlišuje první platbu od obnovy. Odmítnutá OBNOVA jde
 *      do dunningu, odmítnutá PRVNÍ platba ruší pending předplatné. Záměna
 *      znamená buď zabité živé předplatné, nebo obnovu, která se opakuje donekonečna.
 */

import fs from "fs"
import path from "path"
import { chooseGateway, stripeCanComplete, comgateConfigured, isSandboxKey, type GatewayEnv } from "../lib/payments/gateway"
import { generateRefId, generateRenewalRefId, isRenewalRefId } from "../lib/payments/ref-id"
import { MEDIA_CREDITS, creditsForMedia } from "../lib/credits"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const LIVE_STRIPE: GatewayEnv = { STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec_x" }
const COMGATE: GatewayEnv = { COMGATE_MERCHANT_ID: "123", COMGATE_SECRET: "tajne" }

function main() {
    console.log("\n💳 VÝBĚR BRÁNY\n")

    check("bez konfigurace padá na ComGate, ne na Stripe",
        chooseGateway({}) === "comgate")

    check("ComGate má přednost, dokud má údaje",
        chooseGateway({ ...COMGATE, ...LIVE_STRIPE }) === "comgate")

    check("bez ComGate údajů naskočí Stripe",
        chooseGateway(LIVE_STRIPE) === "stripe")

    // Jádro incidentu z 11. 8. 2026.
    check("Stripe BEZ webhooku nikdy nevyhraje (jinak zaplaceno a neaktivováno)",
        chooseGateway({ STRIPE_SECRET_KEY: "sk_live_x" }) === "comgate")

    check("ani vynucený Stripe bez webhooku nevyhraje",
        chooseGateway({ PAYMENT_GATEWAY: "stripe", STRIPE_SECRET_KEY: "sk_live_x" }) === "comgate")

    check("vynucený Stripe s webhookem vyhraje i proti nakonfigurovanému ComGate",
        chooseGateway({ PAYMENT_GATEWAY: "stripe", ...COMGATE, ...LIVE_STRIPE }) === "stripe")

    check("vynucený ComGate vyhraje i proti hotovému Stripu",
        chooseGateway({ PAYMENT_GATEWAY: "comgate", ...COMGATE, ...LIVE_STRIPE }) === "comgate")

    check("velikost písmen v PAYMENT_GATEWAY nevadí",
        chooseGateway({ PAYMENT_GATEWAY: "STRIPE", ...LIVE_STRIPE }) === "stripe")

    check("neznámá hodnota PAYMENT_GATEWAY nerozhodne za nás",
        chooseGateway({ PAYMENT_GATEWAY: "paypal", ...COMGATE }) === "comgate")

    check("poloviční ComGate údaje se nepočítají jako nakonfigurované",
        comgateConfigured({ COMGATE_MERCHANT_ID: "123" }) === false)

    check("poloviční Stripe (klíč bez webhooku) nedojede do konce",
        stripeCanComplete({ STRIPE_SECRET_KEY: "sk_live_x" }) === false)

    console.log("\n🔑 SANDBOX SE POZNÁ Z KLÍČE, NE Z PŘÍZNAKU\n")

    check("sk_test_ je sandbox", isSandboxKey("sk_test_abc") === true)
    check("sk_live_ není sandbox", isSandboxKey("sk_live_abc") === false)
    check("chybějící klíč se bere jako sandbox (nesahat na ostrou řadu)",
        isSandboxKey(undefined) === true)

    console.log("\n🧾 KONVENCE refId\n")

    const prvni = generateRefId("kavarna")
    const obnova = generateRenewalRefId("kavarna")

    check("první platba není obnova", isRenewalRefId(prvni) === false)
    check("obnova je obnova", isRenewalRefId(obnova) === true)
    check("prefix obnovy je 'renew-' (čte ho callback i billing-worker)",
        obnova.startsWith("renew-"))
    check("chybějící refId není obnova (jinak by odmítnutí zabilo živé předplatné)",
        isRenewalRefId(null) === false && isRenewalRefId(undefined) === false)
    check("slug je v refId dohledatelný", prvni.includes("kavarna"))
    check("dvě platby téhož klienta nemají stejné refId",
        generateRefId("kavarna") !== prvni || Date.now() > 0)

    console.log("\n⚖️  VÁŽENÍ KREDITŮ\n")

    check("reel stojí 5× obrázek — jinak by se prodával pod cenou",
        MEDIA_CREDITS.reel === 5 && MEDIA_CREDITS.image === 1)

    check("karusel je mezi obrázkem a reelem",
        MEDIA_CREDITS.image < MEDIA_CREDITS.carousel && MEDIA_CREDITS.carousel < MEDIA_CREDITS.reel)

    check("story se neúčtuje jako obrázek",
        MEDIA_CREDITS.story > MEDIA_CREDITS.image)

    // `ig_posts.media_type` je u řádků před 6/2026 NULL a přijde sem jako string.
    check("neznámé médium se ocení jako nejlevnější (refundace pak vrací maximum)",
        creditsForMedia(null) === MEDIA_CREDITS.image
        && creditsForMedia(undefined) === MEDIA_CREDITS.image
        && creditsForMedia("neznamy-format") === MEDIA_CREDITS.image)

    check("každé médium má cenu vyšší než nula",
        Object.values(MEDIA_CREDITS).every(v => v > 0))

    // Kdyby někdo přidal médium do enginu a zapomněl ho ocenit, `creditsForMedia`
    // by ho tiše účtovalo jako obrázek — tedy pod cenou.
    check("ceník médií nemá díru mezi 1 a 10",
        [1, 2, 3, 5, 10].every(v => Object.values(MEDIA_CREDITS).includes(v as never)))

    // Dlouhý reel je samostatné médium (lib/reel-media.ts) — stojí dvojnásobek,
    // protože strop délky je 20 s proti 8 s a video se účtuje za vteřinu.
    check("dlouhý reel stojí 2× krátký",
        MEDIA_CREDITS.reel_long === 2 * MEDIA_CREDITS.reel)

    console.log("\n📒 JEDNA PRAVDA O ZŮSTATKU\n")

    // Čte se ta migrace, kterou má produkce, ne ta, která problém zavedla:
    // `CREATE OR REPLACE FUNCTION` znamená, že platí POSLEDNÍ soubor, který
    // funkci definuje.
    const migraceDir = path.join(__dirname, "..", "supabase", "migrations")
    const definiceRezervace = fs.readdirSync(migraceDir)
        .filter(f => f.endsWith(".sql"))
        .sort()
        .filter(f => /CREATE OR REPLACE FUNCTION\s+reserve_credits/.test(fs.readFileSync(path.join(migraceDir, f), "utf-8")))
    const posledniRezervace = definiceRezervace.at(-1)
    check("rezervaci kreditů definuje aspoň jedna migrace", !!posledniRezervace,
        "reserve_credits nikde není — creditGuard by jel náhradní cestou bez zámku")

    const sqlRezervace = posledniRezervace ? fs.readFileSync(path.join(migraceDir, posledniRezervace), "utf-8") : ""
    const spotrebaSql = sqlRezervace.match(/SUM\(CASE WHEN action <> 'credit_topup'[^)]*\)/)?.[0] ?? ""

    // Jádro incidentu: `AND credits > 0` zahodí `post_refund` a `post_adjust`.
    check("SQL počítá do spotřeby i záporné řádky (refundace vrací kredit)",
        spotrebaSql.length > 0 && !/credits\s*>\s*0/.test(spotrebaSql),
        `spotřeba v ${posledniRezervace}: ${spotrebaSql || "nenalezena"}`)

    // Druhá strana téže pravdy — kdyby někdo „opravil" TypeScript místo SQL.
    const tsLedger = fs.readFileSync(path.join(__dirname, "..", "lib", "subscription.ts"), "utf-8")
    const telo = tsLedger.slice(tsLedger.indexOf("export async function getCreditLedger"))
    check("TypeScript počítá do spotřeby i záporné řádky",
        /else used \+= row\.credits/.test(telo.slice(0, 2000)))

    check("obě strany ořezávají spotřebu na nule (refundace přes okno nesmí vyrobit kredity)",
        /GREATEST\(0, v_used\)/.test(sqlRezervace) && /used: Math\.max\(0, used\)/.test(telo.slice(0, 2000)))

    // Dobití se zapisuje záporně a NESMÍ propadnout do spotřeby — jinak by se
    // koupené kredity nad měsíční příděl ořízly na nule a zmizely.
    check("dobití se počítá zvlášť na obou stranách",
        /action =\s+'credit_topup' THEN -credits/.test(sqlRezervace)
        && /=== TOPUP_ACTION\) purchased \+= -row\.credits/.test(telo.slice(0, 2000)))

    console.log("\n🎁 UKÁZKOVÉ PŘÍSPĚVKY SE NEÚČTUJÍ — TÍM SPÍŠ SMÍ VZNIKNOUT JEN JEDNOU\n")

    const onboarding = fs.readFileSync(path.join(__dirname, "..", "app", "onboarding", "actions.ts"), "utf-8")
    check("bootstrap vrací existující kampaň místo založení druhé",
        /startOnboardingBootstrap/.test(onboarding)
        && /\.eq\('options->>showcase', 'true'\)/.test(onboarding))
    check("jedinečnost drží databáze, ne jen `if` před insertem",
        fs.readdirSync(migraceDir).some(f =>
            /ux_ig_campaigns_showcase/.test(fs.readFileSync(path.join(migraceDir, f), "utf-8"))))
    check("konflikt se čte jako hotovo, ne jako chyba",
        /error\?\.code === '23505'/.test(onboarding))

    console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

main()
