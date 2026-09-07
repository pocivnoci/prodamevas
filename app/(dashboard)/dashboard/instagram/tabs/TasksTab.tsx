"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { CircleCheck, CirclePause, CirclePlay, Circle, Trash2, X } from "lucide-react"
import {
    listTasks, listTeam, createTask, setTaskStatus, assignTask, deleteTask,
    type Task, type TaskStatus,
} from "@/app/actions/task-actions"
import { ROLE_LABELS, type TeamMember } from "@/lib/team"

/**
 * Úkoly firmy.
 *
 * Vstup je Google tabulka, kterou tým udržuje ručně; zapisovat do ní zpátky nejde,
 * takže stav — kdo to má a jak na tom je — žije tady. Úkol se štítkem „z tabulky"
 * má název a poznámku vlastněné tabulkou: příští sync je přepíše.
 */

const STATUS_ORDER: TaskStatus[] = ["doing", "todo", "blocked", "done", "dropped"]

const STATUS_LABELS: Record<TaskStatus, string> = {
    todo: "Ke zpracování",
    doing: "Dělá se",
    blocked: "Čeká na někoho",
    done: "Hotovo",
    dropped: "Neděláme",
}

/** Kam vede klik na kolečko u úkolu — jeden tah, ne rozbalovací menu. */
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
    todo: "doing",
    doing: "done",
    blocked: "doing",
    done: "todo",
    dropped: "todo",
}

const STATUS_ICON: Record<TaskStatus, typeof Circle> = {
    todo: Circle,
    doing: CirclePlay,
    blocked: CirclePause,
    done: CircleCheck,
    dropped: X,
}

const STATUS_TONE: Record<TaskStatus, string> = {
    todo: "text-white/30",
    doing: "text-sky-400",
    blocked: "text-amber-400",
    done: "text-emerald-400",
    dropped: "text-white/20",
}

const PRIORITY_TONE: Record<number, string> = {
    1: "bg-red-500/10 text-red-300/80 border-red-500/25",
    2: "bg-amber-500/10 text-amber-300/80 border-amber-500/25",
    3: "bg-white/5 text-white/40 border-white/10",
}

/** Obojí naráz — tým se čte kvůli jménům u přiřazení, ne kvůli přístupu. */
const fetchAll = () => Promise.all([listTasks(), listTeam()])

export function TasksTab() {
    const [tasks, setTasks] = useState<Task[]>([])
    const [team, setTeam] = useState<TeamMember[]>([])
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const [ownerFilter, setOwnerFilter] = useState<string>("all")
    const [showDone, setShowDone] = useState(false)

    const [newTitle, setNewTitle] = useState("")
    const [newOwner, setNewOwner] = useState("")
    const [creating, setCreating] = useState(false)

    // Načtení odděleně od zápisu do stavu: efekt tak nesahá na stav synchronně
    // a odmountovaná komponenta si ho nepřepíše doběhlým requestem.
    useEffect(() => {
        let alive = true
        fetchAll().then(([t, m]) => {
            if (!alive) return
            setTasks(t)
            setTeam(m)
            setLoading(false)
        })
        return () => { alive = false }
    }, [])

    const nameOf = useCallback((email: string | null) => {
        if (!email) return null
        return team.find(m => m.email === email)?.name ?? email
    }, [team])

    const visible = useMemo(() => {
        return tasks.filter(t => {
            const mineFilter =
                ownerFilter === "all" ? true
                : ownerFilter === "none" ? t.owner_email === null
                : t.owner_email === ownerFilter
            if (!mineFilter) return false
            // Hotové a zahozené se nedrží v cestě — schová je jeden přepínač, ne mazání.
            if (!showDone && (t.status === "done" || t.status === "dropped")) return false
            return true
        })
    }, [tasks, ownerFilter, showDone])

    const grouped = useMemo(() => {
        return STATUS_ORDER
            .map(status => ({ status, items: visible.filter(t => t.status === status) }))
            .filter(g => g.items.length > 0)
    }, [visible])

    const openCount = tasks.filter(t => t.status !== "done" && t.status !== "dropped").length

    /** Optimisticky: kolečko musí reagovat hned, jinak se na něj klikne dvakrát. */
    const runStatus = async (task: Task) => {
        const next = NEXT_STATUS[task.status]
        setBusyId(task.id)
        setError(null)
        setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status: next } : t)))
        const res = await setTaskStatus(task.id, next)
        if (!res.success) {
            setError(res.error ?? "Změna stavu selhala.")
            // Optimistický stav lhal — vrať se k tomu, co je v databázi.
            const [t] = await fetchAll()
            setTasks(t)
        } else if (res.task) {
            setTasks(prev => prev.map(t => (t.id === task.id ? res.task! : t)))
        }
        setBusyId(null)
    }

    const runAssign = async (task: Task, email: string) => {
        const owner = email || null
        setBusyId(task.id)
        setError(null)
        const res = await assignTask(task.id, owner)
        if (!res.success) setError(res.error ?? "Přiřazení selhalo.")
        else if (res.task) setTasks(prev => prev.map(t => (t.id === task.id ? res.task! : t)))
        setBusyId(null)
    }

    const runDelete = async (task: Task) => {
        setBusyId(task.id)
        setError(null)
        const res = await deleteTask(task.id)
        if (!res.success) setError(res.error ?? "Smazání selhalo.")
        else setTasks(prev => prev.filter(t => t.id !== task.id))
        setBusyId(null)
    }

    const runCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newTitle.trim() || creating) return
        setCreating(true)
        setError(null)
        const res = await createTask({ title: newTitle, ownerEmail: newOwner || null })
        if (res.success && res.task) {
            setTasks(prev => [res.task!, ...prev])
            setNewTitle("")
        } else {
            setError(res.error ?? "Úkol se nepodařilo založit.")
        }
        setCreating(false)
    }

    if (loading) return <div className="text-white/50 text-sm">Načítání…</div>

    return (
        <div className="space-y-5">
            {/* Přidat úkol */}
            <form onSubmit={runCreate} className="flex flex-col sm:flex-row gap-2">
                <input
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    placeholder="Nový úkol…"
                    className="flex-1 bg-[#050505] border border-white/10 rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                />
                <select
                    value={newOwner}
                    onChange={e => setNewOwner(e.target.value)}
                    className="bg-[#050505] border border-white/10 rounded-sm px-3 py-2 text-white/70 text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
                >
                    <option value="">Nezadáno</option>
                    {team.filter(m => m.active).map(m => (
                        <option key={m.email} value={m.email}>{m.name} · {ROLE_LABELS[m.role]}</option>
                    ))}
                </select>
                <button
                    type="submit"
                    disabled={creating || !newTitle.trim()}
                    className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-all border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {creating ? "Zakládám…" : "Přidat"}
                </button>
            </form>

            {/* Filtry */}
            <div className="flex items-center gap-1.5 flex-wrap">
                {[{ id: "all", label: `Vše (${openCount})` },
                  ...team.filter(m => m.active).map(m => ({ id: m.email, label: m.name })),
                  { id: "none", label: "Nezadáno" }].map(opt => (
                    <button
                        key={opt.id}
                        onClick={() => setOwnerFilter(opt.id)}
                        className={`px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border transition-all ${
                            ownerFilter === opt.id
                                ? "bg-white/10 text-white border-white/20"
                                : "bg-transparent text-white/40 border-white/10 hover:text-white/70"
                        }`}
                    >
                        {opt.label}
                    </button>
                ))}
                <button
                    onClick={() => setShowDone(v => !v)}
                    className="ml-auto text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white underline underline-offset-4 decoration-white/20"
                >
                    {showDone ? "Skrýt hotové" : "Zobrazit hotové"}
                </button>
            </div>

            {error && <p className="text-[10px] text-red-400">❌ {error}</p>}

            {grouped.length === 0 && (
                <p className="text-white/30 text-xs py-8 text-center">
                    Nic tu není. Přidej úkol výš, nebo počkej na sync z tabulky (pondělí a čtvrtek ráno).
                </p>
            )}

            {grouped.map(group => (
                <div key={group.status} className="space-y-1.5">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                        {STATUS_LABELS[group.status]} <span className="text-white/20">({group.items.length})</span>
                    </h3>
                    {group.items.map(task => {
                        const Icon = STATUS_ICON[task.status]
                        const muted = task.status === "done" || task.status === "dropped"
                        return (
                            <div
                                key={task.id}
                                className={`flex items-start gap-3 bg-[#0a0a0a] border border-white/5 rounded-sm px-3 py-2.5 ${busyId === task.id ? "opacity-50" : ""}`}
                            >
                                <button
                                    onClick={() => runStatus(task)}
                                    disabled={busyId === task.id}
                                    title={`Posunout na: ${STATUS_LABELS[NEXT_STATUS[task.status]]}`}
                                    className={`shrink-0 mt-0.5 ${STATUS_TONE[task.status]} hover:text-white transition-colors`}
                                >
                                    <Icon className="w-4 h-4" />
                                </button>

                                <div className="flex-1 min-w-0">
                                    <p className={`text-xs ${muted ? "text-white/30 line-through" : "text-white/80"}`}>
                                        {task.title}
                                    </p>
                                    {task.note && (
                                        <p className="text-[10px] text-white/35 mt-0.5">{task.note}</p>
                                    )}
                                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                        {task.priority && (
                                            <span className={`px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded-sm border ${PRIORITY_TONE[task.priority]}`}>
                                                Prio {task.priority}
                                            </span>
                                        )}
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-white/20">
                                            {task.source === "sheet" ? "z tabulky" : "v appce"}
                                        </span>
                                        {task.owner_email && (
                                            <span className="text-[8px] font-bold uppercase tracking-widest text-white/35">
                                                {nameOf(task.owner_email)}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <select
                                    value={task.owner_email ?? ""}
                                    onChange={e => runAssign(task, e.target.value)}
                                    disabled={busyId === task.id}
                                    className="shrink-0 bg-transparent border border-white/10 rounded-sm px-2 py-1 text-white/50 text-[9px] uppercase tracking-widest font-bold focus:outline-none focus:ring-1 focus:ring-white/20"
                                >
                                    <option value="" className="bg-[#0a0a0a]">Nezadáno</option>
                                    {team.filter(m => m.active).map(m => (
                                        <option key={m.email} value={m.email} className="bg-[#0a0a0a]">{m.name}</option>
                                    ))}
                                </select>

                                <button
                                    onClick={() => runDelete(task)}
                                    disabled={busyId === task.id}
                                    title={task.source === "sheet"
                                        ? "Smazat — řádek zůstává v tabulce, příští sync ho vrátí"
                                        : "Smazat"}
                                    className="shrink-0 mt-0.5 text-white/20 hover:text-red-400 transition-colors"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )
                    })}
                </div>
            ))}
        </div>
    )
}
