import Link from "next/link"

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-[#050505] text-white">
            <div className="max-w-3xl mx-auto px-6 py-24">
                <Link href="/" className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-12 inline-block">
                    ← Zpět na hlavní stránku
                </Link>

                <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4">Obchodní podmínky</h1>
                <p className="text-white/40 text-sm font-bold uppercase tracking-widest mb-16">Platné od 1. května 2026</p>

                <div className="prose prose-invert max-w-none space-y-10 text-white/70 text-sm leading-relaxed">
                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">1. Úvodní ustanovení</h2>
                        <p>Tyto obchodní podmínky (dále jen „Podmínky") upravují práva a povinnosti mezi provozovatelem platformy Chrlit (dále jen „Provozovatel") a uživatelem služby (dále jen „Uživatel").</p>
                        <p className="mt-3">Provozovatelem je Chrlit.cz. Platforma je poskytována jako služba (SaaS) prostřednictvím webové aplikace na adrese chrlit.cz.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">2. Popis služby</h2>
                        <p>Chrlit je AI-powered platforma pro automatizované generování obsahu pro sociální sítě. Služba využívá modely Google Gemini a Imagen k vytváření textového a vizuálního obsahu na základě konfigurace značky uživatele.</p>
                        <p className="mt-3">Služba zahrnuje:</p>
                        <ul className="list-disc list-inside space-y-2 mt-3 text-white/60">
                            <li>Automatickou analýzu webu a brandingu</li>
                            <li>Generování Instagram postů (captiony, obrázky, reels)</li>
                            <li>Produktový generátor (návrhy designů a mockupů)</li>
                            <li>Správu více klientských profilů</li>
                            <li>Analytiku a performance tracking</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">3. Registrace a účet</h2>
                        <p>Pro využívání služby je nutné vytvořit uživatelský účet s platnou e-mailovou adresou. Uživatel je povinen uvést pravdivé údaje a chránit své přihlašovací údaje před zneužitím.</p>
                        <p className="mt-3">Provozovatel si vyhrazuje právo zrušit účet, který porušuje tyto Podmínky nebo je využíván k nezákonným účelům.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">4. Cenové podmínky</h2>
                        <p>Platforma nabízí bezplatný plán s omezeným počtem generování a placené plány s rozšířenými funkcemi. Aktuální ceník je uveden na hlavní stránce v sekci Ceník.</p>
                        <p className="mt-3">Placené plány jsou účtovány měsíčně. Uživatel může svůj plán kdykoliv změnit nebo zrušit. Při zrušení zůstává přístup aktivní do konce zaplaceného období.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">5. Autorská práva a licence</h2>
                        <p>Veškerý obsah vygenerovaný platformou (texty, obrázky, videa) je licencován uživateli k neomezenému komerčnímu použití. Provozovatel si nenárokuje žádná autorská práva k vygenerovanému obsahu.</p>
                        <p className="mt-3">Uživatel je plně zodpovědný za obsah, který zveřejní na sociálních sítích, včetně souladu s pravidly příslušné platformy.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">6. Omezení odpovědnosti</h2>
                        <p>Provozovatel negarantuje konkrétní výsledky (dosah, engagement, konverze) při použití vygenerovaného obsahu. Služba je poskytována „tak, jak je" (as-is).</p>
                        <p className="mt-3">Provozovatel nenese odpovědnost za výpadky služeb třetích stran (Google AI, Supabase, Vercel), které mohou dočasně ovlivnit funkčnost platformy.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">7. Zkušební období</h2>
                        <p>Nově registrovaní uživatelé mají nárok na 7denní bezplatné zkušební období placeného plánu. Po uplynutí zkušebního období bude účet automaticky převeden na bezplatný plán, pokud uživatel nezadá platební údaje.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">8. Závěrečná ustanovení</h2>
                        <p>Provozovatel si vyhrazuje právo tyto Podmínky kdykoliv aktualizovat. O podstatných změnách bude uživatel informován e-mailem minimálně 14 dní předem.</p>
                        <p className="mt-3">Tyto Podmínky se řídí právním řádem České republiky. Případné spory budou řešeny příslušnými soudy ČR.</p>
                    </section>
                </div>

                <div className="mt-16 pt-8 border-t border-white/10 text-[9px] text-white/20 font-bold uppercase tracking-widest">
                    © 2026 Chrlit.cz — Všechna práva vyhrazena
                </div>
            </div>
        </div>
    )
}
