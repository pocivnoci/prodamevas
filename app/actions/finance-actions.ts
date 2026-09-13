"use server"

/**
 * Finance firmy — ruční evidence nákladů a vkladů.
 *
 * Odpovídá na jednu otázku, kterou dnes nikdo nemá kde přečíst: kolik jsme do
 * firmy dali a kolik nás měsíčně stojí provoz. Zadání znělo „náklady (fixní,
 * variabilní), co kdo platil a kdo kolik dal peněz" — a přesně tolik to dělá.
 *
 * **Není to účetnictví.** Žádné napojení na Fakturoid ani na banku, žádné
 * reporty. Vydané doklady jsou v `invoices`, přijaté platby v `payments`; kdyby
 * se sem tahaly, začne se totéž počítat dvakrát. Tahle tabulka drží jen to, co
 * se z nich nikdy nedozvíme — nájem, předplatné nástroje, vklad zakladatele.
 *
 * Brána je `requireSuperAdmin()` u KAŽDÉ akce, stejně jako v `lead-actions.ts`
 * a `task-actions.ts`. Jsou to peníze firmy; tady se brána zapomenout nesmí.
 */

import supabaseAdmin from "@/supabase/admin"
import { requireSuperAdmin } from "@/lib/auth-guard"
import { revalidatePath } from "next/cache"
// Číselníky a typy bydlí v `lib/finance.ts`: soubor s „use server" smí
// exportovat jenom async funkce (viz aserce 38.0).
import { KINDS, COST_TYPES, EDITABLE, parseAmount, sumEntries, toAmount } from "@/lib/finance"
import type { FinanceEntry, FinancePatch, FinanceTotals } from "@/lib/finance"

export interface FinanceOverview {
    entries: FinanceEntry[]
    totals: FinanceTotals
}

export interface FinanceResult {
    success: boolean
    error?: string
}

/** Kolik řádků obrazovka unese najednou. Evidence dvoučlenné firmy, ne kniha. */
const LIMIT = 500

// ─── Čtení ───────────────────────────────────────────────────

/**
 * Záznamy odshora podle toho, KDY se staly — ne kdy se zapsaly. Nájem za srpen
 * doplněný v září patří k srpnu, jinak by se evidence četla jako pořadí, ve
 * kterém si na co kdo vzpomněl.
 */
export async function getFinanceOverview(): Promise<FinanceOverview> {
    await requireSuperAdmin()

    const { data, error } = await supabaseAdmin
        .from("finance_entries")
        .select("*")
        .order("happened_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(LIMIT)

    if (error) {
        // Prázdná evidence a rozbitý dotaz vypadají na obrazovce stejně. U peněz
        // je ta záměna nejhorší možná, proto výjimka místo tichého `[]`.
        console.error("🚨 finance: načtení selhalo:", error.message)
        throw new Error(`Evidenci se nepodařilo načíst: ${error.message}`)
    }

    const entries = (data ?? []).map(r => ({ ...r, amount_czk: toAmount(r.amount_czk) })) as FinanceEntry[]
    return { entries, totals: sumEntries(entries) }
}

// ─── Zápis ───────────────────────────────────────────────────

export interface NewFinanceEntry {
    kind: string
    costType?: string | null
    /** Tak, jak to člověk napsal — „1 200", „1200,50". Převod je na serveru. */
    amount: string
    label: string
    person: string
    happenedOn?: string | null
    note?: string | null
}

/**
 * Nový záznam.
 *
 * Validuje se tady, ne jen v prohlížeči: server action je veřejný endpoint
 * a databázový constraint by sice zápis zastavil, ale hláškou, ze které člověk
 * nepozná, co má opravit.
 */
export async function createFinanceEntry(input: NewFinanceEntry): Promise<FinanceResult> {
    const { email } = await requireSuperAdmin()

    const kind = (input.kind || "").trim()
    if (!(KINDS as readonly string[]).includes(kind)) return { success: false, error: "Vyber náklad, nebo vklad." }

    // Fixní/variabilní má smysl jen u nákladu — u vkladu musí zůstat prázdné,
    // jinak by šel vyrobit „fixní vklad" a součet nákladů by ho započítal.
    const costType = kind === "naklad" ? (input.costType || "").trim() : null
    if (kind === "naklad" && !(COST_TYPES as readonly string[]).includes(costType || "")) {
        return { success: false, error: "U nákladu vyber, jestli je fixní, nebo variabilní." }
    }

    const amount = parseAmount(input.amount || "")
    if (amount === null) return { success: false, error: "Částka musí být kladné číslo v korunách." }

    const label = (input.label || "").trim()
    if (!label) return { success: false, error: "Napiš, čeho se záznam týká." }

    const person = (input.person || "").trim()
    if (!person) return { success: false, error: "Doplň, kdo platil (nebo kdo peníze dal)." }

    const { error } = await supabaseAdmin.from("finance_entries").insert({
        kind,
        cost_type: costType,
        amount_czk: amount,
        label,
        person,
        // Datum sloupce `date` se posílá jako `YYYY-MM-DD` beze změny. Převod
        // přes `new Date()` by záznam posunul o den zpátky každému východně
        // od Greenwiche — a my sedíme v Saigonu.
        happened_on: (input.happenedOn || "").trim() || new Date().toISOString().slice(0, 10),
        note: (input.note || "").trim() || null,
        created_by: email,
        updated_by: email,
    })

    if (error) {
        console.error("🚨 finance: zápis selhal:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true }
}

/**
 * Oprava řádku. Jede přes whitelist `EDITABLE` — razítka ani `created_by` do
 * formuláře nepatří, i kdyby je tam někdo poslal. `kind` mezi nimi schválně
 * není: přehození nákladu na vklad musí zároveň vynulovat `cost_type`, jinak
 * to neprojde constraintem. Špatný druh se opraví smazáním a novým řádkem.
 */
export async function updateFinanceEntry(id: string, patch: FinancePatch): Promise<FinanceResult> {
    const { email } = await requireSuperAdmin()
    if (!id) return { success: false, error: "Chybí identifikátor záznamu." }

    const clean: Record<string, string | number | null> = {}
    for (const key of EDITABLE) {
        if (!(key in patch)) continue
        const raw = patch[key]

        if (key === "amount_czk") {
            const amount = parseAmount(String(raw ?? ""))
            if (amount === null) return { success: false, error: "Částka musí být kladné číslo v korunách." }
            clean.amount_czk = amount
            continue
        }
        if (key === "cost_type") {
            const value = String(raw ?? "").trim()
            if (!(COST_TYPES as readonly string[]).includes(value)) {
                return { success: false, error: "Náklad je buď fixní, nebo variabilní." }
            }
            clean.cost_type = value
            continue
        }
        if (key === "label" || key === "person") {
            const value = String(raw ?? "").trim()
            if (!value) return { success: false, error: "Popis ani osoba nesmí zůstat prázdné." }
            clean[key] = value
            continue
        }
        if (key === "happened_on") {
            const value = String(raw ?? "").trim()
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { success: false, error: "Datum musí být ve tvaru RRRR-MM-DD." }
            clean.happened_on = value
            continue
        }
        clean[key] = String(raw ?? "").trim() || null
    }

    if (Object.keys(clean).length === 0) return { success: false, error: "Není co uložit." }

    // `cost_type` se smí měnit jen u nákladu — u vkladu by ho constraint odmítl
    // a člověk by dostal hlášku z databáze místo vysvětlení.
    if ("cost_type" in clean) {
        const { data: row } = await supabaseAdmin
            .from("finance_entries").select("kind").eq("id", id).maybeSingle()
        if (row && row.kind !== "naklad") return { success: false, error: "Vklad fixní ani variabilní není." }
    }

    const { error } = await supabaseAdmin
        .from("finance_entries")
        .update({ ...clean, updated_at: new Date().toISOString(), updated_by: email })
        .eq("id", id)

    if (error) {
        console.error("🚨 finance: oprava selhala:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true }
}

/**
 * Smazání řádku.
 *
 * U peněz je mazání normálně špatná odpověď — tady je to ale ruční evidence
 * bez návazností: překlep se opravuje, ne archivuje, a `finance_entries` na nic
 * dalšího neodkazuje. Doklady a platby zákazníků se tímhle nedotkneme; ty žijí
 * v `invoices` a `payments`, kam tahle akce nesahá.
 */
export async function deleteFinanceEntry(id: string): Promise<FinanceResult> {
    await requireSuperAdmin()
    if (!id) return { success: false, error: "Chybí identifikátor záznamu." }

    const { error } = await supabaseAdmin.from("finance_entries").delete().eq("id", id)
    if (error) {
        console.error("🚨 finance: smazání selhalo:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true }
}
