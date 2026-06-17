import { ReactNode } from 'react'

export const maxDuration = 800 // Vercel Pro cap (Fluid Compute) — website + Instagram scraping + config gen.

export default function OnboardingLayout({ children }: { children: ReactNode }) {
    return <>{children}</>
}
