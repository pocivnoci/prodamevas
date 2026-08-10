/**
 * Měřič spotřeby + ceník — čisté kontroly (bez DB, bez volání modelu).
 *   npx tsx scripts/test-usage-meter.ts
 *
 * Nejdůležitější test je ten na souběh. Kdyby akumulátor byl modulová proměnná,
 * dvě generace běžící v jedné lambdě si spotřebu sečtou dohromady a účtování
 * jednoho tenanta se zamíchá do druhého — přesně to, co umí `setActiveProject()`
 * a před čím varuje CLAUDE.md. Ostatní testy hlídají, že se cena radši nespočítá,
 * než aby se vymyslela.
 */

import { withUsageMeter, recordUsage, recordUnits, currentUsage, isMetering } from "../instagram/usage-meter"
import { costUsdForCall, costUsdForBreakdown } from "../lib/model-pricing"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const gemUsage = (p: number, o: number, t = 0, c = 0) => ({
    promptTokenCount: p, candidatesTokenCount: o, thoughtsTokenCount: t, cachedContentTokenCount: c,
})

async function main() {
    console.log("\n🧮 MĚŘIČ SPOTŘEBY\n")

    // ---------------------------------------------------------------- scope
    check("mimo scope je recordUsage no-op (nespadne)", (() => {
        try { recordUsage("m", gemUsage(1, 1)); return !isMetering() } catch { return false }
    })())

    const { usage: single } = await withUsageMeter(async () => {
        recordUsage("gemini-pro-latest", gemUsage(1000, 200, 50, 100), "copywriter")
        recordUsage("claude-sonnet-5", gemUsage(500, 100), "judge")
    })
    check("sečte prompt tokeny napříč voláními", single.promptTokens === 1500, `bylo ${single.promptTokens}`)
    check("sečte výstupní tokeny", single.outputTokens === 300, `bylo ${single.outputTokens}`)
    check("sečte thinking tokeny", single.thoughtTokens === 50)
    check("sečte cache tokeny", single.cachedTokens === 100)
    check("totalTokens = prompt + výstup + thinking", single.totalTokens === 1850, `bylo ${single.totalTokens}`)
    check("počítá volání", single.calls === 2)
    check("nese rozpad po krocích", single.breakdown[0].label === "copywriter" && single.breakdown[1].label === "judge")

    // ------------------------------------------------------- chybějící pole
    const { usage: partial } = await withUsageMeter(async () => {
        recordUsage("m", { promptTokenCount: 10 }) // SDK nemusí poslat všechno
    })
    check("chybějící pole je 0, ne NaN", partial.outputTokens === 0 && partial.totalTokens === 10)

    // ---------------------------------------------------------- SOUBĚH (!!)
    // Dvě „generace" prokládané await pointy. Každá smí vidět jen svoje.
    const tick = () => new Promise(r => setTimeout(r, 0))
    const [a, b] = await Promise.all([
        withUsageMeter(async () => {
            recordUsage("m", gemUsage(100, 0), "A1")
            await tick()
            recordUsage("m", gemUsage(100, 0), "A2")
            await tick()
            recordUsage("m", gemUsage(100, 0), "A3")
        }),
        withUsageMeter(async () => {
            await tick()
            recordUsage("m", gemUsage(7, 0), "B1")
            await tick()
            recordUsage("m", gemUsage(7, 0), "B2")
        }),
    ])
    check("souběžné generace se nemíchají (A)", a.usage.promptTokens === 300, `A vidělo ${a.usage.promptTokens}`)
    check("souběžné generace se nemíchají (B)", b.usage.promptTokens === 14, `B vidělo ${b.usage.promptTokens}`)
    check("souběžné generace mají vlastní počet volání", a.usage.calls === 3 && b.usage.calls === 2)

    // ------------------------------------------------------ currentUsage()
    await withUsageMeter(async () => {
        recordUsage("m", gemUsage(5, 5))
        const mid = currentUsage()
        check("currentUsage vidí průběžný stav zevnitř", mid?.totalTokens === 10)
        recordUsage("m", gemUsage(5, 5))
        check("currentUsage roste s dalšími voláními", currentUsage()?.totalTokens === 20)
    })
    check("currentUsage je mimo scope null", currentUsage() === null)

    // ------------------------------------------------------------ jednotky
    const { usage: vid } = await withUsageMeter(async () => {
        recordUnits("veo-3.1-fast-generate-preview", "seconds", 8, "video")
    })
    check("video se měří v jednotkách, ne v tokenech",
        vid.breakdown[0].units?.kind === "seconds" && vid.breakdown[0].units?.n === 8)
    check("video nepřidává falešné tokeny", vid.totalTokens === 0)

    // -------------------------------------------------------------- ceník
    console.log("\n💰 CENÍK\n")

    const claude = costUsdForCall("claude-sonnet-5", { promptTokens: 1_000_000, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 })
    check("známý model: milion vstupních tokenů Sonnetu = $2", claude === 2, `bylo ${claude}`)

    const claudeOut = costUsdForCall("claude-sonnet-5", { promptTokens: 0, outputTokens: 500_000, thoughtTokens: 500_000, cachedTokens: 0 })
    check("thinking tokeny se účtují sazbou výstupu", claudeOut === 10, `bylo ${claudeOut}`)

    const cached = costUsdForCall("claude-sonnet-5", { promptTokens: 1_000_000, outputTokens: 0, thoughtTokens: 0, cachedTokens: 1_000_000 })
    check("cache je levnější než čerstvý vstup", cached !== null && cached < 2, `bylo ${cached}`)

    check("neznámý model nemá cenu 0, ale null",
        costUsdForCall("model-co-neexistuje", { promptTokens: 999_999, outputTokens: 999_999, thoughtTokens: 0, cachedTokens: 0 }) === null)

    const veo = costUsdForCall("veo-3.1-fast-generate-preview", {
        promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, units: { kind: "seconds", n: 10 },
    })
    check("video se ocení za vteřiny (10 s Veo Fast = $1,50)", veo !== null && Math.abs(veo - 1.5) < 1e-9, `bylo ${veo}`)

    check("model bez jednotkové sazby vrací null (Veo Lite)",
        costUsdForCall("veo-3.1-lite-generate-preview", {
            promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, units: { kind: "seconds", n: 10 },
        }) === null)

    // Tohle je to podstatné: raději žádná cena než podhodnocená.
    const mixed = costUsdForBreakdown([
        { model: "claude-sonnet-5", promptTokens: 1000, outputTokens: 100, thoughtTokens: 0, cachedTokens: 0 },
        { model: "gemini-pro-latest", promptTokens: 50_000, outputTokens: 5000, thoughtTokens: 0, cachedTokens: 0 },
    ])
    check("jeden neoceněný krok zneplatní celý součet", mixed === null,
        "částečný součet by tvrdil, že post stál míň, než stál")

    const allKnown = costUsdForBreakdown([
        { model: "claude-sonnet-5", promptTokens: 1_000_000, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 },
        { model: "claude-sonnet-5", promptTokens: 1_000_000, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 },
    ])
    check("samé známé kroky se sečtou", allKnown === 4, `bylo ${allKnown}`)

    console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

void main()
