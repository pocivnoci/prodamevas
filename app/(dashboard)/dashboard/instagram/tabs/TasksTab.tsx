"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
    Bot, ChevronDown, CircleCheck, CirclePause, CirclePlay, Circle, ExternalLink,
    Plus, RefreshCw, Sparkles, Trash2, X,
} from "lucide-react"
import { useStudio, useStudioNavigate } from "@/app/(dashboard)/StudioContext"
import {
    listTaskEvents, answerTaskQuestion, addTaskNote, setTaskResult, retriageTask, runTaskAgentNow,
    type TaskEvent,
    listTasks, listTeam, listClientsForTasks, currentUserEmail,
    createTask, updateTask, setTaskStatus, assignTask, setTaskBlocked, setTaskClient, deleteTask,
    type Task, type TaskStatus,
} from "@/app/actions/task-actions"
import { isQuestionForHuman } from "@/lib/tasks/question"
import { ROLE_LABELS, type TeamMember } from "@/lib/team"
import { DateField, Field, FilterChip, Select } from "./shared"
import { useFormatter, useTranslations } from "next-intl"

/**
 * Úkoly firmy.
 *
 * Zdroj pravdy je databáze (Google tabulka je jen historický import). Obrazovka
 * je proto plnohodnotný editor: název, poznámka, priorita, termín, klient
 * i „čekám na…" se mění tady, ne v žádné tabulce vedle.
 *
 * **Řadí se podle odpovědi na otázku „co mám teď dělat", ne podle stavu.**
 * Seskupení podle `status` vypadalo uspořádaně, ale odpověď v něm nebyla:
 * úkol, na kterém stojí AI a čeká na jednu větu, se schovával mezi dvaceti
 * cizími položkami. Pořadí sekcí je pořadí pozornosti — čeká na tebe, tvoje,
 * ničí, ostatní, odložené, hotové.
 */

// Popisky stavů, priorit, velikostí (S/M/L) a agentů (ops = uvnitř systému,
// code = skončí PR; prázdné = jen člověk — banka, schůzka, focení) jsou
// v messages: `adminOps.tasks.status|priority|effort|agentKind.*`.

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

/** Hodnoty priority; popisek k nim dává `adminOps.tasks.priority.p<n>`. */
const PRIORITY_KEYS = ["1", "2", "3"] as const

type ClientOption = { id: string; slug: string; name: string }

/** Dnešek jako `YYYY-MM-DD` v místním čase — sloupec `date` žádné pásmo nemá. */
function today(): string {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const isOpen = (t: Task) => t.status !== "done" && t.status !== "dropped"

export function TasksTab() {
    const t = useTranslations("adminOps.tasks")
    const [tasks, setTasks] = useState<Task[]>([])
    const [team, setTeam] = useState<TeamMember[]>([])
    const [clients, setClients] = useState<ClientOption[]>([])
    const [me, setMe] = useState<string>("")
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Výchozí filtr „moje" se nastaví až po načtení e-mailu — do té doby by
    // filtroval na prázdný řetězec a seznam by vypadal prázdný.
    const [ownerFilter, setOwnerFilter] = useState<string>("all")
    const [clientFilter, setClientFilter] = useState<string>("")
    const [q, setQ] = useState("")
    const [showDone, setShowDone] = useState(false)
    const [showSleeping, setShowSleeping] = useState(false)
    const [creating, setCreating] = useState(false)

    const { setProjectId, deepLink, clearDeepLink, refreshNavBadges } = useStudio()
    const navigate = useStudioNavigate()
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [events, setEvents] = useState<TaskEvent[]>([])
    const [eventsLoading, setEventsLoading] = useState(false)
    const [agentRunning, setAgentRunning] = useState(false)
    const [agentNote, setAgentNote] = useState<string | null>(null)

    const reload = useCallback(async () => {
        setTasks(await listTasks())
        refreshNavBadges()
    }, [refreshNavBadges])

    // Načtení odděleně od zápisu do stavu: efekt tak nesahá na stav synchronně
    // a odmountovaná komponenta si ho nepřepíše doběhlým requestem.
    useEffect(() => {
        let alive = true
        Promise.all([listTasks(), listTeam(), listClientsForTasks(), currentUserEmail()])
            .then(([t, m, c, email]) => {
                if (!alive) return
                setTasks(t)
                setTeam(m)
                setClients(c)
                setMe(email)
                // „Moje" jako výchozí pohled: seznam se otevírá kvůli vlastní
                // práci, cizí se hledá vědomě.
                setOwnerFilter(t.some(x => x.owner_email === email && isOpen(x)) ? email : "all")
                setLoading(false)
            })
            .catch(err => { if (alive) { setError((err as Error)?.message || t("errors.load")); setLoading(false) } })
        return () => { alive = false }
    }, [t])

    /**
     * Deep-link `#tasks?id=…` — úkol se rozbalí a odscrolluje se na něj.
     *
     * Stav se nastavuje až v naplánované úloze, ne v těle efektu: synchronní
     * setState v efektu je kaskádový render navíc a scroll by se navíc trefil
     * do řádku, který ještě není rozbalený.
     */
    useEffect(() => {
        const id = deepLink?.id
        if (!id || loading || !tasks.some(t => t.id === id)) return
        const timer = setTimeout(() => {
            // Filtr by odkazovaný úkol mohl schovat — odkaz musí platit i tak.
            setOwnerFilter("all")
            setShowDone(true)
            setShowSleeping(true)
            setExpandedId(id)
            void listTaskEvents(id).then(setEvents)
            clearDeepLink()
            document.getElementById(`task-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
        }, 0)
        return () => clearTimeout(timer)
    }, [deepLink, tasks, loading, clearDeepLink])

    const nameOf = useCallback((email: string | null) => {
        if (!email) return null
        return team.find(m => m.email === email)?.name ?? email
    }, [team])

    const visible = useMemo(() => {
        const needle = q.trim().toLowerCase()
        return tasks.filter(t => {
            if (ownerFilter === "none" ? t.owner_email !== null
                : ownerFilter !== "all" && t.owner_email !== ownerFilter) return false
            if (clientFilter && t.client_id !== clientFilter) return false
            if (needle && !t.title.toLowerCase().includes(needle)) return false
            return true
        })
    }, [tasks, ownerFilter, clientFilter, q])

    /**
     * Sekce v pořadí pozornosti. Úkol je právě v jedné — každé další zařazení
     * by znamenalo, že se tatáž věc odbaví dvakrát, nebo ani jednou.
     */
    const sections = useMemo(() => {
        const open = visible.filter(isOpen)
        const awaiting = open.filter(t => isQuestionForHuman(t.blocked_on))
        const rest = open.filter(t => !awaiting.includes(t))
        const blocked = rest.filter(t => t.status === "blocked" || t.blocked_on)
        const working = rest.filter(t => !blocked.includes(t))

        return {
            awaiting,
            mine: working.filter(t => t.owner_email === me),
            unassigned: working.filter(t => !t.owner_email),
            others: working.filter(t => t.owner_email && t.owner_email !== me),
            blocked,
            closed: visible.filter(t => !isOpen(t)),
        }
    }, [visible, me])

    const openCount = tasks.filter(isOpen).length

    const patchLocal = (task: Task) => setTasks(prev => prev.map(t => (t.id === task.id ? task : t)))

    /** Optimisticky: kolečko musí reagovat hned, jinak se na něj klikne dvakrát. */
    const runStatus = async (task: Task) => {
        const next = NEXT_STATUS[task.status]
        setBusyId(task.id)
        setError(null)
        setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status: next } : t)))
        const res = await setTaskStatus(task.id, next)
        if (!res.success) {
            setError(res.error ?? t("errors.status"))
            // Optimistický stav lhal — vrať se k tomu, co je v databázi.
            await reload()
        } else if (res.task) {
            patchLocal({ ...res.task, clients: task.clients })
        }
        setBusyId(null)
    }

    /** Obálka kolem akce nad úkolem — jedno místo na busy stav i chybu. */
    const run = async (task: Task, fn: () => Promise<{ success: boolean; task?: Task; error?: string }>, fallback: string) => {
        setBusyId(task.id)
        setError(null)
        const res = await fn()
        if (!res.success) setError(res.error ?? fallback)
        else if (res.task) patchLocal(res.task)
        setBusyId(null)
        return res.success
    }

    const runDelete = async (task: Task) => {
        setBusyId(task.id)
        setError(null)
        const res = await deleteTask(task.id)
        if (!res.success) setError(res.error ?? t("errors.delete"))
        else setTasks(prev => prev.filter(t => t.id !== task.id))
        setBusyId(null)
    }

    /** Rozbalení úkolu načte vlákno. Zabalené vlákno se nenačítá — je to dotaz navíc za nic. */
    const toggleExpand = async (task: Task) => {
        if (expandedId === task.id) { setExpandedId(null); return }
        setExpandedId(task.id)
        setEventsLoading(true)
        setEvents(await listTaskEvents(task.id))
        setEventsLoading(false)
    }

    /**
     * Ruční spuštění třídiče i navrhovače.
     *
     * Běh je asynchronní (agent-worker jede každou minutu), takže se tu jen
     * zařadí a pak se třikrát po deseti sekundách kouknem, co přibylo. Dřív tu
     * stálo „pak stránku obnov" — instrukce, kterou musí vykonat člověk, je
     * v aplikaci vždycky chyba.
     */
    const pollTimers = useRef<ReturnType<typeof setTimeout>[]>([])
    useEffect(() => () => pollTimers.current.forEach(clearTimeout), [])

    const runAgent = async () => {
        setAgentRunning(true)
        setAgentNote(null)
        const res = await runTaskAgentNow()
        if (!res.success) {
            setAgentNote(res.error ?? t("errors.agentStart"))
            setAgentRunning(false)
            return
        }
        setAgentNote(t("ai.started"))
        pollTimers.current.forEach(clearTimeout)
        pollTimers.current = [10_000, 20_000, 30_000].map((delay, i) =>
            setTimeout(() => {
                void reload()
                if (i === 2) { setAgentRunning(false); setAgentNote(t("ai.done")) }
            }, delay))
    }

    const runRetriage = async (task: Task) => {
        const ok = await run(task, () => retriageTask(task.id), t("errors.retriage"))
        if (ok) await runAgent()
    }

    if (loading) return <div className="text-white/50 text-sm">{t("loading")}</div>

    const groups: { key: string; label: string; items: Task[]; tone?: string; collapsed?: boolean }[] = [
        { key: "awaiting", label: t("groups.awaiting"), items: sections.awaiting, tone: "text-amber-300" },
        { key: "mine", label: t("groups.mine"), items: sections.mine },
        { key: "unassigned", label: t("groups.unassigned"), items: sections.unassigned },
        { key: "others", label: t("groups.others"), items: sections.others },
    ]

    return (
        <div className="space-y-5">
            {/* Hlavička s filtry */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">
                    {t("open")} <span className="text-white/25">{openCount}</span>
                </span>
                <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder={t("searchPlaceholder")}
                    className="flex-1 min-w-[160px] px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                />
                <select
                    value={clientFilter}
                    onChange={e => setClientFilter(e.target.value)}
                    className="px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white/70 text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
                >
                    <option value="">{t("allClients")}</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button
                    onClick={() => void reload()}
                    title={t("reload")}
                    className="px-3 py-2 rounded-sm border border-white/10 text-white/40 hover:text-white hover:border-white/25 transition-all"
                ><RefreshCw className="w-3.5 h-3.5" /></button>
                <button
                    onClick={() => setCreating(v => !v)}
                    className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/20 bg-white/10 text-white hover:bg-white/20 transition-all inline-flex items-center gap-1.5"
                ><Plus className="w-3.5 h-3.5" />{t("newTask")}</button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                <FilterChip active={ownerFilter === "all"} onClick={() => setOwnerFilter("all")} label={t("filters.all", { count: openCount })} />
                {team.filter(m => m.active).map(m => (
                    <FilterChip
                        key={m.email}
                        active={ownerFilter === m.email}
                        onClick={() => setOwnerFilter(m.email)}
                        label={m.email === me ? t("filters.me", { name: m.name }) : m.name}
                    />
                ))}
                <FilterChip active={ownerFilter === "none"} onClick={() => setOwnerFilter("none")} label={t("unassigned")} />
                <button
                    onClick={runAgent}
                    disabled={agentRunning}
                    title={t("ai.title")}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-all disabled:opacity-40"
                >
                    <Sparkles className="w-3 h-3 shrink-0" />
                    {agentRunning ? t("ai.running") : t("ai.run")}
                </button>
            </div>

            {creating && (
                <NewTaskForm
                    team={team}
                    clients={clients}
                    defaultOwner={me}
                    onDone={task => {
                        setCreating(false)
                        if (task) { setTasks(prev => [task, ...prev]); setExpandedId(task.id) }
                    }}
                />
            )}

            {agentNote && <p className="text-[10px] text-emerald-400/80">{agentNote}</p>}
            {error && <p className="text-[10px] text-red-400">❌ {error}</p>}

            {visible.length === 0 && (
                <p className="text-white/30 text-xs py-8 text-center">
                    {t("empty")}
                </p>
            )}

            {groups.filter(g => g.items.length > 0).map(g => (
                <div key={g.key} className="space-y-1.5">
                    <h3 className={`text-[10px] font-bold uppercase tracking-widest ${g.tone ?? "text-white/40"}`}>
                        {g.label} <span className="text-white/20">({g.items.length})</span>
                    </h3>
                    {g.items.map(task => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            team={team}
                            clients={clients}
                            busy={busyId === task.id}
                            expanded={expandedId === task.id}
                            events={events}
                            eventsLoading={eventsLoading}
                            nameOf={nameOf}
                            onToggle={() => toggleExpand(task)}
                            onStatus={() => runStatus(task)}
                            onRun={(fn, fallback) => run(task, fn, fallback)}
                            onEventsChanged={async () => { setEvents(await listTaskEvents(task.id)); await reload() }}
                            onDelete={() => runDelete(task)}
                            onRetriage={() => runRetriage(task)}
                            onOpenStudio={slug => { setProjectId(slug); navigate("dashboard") }}
                        />
                    ))}
                </div>
            ))}

            {/* Odložené a hotové se sbalují — jsou to archivy, ne pracovní množina. */}
            {sections.blocked.length > 0 && (
                <BlockedGroup
                    tasks={sections.blocked}
                    showSleeping={showSleeping}
                    onToggleSleeping={() => setShowSleeping(v => !v)}
                    render={task => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            team={team}
                            clients={clients}
                            busy={busyId === task.id}
                            expanded={expandedId === task.id}
                            events={events}
                            eventsLoading={eventsLoading}
                            nameOf={nameOf}
                            onToggle={() => toggleExpand(task)}
                            onStatus={() => runStatus(task)}
                            onRun={(fn, fallback) => run(task, fn, fallback)}
                            onEventsChanged={async () => { setEvents(await listTaskEvents(task.id)); await reload() }}
                            onDelete={() => runDelete(task)}
                            onRetriage={() => runRetriage(task)}
                            onOpenStudio={slug => { setProjectId(slug); navigate("dashboard") }}
                        />
                    )}
                />
            )}

            {sections.closed.length > 0 && (
                <div className="space-y-1.5">
                    <button
                        onClick={() => setShowDone(v => !v)}
                        className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
                    >
                        {t("groups.closed")} <span className="text-white/20">({sections.closed.length})</span> {showDone ? "▲" : "▼"}
                    </button>
                    {showDone && sections.closed.map(task => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            team={team}
                            clients={clients}
                            busy={busyId === task.id}
                            expanded={expandedId === task.id}
                            events={events}
                            eventsLoading={eventsLoading}
                            nameOf={nameOf}
                            onToggle={() => toggleExpand(task)}
                            onStatus={() => runStatus(task)}
                            onRun={(fn, fallback) => run(task, fn, fallback)}
                            onEventsChanged={async () => { setEvents(await listTaskEvents(task.id)); await reload() }}
                            onDelete={() => runDelete(task)}
                            onRetriage={() => runRetriage(task)}
                            onOpenStudio={slug => { setProjectId(slug); navigate("dashboard") }}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

/**
 * Blokované úkoly. Ty s `blocked_until` v budoucnu jsou schované ještě o patro
 * níž: čekání na termín je jediný stav, kdy je správně se na úkol NEDÍVAT.
 */
function BlockedGroup({ tasks, showSleeping, onToggleSleeping, render }: {
    tasks: Task[]
    showSleeping: boolean
    onToggleSleeping: () => void
    render: (task: Task) => React.ReactNode
}) {
    const t = useTranslations("adminOps.tasks")
    const [open, setOpen] = useState(false)
    const now = today()
    const sleeping = tasks.filter(t => t.blocked_until && t.blocked_until > now)
    const awake = tasks.filter(t => !sleeping.includes(t))

    return (
        <div className="space-y-1.5">
            <button
                onClick={() => setOpen(v => !v)}
                className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
            >
                {t("groups.blocked")} <span className="text-white/20">({tasks.length})</span> {open ? "▲" : "▼"}
            </button>
            {open && (
                <>
                    {awake.map(render)}
                    {sleeping.length > 0 && (
                        <button
                            onClick={onToggleSleeping}
                            className="text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-white/60 transition-colors"
                        >
                            {showSleeping ? t("sleeping.hide", { count: sleeping.length }) : t("sleeping.show", { count: sleeping.length })}
                        </button>
                    )}
                    {showSleeping && sleeping.map(render)}
                </>
            )}
        </div>
    )
}

// ─── Řádek úkolu ─────────────────────────────────────────────

function TaskRow({
    task, team, clients, busy, expanded, events, eventsLoading, nameOf,
    onToggle, onStatus, onRun, onEventsChanged, onDelete, onRetriage, onOpenStudio,
}: {
    task: Task
    team: TeamMember[]
    clients: ClientOption[]
    busy: boolean
    expanded: boolean
    events: TaskEvent[]
    eventsLoading: boolean
    nameOf: (email: string | null) => string | null
    onToggle: () => void
    onStatus: () => void
    onRun: (fn: () => Promise<{ success: boolean; task?: Task; error?: string }>, fallback: string) => Promise<boolean>
    onEventsChanged: () => Promise<void>
    onDelete: () => void
    onRetriage: () => void
    onOpenStudio: (slug: string) => void
}) {
    const t = useTranslations("adminOps.tasks")
    const format = useFormatter()
    const Icon = STATUS_ICON[task.status]
    const muted = !isOpen(task)
    const question = isQuestionForHuman(task.blocked_on)
    const overdue = Boolean(task.due_date && task.due_date < today() && isOpen(task))

    /** `2026-09-20` → `20. 9.`; cizí rok se dopíše, ať se termín nedá splést. */
    const shortDate = (value: string | null): string => {
        if (!value) return ""
        const d = new Date(value)
        if (Number.isNaN(d.getTime())) return value
        const sameYear = d.getFullYear() === new Date().getFullYear()
        return format.dateTime(d, sameYear ? { day: "numeric", month: "numeric" } : { day: "numeric", month: "numeric", year: "numeric" })
    }

    return (
        <div
            id={`task-${task.id}`}
            className={`bg-[#0a0a0a] border rounded-sm ${question ? "border-amber-500/25" : "border-white/5"} ${busy ? "opacity-50" : ""}`}
        >
            <div className="flex items-start gap-3 px-3 py-2.5">
                <button
                    onClick={onStatus}
                    disabled={busy}
                    title={t("row.moveTo", { status: t(`status.${NEXT_STATUS[task.status]}`) })}
                    className={`shrink-0 mt-0.5 ${STATUS_TONE[task.status]} hover:text-white transition-colors`}
                >
                    <Icon className="w-4 h-4" />
                </button>

                <div className="flex-1 min-w-0">
                    <p className={`text-xs ${muted ? "text-white/30 line-through" : "text-white/80"}`}>{task.title}</p>
                    {task.note && <p className="text-[10px] text-white/35 mt-0.5">{task.note}</p>}
                    {/* Další krok stojí nad odznaky schválně: je to jediná věta,
                        kterou člověk se čtvrthodinou času potřebuje přečíst. */}
                    {!muted && task.next_step && (
                        <p className="text-[10px] text-emerald-300/70 mt-1">→ {task.next_step}</p>
                    )}
                    {!muted && task.blocked_on && (
                        <p className="text-[10px] text-amber-300/80 mt-1">
                            ⏸ {task.blocked_on}
                            {task.blocked_until && <span className="text-white/30"> {t("row.blockedUntil", { date: shortDate(task.blocked_until) })}</span>}
                        </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {task.priority && (
                            <span className={`px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded-sm border ${PRIORITY_TONE[task.priority]}`}>
                                {t("row.prio", { n: task.priority })}
                            </span>
                        )}
                        {task.due_date && (
                            <span className={`text-[8px] font-bold uppercase tracking-widest ${overdue ? "text-red-400" : "text-white/35"}`}>
                                {t(overdue ? "row.overdue" : "row.due", { date: shortDate(task.due_date) })}
                            </span>
                        )}
                        <span className="text-[8px] font-bold uppercase tracking-widest text-white/20">
                            {task.created_by === "ai" ? t("row.origin.ai") : task.source === "sheet" ? t("row.origin.sheet") : t("row.origin.app")}
                        </span>
                        {task.effort && (
                            <span className="text-[8px] font-bold uppercase tracking-widest text-white/35" title={t("row.effortTitle")}>
                                {t(`effort.${task.effort}`)}
                            </span>
                        )}
                        {task.agent && (
                            <span className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-sky-300/60" title={t("row.agentTitle")}>
                                <Bot className="w-2.5 h-2.5 shrink-0" />{t(`agentKind.${task.agent}`)}
                            </span>
                        )}
                        {task.clients?.slug && (
                            <button
                                onClick={() => onOpenStudio(task.clients!.slug)}
                                title={t("row.openStudio", { name: task.clients.name })}
                                className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-white/35 hover:text-white transition-colors"
                            >
                                <ExternalLink className="w-2.5 h-2.5 shrink-0" />{task.clients.name}
                            </button>
                        )}
                        {task.owner_email && (
                            <span className="text-[8px] font-bold uppercase tracking-widest text-white/35">
                                {nameOf(task.owner_email)}
                            </span>
                        )}
                    </div>
                </div>

                <select
                    value={task.owner_email ?? ""}
                    onChange={e => void onRun(() => assignTask(task.id, e.target.value || null), t("errors.assign"))}
                    disabled={busy}
                    className="shrink-0 bg-transparent border border-white/10 rounded-sm px-2 py-1 text-white/50 text-[9px] uppercase tracking-widest font-bold focus:outline-none focus:ring-1 focus:ring-white/20"
                >
                    <option value="" className="bg-[#0a0a0a]">{t("unassigned")}</option>
                    {team.filter(m => m.active).map(m => (
                        <option key={m.email} value={m.email} className="bg-[#0a0a0a]">{m.name}</option>
                    ))}
                </select>

                <button
                    onClick={onToggle}
                    title={t("row.expandTitle")}
                    className={`shrink-0 mt-0.5 text-white/25 hover:text-white transition-transform ${expanded ? "rotate-180" : ""}`}
                >
                    <ChevronDown className="w-3.5 h-3.5" />
                </button>
            </div>

            {expanded && (
                <TaskDetail
                    task={task}
                    clients={clients}
                    busy={busy}
                    events={events}
                    eventsLoading={eventsLoading}
                    nameOf={nameOf}
                    onRun={onRun}
                    onEventsChanged={onEventsChanged}
                    onDelete={onDelete}
                    onRetriage={onRetriage}
                />
            )}
        </div>
    )
}

// ─── Detail ──────────────────────────────────────────────────

function TaskDetail({ task, clients, busy, events, eventsLoading, nameOf, onRun, onEventsChanged, onDelete, onRetriage }: {
    task: Task
    clients: ClientOption[]
    busy: boolean
    events: TaskEvent[]
    eventsLoading: boolean
    nameOf: (email: string | null) => string | null
    onRun: (fn: () => Promise<{ success: boolean; task?: Task; error?: string }>, fallback: string) => Promise<boolean>
    onEventsChanged: () => Promise<void>
    onDelete: () => void
    onRetriage: () => void
}) {
    const [reply, setReply] = useState("")
    const [resultDraft, setResultDraft] = useState(task.result ?? "")
    const [blockDraft, setBlockDraft] = useState(task.blocked_on ?? "")
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [replyBusy, setReplyBusy] = useState(false)
    const t = useTranslations("adminOps.tasks")

    const priorityOptions = Object.fromEntries(PRIORITY_KEYS.map(k => [k, t(`priority.p${k}`)]))
    const clientOptions = useMemo(
        () => Object.fromEntries(clients.map(c => [c.id, c.name])),
        [clients])

    /**
     * Odpověď na otázku od AI zároveň vrací úkol k přetřídění — proto je to jiná
     * akce než poznámka. Poznámka je pro historii, odpověď je vstup pro model.
     */
    const runReply = async (asAnswer: boolean) => {
        const text = reply.trim()
        if (!text || replyBusy) return
        setReplyBusy(true)
        const res = asAnswer ? await answerTaskQuestion(task.id, text) : await addTaskNote(task.id, text)
        if (res.success) { setReply(""); await onEventsChanged() }
        setReplyBusy(false)
    }

    return (
        <div className="border-t border-white/5 px-3 py-3 space-y-4">
            {/* Úprava — pole se chovají jako buňky tabulky, ukládají se na blur */}
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                <Field label={t("detail.fields.title")} value={task.title} onSave={v => void onRun(() => updateTask(task.id, { title: v }), t("errors.save"))} />
                <Select
                    label={t("detail.fields.priority")}
                    value={task.priority ? String(task.priority) : null}
                    options={priorityOptions}
                    emptyLabel={t("detail.fields.noPriority")}
                    onSave={v => void onRun(() => updateTask(task.id, { priority: v ? Number(v) : null }), t("errors.save"))}
                />
                <DateField
                    label={t("detail.fields.due")}
                    mode="date"
                    value={task.due_date}
                    onSave={v => void onRun(() => updateTask(task.id, { dueDate: v || null }), t("errors.save"))}
                />
                <Select
                    label={t("detail.fields.client")}
                    value={task.client_id}
                    options={clientOptions}
                    emptyLabel={t("detail.fields.companyTask")}
                    onSave={v => void onRun(() => setTaskClient(task.id, v || null), t("errors.assignClient"))}
                />
                <div className="sm:col-span-2">
                    <Field label={t("detail.fields.note")} value={task.note} multiline onSave={v => void onRun(() => updateTask(task.id, { note: v }), t("errors.save"))} />
                </div>
            </div>

            {/* Čekání. Datum má smysl jen s důvodem, proto je v jednom bloku. */}
            <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
                <label className="block">
                    <span className="block text-[8px] font-bold uppercase tracking-widest text-white/30 mb-1">{t("detail.waiting.label")}</span>
                    <input
                        value={blockDraft}
                        onChange={e => setBlockDraft(e.target.value)}
                        placeholder={t("detail.waiting.placeholder")}
                        className="w-full px-2.5 py-1.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                    />
                </label>
                <DateField
                    label={t("detail.waiting.until")}
                    mode="date"
                    value={task.blocked_until}
                    onSave={v => void onRun(() => setTaskBlocked(task.id, blockDraft || task.blocked_on, v || null), t("errors.postpone"))}
                />
                <div className="flex gap-2">
                    <button
                        onClick={() => void onRun(() => setTaskBlocked(task.id, blockDraft, task.blocked_until), t("errors.postpone"))}
                        disabled={busy || blockDraft === (task.blocked_on ?? "")}
                        className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-all disabled:opacity-30"
                    >{t("detail.waiting.postpone")}</button>
                    {task.blocked_on && (
                        <button
                            onClick={() => { setBlockDraft(""); void onRun(() => setTaskBlocked(task.id, null, null), t("errors.unblock")) }}
                            disabled={busy}
                            className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/10 text-white/40 hover:text-white transition-all disabled:opacity-30"
                        >{t("detail.waiting.unblock")}</button>
                    )}
                </div>
            </div>

            {/* Zadání od AI */}
            {task.spec ? (
                <div className="space-y-1">
                    {task.spec.cil && <p className="text-[11px] text-white/70"><span className="text-white/30">{t("detail.spec.goal")} </span>{task.spec.cil}</p>}
                    {task.spec.hotovo && <p className="text-[11px] text-white/70"><span className="text-white/30">{t("detail.spec.done")} </span>{task.spec.hotovo}</p>}
                    {task.spec.kde_zacit && <p className="text-[11px] text-white/70"><span className="text-white/30">{t("detail.spec.start")} </span>{task.spec.kde_zacit}</p>}
                </div>
            ) : (
                <p className="text-[10px] text-white/30">{t("detail.spec.none")}</p>
            )}

            {/* Výsledek: odkaz na PR, doklad, rozhodnutí */}
            <div className="flex gap-2">
                <input
                    value={resultDraft}
                    onChange={e => setResultDraft(e.target.value)}
                    placeholder={t("detail.result.placeholder")}
                    className="flex-1 bg-[#050505] border border-white/10 rounded-sm px-2.5 py-1.5 text-white/80 text-[11px] focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                />
                <button
                    onClick={() => void onRun(() => setTaskResult(task.id, resultDraft), t("errors.saveResult"))}
                    disabled={busy || resultDraft === (task.result ?? "")}
                    className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-all disabled:opacity-30"
                >{t("detail.result.save")}</button>
            </div>

            {/* Vlákno */}
            <div className="space-y-1.5">
                {eventsLoading ? (
                    <p className="text-[10px] text-white/30">{t("detail.thread.loading")}</p>
                ) : events.length === 0 ? (
                    <p className="text-[10px] text-white/25">{t("detail.thread.empty")}</p>
                ) : events.map(ev => (
                    <div key={ev.id} className="flex gap-2">
                        <span className={`shrink-0 text-[8px] font-bold uppercase tracking-widest mt-0.5 ${ev.actor === "ai" ? "text-sky-300/60" : "text-white/30"}`}>
                            {ev.actor === "ai" ? "AI" : nameOf(ev.actor)}
                        </span>
                        <p className={`text-[11px] whitespace-pre-line ${ev.kind === "question" ? "text-amber-200/80" : "text-white/55"}`}>
                            {ev.body}
                        </p>
                    </div>
                ))}
            </div>

            {/* Odpověď / poznámka */}
            <div className="flex flex-col sm:flex-row gap-2">
                <input
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    placeholder={isQuestionForHuman(task.blocked_on) ? t("detail.thread.answerPlaceholder") : t("detail.thread.notePlaceholder")}
                    className="flex-1 bg-[#050505] border border-white/10 rounded-sm px-2.5 py-1.5 text-white/80 text-[11px] focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                />
                <button
                    onClick={() => void runReply(true)}
                    disabled={replyBusy || !reply.trim()}
                    className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-30"
                >{t("detail.thread.answer")}</button>
                <button
                    onClick={() => void runReply(false)}
                    disabled={replyBusy || !reply.trim()}
                    className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-all disabled:opacity-30"
                >{t("detail.thread.noteOnly")}</button>
                <button
                    onClick={onRetriage}
                    disabled={busy}
                    title={t("detail.thread.retriageTitle")}
                    className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/10 text-white/40 hover:text-white transition-all disabled:opacity-30"
                ><RefreshCw className="w-3 h-3" /></button>
            </div>

            {/* Mazání je nevratné, tak se ptá dvakrát — stejně jako u leadů. */}
            <div className="flex items-center gap-3 pt-1">
                <span className="text-[9px] text-white/20 uppercase tracking-widest font-bold">
                    {task.source === "sheet" ? t("detail.source.sheet") : t("detail.source.app")}
                </span>
                <button
                    onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return } onDelete() }}
                    disabled={busy}
                    className="ml-auto inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-red-400 transition-colors disabled:opacity-30"
                ><Trash2 className="w-3 h-3 shrink-0" />{confirmDelete ? t("detail.deleteConfirm") : t("detail.delete")}</button>
                {confirmDelete && (
                    <button onClick={() => setConfirmDelete(false)} className="text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white">
                        <X className="w-3 h-3" />
                    </button>
                )}
            </div>
        </div>
    )
}

// ─── Nový úkol ───────────────────────────────────────────────

/**
 * Výsuvný panel, ne řádkový formulář.
 *
 * Jednořádkový „název + vlastník" vypadal rychleji, ale priorita a termín se
 * pak doplňovaly z jiné obrazovky — a většinou nedoplnily vůbec. Úkol bez
 * termínu je věta, ne závazek.
 */
function NewTaskForm({ team, clients, defaultOwner, onDone }: {
    team: TeamMember[]
    clients: ClientOption[]
    defaultOwner: string
    onDone: (task: Task | null) => void
}) {
    const [title, setTitle] = useState("")
    const [note, setNote] = useState("")
    const [owner, setOwner] = useState(defaultOwner)
    const [priority, setPriority] = useState("")
    const [dueDate, setDueDate] = useState("")
    const [clientId, setClientId] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const t = useTranslations("adminOps.tasks")

    const submit = async () => {
        if (!title.trim() || busy) return
        setBusy(true)
        const res = await createTask({
            title,
            note: note || null,
            ownerEmail: owner || null,
            priority: priority ? Number(priority) : null,
            dueDate: dueDate || null,
            clientId: clientId || null,
        })
        setBusy(false)
        if (res.success && res.task) onDone(res.task)
        else setError(res.error || t("errors.create"))
    }

    const inputClass = "px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"

    return (
        <div className="border border-white/10 bg-[#050505] rounded-sm p-3 space-y-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("form.titlePlaceholder")} autoFocus className={`w-full ${inputClass}`} />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={t("form.notePlaceholder")} className={`w-full ${inputClass}`} />
            <div className="grid sm:grid-cols-4 gap-2">
                <select value={owner} onChange={e => setOwner(e.target.value)} className={inputClass}>
                    <option value="">{t("unassigned")}</option>
                    {team.filter(m => m.active).map(m => (
                        <option key={m.email} value={m.email}>{m.name} · {t.has(`roles.${m.role}`) ? t(`roles.${m.role}`) : ROLE_LABELS[m.role]}</option>
                    ))}
                </select>
                <select value={priority} onChange={e => setPriority(e.target.value)} className={inputClass}>
                    <option value="">{t("form.noPriority")}</option>
                    {PRIORITY_KEYS.map(k => <option key={k} value={k}>{t(`priority.p${k}`)}</option>)}
                </select>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputClass} />
                <select value={clientId} onChange={e => setClientId(e.target.value)} className={inputClass}>
                    <option value="">{t("form.companyTask")}</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>
            <div className="flex items-center gap-2">
                <button onClick={submit} disabled={busy || !title.trim()}
                    className="px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all disabled:opacity-40">
                    {busy ? t("form.creating") : t("form.create")}
                </button>
                <button onClick={() => onDone(null)} className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-all">
                    {t("form.cancel")}
                </button>
                <span className="text-[8px] uppercase tracking-widest font-bold text-white/20 ml-auto text-right">
                    {t("form.aiHint")}
                </span>
            </div>
            {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
    )
}
