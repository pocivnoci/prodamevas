"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useStudio } from "../../StudioContext"

// Tab components
import { DashboardTab } from "./tabs/DashboardTab"
import { PostsTab } from "./tabs/PostsTab"
import { GenerateTab } from "./tabs/GenerateTab"
import { PlanTab } from "./tabs/PlanTab"
import { InspirationTab } from "./tabs/InspirationTab"
import { ProductsTab } from "./tabs/ProductsTab"
import { BrandTab } from "./tabs/BrandTab"
import { PerformanceTab } from "./tabs/PerformanceTab"
import { LogsTab } from "./tabs/LogsTab"
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
import { MailingTab } from "./tabs/MailingTab"
import { TutorialOverlay, useTutorialState } from "./tabs/TutorialOverlay"

// Section labels for header
const SECTION_LABELS: Record<string, { title: string; description: string }> = {
    dashboard: { title: "Dashboard", description: "Váš přehled a rychlé akce" },
    posts: { title: "Příspěvky", description: "Všechny vygenerované příspěvky" },
    plan: { title: "Plán", description: "Kalendář a feed náhled" },
    calendar: { title: "Kalendář", description: "Naplánujte obsah na celý týden" },
    feed: { title: "Feed náhled", description: "Jak bude vypadat váš Instagram profil" },
    generate: { title: "Generovat", description: "Vytvořte nový příspěvek pomocí AI" },
    inspiration: { title: "Inspirace", description: "Nápady a recenze pro tvorbu obsahu" },
    ideas: { title: "Nápady", description: "Banka nápadů na obsah" },
    reviews: { title: "Recenze", description: "Recenze zákazníků pro tvorbu obsahu" },
    brand: { title: "Fotky značky", description: "Referenční fotky vaší značky" },
    products: { title: "Produkty", description: "Produktové nápady a vizualizace" },
    performance: { title: "Výkon", description: "Jak si váš obsah vede" },
    settings: { title: "Nastavení", description: "Konfigurace značky a systému" },
    onboard: { title: "Onboarding", description: "Onboardujte nového klienta" },
    waitlist: { title: "Waitlist", description: "Správa zájemců a zvacích kódů" },
    brain: { title: "Paměť", description: "Naučené vzorce z reálného výkonu" },
    faq: { title: "FAQ", description: "Časté dotazy a nápověda" },
    approvals: { title: "Schválení", description: "Akce agentů čekající na vaše schválení" },
    mailing: { title: "Mailing", description: "Rozeslání e-mailu na segment (waitlist, klienti)" },
}

export default function InstagramPage() {
    const { activeSection, projectId } = useStudio()
    const sectionInfo = SECTION_LABELS[activeSection] || { title: "", description: "" }
    const { showTutorial, openTutorial, closeTutorial } = useTutorialState()

    // Dashboard has its own header
    const showHeader = activeSection !== "dashboard"

    return (
        <div className="space-y-6">
            {/* Section Header */}
            {showHeader && (
                <div>
                    <h1 className="text-3xl font-black uppercase tracking-tight text-white">{sectionInfo.title}</h1>
                    <p className="text-white/40 mt-1 font-medium text-xs">{sectionInfo.description}</p>
                </div>
            )}

            {/* Content */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeSection}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                >
                    {activeSection === "dashboard" && <DashboardTab projectId={projectId} onOpenTutorial={openTutorial} />}
                    {activeSection === "posts" && <PostsTab projectId={projectId} />}
                    {activeSection === "plan" && <PlanTab projectId={projectId} />}
                    {activeSection === "calendar" && <CalendarTab projectId={projectId} />}
                    {activeSection === "feed" && <FeedTab projectId={projectId} />}
                    {activeSection === "generate" && <GenerateTab projectId={projectId} />}
                    {activeSection === "inspiration" && <InspirationTab projectId={projectId} />}
                    {activeSection === "ideas" && <IdeasTab projectId={projectId} />}
                    {activeSection === "reviews" && <ReviewsTab projectId={projectId} />}
                    {activeSection === "products" && <ProductsTab projectId={projectId} />}
                    {activeSection === "brand" && <BrandTab projectId={projectId} />}
                    {activeSection === "performance" && <PerformanceTab projectId={projectId} />}
                    {activeSection === "settings" && <SettingsTab projectId={projectId} />}
                    {activeSection === "onboard" && <OnboardTab />}
                    {activeSection === "waitlist" && <WaitlistTab />}
                    {activeSection === "brain" && <BrainTab projectId={projectId} />}
                    {activeSection === "faq" && <FaqTab />}
                    {activeSection === "approvals" && <ApprovalsTab projectId={projectId} />}
                    {activeSection === "mailing" && <MailingTab />}
                </motion.div>
            </AnimatePresence>

            {/* Tutorial Overlay */}
            <TutorialOverlay isOpen={showTutorial} onClose={closeTutorial} />
        </div>
    )
}
