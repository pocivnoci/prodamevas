"use client"

/**
 * Agent podpory v Nápovědě.
 * =========================
 * Widget ElevenLabs (`<elevenlabs-convai>`) obalený tak, aby se otevřel jen
 * tomu, kdo na něj má nárok, a až ve chvíli, kdy o něj někdo stojí.
 *
 * Tři rozhodnutí, která tenhle soubor drží:
 *
 * 1. **Nárok se ptá serveru, ne kontextu.** `StudioContext` sice zná tarif, ale
 *    je to stav v prohlížeči; o nárok rozhoduje `canProjectUseSupportAgent()`
 *    nad předplatným v DB. Skrytý widget je kosmetika, brána je server action.
 * 2. **Podepsaná URL se razí na kliknutí, ne při vykreslení.** Platí 15 minut
 *    a Nápovědu si lidé otevřou i jen tak; razit ji při každém zobrazení
 *    znamená volání navíc a vypršený odkaz ve chvíli, kdy se konečně klikne.
 * 3. **Text i hlas, volí klient.** Widget nabízí obojí („Zpráva“ a „Zahájit
 *    hovor“) a sám se lokalizuje do češtiny podle jazyka agenta. Na ceně ten
 *    výběr záleží: textová zpráva stojí ~0,003 USD, minuta hlasu ~0,08 USD.
 *    Vynutit jen text jde přes `text_only` v konfiguraci agenta, ne odsud —
 *    modalita je vlastnost agenta, ne téhle obrazovky.
 *
 * Návrh a ekonomika: `docs/DESIGN_podpora-agentem_2026-09-13.md`.
 */

import { useEffect, useState } from "react"
import { MessageCircle, Loader2 } from "lucide-react"
import {
    canProjectUseSupportAgent,
    startSupportConversation,
    type SupportSession,
} from "@/app/actions/support-actions"

const WIDGET_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed"

/**
 * Vlastní element widgetu. Přes `ElementType` schválně: atributy s pomlčkou
 * (`agent-id`, `signed-url`) by jinak chtěly rozšiřovat globální JSX namespace
 * Reactu, a to je změna, která umí rozbít build kdekoliv jinde.
 */
const ConvaiWidget = "elevenlabs-convai" as unknown as React.ElementType

/** Skript widgetu stačí jednou na stránku — druhý `<script>` element znovu
 *  registruje tentýž custom element a prohlížeč si na to stěžuje. */
function useWidgetScript(enabled: boolean) {
    useEffect(() => {
        if (!enabled) return
        if (document.querySelector(`script[src="${WIDGET_SRC}"]`)) return
        const s = document.createElement("script")
        s.src = WIDGET_SRC
        s.async = true
        s.type = "text/javascript"
        document.body.appendChild(s)
    }, [enabled])
}

type State =
    | { kind: "checking" }
    | { kind: "hidden" }
    | { kind: "ready" }
    | { kind: "starting" }
    | { kind: "open"; session: SupportSession }
    | { kind: "error" }

export function SupportAgent({ projectId }: { projectId: string }) {
    const [state, setState] = useState<State>({ kind: "checking" })

    useEffect(() => {
        // Bez tenanta se na nárok není koho zeptat. Řeší to `return null` níž,
        // ne `setState` — synchronní setState v efektu je kaskádový render.
        if (!projectId) return
        let alive = true
        canProjectUseSupportAgent(projectId)
            .then(ok => alive && setState({ kind: ok ? "ready" : "hidden" }))
            // Chyba nároku je „nezobrazuj", ne „rozbij Nápovědu": accordion pod
            // tím je to hlavní, co na téhle stránce je.
            .catch(() => alive && setState({ kind: "hidden" }))
        return () => { alive = false }
    }, [projectId])

    useWidgetScript(state.kind === "open")

    if (!projectId || state.kind === "checking" || state.kind === "hidden") return null

    async function open() {
        setState({ kind: "starting" })
        try {
            const res = await startSupportConversation(projectId)
            setState(res.ok ? { kind: "open", session: res.session } : { kind: "error" })
        } catch {
            setState({ kind: "error" })
        }
    }

    if (state.kind === "open") {
        return (
            <div className="border border-white/10 rounded-sm p-5 bg-white/[0.02]">
                <p className="text-[10px] text-white/25 font-bold uppercase tracking-widest mb-3">
                    Podpora — živý agent
                </p>
                <ConvaiWidget
                    agent-id={state.session.agentId}
                    signed-url={state.session.signedUrl}
                    dynamic-variables={JSON.stringify(state.session.variables)}
                    variant="expanded"
                />
                <p className="text-[11px] text-white/30 leading-relaxed mt-3">
                    Odpovídá na dotazy o Chrlitu a vidí stav vašeho účtu. Co nezvládne,
                    předá člověku. Peníze, refundace a zásahy do účtu řeší vždy člověk.
                </p>
            </div>
        )
    }

    if (state.kind === "error") {
        return (
            <div className="border border-white/5 rounded-sm p-5 bg-white/[0.01]">
                <p className="text-[10px] text-white/25 font-bold uppercase tracking-widest mb-1">
                    Podporu teď nejde otevřít
                </p>
                <p className="text-xs text-white/40">
                    Napište nám prosím na{" "}
                    <a href="mailto:info@chrlit.cz" className="text-aisummit-cinnabar hover:text-aisummit-cinnabar/80 transition-colors">
                        info@chrlit.cz
                    </a>{" "}
                    — ozveme se.
                </p>
            </div>
        )
    }

    const starting = state.kind === "starting"
    return (
        <div className="border border-white/10 rounded-sm p-5 bg-white/[0.02] flex items-center justify-between gap-4">
            <div>
                <p className="text-[10px] text-white/25 font-bold uppercase tracking-widest mb-1">
                    Podpora ve vašem tarifu
                </p>
                <p className="text-xs text-white/40">
                    Zeptejte se rovnou — napsat, nebo si zavolat.
                </p>
            </div>
            <button
                onClick={open}
                disabled={starting}
                className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/60 border border-white/10 rounded-sm hover:text-white hover:bg-white/10 transition-colors flex-shrink-0 flex items-center gap-2 disabled:opacity-40 cursor-pointer"
            >
                {starting
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Spojuji</>
                    : <><MessageCircle className="w-3.5 h-3.5" /> Zeptat se</>}
            </button>
        </div>
    )
}
