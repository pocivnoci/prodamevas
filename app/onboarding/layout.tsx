import { ReactNode } from 'react'
import { UiLocaleProvider } from '@/components/i18n/UiLocaleProvider'

export const maxDuration = 800 // Vercel Pro cap (Fluid Compute) — website + Instagram scraping + config gen.

export default function OnboardingLayout({ children }: { children: ReactNode }) {
    return <UiLocaleProvider>{children}</UiLocaleProvider>
}
