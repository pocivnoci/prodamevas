/**
 * Agent podpory — statické aserce (bez DB, bez sítě).
 *   npx tsx scripts/test-support-kb.ts
 *
 * Hlídá tři věci, které by se daly pokazit tiše:
 *
 *  1. **Báze nesmí lhát o ceně.** Složený text musí nést aktuální čísla
 *     z ceníku. Nápověda tu jednou měla ceny natvrdo a přežily přecenění na
 *     v6; u podpory je to horší, protože to říká „firma“ nahlas.
 *  2. **Jedna kopie odpovědí.** `FaqTab` nesmí mít vlastní `FAQ_CATEGORIES` —
 *     jinak se obrazovka a agent rozejdou.
 *  3. **Brána je brána.** Nárok drží tarif A skutečná platba, rozhoduje o něm
 *     server, a klíč k ElevenLabs se nesmí dostat do prohlížeče.
 */

import fs from "fs"
import { buildSupportKnowledgeBase } from "../lib/support/kb"
import { FAQ_CATEGORIES } from "../lib/support/faq"
import { canUseSupportAgent } from "../lib/subscription"
import { FALLBACK_PLANS, EXTRA_CREDIT_HALERU, formatCzk } from "../lib/pricing"
import { MEDIA_CREDITS, ALL_MEDIA } from "../lib/credits"
import type { SubscriptionInfo, PlanFeatures } from "../lib/subscription"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const read = (p: string) => fs.readFileSync(p, "utf-8")

/** Zdroj bez komentářů — pro NEGATIVNÍ aserce. Komentář, který vysvětluje, proč
 *  se něco nesmí importovat, jinak matchne právě ten vzor, před kterým varuje
 *  (týž důvod jako `codeOnly()` v test-beta-e2e.ts). */
const codeOnly = (p: string) =>
    read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/** Předplatné s právě tolika údaji, kolik brána čte. */
function sub(over: Omit<Partial<SubscriptionInfo>, "features"> & { features?: Partial<PlanFeatures> } = {}): SubscriptionInfo {
    // `features` se NEslévá s výchozím: test potřebuje vyjádřit i „pole tam vůbec
    // není" (starší tarify), a spread by do něj výchozí `true` vždycky vrátil.
    const features = (over.features === undefined ? { support_agent: true } : over.features) as PlanFeatures
    return {
        planId: "chrlit_dominance",
        planName: "Dominance",
        status: "active",
        isTrial: false,
        provider: "comgate",
        ...over,
        features,
    } as SubscriptionInfo
}

function main() {
    console.log("\n🎧 AGENT PODPORY\n")

    // ────────────────────────────────────────────── znalostní báze
    const kb = buildSupportKnowledgeBase({ builtAt: new Date("2026-09-13") })

    for (const p of FALLBACK_PLANS) {
        check(`báze nese cenu tarifu ${p.name} (${formatCzk(p.monthlyHaleru)})`,
            kb.includes(formatCzk(p.monthlyHaleru)))
        check(`báze nese kredity tarifu ${p.name} (${p.creditsPerMonth})`,
            kb.includes(`| ${p.creditsPerMonth} kreditů |`))
    }

    check(`báze nese cenu extra kreditu (${formatCzk(EXTRA_CREDIT_HALERU)})`,
        kb.includes(formatCzk(EXTRA_CREDIT_HALERU)))

    for (const m of ALL_MEDIA) {
        check(`báze nese váhu média ${m} (${MEDIA_CREDITS[m]})`,
            new RegExp(`\\|\\s*${MEDIA_CREDITS[m]}\\s*\\|`).test(kb))
    }

    check("báze obsahuje všechny otázky z nápovědy", (() => {
        const total = FAQ_CATEGORIES.reduce((n, c) => n + c.items.length, 0)
        return FAQ_CATEGORIES.every(c => c.items.every(i => kb.includes(i.q))) && total > 20
    })())

    // Placeholder v ústech podpory je horší než mlčení — `legalSection()` proto
    // sekci při nedoplněné identitě vynechá celou.
    check("báze neobsahuje nedoplněný údaj („DOPLNIT“)", !kb.includes("DOPLNIT"))

    // Instrukce patří do promptu agenta; v bázi by z nich byla vyhledatelná
    // fakta, která jde odcitovat i obejít.
    check("báze neobsahuje instrukce pro agenta", !/^Nikdy |^Vždy /m.test(kb))

    // ─────────────────────────────────── báze nesmí vynést naše vnitřnosti
    // 13. 9. 2026 byly v bázi `docs/INSTAGRAM_SETUP_GUIDE.md` a `POSTING_GUIDE.md`
    // — vybrané podle názvu. Obsahem jsou to interní dokumenty: jména tajemství,
    // `openssl rand`, nastavení Vercelu, stav App Review u Mety a věta „most je
    // neověřený, nezapínej ho platícímu zákazníkovi". Agent by to odcitoval
    // klientovi. Tahle aserce je důvod, proč se to nemůže vrátit omylem.
    const FORBIDDEN = [
        "META_APP_ID", "META_APP_SECRET", "IG_TOKEN_ENCRYPTION_KEY", "CRON_SECRET",
        "openssl", ".env.local", "process.env", "npx tsx", "Vercel",
        "App Review", "Business Verification", "upload-post", "uploadpost",
        "supabase/migrations", "dogfood", "docs/",
    ]
    // Postavená TAK, jak ji staví skript: s blogem z disku, ne jen jádro z kódu.
    const blog = fs.existsSync("content/blog")
        ? fs.readdirSync("content/blog").filter(n => n.endsWith(".md")).sort()
            .map(n => ({ title: `Článek: ${n}`, markdown: fs.readFileSync(`content/blog/${n}`, "utf-8") }))
        : []
    const shipped = buildSupportKnowledgeBase({ guides: blog, builtAt: new Date("2026-09-13") })
    for (const marker of FORBIDDEN) {
        check(`báze neobsahuje „${marker}"`, !shipped.includes(marker))
    }
    check("synchronizační skript nebere nic z docs/",
        !/["'`]docs\//.test(codeOnly("scripts/sync-support-kb.ts")))

    // ────────────────────────────────────────────── jedna kopie odpovědí
    const faqTab = read("app/(dashboard)/dashboard/instagram/tabs/FaqTab.tsx")
    check("FaqTab čte odpovědi z lib/support/faq", faqTab.includes('from "@/lib/support/faq"'))
    check("FaqTab nemá vlastní kopii FAQ_CATEGORIES", !/(const|let)\s+FAQ_CATEGORIES/.test(faqTab))

    const faqSrc = codeOnly("lib/support/faq.ts")
    const kbSrc = codeOnly("lib/support/kb.ts")
    for (const [label, src] of [["faq.ts", faqSrc], ["kb.ts", kbSrc]] as const) {
        check(`${label} zůstává client-safe (bez instagram/, supabase/, process.env)`,
            !/from "(@\/)?(instagram|supabase)\//.test(src) && !src.includes("process.env"))
    }

    // ────────────────────────────────────────────── brána
    check("nárok má Dominance i Impérium (support_agent v tarifu)",
        canUseSupportAgent(sub()) && canUseSupportAgent(sub({ planId: "chrlit_imperium" })))
    check("tarif bez pole nárok nemá",
        !canUseSupportAgent(sub({ features: { support_agent: false } })) &&
        !canUseSupportAgent(sub({ features: {} })))
    check("trial nárok nemá", !canUseSupportAgent(sub({ isTrial: true })))
    check("tarif zdarma od správce nárok nemá", !canUseSupportAgent(sub({ provider: "gift" })))
    check("expirované a nezaplacené předplatné nárok nemá",
        !canUseSupportAgent(sub({ status: "expired" })) && !canUseSupportAgent(sub({ status: "pending" })))
    check("bez předplatného nárok není", !canUseSupportAgent(null))
    // Komu selhala karta, ten podporu potřebuje nejvíc — zavřít mu ji je způsob,
    // jak z dočasného problému udělat odchod.
    check("dunning ani výpověď ke konci období nárok neberou",
        canUseSupportAgent(sub({ billingFailures: 2 })) &&
        canUseSupportAgent(sub({ cancelAtPeriodEnd: true })) &&
        canUseSupportAgent(sub({ status: "cancelled" })))

    const action = read("app/actions/support-actions.ts")
    check("server action překládá slug přes requireProjectAccess", action.includes("requireProjectAccess("))
    check("server action rozhoduje o nároku přes canUseSupportAgent", action.includes("canUseSupportAgent("))
    check("podepsanou URL razí server (xi-api-key jen tam)", action.includes("xi-api-key"))

    const widget = read("components/support/SupportAgent.tsx")
    check("widget nezná klíč ani nerazí podpis sám",
        !widget.includes("xi-api-key") && !widget.includes("ELEVENLABS_API_KEY") && !widget.includes("get-signed-url"))
    check("widget bere nárok ze serveru, ne z kontextu v prohlížeči",
        widget.includes("canProjectUseSupportAgent("))

    // ────────────────────────────────────────────── migrace tarifů
    const mig = read("supabase/migrations/20260913_podpora_agentem.sql")
    check("migrace zapíná agenta právě na Dominance a Impérium", (() => {
        const on = mig.slice(mig.indexOf("'true'::jsonb"), mig.indexOf("'false'::jsonb"))
        return on.includes("chrlit_dominance") && on.includes("chrlit_imperium")
            && !on.includes("chrlit_start") && !on.includes("chrlit_rust") && !on.includes("trial_v2")
    })())
    check("migrace vypíná agenta u nižších tarifů i trialu", (() => {
        const off = mig.slice(mig.indexOf("'false'::jsonb"))
        return off.includes("chrlit_start") && off.includes("chrlit_rust") && off.includes("trial_v2")
    })())
    // `human_support` je slib ČLOVĚKA a má ho jen Impérium. Kdyby na něm jel
    // agent, Dominance by se začala prodávat s lidskou podporou.
    check("migrace nesahá na human_support", !mig.includes("{human_support}"))

    console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} prošlo, ${failed} spadlo\n`)
    if (failed > 0) process.exit(1)
}

main()
