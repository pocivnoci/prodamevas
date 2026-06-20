import Link from "next/link"

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-[#050505] text-white">
            <div className="max-w-3xl mx-auto px-6 py-24">
                <Link href="/" className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-12 inline-block">
                    ← Zpět na hlavní stránku
                </Link>

                <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4">Zpracování osobních údajů</h1>
                <p className="text-white/40 text-sm font-bold uppercase tracking-widest mb-16">Platné od 1. května 2026 · v souladu s GDPR</p>

                <div className="prose prose-invert max-w-none space-y-10 text-white/70 text-sm leading-relaxed">
                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">1. Správce údajů</h2>
                        <p>Správcem osobních údajů je Chrlit.cz (dále jen „Správce"). Kontaktní e-mail pro záležitosti ochrany osobních údajů: info@chrlit.cz</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">2. Jaké údaje zpracováváme</h2>
                        <p>Zpracováváme následující kategorie osobních údajů:</p>
                        <ul className="list-disc list-inside space-y-2 mt-3 text-white/60">
                            <li><strong className="text-white/80">Registrační údaje:</strong> e-mailová adresa, heslo (šifrované)</li>
                            <li><strong className="text-white/80">Údaje o využívání služby:</strong> konfigurace projektů, vygenerovaný obsah, logy generování</li>
                            <li><strong className="text-white/80">Technické údaje:</strong> IP adresa, typ prohlížeče, čas přístupu</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">3. Účel zpracování</h2>
                        <ul className="list-disc list-inside space-y-2 text-white/60">
                            <li>Poskytování a provoz služby Chrlit</li>
                            <li>Autentizace a zabezpečení uživatelského účtu</li>
                            <li>Zlepšování kvality služby a uživatelského zážitku</li>
                            <li>Komunikace s uživatelem (technické notifikace, změny podmínek)</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">4. Právní základ</h2>
                        <p>Zpracování osobních údajů probíhá na základě:</p>
                        <ul className="list-disc list-inside space-y-2 mt-3 text-white/60">
                            <li>Plnění smlouvy (poskytování služby)</li>
                            <li>Oprávněného zájmu správce (bezpečnost, analytika)</li>
                            <li>Souhlasu uživatele (marketingová komunikace)</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">5. Třetí strany a zpracovatelé</h2>
                        <p>Pro provoz služby využíváme následující zpracovatele:</p>
                        <div className="mt-4 bg-[#0a0a0a] border border-white/10 rounded-sm overflow-hidden">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-white/10 bg-white/5">
                                        <th className="text-left p-3 font-bold uppercase tracking-widest text-white/60">Služba</th>
                                        <th className="text-left p-3 font-bold uppercase tracking-widest text-white/60">Účel</th>
                                        <th className="text-left p-3 font-bold uppercase tracking-widest text-white/60">Sídlo</th>
                                    </tr>
                                </thead>
                                <tbody className="text-white/50">
                                    <tr className="border-b border-white/5"><td className="p-3">Supabase</td><td className="p-3">Databáze, autentizace, úložiště</td><td className="p-3">USA (EU hosting)</td></tr>
                                    <tr className="border-b border-white/5"><td className="p-3">Google Cloud (Gemini AI)</td><td className="p-3">AI generování obsahu</td><td className="p-3">USA / EU</td></tr>
                                    <tr className="border-b border-white/5"><td className="p-3">Vercel</td><td className="p-3">Hosting aplikace</td><td className="p-3">USA (EU edge)</td></tr>
                                    <tr className="border-b border-white/5"><td className="p-3">Meta Platforms (Instagram)</td><td className="p-3">Propojení Instagram účtu, statistiky příspěvků, publikování</td><td className="p-3">Irsko / USA</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">6. Doba uchování</h2>
                        <p>Osobní údaje uchováváme po dobu trvání uživatelského účtu a 30 dní po jeho zrušení. Po uplynutí této doby jsou údaje anonymizovány nebo smazány.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">7. Práva uživatele</h2>
                        <p>V souladu s GDPR máte následující práva:</p>
                        <ul className="list-disc list-inside space-y-2 mt-3 text-white/60">
                            <li><strong className="text-white/80">Právo na přístup</strong> — vyžádat si kopii svých údajů</li>
                            <li><strong className="text-white/80">Právo na opravu</strong> — opravit nepřesné údaje</li>
                            <li><strong className="text-white/80">Právo na výmaz</strong> — požádat o smazání účtu a všech údajů</li>
                            <li><strong className="text-white/80">Právo na přenositelnost</strong> — export dat ve strojově čitelném formátu</li>
                            <li><strong className="text-white/80">Právo vznést námitku</strong> — proti zpracování na základě oprávněného zájmu</li>
                        </ul>
                        <p className="mt-3">Pro uplatnění svých práv nás kontaktujte na info@chrlit.cz.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">8. Zabezpečení</h2>
                        <p>Veškerá komunikace probíhá přes šifrované spojení (HTTPS/TLS). Hesla jsou ukládána v hašované podobě. Přístup k databázi je omezen prostřednictvím Row Level Security (RLS) a service role klíčů.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">9. Cookies</h2>
                        <p>Platforma využívá pouze technicky nezbytné cookies pro autentizaci uživatele (Supabase Auth session). Nepoužíváme žádné marketingové ani analytické cookies třetích stran.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">10. Propojení s Instagramem (Meta)</h2>
                        <p>Pokud propojíte svůj Instagram Business účet, využíváme rozhraní Instagram API with Instagram Login společnosti Meta. Připojení je dobrovolné a probíhá výhradně na základě vašeho souhlasu uděleného na přihlašovací obrazovce Instagramu.</p>
                        <p className="mt-3">V rámci propojení zpracováváme:</p>
                        <ul className="list-disc list-inside space-y-2 mt-3 text-white/60">
                            <li><strong className="text-white/80">Identifikační údaje účtu:</strong> ID Instagram účtu a uživatelské jméno (@handle)</li>
                            <li><strong className="text-white/80">Statistiky příspěvků:</strong> dosah, zhlédnutí, lajky, komentáře a uložení — slouží k vyhodnocení výkonu obsahu a jeho zlepšování</li>
                            <li><strong className="text-white/80">Přístupový token:</strong> uchováváme jej v šifrované podobě (AES-256-GCM) a používáme výhradně pro výše uvedené účely</li>
                        </ul>
                        <p className="mt-3">Tyto údaje nesdílíme s dalšími třetími stranami nad rámec uvedených zpracovatelů a nepoužíváme je k profilování ani cílené reklamě.</p>
                        <p className="mt-3"><strong className="text-white/80">Odpojení a výmaz:</strong> propojení můžete kdykoli zrušit v Nastavení projektu. Tím dojde k odstranění uloženého tokenu. O výmaz dat získaných z Instagramu můžete rovněž požádat prostřednictvím <Link href="/api/data-deletion" className="text-white/80 underline">našeho data deletion endpointu</Link> nebo na e-mailu info@chrlit.cz.</p>
                    </section>
                </div>

                <div className="mt-16 pt-8 border-t border-white/10 text-[9px] text-white/20 font-bold uppercase tracking-widest">
                    © 2026 Chrlit.cz — Všechna práva vyhrazena
                </div>
            </div>
        </div>
    )
}
