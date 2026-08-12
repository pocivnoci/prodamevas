"use client"

import { StudioNavPanel } from "./StudioNavPanel"

/**
 * Postranní sloupec — **jen na počítači**. Mobilní vrstva (hamburger vpravo nahoře,
 * vyjíždějící panel a backdrop) je pryč; na telefonu se naviguje spodní lištou
 * (`BottomNav`), která tentýž obsah otevírá zdola pod „Více".
 *
 * Tlačítko „Obnovit", které tu vedle hamburgeru sedělo a pletlo se s ním, taky
 * zmizelo — nahradilo ho tažení dolů. V panelu zůstává jako „Aktualizovat".
 */
export function AdminSidebar() {
    return (
        <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-72 bg-[#050505]/95 backdrop-blur-2xl border-r border-white/10 flex-col z-[58]">
            <StudioNavPanel variant="sidebar" />
        </aside>
    )
}
