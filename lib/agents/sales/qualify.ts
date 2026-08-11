/**
 * Kvalifikace leadu — deterministické skóre, žádný model
 * ======================================================
 * U obchodní fronty musí jít vysvětlit, PROČ je zrovna tahle firma na řadě. Model
 * by odpověděl pokaždé trochu jinak a důvod by se nedal doložit, takže skóre počítá
 * kód a každý bod si nese slovní zdůvodnění (`score_reasons`).
 *
 * ⚠️ Přepsáno po ostrém ověření na skutečných profilech (2026-08-11). Dvě věci
 *    v první verzi byly špatně a stály za to:
 *
 *  1. **Web nebyl podmínka, ale zdroj kontaktu.** Vyřazoval jsem firmy bez webu
 *     v biu — mimo jiné reálné květinářství, tedy přesně cílového zákazníka.
 *     Instagram profil (bio, kategorie, příspěvky) je pro generování
 *     instagramového obsahu lepší zdroj značky než web. Web je potřeba kvůli
 *     e-mailu, ne kvůli značce.
 *  2. **„Aktivní profil = zahodit" byl nepodložený dohad.** Kdo postuje třikrát
 *     týdně, tomu to bere hodiny a dokázal, že mu na Instagramu záleží — to je
 *     motivovaný kupec nástroje na automatizaci. Kdo neposlal nic půl roku,
 *     dokázal spíš opak. Nevím, co konvertuje líp, a **hádat to v kódu je horší
 *     než to změřit**: kadence proto skóruje na obou koncích a lead si nese
 *     `segment`, aby se konverze dala porovnat podle skutečných dat.
 *
 * Jediné tvrdé vyřazení je teď „nemám jak se s nimi spojit" — což je fakt, ne dohad.
 */

/** Nejnižší skóre, se kterým se ještě oslovuje. */
export const QUALIFY_THRESHOLD = 45

/** Kam lead spadá podle toho, jak často postuje. Nese se dál, aby šlo měřit,
 *  který segment skutečně konvertuje — místo aby to rozhodl můj odhad. */
export type Segment = "spici" | "nepravidelny" | "aktivni" | "neznamy"

export interface LeadSignals {
    company?: string | null
    igHandle?: string | null
    /** Web z bia nebo dohledaný — slouží hlavně jako ZDROJ e-mailu. */
    website?: string | null
    /** Kontaktní adresa: z IG `public_email`, nebo vytažená z webu. */
    email?: string | null
    lastPostAt?: Date | null
    followers?: number | null
    bio?: string | null
    isBusiness?: boolean | null
    isPrivate?: boolean | null
}

export interface Qualification {
    score: number
    reasons: string[]
    qualified: boolean
    segment: Segment
    /** Vyplněné jen když qualified === false. */
    rejectReason?: string
}

/**
 * Osobní adresy se zahazují UŽ TADY, ne až před odesláním.
 * Napsat na `info@` je jiná věc než napsat konkrétnímu člověku na jeho adresu.
 */
const ROLE_PREFIXES = [
    "info", "kontakt", "obchod", "office", "podpora", "support", "hello", "ahoj",
    "objednavky", "objednavka", "prodej", "sales", "rezervace", "recepce", "studio",
    "shop", "eshop", "mail", "firma", "provozovna",
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

export function segmentOf(s: LeadSignals, now: Date = new Date()): Segment {
    const idle = daysSince(s.lastPostAt, now)
    if (idle === null) return "neznamy"
    if (idle >= 30) return "spici"
    if (idle >= 10) return "nepravidelny"
    return "aktivni"
}

/**
 * Skóre 0–100. Prahy jsou schválně hrubé — jemnější rozlišení by předstíralo
 * přesnost, kterou tahle data nemají.
 */
export function qualifyLead(s: LeadSignals, now: Date = new Date()): Qualification {
    const segment = segmentOf(s, now)
    const reasons: string[] = []

    // ── Tvrdá vyřazení: fakta, ne dohady ───────────────────────────────────────
    if (s.isPrivate) {
        return { score: 0, reasons: ["soukromý profil — nejde posoudit"], qualified: false, segment, rejectReason: "private" }
    }
    // Bez adresy není kam napsat. Volající se ji nejdřív pokusí vytáhnout z webu
    // (viz `extractEmails` v brand-scrape.ts) — sem se dostane až výsledek.
    if (!s.email) {
        return { score: 0, reasons: ["nenalezena kontaktní adresa"], qualified: false, segment, rejectReason: "no_contact" }
    }
    if (!isRoleAddress(s.email)) {
        return { score: 0, reasons: ["adresa vypadá osobně, ne firemně"], qualified: false, segment, rejectReason: "personal_email" }
    }

    let score = 0

    // ── Kadence: skóruje na OBOU koncích ───────────────────────────────────────
    // Spící má viditelnou bolest a hook píše sám sebe. Aktivní prokázal, že do
    // Instagramu investuje čas — a přesně ten čas mu produkt vrací. Který z nich
    // konvertuje líp, ukáže `segment` v datech, ne můj odhad.
    const idle = daysSince(s.lastPostAt, now)
    if (idle === null) {
        reasons.push("kadenci se nepodařilo zjistit")
        score += 10
    } else if (idle >= 180) {
        reasons.push(`neposlali nic ${idle} dní — profil vypadá opuštěně`)
        score += 35
    } else if (idle >= 30) {
        reasons.push(`neposlali nic ${idle} dní`)
        score += 35
    } else if (idle >= 10) {
        reasons.push(`postují nepravidelně (naposled před ${idle} dny)`)
        score += 30
    } else {
        reasons.push(`postují pravidelně (naposled před ${idle} dny) — Instagramu už čas věnují`)
        score += 30
    }

    // ── Velikost: firma, ne hobby, ale ani korporát s vlastním týmem ───────────
    const f = s.followers ?? null
    if (f === null) {
        score += 5
    } else if (f < 150) {
        reasons.push(`jen ${f} sledujících — spíš začátek než firma`)
        score += 5
    } else if (f <= 10_000) {
        reasons.push(`${f} sledujících — velikost, kde nabídka dává smysl`)
        score += 30
    } else if (f <= 50_000) {
        reasons.push(`${f} sledujících — možná už mají někoho na obsah`)
        score += 15
    } else {
        reasons.push(`${f} sledujících — na tuhle velikost bývá vlastní tým`)
        score += 2
    }

    // ── Doplňkové signály ──────────────────────────────────────────────────────
    if (s.isBusiness) { reasons.push("označeno jako firemní profil"); score += 10 }
    if (s.company) { reasons.push("známe název firmy"); score += 8 }
    // Web není podmínka, ale je to lepší podklad pro ukázku než samotné bio.
    if (s.website) { reasons.push("má web — bohatší podklad pro ukázku"); score += 7 }

    const capped = Math.max(0, Math.min(100, score))
    const qualified = capped >= QUALIFY_THRESHOLD
    return {
        score: capped,
        reasons,
        qualified,
        segment,
        ...(qualified ? {} : { rejectReason: "low_score" }),
    }
}

/**
 * První věta zprávy se odvozuje z TÝCHŽ signálů jako skóre — proto tu, a ne
 * v šabloně. Kdyby to byla dvě různá místa, rozejdou se: zpráva by tvrdila něco,
 * co kvalifikace nezjistila.
 */
export function openingLine(s: LeadSignals, now: Date = new Date()): string {
    const name = s.company?.trim() || s.igHandle?.replace(/^@/, "") || "vaší firmy"
    const idle = daysSince(s.lastPostAt, now)
    if (idle !== null && idle >= 180) {
        return `koukal jsem na ${name} a všiml si, že na Instagramu je ticho už přes půl roku.`
    }
    if (idle !== null && idle >= 30) {
        return `koukal jsem na ${name} a všiml si, že poslední příspěvek na Instagramu je starý ${idle} dní.`
    }
    if (idle !== null && idle >= 10) {
        return `koukal jsem na Instagram ${name} — postujete, ale nepravidelně.`
    }
    if (idle !== null) {
        return `koukal jsem na Instagram ${name} a je vidět, že mu dáváte čas — postujete pravidelně.`
    }
    return `koukal jsem na ${name} a na váš Instagram.`
}
