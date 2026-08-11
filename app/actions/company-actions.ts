"use server"

import { requireSuperAdmin } from "@/lib/auth-guard"

/**
 * Přehled firmy — cross-tenant pohled na zdraví zákaznických účtů.
 *
 * Doteď neexistovalo místo, kde by šlo vidět všechny klienty najednou:
 * `admin-actions.ts` je navzdory jménu per-projekt a týdenní report dává jen
 * agregáty. Tenhle tab je zároveň jediný rozumný způsob, jak ladit ranní brief —
 * e-mail se odkrokovat nedá, tabulka ano.
 *
 * **Read-only záměrně.** Akce patří do briefu, kde mají schvalovací tlačítka
 * a auditní stopu. Kdyby šly dělat i odsud, vzniknou dvě cesty k témuž
 * rozhodnutí a jen jedna z nich bude zalogovaná.
 */

export interface ClientHealthDTO {
    clientId: string
    name: string
    slug: string
    plan: string | null
    status: string | null
    periodEnd: string | null
    billingFailures: number
    cancelAtPeriodEnd: boolean
    lastContentAt: string | null
    postsLast14d: number
    igConnected: boolean
    creditsRemaining: number
    creditsTotal: number
    risks: string[]
    risksLabel: string
}

export interface CompanyOverview {
    clients: ClientHealthDTO[]
    /** Kolik účtů má aspoň jedno riziko — číslo, které má smysl sledovat. */
    atRisk: number
    /** Registrace, které nikdy nedojely do studia. */
    stalledOnboardings: number
    generatedAt: string
}

export async function getCompanyOverview(): Promise<CompanyOverview> {
    await requireSuperAdmin()

    const { buildClientHealth, describeRisks, countStalledOnboardings } = await import("@/lib/agents/client-health")
    const [rows, stalled] = await Promise.all([
        buildClientHealth(),
        countStalledOnboardings(),
    ])

    const clients: ClientHealthDTO[] = rows.map(r => ({
        clientId: r.clientId,
        name: r.name,
        slug: r.slug,
        plan: r.plan,
        status: r.status,
        periodEnd: r.periodEnd,
        billingFailures: r.billingFailures,
        cancelAtPeriodEnd: r.cancelAtPeriodEnd,
        lastContentAt: r.lastContentAt,
        postsLast14d: r.postsLast14d,
        igConnected: r.igConnected,
        creditsRemaining: r.creditsRemaining,
        creditsTotal: r.creditsTotal,
        risks: r.risks,
        risksLabel: describeRisks(r.risks),
    }))

    return {
        clients,
        atRisk: clients.filter(c => c.risks.length > 0).length,
        stalledOnboardings: stalled.count,
        generatedAt: new Date().toISOString(),
    }
}
