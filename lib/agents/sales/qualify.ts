/**
 * Kvalifikace leadu — deterministické skóre, žádný model
 * ======================================================
 * U obchodní fronty musí jít vysvětlit, PROČ je zrovna tahle firma na řadě. Model
 * by odpověděl pokaždé trochu jinak a důvod by se nedal doložit, takže skóre počítá
 * kód a každý bod si nese slovní zdůvodnění (`score_reasons`).
 *
 * Kritéria nejsou libovolná — jsou to tytéž věci, které dělají z firmy dobrého
 * zákazníka, a **zároveň obsah první věty mailu**. Spící profil není jen filtr; je
 * to důvod, proč jim vůbec píšeme.
 */

/** Nejnižší skóre, se kterým se ještě oslovuje. Pod ním se lead zahodí. */
export const QUALIFY_THRESHOLD = 50

export interface LeadSignals {
    company?: string | null
    igHandle?: string | null
    website?: string | null
    email?: string | null
    /** Kdy naposledy něco publikovali. null = nezjištěno. */
    lastPostAt?: Date | null
    followers?: number | null
    /** Bio profilu — hledá se v něm web a náznak, že jde o podnik. */
    bio?: string | null
}

export interface Qualification {
    score: number
    reasons: string[]
    qualified: boolean
    /** Vyplněné jen když qualified === false. */
    rejectReason?: string
}

/**
 * Osobní adresy se zahazují UŽ TADY, ne až před odesláním.
 * Oslovovat `jan.novak@` je jiná věc než napsat na `info@` — a rozhodnutí o tom
 * patří do kvalifikace, aby se taková adresa vůbec nedostala do fronty.
 */
const ROLE_PREFIXES = [
    "info", "kontakt", "obchod", "office", "podpora", "support", "hello", "ahoj",
    "objednavky", "objednavka", "prodej", "sales", "rezervace", "recepce", "studio",
]

export function isRoleAddress(email: string): boolean {
    const local = email.trim().toLowerCase().split("@")[0] ?? ""
    if (!local) return false
    // „info", „info-praha", „info.brno" ano; „jan.novak" ne.
    const head = local.split(/[.\-_+]/)[0]
    return ROLE_PREFIXES.includes(head)
}

/** Dny od posledního příspěvku, nebo null když se to nepodařilo zjistit. */
export function daysSince(date: Date | null | undefined, now: Date = new Date()): number | null {
    if (!date) return null
    return Math.floor((now.getTime() - date.getTime()) / 86_400_000)
}

/**
 * Skóre 0–100. Prahy jsou schválně hrubé — jemnější rozlišení by předstíralo
 * přesnost, kterou tahle data nemají.
 */
export function qualifyLead(s: LeadSignals, now: Date = new Date()): Qualification {
    const reasons: string[] = []

    // ── Vyřazovací podmínky ────────────────────────────────────────────────────
    // Bez webu se značka nenaučí, nevznikne ukázka a není co poslat.
    if (!s.website) {
        return { score: 0, reasons: ["bez webu v biu"], qualified: false, rejectReason: "no_website" }
    }
    if (!s.email) {
        return { score: 0, reasons: ["nenalezena firemní adresa"], qualified: false, rejectReason: "no_email" }
    }
    if (!isRoleAddress(s.email)) {
        return {
            score: 0,
            reasons: ["adresa vypadá osobně, ne firemně"],
            qualified: false,
            rejectReason: "personal_email",
        }
    }

    let score = 0

    // ── Spící profil: hlavní důvod, proč jim píšeme ────────────────────────────
    const idle = daysSince(s.lastPostAt, now)
    if (idle === null) {
        reasons.push("poslední příspěvek se nepodařilo zjistit")
        score += 10
    } else if (idle >= 180) {
        reasons.push(`neposlali nic ${idle} dní — profil vypadá opuštěně`)
        score += 45
    } else if (idle >= 60) {
        reasons.push(`neposlali nic ${idle} dní`)
        score += 40
    } else if (idle >= 30) {
        reasons.push(`poslední příspěvek před ${idle} dny`)
        score += 30
    } else if (idle >= 14) {
        reasons.push("postují nepravidelně")
        score += 12
    } else {
        // Aktivní profil problém nemá — nabídka by byla mimo.
        return {
            score: 5,
            reasons: [`postují pravidelně (naposled před ${idle} dny)`],
            qualified: false,
            rejectReason: "active_profile",
        }
    }

    // ── Velikost: firma, ne hobby, ale ani korporát s vlastním týmem ───────────
    const f = s.followers ?? null
    if (f === null) {
        score += 5
    } else if (f < 150) {
        reasons.push(`jen ${f} sledujících — spíš než firma to vypadá na začátek`)
        score += 5
    } else if (f <= 10_000) {
        reasons.push(`${f} sledujících — velikost, kde nabídka dává smysl`)
        score += 30
    } else if (f <= 50_000) {
        reasons.push(`${f} sledujících — možná už mají někoho na obsah`)
        score += 15
    } else {
        reasons.push(`${f} sledujících — na tuhle velikost má obvykle vlastní tým`)
        score += 2
    }

    // ── Doplňkové signály ──────────────────────────────────────────────────────
    if (s.company) { reasons.push("známe název firmy"); score += 10 }
    if (s.igHandle) score += 5

    const capped = Math.max(0, Math.min(100, score))
    const qualified = capped >= QUALIFY_THRESHOLD
    return {
        score: capped,
        reasons,
        qualified,
        ...(qualified ? {} : { rejectReason: "low_score" }),
    }
}

/**
 * První věta mailu se odvozuje z TÝCHŽ signálů jako skóre — proto tu, a ne
 * v šabloně. Kdyby to byly dvě různá místa, rozejdou se: mail by tvrdil něco,
 * co kvalifikace nezjistila.
 */
export function openingLine(s: LeadSignals, now: Date = new Date()): string {
    const name = s.company?.trim() || s.igHandle?.replace(/^@/, "") || "vaší firmy"
    const idle = daysSince(s.lastPostAt, now)
    if (idle !== null && idle >= 180) {
        return `koukal jsem na web ${name} a všiml si, že na Instagramu je ticho už přes půl roku.`
    }
    if (idle !== null && idle >= 60) {
        return `koukal jsem na web ${name} a všiml si, že poslední příspěvek na Instagramu je starý ${idle} dní.`
    }
    if (idle !== null && idle >= 30) {
        return `koukal jsem na web ${name} — Instagram vám trochu spí, poslední příspěvek je před ${idle} dny.`
    }
    return `koukal jsem na web ${name} a na váš Instagram.`
}
