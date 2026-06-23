"use client"

/**
 * Reveal — scroll-triggered entrance, used once per element. Respects
 * prefers-reduced-motion: when the user asks for less motion, children render at
 * their final state with no transform (the audit's High-severity Reduced Motion rule).
 *
 *   <Reveal>…</Reveal>                       // single fade-up on view
 *   <Reveal stagger>…children…</Reveal>      // container that staggers fadeUp children
 *
 * For staggered children, give each child `variants={fadeUp}`.
 */

import { motion, useReducedMotion } from "framer-motion"
import type { HTMLAttributes } from "react"
import { fadeUp, staggerContainer } from "@/lib/motion"

// Plain DOM attributes minus the handlers whose signatures clash with framer-motion's.
type RevealProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "onAnimationStart" | "onAnimationEnd" | "onDrag" | "onDragStart" | "onDragEnd"
> & {
  /** Use the stagger container instead of a single fadeUp (children must set variants={fadeUp}). */
  stagger?: boolean
  /** Fraction of the element visible before it triggers. */
  amount?: number
}

export function Reveal({ stagger = false, amount = 0.2, children, ...rest }: RevealProps) {
  const reduce = useReducedMotion()

  // Reduced motion → no entrance animation at all, just render the content.
  if (reduce) {
    return <div {...rest}>{children}</div>
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount, margin: "-10% 0px" }}
      variants={stagger ? staggerContainer : fadeUp}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
