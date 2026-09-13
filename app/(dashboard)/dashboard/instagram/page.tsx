"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useStudio } from "../../StudioContext"
import { navItem } from "../../nav"

// Tab components
import { DashboardTab } from "./tabs/DashboardTab"
import { PostsTab } from "./tabs/PostsTab"
import { GenerateTab } from "./tabs/GenerateTab"
import { PlanTab } from "./tabs/PlanTab"
import { InspirationTab } from "./tabs/InspirationTab"
import { ProductsTab } from "./tabs/ProductsTab"
import { BrandTab } from "./tabs/BrandTab"
import { PerformanceTab } from "./tabs/PerformanceTab"
import { OnboardTab } from "./tabs/OnboardTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { CalendarTab } from "./tabs/CalendarTab"
import { FeedTab } from "./tabs/FeedTab"
import { IdeasTab } from "./tabs/IdeasTab"
import { ReviewsTab } from "./tabs/ReviewsTab"
import { WaitlistTab } from "./tabs/WaitlistTab"
import { BrainTab } from "./tabs/BrainTab"
import { FaqTab } from "./tabs/FaqTab"
import { ApprovalsTab } from "./tabs/ApprovalsTab"
import { CompanyTab } from "./tabs/CompanyTab"
import { MailingTab } from "./tabs/MailingTab"
import { TasksTab } from "./tabs/TasksTab"
import { LeadsTab } from "./tabs/LeadsTab"
import { FinanceTab } from "./tabs/FinanceTab"
import { EmailsTab } from "./tabs/EmailsTab"
import { TutorialOverlay, useTutorialState } from "./tabs/TutorialOverlay"

/**
 * Popisek pod nadpisem sekce.
 *
 * **Titulek se sem nepíše** — bere se z `navItem(id).label`, tedy z registru
 * navigace. Dvě kopie názvu znamenaly, že se rozešly: `leads` ani `emails`
 * v téhle tabulce nebyly a obě sekce se otevíraly bez nadpisu.
 */
const SECTION_DESCRIPTIONS: Record<string, string> = {
    dashboard: "Váš přehled a rychlé akce",
    posts: "Všechny vygenerované příspěvky",
    plan: "Kalendář a feed náhled",
    calendar: "Naplánujte obsah na celý týden",
    feed: "Jak bude vypadat váš Instagram profil",
    generate: "Vytvořte nový příspěvek pomocí AI",
    inspiration: "Nápady a recenze pro tvorbu obsahu",
    ideas: "Banka nápadů na obsah",
    reviews: "Recenze zákazníků pro tvorbu obsahu",
    brand: "Referenční fotky vaší značky",
    products: "Produktové nápady a vizualizace",
    performance: "Jak si váš obsah vede",
    settings: "Konfigurace značky a systému",
    onboard: "Onboardujte nového klienta",
    waitlist: "Správa zájemců a zvacích kódů",
    brain: "Naučené vzorce z reálného výkonu",
    faq: "Časté dotazy a průvodce studiem",
    approvals: "Akce agentů čekající na vaše schválení",
    company: "Zdraví zákaznických účtů napříč tenanty",
    mailing: "Rozeslání e-mailu na segment (waitlist, klienti)",
    tasks: "Co je rozdělané, čí to je a co čeká",
    leads: "Evidence klientů — kontakty, schůzky, historie oslovení",
    finance: "Náklady a vklady firmy — ruční evidence, ne účetnictví",
    emails: "Šablony transakčních e-mailů a jejich náhledy",
}

/** Sekce bez vlastní položky v registru (sub-tab) si nadpis nese sama. */
const SUBSECTION_TITLES: Record<string, string> = {
    calendar: "Kalendář",
    feed: "Feed náhled",
    ideas: "Nápady",
    reviews: "Recenze",
}

export default function InstagramPage() {
    // Admin-only sections are gated in render, not just hidden in the sidebar —
    // otherwise anyone can deep-link them via URL hash (#waitlist, #mailing…).
    // Defense-in-depth: the server actions behind them keep their own guards.
    //
    // `isAdmin` jde z kontextu, ne z vlastního dotazu: jinak by na jednu stránku
    // byly dvě odpovědi na tutéž otázku a mohly by se lišit.
    const { activeSection, projectId, isAdmin, navDirection, refreshNonce } = useStudio()
    const sectionInfo = {
        title: navItem(activeSection)?.label ?? SUBSECTION_TITLES[activeSection] ?? "",
        description: SECTION_DESCRIPTIONS[activeSection] ?? "",
    }
    const { showTutorial, openTutorial, closeTutorial } = useTutorialState()

    // Dashboard has its own header
    const showHeader = activeSection !== "dashboard"

    return (
        <div className="space-y-6">
            {/* Content — header lives INSIDE the keyed block so the section title and its
                body switch together. Kept outside, the header updated instantly while the
                old body animated out, briefly showing the new title over the old content. */}
            <AnimatePresence mode="wait">
                <motion.div
                    // `refreshNonce` v klíči je celé tažení pro obnovení: změní se
                    // a tab se přemountuje, takže si data načte znovu sám. Jinak by
                    // se obnovování muselo dopisovat do každého z dvaceti tabů.
                    key={`${activeSection}:${refreshNonce}`}
                    className="space-y-6"
                    // Přejetí prstem posouvá do strany, klik ve svislé ose — aby
                    // pohyb odpovídal tomu, čím se sekce přepnula.
                    initial={navDirection ? { opacity: 0, x: navDirection * 40 } : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, x: 0, y: 0 }}
                    exit={navDirection ? { opacity: 0, x: navDirection * -40 } : { opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                >
                    {showHeader && (
                        <div>
                            {/* Na telefonu menší: `text-3xl` sežral přes dva řádky výšku,
                                kterou obsah potřebuje víc než nadpis. Popisek pod ním je
                                na malé obrazovce řádek navíc bez informace. */}
                            <h1 className="text-xl sm:text-3xl font-black uppercase tracking-tight text-white">{sectionInfo.title}</h1>
                            <p className="hidden sm:block text-white/40 mt-1 font-medium text-xs">{sectionInfo.description}</p>
                        </div>
                    )}
                    {activeSection === "dashboard" && <DashboardTab projectId={projectId} />}
                    {activeSection === "posts" && <PostsTab projectId={projectId} />}
                    {activeSection === "plan" && <PlanTab projectId={projectId} />}
                    {activeSection === "calendar" && <CalendarTab projectId={projectId} />}
                    {activeSection === "feed" && <FeedTab projectId={projectId} />}
                    {activeSection === "generate" && <GenerateTab projectId={projectId} />}
                    {activeSection === "inspiration" && <InspirationTab projectId={projectId} />}
                    {activeSection === "ideas" && <IdeasTab projectId={projectId} />}
                    {activeSection === "reviews" && <ReviewsTab projectId={projectId} />}
                    {activeSection === "products" && isAdmin && <ProductsTab projectId={projectId} />}
                    {activeSection === "brand" && <BrandTab projectId={projectId} />}
                    {activeSection === "performance" && <PerformanceTab projectId={projectId} />}
                    {activeSection === "settings" && <SettingsTab projectId={projectId} />}
                    {activeSection === "onboard" && isAdmin && <OnboardTab />}
                    {activeSection === "waitlist" && isAdmin && <WaitlistTab />}
                    {activeSection === "brain" && <BrainTab projectId={projectId} />}
                    {activeSection === "faq" && <FaqTab onReplayTutorial={openTutorial} />}
                    {activeSection === "approvals" && isAdmin && <ApprovalsTab />}
                    {activeSection === "company" && isAdmin && <CompanyTab />}
                    {activeSection === "mailing" && isAdmin && <MailingTab />}
                    {activeSection === "tasks" && isAdmin && <TasksTab />}
                    {activeSection === "leads" && isAdmin && <LeadsTab />}
                    {activeSection === "finance" && isAdmin && <FinanceTab />}
                    {activeSection === "emails" && isAdmin && <EmailsTab />}
                </motion.div>
            </AnimatePresence>

            {/* Tutorial Overlay */}
            <TutorialOverlay isOpen={showTutorial} onClose={closeTutorial} />
        </div>
    )
}
