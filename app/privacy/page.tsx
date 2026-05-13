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
                        <p>Správcem osobních údajů je ProdámeVás.cz (dále jen „Správce"). Kontaktní e-mail pro záležitosti ochrany osobních údajů: info@prodamevas.cz</p>
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
                            <li>Poskytování a provoz služby ProdámeVás</li>
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
                        <p className="mt-3">Pro uplatnění svých práv nás kontaktujte na info@prodamevas.cz.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">8. Zabezpečení</h2>
                        <p>Veškerá komunikace probíhá přes šifrované spojení (HTTPS/TLS). Hesla jsou ukládána v hašované podobě. Přístup k databázi je omezen prostřednictvím Row Level Security (RLS) a service role klíčů.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">9. Cookies</h2>
                        <p>Platforma využívá pouze technicky nezbytné cookies pro autentizaci uživatele (Supabase Auth session). Nepoužíváme žádné marketingové ani analytické cookies třetích stran.</p>
                    </section>
                </div>

                <div className="mt-16 pt-8 border-t border-white/10 text-[9px] text-white/20 font-bold uppercase tracking-widest">
                    © 2026 ProdámeVás.cz — Všechna práva vyhrazena
                </div>
            </div>
        </div>
    )
}
