import { ReactNode } from 'react'

export const maxDuration = 300 // increased from 60 to 300 for heavy AI tasks

export default function OnboardingLayout({ children }: { children: ReactNode }) {
    return <>{children}</>
}
