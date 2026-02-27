"use client"

import { useState, useCallback } from "react"

/**
 * Custom hook for clipboard copy with visual feedback.
 * Replaces 11+ duplicate copyToClipboard patterns across tab components.
 */
export function useCopyToClipboard(resetMs = 2000) {
    const [copiedField, setCopiedField] = useState<string | null>(null)

    const copyToClipboard = useCallback(async (text: string, field: string) => {
        await navigator.clipboard.writeText(text)
        setCopiedField(field)
        setTimeout(() => setCopiedField(null), resetMs)
    }, [resetMs])

    return { copiedField, copyToClipboard }
}
