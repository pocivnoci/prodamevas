/**
 * Kdo je ve skupině a co tam smí.
 * ================================
 * Telegram je MIMO auth vrstvu aplikace. Ve studiu se identita ověřuje session
 * cookie a `requireProjectAccess()`; tady přijde jen číslo `from.id` v JSONu od
 * Telegramu. Proto tenhle soubor drží dvě oddělené otázky, které se nesmějí
 * slít v jednu:
 *
 *   „je tahle zpráva z NAŠÍ skupiny?"  → isOurChat()   — brána kanálu
 *   „smí tenhle člověk spustit práci?" → canApprove()  — brána pravomoci
 *
 * Členství ve skupině NENÍ pravomoc. Kdokoli, koho někdo do skupiny přidá,
 * bude s agentem mluvit a uvidí čísla — ale schválit odchozí e-mail nebo
 * aktivaci plánu smí jen výslovně uvedená role. Bez tohohle rozdělení by
 * pozvánka do chatu byla tichým udělením práv k produkci.
 *
 * Konfigurace žije v env, ne v DB: je to seznam o třech řádcích, mění se
 * jednou za rok, a když ho někdo vymaže, agent má oněmět — ne začít věřit
 * komukoli. (Viz „Nic nehardcoduj" v CLAUDE.md — tohle je ta env strana.)
 *
 *   TELEGRAM_CHAT_ID=-1001234567890
 *   TELEGRAM_TEAM=111:Thomas:founder,222:Hanz:investor,333:Luděk:manager
 */

/** Role určuje, co člen smí. Pořadí = od nejvíc práv k nejmíň. */
export type TeamRole = "founder" | "manager" | "investor"

export const TEAM_ROLES: readonly TeamRole[] = ["founder", "manager", "investor"] as const

export function isTeamRole(value: string): value is TeamRole {
    return (TEAM_ROLES as readonly string[]).includes(value)
}

export interface TeamMember {
    telegramUserId: number
    name: string
    role: TeamRole
}

/**
 * Role, které smějí ze skupiny schvalovat čekající `agent_actions`.
 *
 * `investor` tu záměrně NENÍ a nemá tu být: investor má vidět čísla, ne
 * odpalovat práci jménem firmy. Kdyby to jednou mělo platit i pro něj, je to
 * změna role v env (`:manager`), ne změna téhle konstanty — takhle zůstane
 * v auditu vidět, s jakou rolí to kdo udělal.
 */
const APPROVER_ROLES: ReadonlySet<TeamRole> = new Set<TeamRole>(["founder", "manager"])

/** Parsovaný `TELEGRAM_TEAM`. Cachuje se — env se za běhu procesu nemění. */
let _team: TeamMember[] | null = null
let _teamSource: string | undefined

export function teamMembers(): TeamMember[] {
    const raw = process.env.TELEGRAM_TEAM?.trim() || ""
    if (_team && _teamSource === raw) return _team

    const members: TeamMember[] = []
    for (const entry of raw.split(",")) {
        const part = entry.trim()
        if (!part) continue
        const [idRaw, nameRaw, roleRaw] = part.split(":").map(s => s?.trim())
        const id = Number(idRaw)
        // Překlep v env nesmí projít jako člen s výchozí rolí — to by tiše
        // udělilo práva. Radši ať člen chybí a agent ho nepozná.
        if (!Number.isSafeInteger(id) || id <= 0) {
            console.warn(`⚠️ TELEGRAM_TEAM: '${part}' nemá platné číselné ID — přeskočeno`)
            continue
        }
        if (!roleRaw || !isTeamRole(roleRaw)) {
            console.warn(`⚠️ TELEGRAM_TEAM: '${part}' má neznámou roli '${roleRaw}' (povolené: ${TEAM_ROLES.join(", ")}) — přeskočeno`)
            continue
        }
        members.push({ telegramUserId: id, name: nameRaw || `#${id}`, role: roleRaw })
    }

    _team = members
    _teamSource = raw
    return members
}

/** Člen podle Telegramového user ID, nebo null když ho neznáme. */
export function findMember(telegramUserId: number | undefined | null): TeamMember | null {
    if (!telegramUserId) return null
    return teamMembers().find(m => m.telegramUserId === telegramUserId) || null
}

/**
 * Smí tenhle člověk schválit/zamítnout čekající akci?
 *
 * Neznámé ID = ne. Nikdy „výchozí ano" — přesně jako „chybějící identifikátor
 * nikdy nedefaultuj na skutečného tenanta" v CLAUDE.md.
 */
export function canApprove(telegramUserId: number | undefined | null): boolean {
    const member = findMember(telegramUserId)
    return Boolean(member && APPROVER_ROLES.has(member.role))
}

/** Chat, ve kterém agent žije. Jediný. */
export function teamChatId(): string | null {
    const raw = process.env.TELEGRAM_CHAT_ID?.trim()
    return raw || null
}

/**
 * Je update z naší skupiny?
 *
 * Bot může být přidaný do jakéhokoli chatu kýmkoli, kdo zná jeho jméno —
 * včetně soukromé zprávy od cizího člověka. Bez téhle brány by stačilo bota
 * najít ve vyhledávání a začít se ho ptát na firemní čísla.
 */
export function isOurChat(chatId: number | string | undefined | null): boolean {
    const ours = teamChatId()
    if (!ours || chatId === undefined || chatId === null) return false
    return String(chatId) === ours
}

/** Je kanál vůbec nakonfigurovaný? Bez tokenu i chatu se nikam neposílá. */
export function isTelegramConfigured(): boolean {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && teamChatId())
}

/** Popis týmu do promptu — agent musí vědět, komu odpovídá. */
export function describeTeam(): string {
    const members = teamMembers()
    if (members.length === 0) return "Složení skupiny není nakonfigurované."
    const label: Record<TeamRole, string> = {
        founder: "zakladatel",
        manager: "manažer",
        investor: "investor",
    }
    return members.map(m => `${m.name} (${label[m.role]})`).join(", ")
}
