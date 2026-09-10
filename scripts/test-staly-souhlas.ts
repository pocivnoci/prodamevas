/**
 * Aserce nad stálým souhlasem (`lib/agent-policy.ts`).
 *   npx tsx scripts/test-staly-souhlas.ts
 *
 * Statické, bez databáze a bez `.env.local` — čte se skutečný kód, ne chování.
 * Hlídá se přesně to, co by se při další úpravě dalo pokazit tiše:
 *
 *  1. `outbound` NESMÍ skončit v `AUTO_TIERS`. Stálý souhlas je rozhodnutí
 *     člověka uložené dopředu, ne přeřazení rizika. Kdyby někdo „zjednodušil"
 *     bránu přesunem tieru, odejdou e-maily i těm, kdo souhlas nikdy nedali.
 *  2. Souhlas se čte PŘED založením návrhu, ne po něm.
 *  3. Denní strop existuje a při chybě počítání se chová jako plný.
 *  4. Klíč se nikdy neodvozuje z `taskType` — jeden handler obsluhuje šest
 *     druhů e-mailu a souhlas s jedním není souhlas se všemi.
 *  5. Schválení akce běží PŘED udělením souhlasu (obojí v routě i v akci).
 *  6. Zrušení souhlasu maže razítko při novém udělení (jinak by „ano" po
 *     „ne" nefungovalo).
 */

import fs from "fs"

let failed = 0
function check(name: string, ok: boolean, hint?: string) {
    if (ok) {
        console.log(`  ✓ ${name}`)
    } else {
        failed++
        console.log(`  ✗ ${name}${hint ? `\n      ${hint}` : ""}`)
    }
}

const read = (p: string) => fs.readFileSync(p, "utf-8")

const policy = read("lib/agent-policy.ts")
const safety = read("lib/agent-safety.ts")
const route = read("app/api/agent-approval/route.ts")
const actions = read("app/actions/approval-actions.ts")
const lifecycle = read("lib/agents/lifecycle.ts")
const link = read("lib/agent-approval-link.ts")
const brief = read("lib/agents/daily-brief.ts")
const migration = read("supabase/migrations/20260910_staly_souhlas.sql")

console.log("\nStálý souhlas — hranice, které se nesmí posunout\n")

// ── 1. Hranice rizika ───────────────────────────────────────────────────────
const autoTiers = safety.match(/const AUTO_TIERS[^\n]*\n?[^\n]*/)?.[0] ?? ""
check(
    "`outbound` zůstává mimo AUTO_TIERS",
    !/outbound/.test(autoTiers),
    "Stálý souhlas nesmí být záminka k přeřazení tieru — bez souhlasu se musí pořád ptát.",
)
check(
    "`spending` a `irreversible` zůstávají mimo AUTO_TIERS",
    !/spending|irreversible/.test(autoTiers),
)

// ── 2. Pořadí: souhlas se čte před založením návrhu ────────────────────────
const gate = safety.slice(safety.indexOf("if (needsApproval(req.riskTier))"))
const posSouhlas = gate.indexOf("canRunUnattended")
const posNavrh = gate.indexOf('insertAction(req, "proposed"')
check(
    "souhlas se čte dřív, než se založí návrh",
    posSouhlas > -1 && posNavrh > -1 && posSouhlas < posNavrh,
    "Opačné pořadí by u každé akce nechalo v tabulce mrtvý `proposed` řádek.",
)
check(
    "akce ze souhlasu se dispatchuje s `actor` ve tvaru policy:<key>",
    /insertAction\(req, "approved", `\$\{POLICY_ACTOR_PREFIX\}/.test(safety),
    "Podle `actor` se počítá denní strop i sekce briefu — bez něj obojí oslepne.",
)

// ── 3. Denní strop ──────────────────────────────────────────────────────────
check("souhlas má denní strop", /daily_cap/.test(policy) && /daily_cap/.test(migration))
check(
    "strop je v migraci vynucený (> 0)",
    /check \(daily_cap > 0\)/.test(migration),
)
check(
    "nespočítaný strop se chová jako plný",
    /MAX_SAFE_INTEGER/.test(policy),
    "Při výpadku počítadla se musí ptát, ne posílat neomezeně.",
)
check(
    "vyčerpaný strop akci navrhne, nezahodí ji",
    /cap-reached/.test(policy) && /cap-reached/.test(safety),
)
check(
    "chyba čtení souhlasu znamená zavřeno",
    /if \(error\)[\s\S]{0,220}return \{ allowed: false/.test(policy),
    "Výpadek databáze se u brány řeší zavřeno, ne tichým `allowed: true`.",
)

// ── 4. Klíč se neodvozuje ───────────────────────────────────────────────────
check(
    "policyKey je nepovinný (chybějící = ptát se)",
    /policyKey\?: string/.test(safety),
)
check(
    "klíč se neodvozuje z taskType",
    !/policyKey[^\n]*(\?\?|\|\|)[^\n]*taskType/.test(safety),
    "Odvozený klíč by novému agentovi podstrčil cizí souhlas jen za to, že sáhl po stejném handleru.",
)
check(
    "lifecycle posílá klíč per druh, ne per handler",
    /policyKey: `lifecycle:\$\{cand\.kind\}`/.test(lifecycle),
)
check(
    "chybějící klíč se do auditu zapíše jako NULL",
    /policy_key: req\.policyKey \?\? null/.test(safety),
)

// ── 5. Schválení před udělením souhlasu ────────────────────────────────────
const routePost = route.slice(route.indexOf("export async function POST"))
check(
    "routa: approveAction běží před grantPolicy",
    routePost.indexOf("approveAction(") < routePost.indexOf("grantPolicy("),
    "Obráceně by proklik na dávno rozhodnutou akci trvale zapnul rozesílku.",
)
const alwaysAction = actions.slice(actions.indexOf("approveAgentActionAlways"))
check(
    "dashboard: approveAction běží před grantPolicy",
    alwaysAction.indexOf("approveAction(") < alwaysAction.indexOf("grantPolicy("),
)
check(
    "souhlas navždy se nenabídne u akce bez druhu",
    /approve_always" && !action\.policy_key/.test(route),
)
check(
    "`approve_always` je vlastní podepsané rozhodnutí",
    /"approve" \| "reject" \| "approve_always"/.test(link)
    && /d !== "approve_always"/.test(link),
    "Kdyby to byl jen příznak u `approve`, šel by odkaz na jednorázové schválení recyklovat na trvalé.",
)

// ── 6. Obnovení po zrušení ──────────────────────────────────────────────────
check(
    "nové udělení maže razítko zrušení",
    /grantPolicy[\s\S]{0,700}revoked_at: null/.test(policy),
    "Jinak by `canRunUnattended` četlo `revoked` i u čerstvého ano.",
)
check(
    "zrušení se razítkuje, nemaže se řádek",
    /revokePolicy[\s\S]{0,400}revoked_at: new Date/.test(policy)
    && !/revokePolicy[\s\S]{0,400}\.delete\(\)/.test(policy),
)
check(
    "zrušení je podmíněný claim na nezrušený řádek",
    /revokePolicy[\s\S]{0,500}\.is\("revoked_at", null\)/.test(policy),
)

// ── 7. Vidět, co systém dělá sám ────────────────────────────────────────────
check(
    "brief hlásí, co odešlo díky souhlasu, zvlášť",
    /POLICY_ACTOR_PREFIX/.test(brief) && /stálý souhlas/.test(brief),
    "Zapnutá rozesílka, o které se nedozvím v jediném e-mailu, který čtu, je slepé místo.",
)
check(
    "dashboard umí souhlas vypsat i zrušit",
    /getAgentPolicies/.test(actions) && /revokeAgentPolicy/.test(actions),
    "Cesta ven musí být stejně krátká jako cesta dovnitř.",
)
check(
    "obě obrazovky jsou za super-adminem",
    /getAgentPolicies[\s\S]{0,200}requireSuperAdmin/.test(actions)
    && /revokeAgentPolicy[\s\S]{0,200}requireSuperAdmin/.test(actions),
)

console.log(failed === 0 ? "\n✅ Stálý souhlas: všechny aserce prošly\n" : `\n❌ Stálý souhlas: ${failed} aserce selhalo\n`)
process.exitCode = failed === 0 ? 0 : 1
