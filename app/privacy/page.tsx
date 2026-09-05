import Link from "next/link"
import { SiteFooter } from "@/components/SiteFooter"
import { LEGAL, DATA_AUTHORITY, SUBPROCESSORS, formatAddress } from "@/lib/legal"

export const metadata = {
    title: "Zpracování osobních údajů — Chrlit",
    description: "Jaké osobní údaje Chrlit zpracovává, proč, jak dlouho a jaká máte práva podle GDPR.",
}

const EFFECTIVE_FROM = "1. srpna 2026"

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
    return (
        <section>
            <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">{n}. {title}</h2>
            {children}
        </section>
    )
}

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-[#050505] text-white">
            <div className="max-w-3xl mx-auto px-6 py-24">
                <Link href="/" className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-12 inline-block">
                    ← Zpět na hlavní stránku
                </Link>

                <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4">Zpracování osobních údajů</h1>
                <p className="text-white/40 text-sm font-bold uppercase tracking-widest mb-16">Účinné od {EFFECTIVE_FROM} · v souladu s GDPR</p>

                <div className="prose prose-invert max-w-none space-y-10 text-white/70 text-sm leading-relaxed">

                    <Section n={1} title="Správce údajů">
                        <p>Správcem osobních údajů je:</p>
                        <div className="mt-4 border border-white/10 bg-white/[0.02] p-5 not-prose">
                            <ul className="space-y-1.5 text-white/70 text-sm">
                                <li className="text-white font-bold">{LEGAL.name}</li>
                                <li>{formatAddress()}, {LEGAL.country}</li>
                                <li>IČO: {LEGAL.ico}</li>
                                <li>E-mail: <a href={`mailto:${LEGAL.email}`} className="text-white/80 underline">{LEGAL.email}</a></li>
                            </ul>
                        </div>
                        <p className="mt-4">Správce nejmenoval pověřence pro ochranu osobních údajů — nesplňuje podmínky čl. 37 GDPR. Ve všech záležitostech ochrany údajů se obracejte na výše uvedený e-mail.</p>
                    </Section>

                    <Section n={2} title="Jaké údaje zpracováváme">
                        <ul className="list-disc list-inside space-y-2 text-white/60">
                            <li><strong className="text-white/80">Registrační údaje:</strong> e-mailová adresa, heslo (uložené pouze v hašované podobě)</li>
                            <li><strong className="text-white/80">Fakturační údaje:</strong> jméno nebo název, adresa, IČO a DIČ, historie plateb a vystavených faktur</li>
                            <li><strong className="text-white/80">Údaje o využívání služby:</strong> nastavení projektů, zadání, vygenerovaný obsah, záznamy o generování a spotřebě kreditů</li>
                            <li><strong className="text-white/80">Údaje z propojeného účtu Instagram:</strong> viz bod 10</li>
                            <li><strong className="text-white/80">Technické údaje:</strong> IP adresa, typ prohlížeče, čas přístupu, chybové a bezpečnostní záznamy</li>
                        </ul>
                        <p className="mt-3">Údaje o platební kartě nezpracováváme ani neukládáme — zpracovává je výhradně platební brána ComGate Payments, a.s.</p>
                    </Section>

                    <Section n={3} title="Účel a právní základ">
                        <div className="mt-4 bg-[#0a0a0a] border border-white/10 rounded-sm overflow-x-auto not-prose">
                            <table className="w-full text-xs min-w-[520px]">
                                <thead>
                                    <tr className="border-b border-white/10 bg-white/5">
                                        <th className="text-left p-3 font-bold uppercase tracking-widest text-white/60">Účel</th>
                                        <th className="text-left p-3 font-bold uppercase tracking-widest text-white/60">Právní základ</th>
                                    </tr>
                                </thead>
                                <tbody className="text-white/50">
                                    <tr className="border-b border-white/5"><td className="p-3">Poskytování a provoz služby, správa účtu</td><td className="p-3">Plnění smlouvy — čl. 6 odst. 1 písm. b) GDPR</td></tr>
                                    <tr className="border-b border-white/5"><td className="p-3">Vystavování faktur a vedení daňové evidence</td><td className="p-3">Právní povinnost — čl. 6 odst. 1 písm. c) GDPR</td></tr>
                                    <tr className="border-b border-white/5"><td className="p-3">Zabezpečení služby, prevence zneužití</td><td className="p-3">Oprávněný zájem — čl. 6 odst. 1 písm. f) GDPR</td></tr>
                                    <tr className="border-b border-white/5"><td className="p-3">Zlepšování kvality generovaného obsahu</td><td className="p-3">Oprávněný zájem — čl. 6 odst. 1 písm. f) GDPR</td></tr>
                                    <tr className="border-b border-white/5"><td className="p-3">Provozní a transakční e-maily (potvrzení platby, změny podmínek)</td><td className="p-3">Plnění smlouvy — čl. 6 odst. 1 písm. b) GDPR</td></tr>
                                    <tr className="border-b border-white/5"><td className="p-3">Marketingová sdělení</td><td className="p-3">Souhlas — čl. 6 odst. 1 písm. a) GDPR (kdykoli odvolatelný)</td></tr>
                                    <tr><td className="p-3">Propojení a publikování na Instagramu</td><td className="p-3">Souhlas — čl. 6 odst. 1 písm. a) GDPR</td></tr>
                                </tbody>
                            </table>
                        </div>
                        <p className="mt-4">Neprovádíme automatizované rozhodování s právními účinky pro uživatele ani profilování ve smyslu čl. 22 GDPR. Modely umělé inteligence generují obsah, nerozhodují o právech uživatele.</p>
                    </Section>

                    <Section n={4} title="Zpracovatelé">
                        <p>Pro provoz služby využíváme následující zpracovatele, s nimiž máme uzavřeny smlouvy o zpracování osobních údajů podle čl. 28 GDPR:</p>
                        <div className="mt-4 bg-[#0a0a0a] border border-white/10 rounded-sm overflow-x-auto not-prose">
                            <table className="w-full text-xs min-w-[520px]">
                                <thead>
                                    <tr className="border-b border-white/10 bg-white/5">
                                        <th className="text-left p-3 font-bold uppercase tracking-widest text-white/60">Zpracovatel</th>
                                        <th className="text-left p-3 font-bold uppercase tracking-widest text-white/60">Účel</th>
                                        <th className="text-left p-3 font-bold uppercase tracking-widest text-white/60">Umístění</th>
                                    </tr>
                                </thead>
                                <tbody className="text-white/50">
                                    {SUBPROCESSORS.map(p => (
                                        <tr key={p.name} className="border-b border-white/5 last:border-b-0">
                                            <td className="p-3 text-white/70">{p.name}</td>
                                            <td className="p-3">{p.purpose}</td>
                                            <td className="p-3 whitespace-nowrap">{p.location}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="mt-4">U zpracovatelů se sídlem mimo EU probíhá předání údajů na základě standardních smluvních doložek schválených Evropskou komisí, případně na základě rozhodnutí o odpovídající ochraně (rámec EU–USA Data Privacy Framework).</p>
                        <p className="mt-3"><strong className="text-white/80">Obsah, který zadáte do služby, se předává poskytovatelům modelů umělé inteligence</strong> za účelem vygenerování výstupu. Nepoužívá se k trénování jejich modelů.</p>
                    </Section>

                    <Section n={5} title="Doba uchování">
                        <ul className="list-disc list-inside space-y-2 text-white/60">
                            <li><strong className="text-white/80">Údaje účtu a obsah:</strong> po dobu trvání účtu a 30 dní po jeho zrušení, poté smazány nebo anonymizovány</li>
                            <li><strong className="text-white/80">Faktury a daňová evidence:</strong> po dobu stanovenou daňovými a účetními předpisy (zpravidla 10 let od konce zdaňovacího období) — tuto povinnost nelze zkrátit žádostí o výmaz</li>
                            <li><strong className="text-white/80">Bezpečnostní a provozní záznamy:</strong> nejdéle 12 měsíců</li>
                            <li><strong className="text-white/80">Token propojeného Instagram účtu:</strong> do odpojení účtu, poté okamžitě smazán</li>
                        </ul>
                    </Section>

                    <Section n={6} title="Vaše práva">
                        <p>Podle GDPR máte právo:</p>
                        <ul className="list-disc list-inside space-y-2 mt-3 text-white/60">
                            <li><strong className="text-white/80">na přístup</strong> — vyžádat si potvrzení a kopii zpracovávaných údajů</li>
                            <li><strong className="text-white/80">na opravu</strong> — nechat opravit nepřesné nebo doplnit neúplné údaje</li>
                            <li><strong className="text-white/80">na výmaz</strong> — požádat o smazání účtu a údajů, nebrání-li tomu právní povinnost</li>
                            <li><strong className="text-white/80">na omezení zpracování</strong> — v případech podle čl. 18 GDPR</li>
                            <li><strong className="text-white/80">na přenositelnost</strong> — získat údaje ve strojově čitelném formátu</li>
                            <li><strong className="text-white/80">vznést námitku</strong> — proti zpracování na základě oprávněného zájmu</li>
                            <li><strong className="text-white/80">odvolat souhlas</strong> — kdykoli, bez vlivu na zákonnost dosavadního zpracování</li>
                        </ul>
                        <p className="mt-3">Žádost stačí poslat na <a href={`mailto:${LEGAL.email}`} className="text-white/80 underline">{LEGAL.email}</a>. Vyřídíme ji nejpozději do jednoho měsíce.</p>
                        <p className="mt-3">Máte také právo podat stížnost u dozorového úřadu:</p>
                        <div className="mt-4 border border-white/10 bg-white/[0.02] p-5 not-prose">
                            <ul className="space-y-1.5 text-white/70 text-sm">
                                <li className="text-white font-bold">{DATA_AUTHORITY.name}</li>
                                <li>{DATA_AUTHORITY.address}</li>
                                <li><a href={DATA_AUTHORITY.web} target="_blank" rel="noopener noreferrer" className="text-white/80 underline">{DATA_AUTHORITY.web}</a></li>
                            </ul>
                        </div>
                    </Section>

                    <Section n={7} title="Zabezpečení">
                        <p>Veškerá komunikace probíhá přes šifrované spojení (HTTPS/TLS). Hesla jsou ukládána pouze v hašované podobě. Přístup k databázi je omezen politikami Row Level Security a servisními klíči. Tokeny propojených účtů jsou šifrovány algoritmem AES-256-GCM.</p>
                    </Section>

                    <Section n={8} title="Cookies">
                        <p><strong className="text-white/90">Technicky nezbytné cookies</strong> používáme vždy — jde o relaci Supabase Auth, bez které se nelze přihlásit. Souhlas k nim zákon nevyžaduje, protože bez nich by služba nefungovala.</p>
                        <p className="mt-3"><strong className="text-white/90">Analytické cookies</strong> (Google Analytics, správce Google Ireland Ltd.) používáme k měření návštěvnosti webu. Spustí se <strong className="text-white/90">až poté, co k nim dáte souhlas</strong> v cookie liště; do té doby je měření vypnuté. Právním základem je váš souhlas podle čl. 6 odst. 1 písm. a) GDPR a § 89 odst. 3 zákona č. 127/2005 Sb.</p>
                        <p className="mt-3">Souhlas můžete kdykoli odvolat — smazáním dat webu v prohlížeči se lišta zobrazí znovu a můžete zvolit „Odmítnout". Odvolání souhlasu nemá vliv na zákonnost zpracování před jeho odvoláním.</p>
                        <p className="mt-3">Marketingové ani reklamní cookies nepoužíváme a data z analytiky nepředáváme inzertním sítím.</p>
                    </Section>

                    <Section n={9} title="Děti">
                        <p>Služba není určena osobám mladším 18 let a vědomě nezpracováváme jejich osobní údaje.</p>
                    </Section>

                    <Section n={10} title="Propojení s Instagramem (Meta)">
                        <p>Pokud propojíte svůj Instagram Business účet, využíváme rozhraní Instagram API with Instagram Login společnosti Meta. Připojení je dobrovolné a probíhá výhradně na základě vašeho souhlasu uděleného na přihlašovací obrazovce Instagramu.</p>
                        <p className="mt-3">V rámci propojení zpracováváme:</p>
                        <ul className="list-disc list-inside space-y-2 mt-3 text-white/60">
                            <li><strong className="text-white/80">Identifikační údaje účtu:</strong> ID Instagram účtu a uživatelské jméno (@handle)</li>
                            <li><strong className="text-white/80">Statistiky příspěvků:</strong> dosah, zhlédnutí, lajky, komentáře a uložení — slouží k vyhodnocení výkonu obsahu a jeho zlepšování</li>
                            <li><strong className="text-white/80">Přístupový token:</strong> uchováváme jej v šifrované podobě (AES-256-GCM) a používáme výhradně pro výše uvedené účely</li>
                        </ul>
                        <p className="mt-3">Tyto údaje nesdílíme s dalšími třetími stranami nad rámec uvedených zpracovatelů a nepoužíváme je k profilování ani cílené reklamě.</p>
                        <p className="mt-3"><strong className="text-white/80">Propojení přes službu Upload-Post:</strong> u některých projektů probíhá propojení Instagramu přes službu Upload-Post LLC (USA), která pro nás zajišťuje publikování příspěvků a čtení jejich statistik. V takovém případě udělujete souhlas na jejich autorizační stránce a rozsah zpracovávaných údajů je stejný jako výše. Kterou cestu váš projekt používá, poznáte v Nastavení projektu; propojení lze i zde kdykoli zrušit a profil je pak u Upload-Post smazán.</p>
                        <p className="mt-3"><strong className="text-white/80">Odpojení a výmaz:</strong> propojení můžete kdykoli zrušit v Nastavení projektu. Tím dojde k odstranění uloženého tokenu. O výmaz dat získaných z Instagramu můžete rovněž požádat prostřednictvím <Link href="/api/data-deletion" className="text-white/80 underline">našeho data deletion endpointu</Link> nebo na e-mailu <a href={`mailto:${LEGAL.email}`} className="text-white/80 underline">{LEGAL.email}</a>.</p>
                    </Section>

                    <Section n={11} title="Změny těchto zásad">
                        <p>Tyto zásady můžeme aktualizovat, zejména při změně rozsahu služby nebo seznamu zpracovatelů. O podstatné změně vás informujeme e-mailem nejméně 14 dní předem. Aktuální znění je vždy dostupné na této stránce.</p>
                    </Section>
                </div>
            </div>
            <SiteFooter />
        </div>
    )
}
