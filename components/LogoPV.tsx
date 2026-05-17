import React from "react"
import Image from "next/image"

/**
 * Chrlit logomark — uses the generated PNG icon.
 * Falls back to a red square with "C" if image fails.
 */
export function LogoPV({ className = "w-8 h-8", style }: { className?: string; style?: React.CSSProperties }) {
    return (
        <Image
            src="/chrlit-icon.png"
            alt="Chrlit"
            width={32}
            height={32}
            className={className}
            style={style}
            priority
        />
    )
}
