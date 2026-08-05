/**
 * Daňový a účetní kalendář — „termíny si nemusíš pamatovat".
 * =========================================================
 * Denní běh v daily-ops. Projde zákonné termíny a sledovaný obrat a **posílá
 * e-mail jen tehdy, když je něco na spadnutí**. Tichý den nepošle nic.
 *
 * Proč tak: seznam povinností v dokumentaci je k ničemu, pokud se na něj musí
 * někdo sám vzpomenout. Tenhle agent obrací směr — nečeká, že si termín
 * vybavíš, ozve se sám a řekne rovnou jednu konkrétní akci s datem.
 *
 * Zásady, které dělají rozdíl mezi upozorněním a šumem:
 *  - **Jedna položka = jedna akce.** Žádné „zkontroluj situaci".
 *  - **Předstih, ne den D.** Na měsíční přiznání se ozve pět dní dopředu, ať
 *    zbývá čas účetní napsat.
 *  - **Ticho, když není co řešit.** Agent, který píše každý den, se přestane číst.
 *
 * Obrat pro hranici DPH se sčítá **za osobu, ne za činnost** — proto se
 * k fakturám Chrlitu přičítá `LEGAL_OTHER_TURNOVER_CZK` (květinářství). Bez ní
 * je součet nepravdivý a hlásí se to jako vlastní problém.
 */

import supabaseAdmin from "@/supabase/admin"
import { LEGAL, legalIdentityGaps, type VatStatus } from "@/lib/legal"

/** Hranice obratu pro povinné plátcovství DPH (Kč / 12 měsíců). */
export const VAT_REGISTRATION_THRESHOLD_CZK = 2_000_000

export type Urgency = "info" | "soon" | "now"

export interface ComplianceItem {
    urgency: Urgency
    /** Co se má stát — v rozkazovacím způsobu, jedna akce. */
    action: string
    /** Do kdy, česky ("do 25. 8."). Prázdné u položek bez termínu. */
    deadline: string
    /** Proč, jednou větou. */
    why: string
    /** Komu se to podává / kdo to řeší. */
    who?: string
}

export interface ComplianceReport {
    items: ComplianceItem[]
    /** Obrat za posledních 12 měsíců, Kč. */
    turnover12m: number
    /** Podíl na hranici 2 mil. (0–1+). */
    thresholdRatio: number
    /** true, když se má vůbec posílat e-mail. */
    needsAttention: boolean
    checkedAt: string
}

const MONTHS_CS = [
    "ledna", "února", "března", "dubna", "května", "června",
    "července", "srpna", "září", "října", "listopadu", "prosince",
]

function fmtDate(d: Date): string {
    return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`
}

function daysUntil(target: Date, now: Date): number {
    const a = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
    const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    return Math.round((a - b) / 86_400_000)
}

function urgencyFor(days: number): Urgency {
    if (days <= 3) return "now"
    if (days <= 10) return "soon"
    return "info"
}

/**
 * Roční termíny. Data jsou pro OSVČ s datovou schránkou (elektronické podání
 * povinné). `verify` označuje ta, která se mají potvrdit u účetní — zákon je
 * posouvá na nejbližší pracovní den a lhůty se novelami mění.
 */
interface AnnualDeadline {
    month: number // 1–12
    day: number
    leadDays: number
    action: string
    why: string
    who: string
}

const ANNUAL_DEADLINES: AnnualDeadline[] = [
    {
        month: 1, day: 10, leadDays: 14,
        action: "Rozhodnout s účetní, jestli letos vstoupit do paušálního režimu daně",
        why: "Přihlásit se lze jen do 10. ledna. Po tom datu je rozhodnutí odložené o celý rok.",
        who: "Finanční úřad",
    },
    {
        month: 1, day: 31, leadDays: 21,
        action: "Přenastavit trvalé příkazy na nové minimální zálohy",
        why: "Sociální a zdravotní zálohy se mění každý leden. Stará výše znamená nedoplatek.",
        who: "ČSSZ + zdravotní pojišťovna",
    },
    {
        month: 5, day: 2, leadDays: 30,
        action: "Podat daňové přiznání za předchozí rok",
        why: "Elektronicky, povinně kvůli datové schránce. Sčítá se Chrlit i květinářství — je to jedno IČO.",
        who: "Finanční úřad",
    },
    {
        month: 6, day: 2, leadDays: 21,
        action: "Podat Přehled o příjmech a výdajích",
        why: "Do měsíce po daňovém přiznání. Podává se dvakrát — zvlášť ČSSZ a zvlášť pojišťovně.",
        who: "ČSSZ + zdravotní pojišťovna",
    },
]

/**
 * Měsíční přiznání k DPH — jen pro identifikovanou osobu a plátce.
 *
 * `vatStatus` je parametr, ne čtení z `LEGAL` uvnitř: `lib/legal.ts` snímá env
 * při importu, takže bez parametru by tohle pravidlo nešlo otestovat pro oba
 * režimy v jednom procesu (a test by tiše kontroloval pořád tentýž stav).
 */
export function monthlyVatItem(now: Date, vatStatus: VatStatus = LEGAL.vatStatus): ComplianceItem | null {
    if (vatStatus === "none") return null

    // Termín je 25. den měsíce následujícího po zdaňovacím období.
    let due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 25))
    if (daysUntil(due, now) < 0) {
        due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 25))
    }
    const days = daysUntil(due, now)
    if (days > 5) return null // pět dní předstih — dost času napsat účetní, ne dost na zapomenutí

    const period = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() - 1, 1))
    const periodName = `${MONTHS_CS[period.getUTCMonth()]} ${period.getUTCFullYear()}`

    return {
        urgency: urgencyFor(days),
        action: `Poslat účetní podklady k DPH za ${periodName}`,
        deadline: `do ${fmtDate(due)}`,
        why: vatStatus === "identified"
            ? "Jako identifikovaná osoba podáváš přiznání za měsíce, kdy jsi nakoupila službu ze zahraničí — Stripe, Google, Vercel, Supabase, Anthropic, reklama."
            : "Jako plátce DPH se přiznání podává za každé období.",
        who: "Finanční úřad",
    }
}

/** Roční termíny v okně předstihu. */
function annualItems(now: Date): ComplianceItem[] {
    const out: ComplianceItem[] = []
    for (const d of ANNUAL_DEADLINES) {
        // Letošní výskyt; když už je za námi, řeší se ten příští rok.
        let due = new Date(Date.UTC(now.getUTCFullYear(), d.month - 1, d.day))
        if (daysUntil(due, now) < 0) {
            due = new Date(Date.UTC(now.getUTCFullYear() + 1, d.month - 1, d.day))
        }
        const days = daysUntil(due, now)
        if (days > d.leadDays) continue
        out.push({
            urgency: urgencyFor(days),
            action: d.action,
            deadline: `do ${fmtDate(due)}`,
            why: d.why,
            who: d.who,
        })
    }
    return out
}

/**
 * Obrat za 12 měsíců z reálných dokladů + obrat ostatních činností z env.
 * Hranice DPH se počítá za osobu, takže bez druhé části je číslo nepravdivé.
 */
async function turnoverItems(now: Date): Promise<{ items: ComplianceItem[]; turnover: number; ratio: number }> {
    const items: ComplianceItem[] = []
    const since = new Date(now.getTime() - 365 * 86_400_000).toISOString()

    let chrlitCzk = 0
    try {
        const { data, error } = await supabaseAdmin
            .from("invoices")
            .select("total_czk")
            .eq("status", "issued")
            .gte("created_at", since)
        if (error) throw new Error(error.message)
        // total_czk je v HALÉŘÍCH — stejná jednotka jako payments.amount.
        chrlitCzk = (data || []).reduce((sum, r) => sum + (r.total_czk || 0), 0) / 100
    } catch (err) {
        items.push({
            urgency: "soon",
            action: "Zkontrolovat sledování obratu — čtení dokladů selhalo",
            deadline: "",
            why: `Bez něj nikdo nehlídá hranici 2 mil. Kč pro DPH. Chyba: ${(err as Error)?.message?.slice(0, 120)}`,
            who: "vývoj",
        })
    }

    const otherRaw = Number(process.env.LEGAL_OTHER_TURNOVER_CZK || 0)
    const otherCzk = Number.isFinite(otherRaw) && otherRaw > 0 ? otherRaw : 0
    const turnover = chrlitCzk + otherCzk
    const ratio = turnover / VAT_REGISTRATION_THRESHOLD_CZK

    // Bez obratu ostatních činností je součet neúplný. Hlásí se to jen když už
    // Chrlit sám něco vydělal — do té doby by to byl planý poplach.
    if (!otherCzk && chrlitCzk > 0) {
        items.push({
            urgency: "info",
            action: "Doplnit roční obrat květinářství do LEGAL_OTHER_TURNOVER_CZK",
            deadline: "",
            why: `Hranice 2 mil. Kč se počítá za osobu, ne za činnost. Teď se hlídá jen ${Math.round(chrlitCzk).toLocaleString("cs-CZ")} Kč z Chrlitu, takže skutečná rezerva je menší.`,
            who: "vývoj / účetní",
        })
    }

    if (LEGAL.vatStatus !== "payer") {
        const pct = Math.round(ratio * 100)
        if (ratio >= 0.9) {
            items.push({
                urgency: "now",
                action: "Připravit s účetní přechod na plátcovství DPH",
                deadline: "",
                why: `Obrat za 12 měsíců je na ${pct} % hranice 2 mil. Kč. Nad hranicí vzniká plátcovství povinně — ceny se pak uvádějí bez DPH.`,
                who: "Finanční úřad",
            })
        } else if (ratio >= 0.7) {
            items.push({
                urgency: "soon",
                action: "Naplánovat s účetní přechod na plátcovství DPH",
                deadline: "",
                why: `Obrat za 12 měsíců je na ${pct} % hranice. Přechod se dá připravit v klidu, pokud se nezmešká.`,
                who: "Finanční úřad",
            })
        }
    }

    return { items, turnover, ratio }
}

/** Doklady, které se nepodařilo vystavit = zákazník bez daňového dokladu. */
async function failedInvoiceItem(): Promise<ComplianceItem | null> {
    try {
        const { count, error } = await supabaseAdmin
            .from("invoices")
            .select("id", { count: "exact", head: true })
            .eq("status", "failed")
        if (error) throw new Error(error.message)
        if (!count) return null
        return {
            urgency: "now",
            action: `Dořešit ${count}× nevystavený daňový doklad`,
            deadline: "",
            why: "Zákazník zaplatil, ale doklad nemá. Detail je v tabulce invoices ve sloupci error.",
            who: "vývoj",
        }
    } catch {
        return null // sledování dokladů řeší health-check, tady to nemá padat
    }
}

/** Chybějící identifikační údaje. Nízká priorita, ale nesmí zmizet z radaru. */
function identityItem(): ComplianceItem | null {
    const gaps = legalIdentityGaps()
    if (gaps.length === 0) return null
    return {
        urgency: "info",
        action: `Doplnit chybějící údaje: ${gaps.join(", ")}`,
        deadline: "",
        why: "Patří na daňový doklad i do obchodních podmínek. Ověřuje to `npx tsx scripts/check-legal-identity.ts`.",
        who: "vývoj",
    }
}

export async function buildComplianceReport(now: Date = new Date()): Promise<ComplianceReport> {
    const items: ComplianceItem[] = []

    const vat = monthlyVatItem(now)
    if (vat) items.push(vat)
    items.push(...annualItems(now))

    const { items: turnoverIssues, turnover, ratio } = await turnoverItems(now)
    items.push(...turnoverIssues)

    const failed = await failedInvoiceItem()
    if (failed) items.push(failed)

    const identity = identityItem()
    if (identity) items.push(identity)

    const rank: Record<Urgency, number> = { now: 0, soon: 1, info: 2 }
    items.sort((a, b) => rank[a.urgency] - rank[b.urgency])

    // „info" samo o sobě e-mail nespustí — jinak by chybějící číslo účtu
    // generovalo poštu každý den, dokud ho někdo nedoplní, a agent by se
    // přestal číst. Do e-mailu se info položky přibalí, až ho vyvolá něco vážnějšího.
    const needsAttention = items.some(i => i.urgency === "now" || i.urgency === "soon")

    return {
        items,
        turnover12m: Math.round(turnover),
        thresholdRatio: ratio,
        needsAttention,
        checkedAt: now.toISOString(),
    }
}

const URGENCY_LABEL: Record<Urgency, { icon: string; text: string; color: string }> = {
    now: { icon: "🔴", text: "Teď", color: "#c0392b" },
    soon: { icon: "🟡", text: "Brzy", color: "#b7791f" },
    info: { icon: "⚪", text: "Až bude čas", color: "#777" },
}

export function renderComplianceEmail(report: ComplianceReport): { subject: string; html: string; text: string } {
    const urgent = report.items.filter(i => i.urgency === "now").length
    const subject = urgent > 0
        ? `🔴 Daně a úřady: ${urgent}× urgentní`
        : `🟡 Daně a úřady: ${report.items.filter(i => i.urgency === "soon").length}× se blíží termín`

    const rows = report.items.map(i => {
        const u = URGENCY_LABEL[i.urgency]
        return `<tr>
      <td style="padding:12px 10px;border-bottom:1px solid #eee;vertical-align:top;white-space:nowrap">
        <span style="color:${u.color};font-weight:700;font-size:12px">${u.icon} ${u.text}</span>
      </td>
      <td style="padding:12px 10px;border-bottom:1px solid #eee;vertical-align:top">
        <div style="font-weight:700;color:#111">${i.action}</div>
        ${i.deadline ? `<div style="color:${u.color};font-weight:700;font-size:13px;margin-top:2px">${i.deadline}</div>` : ""}
        <div style="color:#666;font-size:13px;margin-top:4px">${i.why}</div>
        ${i.who ? `<div style="color:#999;font-size:12px;margin-top:4px">Řeší: ${i.who}</div>` : ""}
      </td>
    </tr>`
    }).join("")

    const pct = Math.round(report.thresholdRatio * 100)
    const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 6px">Daně a úřady</h1>
      <p style="color:#666;font-size:14px;margin:0 0 20px">
        Každá položka je jedna akce. Co je označené „Teď", má termín do tří dnů.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
      <p style="color:#666;font-size:13px;margin:20px 0 0;padding-top:14px;border-top:1px solid #eee">
        Obrat za 12 měsíců: <strong>${report.turnover12m.toLocaleString("cs-CZ")} Kč</strong>
        — ${pct} % hranice 2 mil. Kč pro DPH.
      </p>
      <p style="color:#999;font-size:12px;margin:14px 0 0">
        Postup ke každé položce je v docs/LEGAL_SETUP.md. Není to daňové poradenství — lhůty potvrď u účetní.
      </p>
    </div>`

    const text = report.items
        .map(i => `${URGENCY_LABEL[i.urgency].text.toUpperCase()}: ${i.action}${i.deadline ? ` (${i.deadline})` : ""}\n  ${i.why}`)
        .join("\n\n")
        + `\n\nObrat 12 m: ${report.turnover12m.toLocaleString("cs-CZ")} Kč (${pct} % hranice DPH)`

    return { subject, html, text }
}
