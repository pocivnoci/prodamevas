/**
 * Podklad na vstupní schůzku
 * ==========================
 * Rozdíl mezi „pojďme si popovídat" a „tady je návrh vaší strategie, projdeme
 * ho" je celá hodnota té schůzky — a Chrlit ho má skoro zadarmo: po onboardingu
 * už značku zná (`clients.config`), má vygenerované příspěvky a zná katalog
 * produktů. Tohle jen posbírá, co víme, a doplní, co se musíme zeptat.
 *
 * Podklad je pro NÁS, ne pro zákazníka. Píše se proto věcně a bez marketingu:
 * na hovoru se v něm musí dát rychle najít, co říct.
 *
 * Běží jako agentní úkol po rezervaci termínu (nikdy synchronně ve webhooku),
 * takže Cal.com dostane ACK hned a generování ho nemůže shodit.
 */

import supabaseAdmin from "@/supabase/admin"
import type { ClientConfig } from "@/instagram/configs/types"

/** Co v konfiguraci chybí a musí se doptat na hovoru. */
function findGaps(config: Partial<ClientConfig>): string[] {
    const gaps: string[] = []
    if (!config.industry) gaps.push("Obor není vyplněný — kontextový agent bez něj nepozná, co je pro značku relevantní.")
    if (!config.city) gaps.push("Město chybí — bez něj nefunguje lokální kontext (počasí, svátky, akce v okolí).")
    if (!config.instagram) gaps.push("Instagram účet není propojený — nejde měřit výkon ani publikovat.")
    if (!config.brandVoiceExamples?.length) {
        gaps.push("Nemáme ukázky vlastního hlasu. Jeden až tři příspěvky, které se značce líbí, drží tón víc než jakékoli nastavení.")
    }
    const pillars = Object.keys(config.contentPillars || {})
    if (pillars.length === 0) gaps.push("Nejsou nastavené obsahové pilíře — bez nich se plán scvrkne na náhodné příspěvky.")
    return gaps
}

/** Zkrácení dlouhých textů, aby se podklad dal přečíst na jednu obrazovku. */
const trim = (s: string | undefined | null, max = 220): string =>
    !s ? "—" : s.length <= max ? s : `${s.slice(0, max).trimEnd()}…`

/**
 * Sestaví podklad a uloží ho ke konzultaci.
 *
 * Bez modelu: všechno potřebné už v DB je, a volání LLM by přidalo náklad,
 * latenci i riziko, že si podklad něco vymyslí. Kde chybí data, se to napíše —
 * prázdné místo v podkladu je informace, ne vada.
 */
export async function generateConsultationBrief(consultationId: string): Promise<string | null> {
    const { data: consultation } = await supabaseAdmin
        .from("consultations")
        .select("id, client_id, status, scheduled_at, brief_generated_at, source")
        .eq("id", consultationId)
        .maybeSingle()
    if (!consultation) return null

    // Idempotence: podklad se generuje jednou. Přegenerování by přepsalo
    // poznámky, které si k němu mohl zakladatel už dopsat.
    if (consultation.brief_generated_at) return null

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, name, slug, website, instagram, config")
        .eq("id", consultation.client_id)
        .maybeSingle()
    if (!client) return null

    const config = (client.config || {}) as Partial<ClientConfig>

    // Co už engine pro značku vyrobil — nejlepší podklad k hovoru je jejich
    // vlastní obsah, ne naše popisy.
    const { data: posts } = await supabaseAdmin
        .from("ig_posts")
        .select("caption, content_pillar, status, created_at")
        .eq("client_id", client.id)
        .in("status", ["draft", "approved", "published"])
        .order("created_at", { ascending: false })
        .limit(5)

    const { data: products } = await supabaseAdmin
        .from("ig_products")
        .select("name")
        .eq("client_id", client.id)
        .limit(8)

    const pillars = Object.entries(config.contentPillars || {})
    const gaps = findGaps(config)
    const when = consultation.scheduled_at
        ? new Date(consultation.scheduled_at).toLocaleString("cs-CZ", { dateStyle: "full", timeStyle: "short" })
        : "termín neurčen"

    const brief = `# ${client.name} — podklad na nastavení značky

**Termín:** ${when}
**Web:** ${client.website || "—"} · **Instagram:** ${client.instagram || "nepropojeno"}
**Původ schůzky:** ${consultation.source === "purchase" ? "koupená zvlášť (990 Kč)" : consultation.source === "manual" ? "domluvená ručně" : "v ceně předplatného"}

## Co o značce víme

- **Obor:** ${config.industry || "—"}
- **Město:** ${config.city || "—"}
- **Persona:** ${trim(config.brandVoice?.persona)}
- **Čemu se vyhýbáme:** ${config.brandVoice?.antiPatterns?.slice(0, 3).join(" · ") || "—"}
- **Vizuální styl:** ${trim(config.feedAesthetic?.feel)}${config.feedAesthetic?.colorPalette ? ` · paleta: ${trim(config.feedAesthetic.colorPalette, 90)}` : ""}

## Obsahové pilíře (${pillars.length})

${pillars.length === 0
    ? "_Žádné — tohle je první věc k probrání._"
    : pillars.map(([id, p]) => `- **${(p as { label?: string })?.label || id}** — ${trim((p as { description?: string })?.description, 140)}`).join("\n")}

## Produkty v katalogu (${products?.length || 0})

${products?.length ? products.map(p => `- ${p.name}`).join("\n") : "_Katalog je prázdný — bez něj nefungují produktové vizualizace._"}

## Co už engine vygeneroval

${posts?.length
    ? posts.map(p => `- _${p.content_pillar || "bez pilíře"}_ · ${trim(p.caption, 110)}`).join("\n")
    : "_Zatím nic — na hovoru je dobré vygenerovat první příspěvek živě._"}

## Na co se zeptat

${gaps.length ? gaps.map(g => `- ${g}`).join("\n") : "- Konfigurace je kompletní. Ptát se na cíle: co má Instagram firmě přinést a podle čeho poznají, že to funguje."}

## Návrh postupu na hovoru

1. Ukázat, co engine vygeneroval, a nechat reagovat — reakce na konkrétní příspěvek řekne o tónu víc než otázka na tón.
2. Doladit pilíře a kadenci podle toho, co reálně stihnou zveřejnit.
3. Doplnit mezery výš.
4. Vygenerovat první příspěvek živě a nechat je ho schválit.
`

    await supabaseAdmin
        .from("consultations")
        .update({ brief, brief_generated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", consultationId)
        // Podmíněný zápis: souběžný běh nesmí přepsat už hotový podklad.
        .is("brief_generated_at", null)

    console.log(`📋 Podklad na schůzku připraven pro ${client.name}`)
    return brief
}
