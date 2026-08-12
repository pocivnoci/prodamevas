/**
 * GET /ukazka/<token> — veřejná ukázka na míru pro jednu firmu
 *
 * Tohle je to, na co vede odkaz z oslovení. V mailu není žádný obrázek ani
 * příloha (spamový signál a horší doručitelnost); celý dojem nese tahle stránka.
 *
 * Token je náhodný a unikátní (`leads.preview_token`, částečný UNIQUE index) —
 * ne odvozený od e-mailu, aby ho nešlo uhodnout ani vyjmenovat. Bez platného
 * tokenu se nic nezobrazí.
 *
 * Otevření stránky se zapisuje jako `previewed` do `lead_events` — z toho se
 * počítá, jestli zpráva vůbec funguje, dřív než se zvýší objem.
 */

import { notFound } from "next/navigation"
import supabaseAdmin from "@/supabase/admin"
import { LEGAL, formatIdentityLine } from "@/lib/legal"
import { lowestPriceClaim } from "@/lib/pricing"

export const dynamic = "force-dynamic"

interface PreviewPost {
    hook: string
    body: string
    cta: string
    hashtags: string[]
    imageUrl: string
}

export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params

    const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, company, website, ig_handle, preview_posts, preview_ready_at")
        .eq("preview_token", token)
        .maybeSingle()

    if (!lead || !lead.preview_ready_at) notFound()

    const posts = (lead.preview_posts ?? []) as PreviewPost[]
    const name = lead.company || lead.ig_handle?.replace(/^@/, "") || "vaši značku"

    // Návštěva je nejsilnější signál zájmu, jaký z oslovení dostaneme. Zápis nesmí
    // shodit stránku — když se nezaloguje, ukázka se pořád ukáže.
    try {
        await supabaseAdmin.from("lead_events").insert({ lead_id: lead.id, kind: "previewed" })
    } catch { /* nevadí */ }

    return (
        <main className="min-h-screen bg-[#050505] text-white">
            <div className="mx-auto max-w-5xl px-6 py-16 md:py-24">

                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                    Ukázka na míru
                </p>
                <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight md:text-5xl">
                    Takhle by mohl vypadat Instagram
                    <br />
                    <span className="text-[#e4472c]">{name}</span>
                </h1>
                <p className="mt-6 max-w-2xl text-sm leading-relaxed text-white/60 md:text-base">
                    Tyhle příspěvky nikdo neupravoval. Vznikly automaticky z vašeho webu
                    {lead.website ? ` (${lead.website.replace(/^https?:\/\//, "")})` : ""} — texty,
                    obrázky i hashtagy. Můžete si je vzít a použít, jsou vaše.
                </p>

                <div className="mt-14 grid gap-10 md:grid-cols-3">
                    {posts.map((p, i) => (
                        <article key={i} className="border border-white/5 bg-[#0a0a0a]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={p.imageUrl}
                                alt={`Ukázkový příspěvek ${i + 1} pro ${name}`}
                                className="aspect-[4/5] w-full object-cover"
                                loading={i === 0 ? "eager" : "lazy"}
                            />
                            <div className="space-y-3 p-5">
                                <p className="text-sm font-bold leading-snug">{p.hook}</p>
                                <p className="text-xs leading-relaxed text-white/55">{p.body}</p>
                                {p.cta ? <p className="text-xs text-white/70">{p.cta}</p> : null}
                                {p.hashtags?.length ? (
                                    <p className="text-[11px] leading-relaxed text-[#e4472c]/70">
                                        {p.hashtags.slice(0, 8).map(h => (h.startsWith("#") ? h : `#${h}`)).join(" ")}
                                    </p>
                                ) : null}
                            </div>
                        </article>
                    ))}
                </div>

                <section className="mt-20 border border-white/10 bg-[#0a0a0a] p-8 md:p-12">
                    <h2 className="text-xl font-bold tracking-tight md:text-2xl">
                        Co Chrlit umí — a co ne
                    </h2>
                    <div className="mt-8 grid gap-8 md:grid-cols-2">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Umí</p>
                            <ul className="mt-4 space-y-2 text-sm text-white/70">
                                <li>Naučit se vaši značku z webu — tón, barvy, produkty</li>
                                <li>Připravit obsah na celý měsíc dopředu</li>
                                <li>Psát česky, ne strojovým překladem</li>
                                <li>Obrázky, karusely i reely včetně textu v obraze</li>
                            </ul>
                        </div>
                        <div>
                            {/* Slibovat výsledky je přesně to, kvůli čemu se firmy dostávají
                                do potíží — a produkt je ani ovlivnit nemůže. */}
                            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Neslibuje</p>
                            <ul className="mt-4 space-y-2 text-sm text-white/70">
                                <li>Že vám poroste dosah nebo přibudou sledující</li>
                                <li>Že se obsah trefí napoprvé — proto ho můžete upravit</li>
                                <li>Že nahradí vaše fotky produktů, když na nich záleží</li>
                            </ul>
                        </div>
                    </div>

                    <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                        <a
                            href="/register"
                            className="inline-flex items-center justify-center bg-[#e4472c] px-7 py-3 text-xs font-bold uppercase tracking-widest text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e4472c]"
                        >
                            Chci to pro svoji firmu
                        </a>
                        <p className="text-xs text-white/40">{lowestPriceClaim().replace(/^od/, "Od")}. Zrušit můžete kdykoli.</p>
                    </div>
                </section>

                <footer className="mt-16 border-t border-white/5 pt-8 text-[11px] leading-relaxed text-white/30">
                    <p>{formatIdentityLine()}</p>
                    <p className="mt-1">
                        Ukázku jsme připravili z veřejně dostupných údajů o vaší firmě.
                        Nechcete-li od nás už nic, stačí odpovědět na e-mail —{" "}
                        <a href={LEGAL.website} className="underline hover:text-white/60">{LEGAL.website.replace(/^https?:\/\//, "")}</a>
                    </p>
                </footer>
            </div>
        </main>
    )
}
