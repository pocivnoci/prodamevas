"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown } from "lucide-react"

// ─── FAQ Data ────────────────────────────────────────────────

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
                a: "Post = 1 kredit. Varianta = 1 kredit. Generování nápadů = 1 kredit. Produktová vizualizace = 2 kredity. Design pro tisk = 3 kredity. Mockup = 2 kredity. Business Brief = 5 kreditů.",
            },
            {
                q: "Co se stane, když mi dojdou kredity?",
                a: "Nemůžete generovat další obsah, dokud si nedokoupíte kredity nebo nečekáte na reset v dalším měsíci. Existující posty zůstávají — nic se nesmaže.",
            },
            {
                q: "Jak funguje dobíjení kreditů?",
                a: "Kdykoli si můžete dokoupit extra kredity za 15 Kč/ks. Jdete do Nastavení → Předplatné a dobíjete. Kredity se přičtou okamžitě.",
            },
            {
                q: "Převádí se nevyčerpané kredity do dalšího měsíce?",
                a: "Ne. Každý měsíc dostanete kredity podle svého plánu (Start 15, Růst 40, Dominance 100). Nevyčerpané kredity propadnou. Pokud potřebujete víc, dobijte si je za 15 Kč/ks.",
            },
            {
                q: "Jak funguje trial?",
                a: "3 posty zdarma, bez kreditky a bez časového limitu. Z plánu obsahu máte 3 příspěvky plně odemčené k vyzkoušení; zbytek se odemkne po výběru plánu. Nic se nesmaže — vygenerované posty vám zůstanou.",
            },
            {
                q: "Jaké jsou plány a jak si dobiju kredity?",
                a: "Tři plány: Start (490 Kč, 15 kreditů — obrázky a carousely), Růst (990 Kč, 40 kreditů — navíc A/B varianty, reels a růstový dashboard) a Dominance (1 990 Kč, 100 kreditů — navíc product studio a prioritní generování). Když kredity dojdou, dobijete si je za 15 Kč/ks v Nastavení → Předplatné.",
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
                a: "Funkce pro e-shopy a značky s produkty. AI navrhne nové produktové nápady, vygeneruje design pro tisk (trička, hrnky...), vytvoří realistické mockupy a může připravit celý Business Brief s analýzou trhu.",
            },
            {
                q: "Jak fungují mockupy?",
                a: "AI vygeneruje fotorealistický obrázek produktu — tričko na modelce, hrnek na stole, krabička v kontextu. Ideální pro testování nových designů nebo prezentaci zákazníkům.",
            },
            {
                q: "Co je Design pro tisk?",
                a: "AI vytvoří grafický design optimalizovaný pro tisk na produkty — trička, plakáty, samolepky. Výstup je ve vysokém rozlišení s průhledným pozadím.",
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
                a: "Nechte AI vygenerovat dávku nápadů pro konkrétní téma (Dosah, Hodnota, Konverze...). Pak je projděte a ty nejlepší použijte jako základ pro generování postů. Je to rychlejší než vymýšlet témata od nuly.",
            },
        ],
    },
]

// ─── Component ───────────────────────────────────────────────

export function FaqTab() {
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
