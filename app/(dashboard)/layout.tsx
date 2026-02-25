import { redirect } from "next/navigation"
import { AdminSidebar } from "./AdminSidebar"
import { checkOnboardingStatus } from "@/app/onboarding/actions"

export const maxDuration = 300 // 5 minutes Vercel Serverless Function timeout

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
        <div className="min-h-screen bg-aisummit-bg text-aisummit-text selection:bg-aisummit-cinnabar/30 selection:text-white font-sans relative overflow-hidden">
            {/* Tech-Summit Structural Grid */}
            <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden transform-gpu">
                <div className="hidden md:block absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-aisummit-glow/10 rounded-full blur-[120px] opacity-50" style={{ transform: 'translateZ(0)' }}></div>
                <div className="hidden md:block absolute top-[20%] right-[-10%] w-[40%] h-[60%] bg-aisummit-glow/10 rounded-full blur-[120px] opacity-40" style={{ transform: 'translateZ(0)' }}></div>
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem]"></div>
            </div>

            <AdminSidebar />

            <main className="lg:pl-72 min-h-screen relative z-10 transition-all duration-300">
                <div className="p-4 sm:p-6 lg:p-12 mb-20 max-w-7xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    )
}

