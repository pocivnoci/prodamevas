"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useStudio } from "../../StudioContext"

// Tab components
import { PostsTab } from "./tabs/PostsTab"
import { GenerateTab } from "./tabs/GenerateTab"
import { IdeasTab } from "./tabs/IdeasTab"
import { ReviewsTab } from "./tabs/ReviewsTab"
import { ProductsTab } from "./tabs/ProductsTab"
import { BrandTab } from "./tabs/BrandTab"
import { PerformanceTab } from "./tabs/PerformanceTab"
import { LogsTab } from "./tabs/LogsTab"
import { OnboardTab } from "./tabs/OnboardTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { CalendarTab } from "./tabs/CalendarTab"
import { FeedTab } from "./tabs/FeedTab"

// Section labels for header
const SECTION_LABELS: Record<string, { title: string; description: string }> = {
    posts: { title: "Příspěvky", description: "Všechny vygenerované příspěvky" },
    calendar: { title: "Kalendář", description: "Naplánujte obsah na celý týden" },
    feed: { title: "Feed náhled", description: "Jak bude vypadat váš Instagram profil" },
    generate: { title: "Generovat", description: "Vytvořte nový příspěvek pomocí AI" },
    ideas: { title: "Nápady", description: "Banka nápadů na obsah" },
    reviews: { title: "Recenze", description: "Recenze zákazníků pro tvorbu obsahu" },
    brand: { title: "Brand fotky", description: "Referenční fotky vaší značky" },
    products: { title: "Produkty", description: "Produktové nápady a vizualizace" },
    performance: { title: "Výkon", description: "Jak si váš obsah vede" },
    settings: { title: "Nastavení", description: "Konfigurace značky a systému" },
    onboard: { title: "Onboarding", description: "Onboardujte nového klienta" },
}

export default function InstagramPage() {
    const { activeSection, projectId } = useStudio()
    const sectionInfo = SECTION_LABELS[activeSection] || { title: "", description: "" }

    return (
        <div className="space-y-6">
            {/* Section Header */}
            <div>
                <h1 className="text-3xl font-black uppercase tracking-tight text-white">{sectionInfo.title}</h1>
                <p className="text-white/40 mt-1 font-medium text-xs">{sectionInfo.description}</p>
            </div>

            {/* Content */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeSection}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                >
                    {activeSection === "posts" && <PostsTab projectId={projectId} />}
                    {activeSection === "calendar" && <CalendarTab projectId={projectId} />}
                    {activeSection === "feed" && <FeedTab projectId={projectId} />}
                    {activeSection === "generate" && <GenerateTab projectId={projectId} />}
                    {activeSection === "ideas" && <IdeasTab projectId={projectId} />}
                    {activeSection === "reviews" && <ReviewsTab projectId={projectId} />}
                    {activeSection === "products" && <ProductsTab projectId={projectId} />}
                    {activeSection === "brand" && <BrandTab projectId={projectId} />}
                    {activeSection === "performance" && <PerformanceTab projectId={projectId} />}
                    {activeSection === "settings" && <SettingsTab projectId={projectId} />}
                    {activeSection === "onboard" && <OnboardTab />}
                </motion.div>
            </AnimatePresence>
        </div>
    )
}
