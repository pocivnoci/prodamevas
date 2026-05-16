"use client"

import { createContext, useContext, useState, type ReactNode } from "react"

export type StudioSection =
    | "posts"
    | "calendar"
    | "feed"
    | "generate"
    | "ideas"
    | "reviews"
    | "brand"
    | "products"
    | "performance"
    | "settings"

interface StudioState {
    activeSection: StudioSection
    setActiveSection: (s: StudioSection) => void
    projectId: string
    setProjectId: (id: string) => void
}

const StudioContext = createContext<StudioState>({
    activeSection: "posts",
    setActiveSection: () => {},
    projectId: "",
    setProjectId: () => {},
})

export function StudioProvider({ children }: { children: ReactNode }) {
    const [activeSection, setActiveSection] = useState<StudioSection>("posts")
    const [projectId, setProjectId] = useState("")

    return (
        <StudioContext.Provider value={{ activeSection, setActiveSection, projectId, setProjectId }}>
            {children}
        </StudioContext.Provider>
    )
}

export function useStudio() {
    return useContext(StudioContext)
}
