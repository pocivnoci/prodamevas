/**
 * Dohojení zaseklých plateb — „zákazník zaplatil a nikdo se to nedozvěděl".
 * ========================================================================
 * Callback od brány je jediné spolehlivé potvrzení platby, ale doručit se
 * nemusí: spadlý deploy, timeout, síť. Řádek pak zůstane navždy v `PENDING` —
 * peníze odešly, plán se neaktivoval a **nikde o tom není ani řádek**. To je
 * jediný stav, ve kterém jsme vzali peníze a nedodali produkt.
 *
 * Reconciler se brány doptá sám. Běží dvěma způsoby a oba jsou potřeba:
 *  - **cíleně** — po založení každé platby se do fronty přidá úkol na +20 minut
 *    (`enqueueTask`, ne `requestAction`: mechanické doptání není rozhodnutí,
 *    které by patřilo do auditu akcí),
 *  - **plošně** — denní sweep z daily-ops jako záchytná síť pro úkoly, o které
 *    přišel redeploy.
 *
 * Nikdy neaktivuje plán sám: všechno jde přes `applyGatewayStatus`, aby claim
 * i aktivace zůstaly na jednom místě a souběh s callbackem byl neškodný —
 * podmíněný UPDATE vrátí řádek jen jednomu z nich.
 */

import supabaseAdmin from "@/supabase/admin"
import { applyGatewayStatus, type GatewayStatus } from "@/lib/payments/on-paid"
import type { ComgateStatusResponse } from "@/lib/comgate"

/** Po téhle době se PENDING řádek přestane doptávat — brána už ho dávno zahodila. */
const ZOMBIE_AFTER_DAYS = 14
/** Mladší platby se nedoptávají: zákazník může být pořád na platební bráně. */
const DEFAULT_MIN_AGE_MINUTES = 20
const DEFAULT_LIMIT = 50

export interface ReconcileOpts {
    limit?: number
    minAgeMinutes?: number
    /**
     * Injekce dotazu na bránu. Bez ní by se reconciler nedal ověřit bez sítě —
     * a tedy ani dostat do `npm run guard`.
     */
    probe?: (transId: string) => Promise<ComgateStatusResponse>
}

export interface ReconcileResult {
    checked: number
    resolved: Array<{ paymentId: string; from: string; to: string }>
    /** Brána odpověděla chybou → nic se nemění, zkusí se zítra. */
    unknown: number
    /** Beznadějně staré PENDING řádky — jen se počítají, nemutují. */
    zombies: number
    skipped?: string
}

const empty = (): ReconcileResult => ({ checked: 0, resolved: [], unknown: 0, zombies: 0 })

interface PendingRow {
    id: string
    comgate_trans_id: string | null
    status: string
    created_at: string
}

/**
 * Mock režim se nedoptává: `getConfig()` v comgate.ts hází výjimku na chybějících
 * env proměnných a shodil by celý sweep. Mock transId navíc u brány neexistuje.
 */
function unprobeable(row: PendingRow, mock: boolean): boolean {
    return mock || !row.comgate_trans_id || row.comgate_trans_id.startsWith("MOCK-")
}

async function resolveOne(
    row: PendingRow,
    probe: (transId: string) => Promise<ComgateStatusResponse>,
    out: ReconcileResult,
): Promise<void> {
    const ageDays = (Date.now() - new Date(row.created_at).getTime()) / 86_400_000
    if (ageDays > ZOMBIE_AFTER_DAYS) {
        out.zombies++
        return
    }

    out.checked++
    let verified: ComgateStatusResponse
    try {
        verified = await probe(row.comgate_trans_id!)
    } catch (err: any) {
        console.warn(`payment-reconcile: dotaz na bránu selhal (${row.id}): ${err?.message}`)
        out.unknown++
        return
    }

    // Brána neví → nemutovat. Domýšlet si stav platby je horší než počkat.
    if (verified.code !== 0 || !verified.status) {
        out.unknown++
        return
    }
    if (verified.status === row.status) return

    const result = await applyGatewayStatus({
        locator: { provider: "comgate", transId: row.comgate_trans_id! },
        status: verified.status as GatewayStatus,
        method: verified.method,
        raw: verified,
        // Ostrá platba — mock se sem nikdy nedostane (viz unprobeable).
        sandbox: false,
        // Token se ukládá jen u první platby a jen z callbacku; reconciler
        // dohojuje stav, nezakládá sérii obnov.
        recurringToken: null,
        source: "reconcile",
    })

    if (result.claimed) {
        out.resolved.push({ paymentId: row.id, from: row.status, to: verified.status })
        console.log(`🩹 payment-reconcile: platba ${row.id} ${row.status} → ${verified.status}`)
    }
}

async function run(rows: PendingRow[], opts?: ReconcileOpts): Promise<ReconcileResult> {
    const { isMockPaymentMode, getPaymentStatus } = await import("@/lib/comgate")
    const mock = isMockPaymentMode()
    const probe = opts?.probe || getPaymentStatus

    const out = empty()
    for (const row of rows) {
        if (unprobeable(row, mock)) continue
        try {
            await resolveOne(row, probe, out)
        } catch (err: any) {
            // Jedna rozbitá platba nesmí zabít celý sweep.
            console.warn(`payment-reconcile: ${row.id} spadla: ${err?.message}`)
            out.unknown++
        }
    }
    return out
}

/** Cílené doptání na jednu platbu — plánuje se ~20 min po jejím založení. */
export async function reconcilePayment(paymentId: string, opts?: ReconcileOpts): Promise<ReconcileResult> {
    const { data } = await supabaseAdmin
        .from("payments")
        .select("id, comgate_trans_id, status, created_at")
        .eq("id", paymentId)
        .eq("provider", "comgate")
        .maybeSingle()

    // Už doběhlo (callback dorazil dřív) → není co dohojovat.
    if (!data || data.status !== "PENDING") return { ...empty(), skipped: "není PENDING" }
    return run([data as PendingRow], opts)
}

/** Denní sweep přes všechny visící PENDING platby — záchytná síť. */
export async function reconcilePendingPayments(opts?: ReconcileOpts): Promise<ReconcileResult> {
    const minAge = opts?.minAgeMinutes ?? DEFAULT_MIN_AGE_MINUTES
    const { data } = await supabaseAdmin
        .from("payments")
        .select("id, comgate_trans_id, status, created_at")
        .eq("provider", "comgate")
        .eq("status", "PENDING")
        .lt("created_at", new Date(Date.now() - minAge * 60_000).toISOString())
        .order("created_at", { ascending: true })
        .limit(opts?.limit ?? DEFAULT_LIMIT)

    return run((data || []) as PendingRow[], opts)
}
