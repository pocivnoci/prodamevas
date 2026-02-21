import React from "react"

export function LogoPV({ className = "w-8 h-8", style }: { className?: string; style?: React.CSSProperties }) {
    return (
        <svg
            viewBox="0 0 240 240"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            style={style}
        >
            {/* Bold Geometric P */}
            <path d="M40 40 H 95 C 145 40 160 60 160 90 C 160 120 145 140 95 140 H 80 V 200 H 40 V 40 Z M 80 75 V 105 H 90 C 110 105 115 95 115 90 C 115 85 110 75 90 75 H 80 Z" />
            {/* Checkmark V */}
            <path d="M115 110 L 155 200 L 230 40 H 190 L 148 140 L 138 110 Z" />
        </svg>
    )
}
