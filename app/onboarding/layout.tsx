import { ReactNode } from 'react'

export const maxDuration = 800 // heavy AI tasks now on Pro (analysis + config + custom formats); needs Vercel plan allowing >300s

export default function OnboardingLayout({ children }: { children: ReactNode }) {
    return <>{children}</>
}
