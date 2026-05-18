'use client'

import { useState, useEffect } from 'react'
import { getWaitlist, getInviteCodes, createInviteCode, toggleInviteCodeActive } from '@/app/actions/waitlist-admin'

export function WaitlistTab() {
    const [waitlist, setWaitlist] = useState<any[]>([])
    const [inviteCodes, setInviteCodes] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [newCode, setNewCode] = useState('')
    const [maxUses, setMaxUses] = useState(1)
    const [creating, setCreating] = useState(false)

    useEffect(() => {
        loadData()
    }, [])

    async function loadData() {
        setLoading(true)
        const [wList, iCodes] = await Promise.all([
            getWaitlist(),
            getInviteCodes()
        ])
        setWaitlist(wList)
        setInviteCodes(iCodes)
        setLoading(false)
    }

    async function handleCreateCode(e: React.FormEvent) {
        e.preventDefault()
        if (!newCode.trim()) return
        
        setCreating(true)
        const res = await createInviteCode(newCode, maxUses)
        if (res.success) {
            setNewCode('')
            setMaxUses(1)
            await loadData()
        } else {
            alert('Chyba při vytváření kódu: ' + res.error)
        }
        setCreating(false)
    }

    async function handleToggleActive(id: string, currentStatus: boolean) {
        const res = await toggleInviteCodeActive(id, !currentStatus)
        if (res.success) {
            await loadData()
        } else {
            alert('Chyba při změně stavu: ' + res.error)
        }
    }

    if (loading) {
        return <div className="text-white/50 text-sm">Načítání...</div>
    }

    return (
        <div className="space-y-8">
            {/* Create new code */}
            <div className="bg-[#0a0a0a] border border-white/10 rounded-sm p-6">
                <h2 className="text-sm font-black uppercase tracking-widest text-white mb-4">Vytvořit invite kód</h2>
                <form onSubmit={handleCreateCode} className="flex items-end gap-4">
                    <div className="flex-1">
                        <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">Kód</label>
                        <input
                            type="text"
                            value={newCode}
                            onChange={e => setNewCode(e.target.value.toUpperCase())}
                            placeholder="Např. VIP2026"
                            required
                            className="w-full bg-[#050505] border border-white/10 rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:border-aisummit-cinnabar"
                        />
                    </div>
                    <div className="w-32">
                        <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">Max použití</label>
                        <input
                            type="number"
                            min="1"
                            value={maxUses}
                            onChange={e => setMaxUses(parseInt(e.target.value))}
                            required
                            className="w-full bg-[#050505] border border-white/10 rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:border-aisummit-cinnabar"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={creating || !newCode.trim()}
                        className="px-6 py-2 bg-emerald-600 text-white font-bold text-sm rounded-sm hover:bg-emerald-500 disabled:opacity-50 transition-colors h-[38px]"
                    >
                        {creating ? 'Vytvářím...' : 'Vytvořit'}
                    </button>
                </form>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Invite Codes list */}
                <div className="bg-[#0a0a0a] border border-white/10 rounded-sm p-6">
                    <h2 className="text-sm font-black uppercase tracking-widest text-white mb-4">Existující kódy</h2>
                    <div className="space-y-2">
                        {inviteCodes.map(c => (
                            <div key={c.id} className="flex items-center justify-between p-3 bg-white/5 rounded-sm border border-white/5">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-white text-sm font-bold">{c.code}</span>
                                        {!c.is_active && <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold uppercase">Neaktivní</span>}
                                        {c.used_count >= c.max_uses && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold uppercase">Vyčerpáno</span>}
                                    </div>
                                    <div className="text-[10px] text-white/40 mt-1">
                                        Použito: {c.used_count} / {c.max_uses}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleToggleActive(c.id, c.is_active)}
                                    className="text-[10px] text-white/30 hover:text-white uppercase tracking-widest font-bold"
                                >
                                    {c.is_active ? 'Deaktivovat' : 'Aktivovat'}
                                </button>
                            </div>
                        ))}
                        {inviteCodes.length === 0 && (
                            <div className="text-white/30 text-xs text-center py-4">Žádné kódy zatím nebyly vytvořeny.</div>
                        )}
                    </div>
                </div>

                {/* Waitlist list */}
                <div className="bg-[#0a0a0a] border border-white/10 rounded-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-black uppercase tracking-widest text-white">Waitlist</h2>
                        <span className="text-xs text-white/40 bg-white/5 px-2 py-1 rounded-sm">{waitlist.length} zájemců</span>
                    </div>
                    <div className="space-y-2 max-h-[500px] overflow-y-auto override-scrollbar pr-2">
                        {waitlist.map(w => (
                            <div key={w.id} className="p-3 bg-white/5 rounded-sm border border-white/5">
                                <div className="text-white text-sm font-medium">{w.email}</div>
                                <div className="text-[10px] text-white/40 mt-1">
                                    {new Date(w.created_at).toLocaleString('cs-CZ')}
                                </div>
                            </div>
                        ))}
                        {waitlist.length === 0 && (
                            <div className="text-white/30 text-xs text-center py-4">Waitlist je zatím prázdný.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
