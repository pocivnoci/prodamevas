import React from "react"

/**
 * Chrlit logomark — uses the transparent SVG logo.
 */
export function LogoPV({ className = "w-8 h-8", style }: { className?: string; style?: React.CSSProperties }) {
    return (
        <img
            src="/chrlit-logo-transparent.svg"
            alt="Chrlit"
            className={className}
            style={style}
        />
    )
}
