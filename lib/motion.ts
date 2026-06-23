/**
 * Shared motion tokens + variants — one rhythm for the whole marketing site.
 *
 * Restrained & professional: scroll-reveal once, spring micro-interactions, no
 * decorative infinite loops. Durations follow the UX audit (micro 150–300ms,
 * complex ≤400ms; exits ~60–70% of enter). Always pair with `useReducedMotion()`
 * — see components/Reveal.tsx — so motion-sensitive users get final states instantly.
 */

import type { Variants, Transition } from "framer-motion"

// The single easing curve used everywhere (was scattered/inconsistent before).
export const EASE_OUT = [0.16, 1, 0.3, 1] as const

export const DUR = {
  fast: 0.18,
  base: 0.3,
  slow: 0.45,
} as const

// Snappy spring for press/hover micro-interactions on cards & buttons.
export const SPRING: Transition = { type: "spring", stiffness: 400, damping: 30 }

// Section / element entrance — fade up a touch.
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.slow, ease: EASE_OUT },
  },
}

// Wrap a group; children using `fadeUp` reveal in sequence (40ms apart — audit rule).
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
}
