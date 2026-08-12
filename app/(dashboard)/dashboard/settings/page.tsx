"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { getAvailableIGClients } from "@/app/actions/admin-actions"
import { getClientConfig, updateClientConfig } from "@/app/actions/settings-actions"
import { Lightbulb } from "lucide-react"

type ClientInfo = { id: string; name: string; icon: string; description: string }

export default function SettingsPage() {
    const [projectId, setProjectId] = useState("")
    const [clients, setClients] = useState<ClientInfo[]>([])
    
    // Editor state
    const [configData, setConfigData] = useState<any>(null)
    const [jsonStr, setJsonStr] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)
    const [jsonError, setJsonError] = useState<string | null>(null)

    // Load available clients from config registry
    useEffect(() => {
        getAvailableIGClients().then(data => {
            setClients(data)
            if (data.length > 0 && !projectId) {
                setProjectId(data[0].id)
            }
        })
    }, [])

    // Load config when projectId changes
    useEffect(() => {
        if (!projectId) return
        
        setIsLoading(true)
        setErrorMsg(null)
        setSuccessMsg(null)
        setJsonError(null)
        setJsonStr("")
        
        getClientConfig(projectId).then(data => {
            if (data) {
                setConfigData(data)
                setJsonStr(JSON.stringify(data, null, 2))
            } else {
                setErrorMsg(`Nepodařilo se načíst konfiguraci pro projekt ${projectId}`)
            }
            setIsLoading(false)
        }).catch(err => {
            setErrorMsg(err.message)
            setIsLoading(false)
        })
    }, [projectId])

    // Validate JSON on manual edit
    const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value
        setJsonStr(value)
        setSuccessMsg(null)
        
        try {
            JSON.parse(value)
            setJsonError(null)
        } catch (e: any) {
            setJsonError(`Chyba formátu JSON: ${e.message}`)
        }
    }

    const handleSave = async () => {
        if (jsonError) return
        
        let parsedConfig
        try {
            parsedConfig = JSON.parse(jsonStr)
        } catch (e: any) {
            setJsonError(`Nelze uložit: ${e.message}`)
            return
        }

        setIsSaving(true)
        setErrorMsg(null)
        setSuccessMsg(null)

        const res = await updateClientConfig(projectId, parsedConfig)
        
        if (res.success) {
            setSuccessMsg("Konfigurace úspěšně uložena a aktualizována! Můžeš pokračovat v používání Studia.")
            // Format perfectly
            setJsonStr(JSON.stringify(parsedConfig, null, 2))
        } else {
            setErrorMsg(res.error || "Při ukládání došlo k neznámé chybě.")
        }
        
        setIsSaving(false)
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-white">Nastavení Profilu</h1>
                    <p className="text-white/50 mt-2 font-bold uppercase tracking-widest text-[10px]">
                        Komplexní editor profilových dat a SaaS logiky
                    </p>
                </div>

                {/* Project Selector - Replicated from Studio */}
                <div className="relative">
                    <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="appearance-none bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 text-white rounded-sm px-5 py-3 pr-12 text-sm font-bold uppercase tracking-wider cursor-pointer shadow-sm hover:border-white/30 transition-colors focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30"
                    >
                        {clients.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.icon} {p.name}
                            </option>
                        ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
                        ▾
                    </div>
                </div>
            </div>

            {/* Editor Area */}
            <div className="bg-[#0f0f0f] border border-white/10 rounded-sm overflow-hidden flex flex-col shadow-sm">
                <div className="bg-[#050505] p-4 border-b border-white/10 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-bold uppercase tracking-widest text-white/90">Pokročilý JSON Editor</h2>
                        <p className="text-[10px] text-white/40 mt-1 uppercase tracking-widest">
                            Zde jsou kompletní informace o profilu (Tone of Voice, Produkty, Barvy). Opatrně s přepisy!
                        </p>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={isLoading || isSaving || !!jsonError || !jsonStr}
                        className={`px-6 py-2 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-all ${
                            isSaving 
                                ? "bg-white/10 text-white/50 cursor-wait"
                                : !!jsonError
                                    ? "bg-red-500/20 text-red-500/50 cursor-not-allowed border border-red-500/30"
                                    : "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500 hover:text-white shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                        }`}
                    >
                        {isSaving ? "Ukládám..." : "Uložit změny"}
                    </button>
                </div>

                {/* Notifications */}
                <AnimatePresence>
                    {errorMsg && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="bg-red-500/10 border-b border-red-500/20 p-4">
                            <p className="text-xs text-red-400 font-medium">❌ {errorMsg}</p>
                        </motion.div>
                    )}
                    {successMsg && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="bg-emerald-500/10 border-b border-emerald-500/20 p-4">
                            <p className="text-xs text-emerald-400 font-medium">✅ {successMsg}</p>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* The Code Editor */}
                <div className="relative min-h-[500px] flex group">
                    {/* Line numbers (fake simulation for aesthetics) */}
                    <div className="hidden sm:flex flex-col text-right pr-4 pl-4 py-4 bg-[#0a0a0a] border-r border-white/5 text-white/20 font-mono text-[11px] select-none h-full">
                        {Array.from({ length: 150 }).map((_, i) => <span key={i}>{i + 1}</span>)}
                    </div>
                    
                    {isLoading ? (
                        <div className="flex-1 p-12 flex items-center justify-center">
                            <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
                        </div>
                    ) : (
                        <textarea
                            value={jsonStr}
                            onChange={handleJsonChange}
                            spellCheck={false}
                            className={`flex-1 p-4 bg-transparent border-none text-white/80 font-mono text-[11px] leading-relaxed resize-y focus:outline-none focus:ring-0 ${jsonError ? "text-red-300" : ""}`}
                            style={{ minHeight: "600px" }}
                        />
                    )}

                    {jsonError && (
                        <div className="absolute bottom-4 left-4 right-4 sm:left-14 bg-red-950/80 backdrop-blur-md border border-red-500/50 p-3 rounded-sm shadow-xl">
                            <p className="text-xs text-red-400 font-mono text-center">⚠️ {jsonError}</p>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="p-4 bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm">
                <h3 className="text-xs text-aisummit-cinnabar font-bold uppercase tracking-widest mb-2 flex items-center gap-2"><Lightbulb className="w-4 h-4" /> Uživatelský manuál k nastavení profilu</h3>
                <ul className="text-[11px] text-white/60 space-y-1 ml-6 list-disc">
                    <li>Vyber projekt nahoře vpravo.</li>
                    <li>V JSONu můžeš ručně upravit sekci <strong className="text-white/80">"products"</strong> a přidat / smazat libovolné produkty nebo služby pro tento model.</li>
                    <li>Upravené barvy (<strong className="text-white/80">overlayGradient</strong>) nebo font se ihned promítnou do generování nových postů.</li>
                    <li>Pokud provedeš neplatnou změnu v syntaxi (chybějící uvozovky), editor ti nedovolí uložit kód, dokud chybu neopravíš.</li>
                </ul>
            </div>
        </div>
    )
}
