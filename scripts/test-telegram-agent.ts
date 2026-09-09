/**
 * Týmový kanál — invarianty, které se naostro projeví až škodou.
 *   npx tsx scripts/test-telegram-agent.ts
 *
 * Čtyři třídy chyb, na které tenhle kanál umí doplatit:
 *  1. Členství ve skupině se slije s pravomocí → pozvánka do chatu tiše udělí
 *     právo spouštět práci v produkci.
 *  2. Překlep v TELEGRAM_TEAM projde jako platný člen s výchozí rolí.
 *  3. Bot odpoví do cizího chatu (soukromá zpráva komukoli, kdo ho najde).
 *  4. Dlouhá zpráva se rozpadne na kusu, který Telegram odmítne — a brief
 *     nedorazí vůbec, místo aby dorazil na dvakrát.
 *  5. Nejasná odpověď modelu skončí ve skupině jako surový text — nebo obejde
 *     limit ukecanosti tím, že vynechá pole v JSONu.
 */

import {
    canApprove, findMember, isOurChat, isTeamRole, isTelegramConfigured, teamMembers,
} from "../lib/telegram/team"
import { approvalButtons, parseCallbackData } from "../lib/telegram/actions"
import { esc, splitMessage } from "../lib/telegram/client"
import { parseDecision } from "../lib/telegram/decision"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

function eq<T>(name: string, actual: T, expected: T) {
    check(name, actual === expected, `čekáno ${JSON.stringify(expected)}, dostal ${JSON.stringify(actual)}`)
}

/** Env se čte přes cache v team.ts, takže se mezi případy musí přepínat celý. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const backup: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(vars)) {
        backup[k] = process.env[k]
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
    }
    try { fn() } finally {
        for (const [k, v] of Object.entries(backup)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }
    }
}

const TEAM = "111:Thomas:founder,222:Hanz:investor,333:Ludek:manager"

console.log("\n── Složení týmu ──")

withEnv({ TELEGRAM_TEAM: TEAM }, () => {
    eq("tři členi se načtou", teamMembers().length, 3)
    eq("zakladatel se najde podle ID", findMember(111)?.name, "Thomas")
    eq("neznámé ID není člen", findMember(999), null)
    eq("undefined ID nespadne", findMember(undefined), null)
})

// Překlep nesmí projít jako člen — tichý default role by udělil práva.
withEnv({ TELEGRAM_TEAM: "111:Thomas:zakladatel,222:Hanz:investor" }, () => {
    eq("neznámá role se zahodí, zbytek projde", teamMembers().length, 1)
    eq("zůstal ten s platnou rolí", teamMembers()[0]?.name, "Hanz")
})

withEnv({ TELEGRAM_TEAM: "abc:Kdo:founder,222:Hanz:investor" }, () => {
    eq("nečíselné ID se zahodí", teamMembers().length, 1)
})

withEnv({ TELEGRAM_TEAM: "" }, () => {
    eq("prázdný seznam = nikdo", teamMembers().length, 0)
})

check("role se ověřuje proti seznamu", isTeamRole("founder") && !isTeamRole("admin"))

console.log("\n── Pravomoc ≠ členství ──")

withEnv({ TELEGRAM_TEAM: TEAM }, () => {
    check("zakladatel smí schvalovat", canApprove(111))
    check("manažer smí schvalovat", canApprove(333))
    check("INVESTOR NESMÍ schvalovat", !canApprove(222))
    check("cizí ID NESMÍ schvalovat", !canApprove(999))
    check("chybějící ID NESMÍ schvalovat", !canApprove(undefined))
})

// Nejhorší možný stav: prázdná konfigurace nesmí znamenat „všichni smí".
withEnv({ TELEGRAM_TEAM: undefined }, () => {
    check("bez konfigurace nesmí schvalovat NIKDO", !canApprove(111) && !canApprove(999))
})

console.log("\n── Brána chatu ──")

withEnv({ TELEGRAM_CHAT_ID: "-1001234567890" }, () => {
    check("naše skupina projde", isOurChat(-1001234567890))
    check("naše skupina projde i jako řetězec", isOurChat("-1001234567890"))
    check("cizí skupina neprojde", !isOurChat(-100999))
    check("soukromá zpráva neprojde", !isOurChat(111))
    check("chybějící chat neprojde", !isOurChat(undefined))
})

withEnv({ TELEGRAM_CHAT_ID: undefined }, () => {
    // Bez nastaveného chatu nesmí projít NIC — jinak by bot po nasazení
    // odpovídal komukoli, kdo si ho najde ve vyhledávání.
    check("bez TELEGRAM_CHAT_ID neprojde žádný chat", !isOurChat(-1001234567890) && !isOurChat(111))
})

withEnv({ TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "-100" }, () => {
    check("kanál je nakonfigurovaný s tokenem i chatem", isTelegramConfigured())
})
withEnv({ TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: undefined }, () => {
    check("bez chatu kanál nakonfigurovaný není", !isTelegramConfigured())
})

console.log("\n── Tlačítka a jejich zpáteční cesta ──")

const ACTION_ID = "8f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
const buttons = approvalButtons(ACTION_ID)

// 64 BAJTŮ je tvrdý strop Bot API — delší callback_data odmítne už odeslání
// zprávy, takže by se tlačítka nikdy neukázala.
for (const row of buttons) {
    for (const b of row) {
        check(`callback_data '${b.callbackData.slice(0, 12)}…' se vejde do 64 B`,
            Buffer.byteLength(b.callbackData, "utf8") <= 64,
            `${Buffer.byteLength(b.callbackData, "utf8")} B`)
    }
}

eq("schválení se rozparsuje zpět", parseCallbackData(buttons[0][0].callbackData)?.decision, "approve")
eq("zamítnutí se rozparsuje zpět", parseCallbackData(buttons[0][1].callbackData)?.decision, "reject")
eq("id přežije cestu tam i zpět", parseCallbackData(buttons[0][0].callbackData)?.actionId, ACTION_ID)
eq("cizí prefix se nepřijme", parseCallbackData(`x:${ACTION_ID}`), null)
eq("prázdné id se nepřijme", parseCallbackData("a:"), null)
eq("prázdná data se nepřijmou", parseCallbackData(undefined), null)
eq("delší prefix se nepřijme", parseCallbackData(`ap:${ACTION_ID}`), null)

console.log("\n── Escapování a dělení zpráv ──")

eq("ostré závorky se escapují", esc("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;")
eq("ampersand se escapuje", esc("Tom & Jerry"), "Tom &amp; Jerry")
// Telegram uvozovky escapovat NECHCE — &quot; by se v textu ukázal doslova.
eq("uvozovka zůstává", esc('řekl "ahoj"'), 'řekl "ahoj"')

const short = "krátká zpráva"
eq("krátká zpráva se nedělí", splitMessage(short).length, 1)
eq("a zůstane beze změny", splitMessage(short)[0], short)

const long = Array.from({ length: 200 }, (_, i) => `Odstavec číslo ${i} s nějakým textem navíc.`).join("\n\n")
const chunks = splitMessage(long)
check("dlouhá zpráva se rozdělí", chunks.length > 1, `${chunks.length} dílů`)
check("každý díl je pod stropem 4096",
    chunks.every(c => c.length <= 4096),
    `nejdelší ${Math.max(...chunks.map(c => c.length))}`)
check("dělením se nic neztratí",
    chunks.join("").replace(/\s/g, "").length === long.replace(/\s/g, "").length)

// Jediný obří odstavec bez prázdných řádků — dělí se po řádcích.
const wall = Array.from({ length: 500 }, (_, i) => `řádek ${i}`).join("\n")
const wallChunks = splitMessage(wall)
check("zeď textu se taky rozdělí pod strop", wallChunks.every(c => c.length <= 4096))

console.log("\n── Čtení odpovědi modelu ──")

const ok = parseDecision('{"respond":true,"reason":"correction","text":"Platících je 12.","intent":"none","actionId":null}', false)
check("platná odpověď projde", ok.respond && ok.text === "Platících je 12.")
eq("důvod se zachová", ok.reason, "correction")

eq("respond:false = ticho", parseDecision('{"respond":false,"text":"něco"}', true).respond, false)
eq("prázdný text = ticho", parseDecision('{"respond":true,"text":"   "}', true).respond, false)
eq("chybějící text = ticho", parseDecision('{"respond":true}', true).respond, false)
eq("rozbitý JSON = ticho", parseDecision("tohle není JSON", true).respond, false)
eq("prázdná odpověď = ticho", parseDecision("", true).respond, false)

// Laxní čtení by z nejistoty modelu udělalo zprávu do skupiny.
eq('"true" jako řetězec neprojde', parseDecision('{"respond":"true","text":"x"}', true).respond, false)
eq("1 místo true neprojde", parseDecision('{"respond":1,"text":"x"}', true).respond, false)

// Model občas obalí JSON do bloku i přes instrukci — do skupiny nesmí spadnout "```json".
const fenced = parseDecision('```json\n{"respond":true,"reason":"mention","text":"Ahoj."}\n```', true)
check("JSON v ```bloku se rozbalí", fenced.respond && fenced.text === "Ahoj.")
check("a nezůstanou v něm zbytky značek", !fenced.text.includes("`"))

// Chybějící důvod BEZ oslovení musí spadnout pod cooldown, ne ho obejít.
eq("bez důvodu a bez oslovení = correction",
    parseDecision('{"respond":true,"text":"x"}', false).reason, "correction")
eq("bez důvodu ale po oslovení = mention",
    parseDecision('{"respond":true,"text":"x"}', true).reason, "mention")
eq("neznámý důvod bez oslovení = correction",
    parseDecision('{"respond":true,"reason":"protoze","text":"x"}', false).reason, "correction")

// Záměr se čte, ale NEAUTORIZUJE — to dělá canApprove() u volajícího.
const intent = parseDecision('{"respond":true,"reason":"mention","text":"Schvaluji.","intent":"approve","actionId":"8f2c"}', true)
eq("záměr schválit se přečte", intent.intent, "approve")
eq("a nese id akce", intent.actionId, "8f2c")
eq("vymyšlený záměr se zahodí",
    parseDecision('{"respond":true,"text":"x","intent":"smaz_vsechno","actionId":"1"}', true).intent, "none")
eq("prázdné actionId je null",
    parseDecision('{"respond":true,"text":"x","intent":"approve","actionId":"  "}', true).actionId, null)

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} prošlo, ${failed} selhalo\n`)
process.exit(failed === 0 ? 0 : 1)
