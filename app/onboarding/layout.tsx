import { ReactNode } from 'react'

export const maxDuration = 300 // Vercel cap without a raised plan; bump to 800 when the plan allows it.

export default function OnboardingLayout({ children }: { children: ReactNode }) {
    return <>{children}</>
}
