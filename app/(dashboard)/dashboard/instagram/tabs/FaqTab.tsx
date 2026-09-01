"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown } from "lucide-react"
import { EXTRA_CREDIT_HALERU, FALLBACK_PLANS, formatCzk } from "@/lib/pricing"

// ─── FAQ Data ────────────────────────────────────────────────

/**
 * Věta o tarifech se skládá z ceníku, ne z ruky.
 *
 * Do 9/2026 tu stály ceny natvrdo a přežily přecenění na v6 — zákazník tak četl
 * v nápovědě jinou cenu, než jakou mu naúčtovala pokladna. Copy zůstává tady
 * (je to marketingový text, ne data), čísla chodí z `lib/pricing.ts`.
 */
const PLAN_BLURB: Record<string, string> = {
    chrlit_start: "obrázky a carousely",
    chrlit_rust: "navíc A/B varianty, reels a růstový dashboard",
    chrlit_dominance: "navíc product studio a prioritní generování",
    // Ne „pro agentury a e-shopy": víc profilů na účet není implementované ani
    // vynucované, takže by to prodávalo něco, co zákazník nedostane.
    chrlit_imperium: "nejvyšší objem pro jednu značku",
}

/** „Start 20, Růst 70, Dominance 130, Impérium 260" — také z ceníku, ne z ruky. */
function creditsSentence(): string {
    return FALLBACK_PLANS.map((p) => `${p.name} ${p.creditsPerMonth}`).join(", ")
}

function plansSentence(): string {
    const list = FALLBACK_PLANS.map(
        (p) => `${p.name} (${formatCzk(p.monthlyHaleru)}, ${p.creditsPerMonth} kreditů — ${PLAN_BLURB[p.id] ?? ""})`,
    )
    const last = list.pop()
    return `Čtyři plány: ${list.join(", ")} a ${last}.`
}

interface FaqItem {
    q: string
    a: string
}

interface FaqCategory {
    id: string
    emoji: string
    label: string
    items: FaqItem[]
}

const FAQ_CATEGORIES: FaqCategory[] = [
    {
        id: "generating",
        emoji: "🚀",
        label: "Generování obsahu",
        items: [
            {
                q: "Jak funguje generování příspěvků?",
                a: "AI přečte vaši brand konfiguraci (tón komunikace, barvy, produkty, témata obsahu) a na základě toho vygeneruje caption, obrázek a hashtagy. Výsledek odpovídá vaší značce — používá vaše barvy, font a styl komunikace.",
            },
            {
                q: "Proč je výsledek pokaždé jiný?",
                a: "AI generuje obsah s určitou mírou kreativity (temperature). To je záměr — chcete různorodý feed, ne opakující se šablony. Pokud chcete konzistentní styl, upřesněte brand voice v nastavení.",
            },
            {
                q: "Co ovlivní kvalitu výstupu?",
                a: "Hlavně kvalita konfigurace. Čím detailnější máte styl textu (persona, tón komunikace, co neříkáme), témata s kategoriemi, a šablony úvodních vět — tím přesnější výstup dostanete. Investice do nastavení se vyplatí.",
            },
            {
                q: "Jak funguje batch generování?",
                a: "Můžete vygenerovat více postů najednou (např. celý týden). Posty se generují sekvenčně — jeden po druhém — aby se zachovala kvalita a různorodost. Každý post stojí 1 kredit.",
            },
            {
                q: "Co znamenají různé typy postů?",
                a: "Chrlit podporuje typy jako tip, meme, carousel, behind_scenes, product_drop, recenze, challenge a další. Každý typ má jiný tón a formát — tip je edukativní, meme je vtipný, product_drop je prodejní. Typy jsou definované ve vaší konfiguraci.",
            },
            {
                q: "Můžu regenerovat jen obrázek nebo jen text?",
                a: "Ano. U každého postu máte varianty — můžete vygenerovat nový obrázek se stejným textem, nebo nový text ke stejnému obrázku. Varianta stojí 1 kredit.",
            },
        ],
    },
    {
        id: "credits",
        emoji: "💳",
        label: "Kredity & plán",
        items: [
            {
                q: "Kolik stojí jedna akce?",
                a: "Post = 1 kredit. Varianta = 1 kredit. Generování nápadů = 1 kredit. Produktová vizualizace = 2 kredity. Design pro tisk = 3 kredity. Mockup = 2 kredity. Business Brief = 5 kreditů. Celá produktová řada = 8 kreditů.",
            },
            {
                q: "Co se stane, když mi dojdou kredity?",
                a: "Nemůžete generovat další obsah, dokud si nedokoupíte kredity nebo nečekáte na reset v dalším měsíci. Existující posty zůstávají — nic se nesmaže.",
            },
            {
                q: "Jak funguje dobíjení kreditů?",
                a: "Kdykoli si můžete dokoupit extra kredity za 49 Kč/ks. Jdete do Nastavení → Předplatné a dobíjete. Kredity se přičtou okamžitě.",
            },
            {
                q: "Převádí se nevyčerpané kredity do dalšího měsíce?",
                a: `Ne. Každý měsíc dostanete kredity podle svého plánu (${creditsSentence()}). Nevyčerpané kredity propadnou. Pokud potřebujete víc, dobijte si je za ${formatCzk(EXTRA_CREDIT_HALERU)}/ks.`,
            },
            {
                q: "Jak funguje trial?",
                a: "3 posty zdarma, bez kreditky a bez časového limitu. Z plánu obsahu máte 3 příspěvky plně odemčené k vyzkoušení; zbytek se odemkne po výběru plánu. Nic se nesmaže — vygenerované posty vám zůstanou.",
            },
            {
                q: "Jaké jsou plány a jak si dobiju kredity?",
                a: `${plansSentence()} Ceny jsou měsíční; při delším období platíte míň. Když kredity dojdou, dobijete si je za ${formatCzk(EXTRA_CREDIT_HALERU)}/ks v Nastavení → Předplatné.`,
            },
            {
                q: "Jak funguje placení na 3, 6 nebo 12 měsíců?",
                a: "Zaplatíte jednou dopředu a máte klid. Za čtvrt roku ušetříte 5 %, za půl roku 10 % a za rok platíte jen deset měsíců — dva jsou zdarma. Cenu máte navíc zamčenou na celé období: i kdyby se ceník mezitím zvedl, vás se to dotkne až při obnově. Kredity se přitom obnovují každý měsíc úplně stejně jako u měsíčního plánu.",
            },
            {
                q: "Co když si to rozmyslím po zaplacení na rok?",
                a: "Máte 30 dní na rozmyšlenou — napište nám a peníze vrátíme, bez udání důvodu. Po té lhůtě předplacené období doběhne; předplatné jde kdykoli vypovědět k jeho konci, takže se další období už nestrhne.",
            },
            {
                q: "Můžu uprostřed předplaceného období přejít na vyšší tarif?",
                a: "Ano, ale ne jedním klikem — napsali bychom vám tím zbytek zaplaceného období k dobru a to musíme udělat ručně. Napište nám a zbývající období převedeme do nového tarifu.",
            },
        ],
    },
    {
        id: "settings",
        emoji: "⚙️",
        label: "Nastavení & konfigurace",
        items: [
            {
                q: "Jak změním tón komunikace?",
                a: "V Nastavení → Styl textu. Upravte personu, voice traits a anti-patterns. Změny se projeví u všech nově generovaných postů. Existující posty zůstávají beze změny.",
            },
            {
                q: "Jak přidám nový produkt?",
                a: "V Nastavení → Produkty. Přidejte název, typ, cenu a popis. AI ho pak bude používat v product_drop postech a produktových vizualizacích.",
            },
            {
                q: "Můžu změnit barvy a gradient?",
                a: "Ano, v Nastavení → Vizuální identita. Změníte overlay gradient (3 barvy), font, accent color a celkový feel feedu. Doporučujeme tmavší, syté barvy — bílý text musí být čitelný.",
            },
            {
                q: "Co jsou témata obsahu?",
                a: "Témata definují strategii obsahu: Dosah (virální obsah), Hodnota (edukace), Konverze (prodej), Propojení (komunita). Každé téma má poměr (kolik % obsahu), post typy a kategorie. AI podle nich vybírá, co generovat.",
            },
            {
                q: "Jak fungují šablony úvodních vět?",
                a: "Šablony úvodních vět jsou vzory pro první řádek captionů — to, co zaujme v feedu. Příklady: '{{téma}}? Tohle nikdo neříká.' nebo '3 chyby, které děláš s {{produkt}}'. AI je používá jako inspiraci, ne doslova.",
            },
            {
                q: "Jak spustím re-onboarding?",
                a: "V Nastavení úplně dole najdete tlačítko Re-onboarding. AI znovu analyzuje váš web a přegeneruje celou konfiguraci. Stávající posty se neztratí.",
            },
        ],
    },
    {
        id: "products",
        emoji: "🛍️",
        label: "Produkty & vizualizace",
        items: [
            {
                q: "Co je produktový pipeline?",
                a: "Funkce pro e-shopy a značky s produkty. AI navrhne celou produktovou řadu jako systém (každý produkt dostane svůj krok, roli a místo v cenovém žebříčku), nebo jednotlivé produktové nápady. Ke schváleným produktům pak vygeneruje tiskovou grafiku, mockupy a Business Brief s analýzou nákladů a marží.",
            },
            {
                q: "Jak fungují mockupy?",
                a: "AI vygeneruje fotorealistický obrázek produktu — tričko na modelce, hrnek na stole, krabička v kontextu. Ideální pro testování nových designů nebo prezentaci zákazníkům.",
            },
            {
                q: "Co je Design pro tisk?",
                a: "AI vytvoří plochou tiskovou grafiku pro produkty a obaly — trička, plakáty, etikety lahví, ovinové etikety. Výstup je PNG doškálované na fyzický rozměr při 300 DPI, u potisků s průhledným pozadím, plus náhled s vyznačenou spadávkou a bezpečným okrajem a textové zadání pro tiskárnu. Je to podklad pro tiskaře, ne hotová produkční data: barvy jsou v RGB a pro velké formáty je potřeba grafiku převést do vektorů.",
            },
            {
                q: "Můžu použít vygenerované obrázky komerčně?",
                a: "Ano. Všechny AI-generované obrázky jsou vaše — můžete je používat na Instagramu, webu, v reklamách i na produktech. Chrlit si nenárokuje žádná práva na vygenerovaný obsah.",
            },
        ],
    },
    {
        id: "tips",
        emoji: "💡",
        label: "Tipy & triky",
        items: [
            {
                q: "Jak dostanu lepší výsledky?",
                a: "1) Vyplňte detailní styl textu — hlavně co neříkáme (co nepoužívat). 2) Přidejte fotky značky — AI se z nich učí styl. 3) Používejte kategorie v tématech pro cílenější obsah. 4) Pravidelně kontrolujte Paměť — AI se učí z výkonu.",
            },
            {
                q: "Kolik postů na týden je optimální?",
                a: "Pro většinu značek 3-5 postů týdně. Méně a ztrácíte viditelnost, víc a riskujete únavu publika. Chrlit vám pomůže udržet konzistenci bez stresu.",
            },
            {
                q: "Jak funguje AI Paměť (Brain)?",
                a: "Chrlit analyzuje výkon vašich postů (liky, komentáře, uložení) a učí se, co funguje. Postupně přizpůsobuje strategii — víc obsahu, který rezonuje, méně toho, co nefunguje. Čím déle ho používáte, tím lepší výsledky.",
            },
            {
                q: "Můžu generovat obsah v jiném jazyce než češtině?",
                a: "Aktuálně je Chrlit optimalizovaný pro češtinu. Brand voice, hook templates a CTA jsou generované česky. Podpora dalších jazyků je v plánu.",
            },
            {
                q: "Jak nejlépe využít Nápady?",
                a: "Nápady jsou zásobník témat, ze kterého si AI sama bere náměty pro nové příspěvky. Nechte AI vygenerovat dávku nápadů pro konkrétní téma (Dosah, Hodnota, Konverze...), projděte je a slabé vypněte nebo smažte. Nápad můžete také ručně vybrat při generování — příspěvek se pak započítá do jeho výkonu.",
            },
            {
                q: "Co se stane s nápadem po použití?",
                a: "Nic se nemaže. Použitý nápad si dá pauzu (cooldown), aby se váš feed neopakoval, a po ní se vrací do hry. Nápady, které mají dobré výsledky, si AI vybírá častěji — poznáte je podle štítku 🔥 Funguje. Nápad můžete kdykoli vypnout nebo smazat.",
            },
        ],
    },
]

// ─── Component ───────────────────────────────────────────────

export function FaqTab({ onReplayTutorial }: { onReplayTutorial?: () => void }) {
    const [activeCategory, setActiveCategory] = useState(FAQ_CATEGORIES[0].id)
    const [openIndex, setOpenIndex] = useState<number | null>(null)

    const currentCategory = FAQ_CATEGORIES.find(c => c.id === activeCategory) || FAQ_CATEGORIES[0]

    return (
        <div className="space-y-6">
            {/* Category tabs */}
            <div className="flex flex-wrap gap-2">
                {FAQ_CATEGORIES.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => {
                            setActiveCategory(cat.id)
                            setOpenIndex(null)
                        }}
                        className={`px-4 py-2.5 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center gap-2 ${
                            activeCategory === cat.id
                                ? "bg-white/10 text-white border border-white/15"
                                : "bg-white/[0.02] text-white/40 border border-white/5 hover:text-white/60 hover:border-white/10"
                        }`}
                    >
                        <span className="text-sm">{cat.emoji}</span>
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Questions accordion */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeCategory}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-1.5"
                >
                    {currentCategory.items.map((item, i) => {
                        const isOpen = openIndex === i
                        return (
                            <div
                                key={i}
                                className={`border rounded-sm overflow-hidden transition-colors duration-300 ${
                                    isOpen
                                        ? "border-white/15 bg-white/[0.03]"
                                        : "border-white/5 bg-[#0a0a0a] hover:border-white/10"
                                }`}
                            >
                                <button
                                    onClick={() => setOpenIndex(isOpen ? null : i)}
                                    className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer group"
                                >
                                    <span
                                        className={`text-xs font-bold transition-colors ${
                                            isOpen ? "text-white" : "text-white/50 group-hover:text-white/70"
                                        }`}
                                    >
                                        {item.q}
                                    </span>
                                    <motion.div
                                        animate={{ rotate: isOpen ? 180 : 0 }}
                                        transition={{ duration: 0.25 }}
                                        className="ml-3 flex-shrink-0"
                                    >
                                        <ChevronDown
                                            className={`w-3.5 h-3.5 transition-colors ${
                                                isOpen ? "text-aisummit-cinnabar" : "text-white/15"
                                            }`}
                                        />
                                    </motion.div>
                                </button>
                                <AnimatePresence initial={false}>
                                    {isOpen && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                                            className="overflow-hidden"
                                        >
                                            <div className="px-5 pb-4 border-t border-white/5">
                                                <p className="text-white/35 text-xs leading-relaxed pt-3">
                                                    {item.a}
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )
                    })}
                </motion.div>
            </AnimatePresence>

            {/* Replay onboarding tour */}
            {onReplayTutorial && (
                <div className="border border-white/5 rounded-sm p-5 bg-white/[0.01] flex items-center justify-between gap-4">
                    <div>
                        <p className="text-[10px] text-white/25 font-bold uppercase tracking-widest mb-1">
                            Průvodce studiem
                        </p>
                        <p className="text-xs text-white/40">
                            Znovu si projděte úvodní přehled funkcí.
                        </p>
                    </div>
                    <button
                        onClick={onReplayTutorial}
                        className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/60 border border-white/10 rounded-sm hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                    >
                        ▶ Přehrát průvodce
                    </button>
                </div>
            )}

            {/* Help footer */}
            <div className="border border-white/5 rounded-sm p-5 bg-white/[0.01] text-center">
                <p className="text-[10px] text-white/25 font-bold uppercase tracking-widest mb-1">
                    Nenašli jste odpověď?
                </p>
                <p className="text-xs text-white/40">
                    Napište nám na{" "}
                    <a href="mailto:info@chrlit.cz" className="text-aisummit-cinnabar hover:text-aisummit-cinnabar/80 transition-colors">
                        info@chrlit.cz
                    </a>
                </p>
            </div>
        </div>
    )
}
