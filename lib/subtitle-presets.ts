/**
 * Popisky presetů titulků pro UI (Nastavení i detail příspěvku).
 * ==============================================================
 * Vzhled samotný žije v `instagram/reel-subtitles.ts` (`SUBTITLE_PRESETS`) — tady
 * jsou jen česká jména a jedna věta, proč si preset vybrat. Oddělené proto, že
 * `reel-subtitles.ts` patří k enginu a klientské komponenty z něj nic tahat nemají.
 *
 * Jména presetů musí odpovídat `SubtitlePreset` — typ to hlídá při buildu.
 */
import type { SubtitlePreset } from "@/instagram/configs/types"

export const SUBTITLE_PRESET_OPTIONS: { id: SubtitlePreset; label: string; description: string }[] = [
    { id: "pop", label: "Zvýraznění", description: "Větší písmo a právě mluvené slovo v barvě značky. Dnešní standard reelů — výchozí." },
    { id: "classic", label: "Klasické", description: "Bílý text s obrysem a jemným podkladem. Čitelné na všem, nepřebíjí obraz." },
    { id: "cards", label: "Karty", description: "Velké písmo v plném boxu, po pár slovech. Drží pozornost i bez zvuku." },
    { id: "minimal", label: "Minimal", description: "Jen tenký obrys, žádný podklad. Nejmíň ruší, ale na světlé scéně se ztrácí." },
]

export const SUBTITLE_POSITION_OPTIONS: { id: "bottom" | "center" | "top"; label: string }[] = [
    { id: "bottom", label: "Dole" },
    { id: "center", label: "Na střed" },
    { id: "top", label: "Nahoře" },
]

export const SUBTITLE_SIZE_OPTIONS: { id: "s" | "m" | "l"; label: string }[] = [
    { id: "s", label: "Malé" },
    { id: "m", label: "Střední" },
    { id: "l", label: "Velké" },
]
