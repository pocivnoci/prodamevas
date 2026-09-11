/**
 * Aserce nad kontrolou doručení v denním health checku (`lib/agents/health-check.ts`).
 *   npx tsx scripts/test-doruceni.ts
 *
 * Statické, bez databáze. Kontrola doručení je jediná, která se dívá na to, co
 * zákazník DOSTAL, ne jestli stroj běží. Bez ní se health check hlásil čistý,
 * zatímco platící klienti měli desítky hotových příspěvků po termínu. Hlídá se:
 *
 *  1. kontrola existuje a běží přes `safe()` (rozbitý dotaz nesmí shodit brief),
 *  2. počítá jen platící (`active`) a mimo výlohu,
 *  3. dotaz na `ig_posts` filtruje `client_id`,
 *  4. žádný dotaz na klienta v cyklu.
 */

import fs from "fs"

let failed = 0
function check(name: string, ok: boolean, hint?: string) {
    if (ok) console.log(`  ✓ ${name}`)
    else { failed++; console.log(`  ✗ ${name}${hint ? `\n      ${hint}` : ""}`) }
}

const health = fs.readFileSync("lib/agents/health-check.ts", "utf-8")
const start = health.indexOf(`safe("doručení platícím"`)
const block = start < 0 ? "" : health.slice(start, health.indexOf("\n        }),", start))

console.log("\nDoručení — health check se dívá i na to, co zákazník dostal\n")

check(
    "kontrola doručení existuje a běží přes safe()",
    block.length > 0,
    "Bez ní health check hlásí „v pořádku“, i když obsah leží nedoručený.",
)
check(
    "počítá jen předplatné ve stavu active",
    /from\("subscriptions"\)[\s\S]{0,120}\.eq\("status", "active"\)/.test(block),
    "Trial je zkouška, ne slib — poplach u něj by naučil kontrolu ignorovat.",
)
check(
    "výloha se nepočítá",
    /\.or\(NOT_SHOWCASE\)/.test(block),
    "Portfolio značky vlastníme my; `neq.true` je past na NULL, proto NOT_SHOWCASE.",
)
check(
    "jen aktivní klienti",
    /\.eq\("is_active", true\)/.test(block),
)
check(
    "dotaz na příspěvky filtruje client_id",
    /from\("ig_posts"\)[\s\S]{0,120}\.in\("client_id"/.test(block),
)
check(
    "hledá hotové příspěvky po termínu",
    /\.eq\("status", "ready"\)/.test(block) && /\.lt\("scheduled_for"/.test(block),
)
check(
    "žádný dotaz v cyklu",
    !/for \([\s\S]{0,400}await supabaseAdmin/.test(block),
    "Dotaz na klienta v cyklu roste s počtem klientů; health check má běžet vteřiny.",
)
check(
    "tolerance jsou 2 dny",
    /const OVERDUE_DAYS = 2\b/.test(health),
    "Den ujede běžně; kratší tolerance dělá z kontroly šum.",
)

console.log(failed ? `\n✗ ${failed} aserce selhala\n` : "\n✓ vše drží\n")
if (failed) process.exit(1)
