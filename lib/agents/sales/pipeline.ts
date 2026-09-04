/**
 * Obchodní pipeline — od leadu k odeslané zprávě
 * ==============================================
 * Každý krok je vlastní úloha ve frontě `agent_tasks`, kterou drénuje existující
 * cron `agent-worker` (běží každou minutu, umí lease, retry i backoff). Žádný nový
 * cron; `scheduled_for` zároveň rozprostírá odesílání a drží denní strop.
 *
 *   lead_qualify   → doplní kontakt z webu, obodujе, rozhodne
 *   lead_preview   → vygeneruje ukázku (drahé, ~18 Kč) — jen pro kvalifikované
 *   lead_outreach  → složí zprávu, nechá ji projít soudcem, odešle
 *
 * **Kvalitu drží soudce, ne člověk.** Schvalovat jednotlivé zprávy by znamenalo
 * desítky rozhodnutí denně; systém, který stojí na tom, že si na něj někdo
 * vzpomene, se zastaví. Zakladatel dostává souhrn ke ČTENÍ.
 */

import supabaseAdmin from "@/supabase/admin"
import crypto from "crypto"
import { enqueueTask } from "@/lib/agent-runner"
import { scrapeBrandBasics } from "./brand-scrape"
import { qualifyLead, type LeadSignals } from "./qualify"
import { composeMessage, judgeRubric } from "./templates"
import { generatePreview } from "./preview"

/** Kolik zpráv smí odejít za den. Doručitelnost, ne rozpočet. */
export const DAILY_SEND_CAP = Number(process.env.OUTREACH_DAILY_CAP) || 30

/** Odesílá se jen z vyhrazené domény — transakční pošta se toho nesmí dotknout. */
export function outreachFrom(): string | null {
    return process.env.OUTREACH_FROM_EMAIL || null
}

interface LeadRow {
    id: string
    company: string | null
    ig_handle: string | null
    website: string | null
    email: string | null
    followers: number | null
    last_post_at: string | null
    preview_token: string | null
}

async function logEvent(leadId: string, kind: string, detail: Record<string, unknown> = {}) {
    try {
        await supabaseAdmin.from("lead_events").insert({ lead_id: leadId, kind, detail })
    } catch (err: any) {
        console.warn(`⚠️ lead_events zápis selhal: ${err?.message}`)
    }
}

function signalsOf(l: LeadRow): LeadSignals {
    return {
        company: l.company, igHandle: l.ig_handle, website: l.website, email: l.email,
        followers: l.followers, lastPostAt: l.last_post_at ? new Date(l.last_post_at) : null,
    }
}

/**
 * KROK 1 — kvalifikace.
 * Když lead nemá kontakt, zkusí se vytáhnout z webu. To je ta část, která
 * v první verzi chyběla a kvůli které trychtýř našel firmy, na které se nedá
 * napsat: Instagram kontakty spolehlivě nevydává, web ano.
 */
export async function runQualify(leadId: string) {
    const { data: lead } = await supabaseAdmin
        .from("leads").select("*").eq("id", leadId).single<LeadRow>()
    if (!lead) return { ok: false, reason: "lead neexistuje" }

    let email = lead.email
    if (!email && lead.website) {
        const brand = await scrapeBrandBasics(lead.website)
        email = brand?.emails[0] ?? null
        if (email) await supabaseAdmin.from("leads").update({ email }).eq("id", leadId)
    }

    const q = qualifyLead(signalsOf({ ...lead, email }))
    // Chyba zápisu se MUSÍ ozvat. Bez téhle kontroly hlásila kvalifikace úspěch,
    // přestože update spadl na neexistujícím sloupci — lead zůstal na score 0
    // a status "new", a nikdo se to nedozvěděl. Tiché selhání zápisu je horší
    // než hlasitý pád: fronta by se plnila leady, které nikam nepostoupí.
    const { error: upErr } = await supabaseAdmin.from("leads").update({
        score: q.score, score_reasons: q.reasons,
        status: q.qualified ? "qualified" : "rejected",
        reject_reason: q.rejectReason ?? null,
        segment: q.segment,
        updated_at: new Date().toISOString(),
    }).eq("id", leadId)
    if (upErr) throw new Error(`zápis kvalifikace selhal: ${upErr.message}`)

    await logEvent(leadId, q.qualified ? "qualified" : "rejected",
        { score: q.score, segment: q.segment, reasons: q.reasons, reject: q.rejectReason })

    // Ukázka je drahá — zařadí se až pro kvalifikované, a jen nad prahem skóre.
    //
    // Stojí 18 Kč a vzniká PŘED oslovením, tedy dřív, než kdokoli projeví zájem.
    // Náklad tím škáluje s objemem oslovení, ne s konverzí: při tisíci oslovených
    // a pětiprocentní míře odpovědí se zaplatí dvacetkrát víc ukázek, než kolik
    // jich někdo otevře.
    //
    // Předgenerování se přesto nezrušilo — má dobrý důvod. Generovat až po
    // kliknutí znamená minuty čekání na prázdné stránce a návštěvník odejde.
    // Práh je kompromis mezi obojím: nejlepší leady dostanou ukázku hotovou,
    // u slabších se peníze neutratí předem.
    //
    // ⚠️ Práh neškrtá jen náklad, ale i OSLOVENÍ: `runOutreach` lead bez
    // `preview_token` přeskočí, takže komu se ukázka nevygeneruje, tomu se ani
    // nepíše. Je to vědomý kompromis — oslovit míň leadů, ale s hotovou
    // ukázkou — ne tichý vedlejší účinek.
    //
    // `SALES_PREVIEW_MIN_SCORE` se ladí bez deploye. Nula = předgenerovat všem
    // kvalifikovaným (chování do 9/2026).
    const prah = Number(process.env.SALES_PREVIEW_MIN_SCORE) || 0
    if (q.qualified && q.score >= prah) {
        await enqueueTask({ type: "lead_preview", payload: { leadId } })
    } else if (q.qualified) {
        console.log(`💤 Lead ${leadId}: skóre ${q.score} pod prahem ${prah} — ukázka se předem negeneruje.`)
    }
    return { ok: true, qualified: q.qualified, score: q.score, segment: q.segment }
}

/**
 * KROK 2 — ukázka.
 * Předgeneruje se, aby stránka po kliknutí naskočila hned; čekat pět minut na
 * render znamená, že návštěvník odejde.
 */
export async function runPreview(leadId: string) {
    const { data: lead } = await supabaseAdmin
        .from("leads").select("*").eq("id", leadId).single<LeadRow>()
    if (!lead) return { ok: false, reason: "lead neexistuje" }
    if (!lead.website) return { ok: false, reason: "bez webu nejde ukázku vyrobit" }

    const token = lead.preview_token ?? crypto.randomBytes(12).toString("base64url")
    const result = await generatePreview({
        website: lead.website, igHandle: lead.ig_handle ?? undefined, count: 3, token,
    })

    const { error: pvErr } = await supabaseAdmin.from("leads").update({
        preview_token: token,
        preview_posts: result.posts,
        preview_ready_at: new Date().toISOString(),
        company: lead.company ?? result.config.name,
        updated_at: new Date().toISOString(),
    }).eq("id", leadId)
    // Ukázka se vygenerovala (18 Kč) — když se neuloží, jsou to vyhozené peníze
    // a odkaz v mailu povede na 404. Musí to spadnout, ne projít.
    if (pvErr) throw new Error(`zápis ukázky selhal: ${pvErr.message}`)

    await enqueueTask({ type: "lead_outreach", payload: { leadId } })
    return { ok: true, posts: result.posts.length, costCzk: result.costCzk }
}

/** Kolik zpráv už dnes odešlo — strop se drží podle skutečnosti, ne podle plánu. */
async function sentToday(): Promise<number> {
    const since = new Date(); since.setHours(0, 0, 0, 0)
    const { count } = await supabaseAdmin
        .from("lead_events").select("id", { count: "exact", head: true })
        .eq("kind", "sent").gte("created_at", since.toISOString())
    return count ?? 0
}

/**
 * KROK 3 — oslovení.
 * Před odesláním projde zpráva soudcem z jiné modelové rodiny (`instagram/judge.ts`,
 * Claude). Co neprojde, NEODEJDE a čeká s důvodem.
 */
export async function runOutreach(leadId: string) {
    const { isOutreachConfigured, outreachSetupHint } = await import("./transport")
    if (!isOutreachConfigured()) return { ok: false, reason: outreachSetupHint() }

    const { data: lead } = await supabaseAdmin
        .from("leads").select("*").eq("id", leadId).single<LeadRow>()
    if (!lead?.email || !lead.preview_token) return { ok: false, reason: "chybí kontakt nebo ukázka" }

    // Odhlášení se kontroluje PŘED KAŽDÝM odesláním, ne jen při zápisu.
    const { data: optout } = await supabaseAdmin
        .from("email_optouts").select("email").eq("email", lead.email.toLowerCase()).maybeSingle()
    if (optout) {
        await logEvent(leadId, "blocked", { reason: "opt-out" })
        await supabaseAdmin.from("leads").update({ status: "rejected", reject_reason: "optout" }).eq("id", leadId)
        return { ok: false, reason: "adresa je odhlášená" }
    }

    if (await sentToday() >= DAILY_SEND_CAP) {
        // Nezahazuje se — odloží se na zítra. Strop je o doručitelnosti, ne o tom,
        // že by lead přestal být zajímavý.
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(8, 0, 0, 0)
        await enqueueTask({ type: "lead_outreach", payload: { leadId }, scheduledFor: tomorrow })
        return { ok: true, deferred: true, reason: "denní strop vyčerpán" }
    }

    const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://chrlit.cz"
    const msg = composeMessage(signalsOf(lead), `${base}/ukazka/${lead.preview_token}`)

    // ── Brána: soudce místo klikání ────────────────────────────────────────────
    const { judgeText } = await import("@/instagram/judge")
    let verdict: { pass: boolean; score?: number; problems?: string[] } = { pass: true }
    try {
        const raw = await judgeText(judgeRubric(msg, signalsOf(lead)), { label: "outreach-judge" })
        verdict = JSON.parse(raw)
    } catch (err: any) {
        // Soudce nedostupný = neodesílá se. Raději nic než nezkontrolovaná zpráva.
        await logEvent(leadId, "blocked", { reason: "soudce nedostupný", error: String(err?.message).slice(0, 120) })
        return { ok: false, reason: "soudce nedostupný" }
    }
    if (!verdict.pass) {
        await logEvent(leadId, "blocked", { reason: "zamítnuto soudcem", problems: verdict.problems })
        return { ok: false, reason: "zpráva neprošla kontrolou", problems: verdict.problems }
    }

    // ODDĚLENÁ přeprava — nikdy ne přes lib/email.ts. Resend má studené oslovení
    // v pravidlech zakázané a chodí přes něj potvrzení o platbách.
    const { sendOutreach } = await import("./transport")
    // Odhlašovací odkaz se skládal na dvou místech zvlášť a tahle kopie stála na
    // `base`, který padá na nekanonické `chrlit.cz` (308 → www) a neověřuje, že
    // je to vůbec URL. Sdílený helper drží obojí na jednom místě.
    const { unsubscribeUrl } = await import("@/lib/mail/links")
    const unsub = unsubscribeUrl(lead.email)
    const text = `${msg.text}\n\nNechcete-li od nás už nic, odhlaste se tady: ${unsub}`

    const sent = await sendOutreach({ to: lead.email, subject: msg.subject, text })

    const followup = new Date(); followup.setDate(followup.getDate() + 4)
    await supabaseAdmin.from("leads").update({
        status: "contacted", last_contacted_at: new Date().toISOString(),
        followup_at: followup.toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", leadId)
    await logEvent(leadId, "sent", { subject: msg.subject, judgeScore: verdict.score })

    return { ok: true, to: lead.email, emailId: (sent as any)?.id }
}
