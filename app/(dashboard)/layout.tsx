import { redirect } from "next/navigation"
import { AdminSidebar } from "./AdminSidebar"
import { StudioProvider } from "./StudioContext"
import { ErrorBoundary } from "./ErrorBoundary"
import { PaywallProvider } from "./PaywallProvider"
import { BillingBanner } from "./BillingBanner"
import { InstallBanner } from "@/components/InstallApp"
import { BottomNav } from "./BottomNav"
import { GestureShell } from "./GestureShell"
import { checkOnboardingStatus } from "@/app/onboarding/actions"

export const maxDuration = 800 // Vercel Pro cap (Fluid Compute)

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // Check if user needs onboarding (no client config yet)
    const { needsOnboarding } = await checkOnboardingStatus()
    if (needsOnboarding) {
        redirect("/onboarding")
    }

    return (
        <StudioProvider>
            <PaywallProvider>
            <div className="min-h-screen bg-aisummit-bg text-aisummit-text selection:bg-aisummit-cinnabar/30 selection:text-white font-sans relative overflow-hidden">
                {/* Tech-Summit Structural Grid */}
                <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden transform-gpu">
                    <div className="hidden md:block absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-aisummit-glow/10 rounded-full blur-[120px] opacity-50" style={{ transform: 'translateZ(0)' }}></div>
                    <div className="hidden md:block absolute top-[20%] right-[-10%] w-[40%] h-[60%] bg-aisummit-glow/10 rounded-full blur-[120px] opacity-40" style={{ transform: 'translateZ(0)' }}></div>
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem]"></div>
                </div>

                <AdminSidebar />
                <BottomNav />

                {/* Nahoře výřez a stavový řádek, dole navigační lišta a domovský
                    indikátor. Insety jsou v prohlížeči nulové — projeví se až
                    v aplikaci na ploše (`viewportFit: cover` + black-translucent).
                    Odsazení dole musí být PADDING: `mb-20`, které tu bylo, je margin
                    a fixed lišta by přes obsah stejně přelezla. */}
                <main className="lg:pl-72 min-h-[100dvh] relative z-10 transition-all duration-300 pt-[env(safe-area-inset-top)] pb-[calc(var(--studio-navbar-h)+env(safe-area-inset-bottom))]">
                    <div className="p-4 sm:p-6 lg:p-10 max-w-7xl mx-auto">
                        <BillingBanner />
                        <InstallBanner />
                        <GestureShell>
                            <ErrorBoundary>
                                {children}
                            </ErrorBoundary>
                        </GestureShell>
                    </div>
                </main>
            </div>
            </PaywallProvider>
        </StudioProvider>
    )
}
