import Link from "next/link"
import { LEGAL, CONSUMER_AUTHORITY, formatAddress, vatNotice } from "@/lib/legal"

export const metadata = {
    title: "Obchodní podmínky — Chrlit",
    description: "Obchodní podmínky služby Chrlit: uzavření smlouvy, ceny, předplatné, odstoupení od smlouvy a reklamace.",
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

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-[#050505] text-white">
            <div className="max-w-3xl mx-auto px-6 py-24">
                <Link href="/" className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-12 inline-block">
                    ← Zpět na hlavní stránku
                </Link>

                <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4">Obchodní podmínky</h1>
                <p className="text-white/40 text-sm font-bold uppercase tracking-widest mb-16">Účinné od {EFFECTIVE_FROM}</p>

                <div className="prose prose-invert max-w-none space-y-10 text-white/70 text-sm leading-relaxed">

                    <Section n={1} title="Kdo službu poskytuje">
                        <p>Tyto obchodní podmínky (dále jen „Podmínky“) upravují práva a povinnosti mezi poskytovatelem a uživatelem služby Chrlit dostupné na adrese {LEGAL.website.replace(/^https?:\/\//, "")}.</p>
                        <div className="mt-4 border border-white/10 bg-white/[0.02] p-5 not-prose">
                            <div className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-3">Poskytovatel</div>
                            <ul className="space-y-1.5 text-white/70 text-sm">
                                <li className="text-white font-bold">{LEGAL.name}</li>
                                <li>{formatAddress()}, {LEGAL.country}</li>
                                <li>IČO: {LEGAL.ico}</li>
                                {LEGAL.dic ? <li>DIČ: {LEGAL.dic}</li> : null}
                                <li>E-mail: <a href={`mailto:${LEGAL.email}`} className="text-white/80 underline">{LEGAL.email}</a></li>
                                {LEGAL.phone ? <li>Telefon: {LEGAL.phone}</li> : null}
                                <li className="text-white/40 text-xs pt-2">Podnikatel zapsaný v živnostenském rejstříku, {LEGAL.registryOffice}.</li>
                            </ul>
                        </div>
                        <p className="mt-4">Uživatelem se rozumí fyzická nebo právnická osoba, která si založí účet. Je-li uživatelem spotřebitel (fyzická osoba jednající mimo rámec své podnikatelské činnosti), uplatní se navíc ustanovení označená jako <strong className="text-white/90">spotřebitelská</strong>.</p>
                    </Section>

                    <Section n={2} title="Co služba dělá">
                        <p>Chrlit je software jako služba (SaaS) pro automatizované vytváření obsahu na sociální sítě pomocí modelů umělé inteligence. Na základě analýzy webu a zadání uživatele generuje texty, obrázky, carousely, Instagram Stories a videa (reels).</p>
                        <p className="mt-3">Součástí služby je:</p>
                        <ul className="list-disc list-inside space-y-2 mt-3 text-white/60">
                            <li>analýza webu a značky a návrh nastavení,</li>
                            <li>generování příspěvků včetně textů a vizuálů,</li>
                            <li>obsahové plány a kalendář,</li>
                            <li>produktové studio (návrhy potisků a mockupů),</li>
                            <li>volitelné propojení s účtem Instagram pro publikování a měření výsledků,</li>
                            <li>analytika a vyhodnocování výkonu příspěvků.</li>
                        </ul>
                        <p className="mt-3">Rozsah funkcí se liší podle zvoleného tarifu. Aktuální rozsah je vždy uveden v ceníku na hlavní stránce.</p>
                    </Section>

                    <Section n={3} title="Uzavření smlouvy">
                        <p>Smlouva je uzavřena okamžikem, kdy uživatel dokončí registraci účtu, u placených tarifů pak okamžikem zaplacení první platby za zvolený tarif. Před odesláním objednávky je uživateli zobrazena cena, rozsah tarifu a délka zúčtovacího období.</p>
                        <p className="mt-3">Smlouva se uzavírá v českém jazyce a poskytovatel ji archivuje v elektronické podobě. Uživatel k ní má přístup ve svém účtu v sekci Předplatné.</p>
                        <p className="mt-3">Náklady na použití prostředků komunikace na dálku (připojení k internetu) si hradí uživatel sám a neliší se od základní sazby.</p>
                    </Section>

                    <Section n={4} title="Účet">
                        <p>Pro využívání služby je nutné vytvořit účet s platnou e-mailovou adresou. Uživatel je povinen uvádět pravdivé údaje a chránit své přihlašovací údaje před zneužitím. Za činnost provedenou pod svým účtem odpovídá uživatel.</p>
                        <p className="mt-3">Poskytovatel je oprávněn omezit nebo zrušit účet, který porušuje tyto Podmínky, zejména je-li využíván k protiprávnímu jednání, k porušování práv třetích osob nebo k obcházení limitů tarifu. Před zrušením účtu poskytovatel uživatele vyzve k nápravě, nejde-li o závažné porušení.</p>
                    </Section>

                    <Section n={5} title="Bezplatná zkušební verze">
                        <p>Nový účet má k dispozici bezplatnou zkušební verzi, která <strong className="text-white/90">není omezena časem, ale rozsahem vygenerovaného obsahu</strong>. Po vyčerpání zkušebního rozsahu zůstává účet i vytvořený obsah přístupný, ale generování dalšího obsahu vyžaduje placený tarif.</p>
                        <p className="mt-3">Za zkušební verzi se neplatí a nepřechází automaticky do placeného tarifu. Placený tarif vzniká výhradně aktivním výběrem tarifu a zaplacením.</p>
                    </Section>

                    <Section n={6} title="Ceny a platební podmínky">
                        <p>Ceny tarifů jsou uvedeny v ceníku na hlavní stránce a v aplikaci. <strong className="text-white/90">{vatNotice()}</strong></p>
                        <p className="mt-3">Platba probíhá předem na začátku každého zúčtovacího období prostřednictvím platební brány ComGate Payments, a.s. Poskytovatel neuchovává údaje o platební kartě; ty zpracovává výhradně platební brána.</p>
                        <p className="mt-3">Na každou přijatou platbu vystaví poskytovatel daňový doklad (fakturu), který zašle na e-mail uživatele a zpřístupní v aplikaci. Fakturační údaje zadává uživatel před první platbou a odpovídá za jejich správnost.</p>
                    </Section>

                    <Section n={7} title="Kredity a limity">
                        <p>Rozsah generování je řízen kredity. Každý tarif zahrnuje měsíční příděl kreditů, který se obnovuje na začátku každého kreditového období. Různé typy obsahu spotřebují různý počet kreditů (obrázek 1, carousel 3, reel 5); aktuální váhy jsou uvedeny v aplikaci.</p>
                        <p className="mt-3"><strong className="text-white/90">Nevyčerpané kredity se nepřevádějí do dalšího období a jejich nevyužitím zanikají.</strong> Kredity nelze směnit za peníze ani převést na jiný účet.</p>
                        <p className="mt-3">Nad rámec tarifu si uživatel může dokoupit jednotlivé kredity za cenu uvedenou v aplikaci. Dokoupené kredity platí do konce probíhajícího kreditového období.</p>
                    </Section>

                    <Section n={8} title="Automatická obnova a ukončení předplatného">
                        <p>Předplatné se <strong className="text-white/90">automaticky obnovuje</strong> vždy na další období za cenu platnou v okamžiku obnovy, dokud jej uživatel nezruší. O nadcházející obnově i o změně ceny informuje poskytovatel e-mailem předem.</p>
                        <p className="mt-3">Uživatel může předplatné kdykoli zrušit v aplikaci v sekci Předplatné, a to bez udání důvodu a bez sankce. Zrušení je účinné ke konci již zaplaceného období — do té doby zůstává služba plně přístupná. Zaplacené období se nevrací poměrnou částí, není-li dále uvedeno jinak.</p>
                        <p className="mt-3">Nepodaří-li se platbu strhnout, poskytovatel se pokusí o opakované stržení v následujících dnech a informuje uživatele e-mailem. Nedojde-li k úhradě, předplatné skončí a účet přejde do bezplatného režimu bez možnosti dalšího generování.</p>
                    </Section>

                    <Section n={9} title="Odstoupení od smlouvy (spotřebitelská)">
                        <p>Je-li uživatel spotřebitel, má podle § 1829 občanského zákoníku právo odstoupit od smlouvy uzavřené distančním způsobem <strong className="text-white/90">do 14 dnů</strong> bez udání důvodu. Lhůta běží ode dne uzavření smlouvy.</p>
                        <p className="mt-3">Chrlit je digitální obsah nedodávaný na hmotném nosiči. Podle § 1837 občanského zákoníku <strong className="text-white/90">právo na odstoupení zaniká</strong>, pokud plnění začalo s předchozím výslovným souhlasem spotřebitele před uplynutím čtrnáctidenní lhůty a spotřebitel byl poučen, že tím právo na odstoupení ztrácí.</p>
                        <p className="mt-3">Proto před dokončením platby spotřebitel výslovně potvrzuje, že si přeje zpřístupnit službu ihned, a bere na vědomí, že tím pozbývá právo odstoupit. Pokud tento souhlas neudělí, bude služba zpřístupněna až po uplynutí lhůty.</p>
                        <p className="mt-3">Neudělil-li spotřebitel souhlas se zahájením plnění, může odstoupit e-mailem na <a href={`mailto:${LEGAL.email}`} className="text-white/80 underline">{LEGAL.email}</a> nebo jakýmkoli jiným jednoznačným prohlášením. Poskytovatel vrátí přijatou platbu do 14 dnů od odstoupení stejným způsobem, jakým ji přijal.</p>
                    </Section>

                    <Section n={10} title="Vady služby a reklamace">
                        <p>Poskytovatel odpovídá za to, že služba je po dobu trvání předplatného poskytována v ujednaném rozsahu a kvalitě podle § 2389a a násl. občanského zákoníku.</p>
                        <p className="mt-3">Vadou není subjektivní nespokojenost s uměleckou nebo obsahovou kvalitou jednotlivého vygenerovaného výstupu — výstup generativního modelu je z povahy věci variabilní a uživatel jej může opakovaně přegenerovat či upravit. Vadou je naopak nedostupnost služby, nefunkčnost placené funkce nebo nezapočtení zaplacených kreditů.</p>
                        <p className="mt-3">Reklamaci lze uplatnit e-mailem na <a href={`mailto:${LEGAL.email}`} className="text-white/80 underline">{LEGAL.email}</a>. Poskytovatel vydá potvrzení o přijetí reklamace a vyřídí ji <strong className="text-white/90">nejpozději do 30 dnů</strong>, není-li se spotřebitelem dohodnuta delší lhůta. Je-li reklamace oprávněná, má uživatel právo na bezplatnou nápravu, přiměřenou slevu, nebo — u podstatné vady — na odstoupení od smlouvy a vrácení poměrné části ceny.</p>
                    </Section>

                    <Section n={11} title="Práva k obsahu">
                        <p>Obsah vygenerovaný službou (texty, obrázky, videa) může uživatel užívat neomezeně, včetně užití komerčního. Poskytovatel si k vygenerovanému obsahu nenárokuje žádná práva.</p>
                        <p className="mt-3">Poskytovatel neposkytuje záruku, že vygenerovaný obsah je jedinečný ani že nezasahuje do práv třetích osob — generativní modely mohou pro různé uživatele vytvořit podobné výstupy. <strong className="text-white/90">Před zveřejněním je uživatel povinen obsah zkontrolovat</strong>, zejména faktickou správnost tvrzení o vlastních produktech, použití ochranných známek a soulad s pravidly cílové platformy a s právními předpisy o reklamě.</p>
                        <p className="mt-3">Za obsah, který uživatel zveřejní, odpovídá výlučně uživatel. Uživatel dále odpovídá za to, že podklady, které do služby nahraje (loga, fotografie, texty), je oprávněn užít.</p>
                    </Section>

                    <Section n={12} title="Zakázané užití">
                        <p>Službu nelze používat k vytváření obsahu, který je protiprávní, klamavý, nenávistný, zasahuje do práv třetích osob, vydává se za jinou osobu nebo porušuje pravidla cílové sociální sítě. Rovněž je zakázáno obcházet technická omezení, automatizovaně zatěžovat službu nad rámec běžného užití nebo ji zpřístupňovat dalším osobám mimo rámec zvoleného tarifu.</p>
                    </Section>

                    <Section n={13} title="Dostupnost a omezení odpovědnosti">
                        <p>Poskytovatel usiluje o nepřetržitou dostupnost služby, negarantuje ji však bez výpadků. Služba je poskytována „tak, jak je“. Poskytovatel je oprávněn službu krátkodobě přerušit z důvodu údržby; o plánované odstávce informuje předem, je-li to možné.</p>
                        <p className="mt-3">Poskytovatel neodpovídá za výpadky služeb třetích stran (zejména Google, Supabase, Vercel, Meta, ComGate), které mohou dočasně ovlivnit funkčnost, ani za změny jejich podmínek či cen.</p>
                        <p className="mt-3">Poskytovatel negarantuje konkrétní obchodní výsledky (dosah, interakce, konverze, počet sledujících) dosažené s pomocí vygenerovaného obsahu.</p>
                        <p className="mt-3">Poskytovatel nahradí uživateli — podnikateli škodu maximálně do výše ceny zaplacené tímto uživatelem za posledních dvanáct měsíců. Toto omezení se <strong className="text-white/90">neuplatní vůči spotřebiteli</strong> ani v případě újmy způsobené úmyslně či z hrubé nedbalosti nebo újmy na přirozených právech člověka.</p>
                    </Section>

                    <Section n={14} title="Ochrana osobních údajů">
                        <p>Zpracování osobních údajů popisují samostatné <Link href="/privacy" className="text-white/80 underline">Zásady zpracování osobních údajů</Link>, které jsou nedílnou součástí těchto Podmínek.</p>
                    </Section>

                    <Section n={15} title="Mimosoudní řešení sporů (spotřebitelská)">
                        <p>Vznikne-li mezi poskytovatelem a spotřebitelem spor, který se nepodaří vyřešit dohodou, má spotřebitel právo obrátit se na subjekt mimosoudního řešení spotřebitelských sporů:</p>
                        <div className="mt-4 border border-white/10 bg-white/[0.02] p-5 not-prose">
                            <ul className="space-y-1.5 text-white/70 text-sm">
                                <li className="text-white font-bold">{CONSUMER_AUTHORITY.name}</li>
                                <li>{CONSUMER_AUTHORITY.department}</li>
                                <li>{CONSUMER_AUTHORITY.address}</li>
                                <li><a href={CONSUMER_AUTHORITY.adrWeb} target="_blank" rel="noopener noreferrer" className="text-white/80 underline">{CONSUMER_AUTHORITY.adrWeb}</a></li>
                                <li>E-mail: <a href={`mailto:${CONSUMER_AUTHORITY.email}`} className="text-white/80 underline">{CONSUMER_AUTHORITY.email}</a></li>
                            </ul>
                        </div>
                        <p className="mt-4">Dozor nad dodržováním povinností podle zákona o ochraně spotřebitele vykonává Česká obchodní inspekce. Dozor nad živnostenským oprávněním vykonává {LEGAL.registryOffice}.</p>
                    </Section>

                    <Section n={16} title="Změny podmínek">
                        <p>Poskytovatel je oprávněn tyto Podmínky změnit zejména při změně rozsahu služby, právních předpisů nebo podmínek dodavatelů. O podstatné změně informuje uživatele e-mailem <strong className="text-white/90">nejméně 14 dní předem</strong>.</p>
                        <p className="mt-3">Nesouhlasí-li uživatel se změnou, může předplatné do dne účinnosti změny zrušit; do konce zaplaceného období se na něj vztahuje dosavadní znění. Pokračováním v užívání služby po účinnosti změny uživatel se změnou souhlasí.</p>
                        <p className="mt-3">Změna ceny probíhajícího předplatného se uplatní až od následujícího zúčtovacího období a poskytovatel na ni upozorní předem.</p>
                    </Section>

                    <Section n={17} title="Závěrečná ustanovení">
                        <p>Právní vztahy neupravené těmito Podmínkami se řídí právním řádem České republiky, zejména zákonem č. 89/2012 Sb., občanský zákoník, a zákonem č. 634/1992 Sb., o ochraně spotřebitele. Volbou práva není spotřebitel zbaven ochrany podle práva státu svého obvyklého bydliště.</p>
                        <p className="mt-3">Je-li některé ustanovení Podmínek neplatné nebo neúčinné, nemá to vliv na platnost ostatních ustanovení.</p>
                        <p className="mt-3">Spory budou řešeny věcně a místně příslušnými soudy České republiky. Vůči spotřebiteli tím není dotčena příslušnost soudu podle jeho bydliště.</p>
                        <p className="mt-3">Tyto Podmínky nabývají účinnosti dne {EFFECTIVE_FROM}.</p>
                    </Section>
                </div>

                <div className="mt-16 pt-8 border-t border-white/10 text-[9px] text-white/20 font-bold uppercase tracking-widest">
                    © {new Date().getFullYear()} {LEGAL.name} — IČO {LEGAL.ico}
                </div>
            </div>
        </div>
    )
}
