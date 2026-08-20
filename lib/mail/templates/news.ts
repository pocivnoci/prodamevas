/**
 * Novinky a oznámení.
 *
 * Tělo se píše v lehkém značkování (`## nadpis`, `- odrážka`, `> citace`,
 * `**tučně**`, `[odkaz](url)`) — viz `markdownToBlocks`. Díky tomu jde napsat
 * pokaždé jiný e-mail, a přesto vyjde v témž stylu jako všechno ostatní.
 */

import { button, compact, heading, image, paragraph } from "../blocks"
import { siteUrl } from "../links"
import { markdownToBlocks } from "../markdown"
import type { EmailTemplate } from "../template"

export const news: EmailTemplate = {
    id: "news",
    label: "Novinky",
    group: "news",
    kind: "notification",
    broadcast: true,
    fields: [
        { key: "edition", label: "Označení vydání", type: "text", placeholder: "Novinky · srpen 2026" },
        { key: "headline", label: "Nadpis", type: "text", required: true },
        { key: "intro", label: "Perex", type: "textarea", required: true },
        {
            key: "body", label: "Tělo", type: "textarea", required: true,
            help: "## mezinadpis · - odrážka · > citace · **tučně** · [odkaz](https://…) · --- oddělovač",
        },
        { key: "imageUrl", label: "Obrázek (URL)", type: "url" },
        { key: "ctaLabel", label: "Text tlačítka", type: "text" },
        { key: "ctaUrl", label: "Odkaz tlačítka", type: "url" },
    ],
    sample: {
        edition: "Novinky · srpen 2026",
        headline: "Chrlit umí reely",
        intro: "Dobrý den,\n\ndlouho jste si o ně říkali. Od tohohle týdne Chrlit skládá celé reely — včetně voiceoveru a titulků.",
        body: [
            "## Co je nového",
            "- **Reely** s voiceoverem, titulky a hudbou",
            "- **Stories** ve správném poměru stran",
            "- Rychlejší generování obrázků",
            "",
            "## Co to znamená pro vás",
            "Nic nastavovat nemusíte. Reel si objednáte stejně jako běžný příspěvek — jen stojí 5 kreditů místo jednoho.",
            "",
            "> Konečně nemusím řešit, co postnout.",
        ].join("\n"),
        imageUrl: "",
        ctaLabel: "Vyzkoušet reely",
        ctaUrl: `${siteUrl()}/dashboard/instagram`,
    },
    build: v => ({
        subject: v.headline,
        eyebrow: v.edition || undefined,
        blocks: compact([
            heading(v.headline),
            paragraph(v.intro),
            v.imageUrl && image(v.imageUrl, v.headline),
            ...markdownToBlocks(v.body),
            v.ctaUrl && button(v.ctaLabel || "Otevřít Chrlit", v.ctaUrl),
            paragraph("Tým Chrlit"),
        ]),
    }),
}

export const announcement: EmailTemplate = {
    id: "announcement",
    label: "Prosté oznámení",
    group: "news",
    kind: "notification",
    broadcast: true,
    fields: [
        { key: "headline", label: "Nadpis", type: "text", required: true },
        {
            key: "body", label: "Text", type: "textarea", required: true,
            help: "Prázdný řádek = nový odstavec. Značkování jako u novinek.",
        },
        { key: "ctaLabel", label: "Text tlačítka", type: "text" },
        { key: "ctaUrl", label: "Odkaz tlačítka", type: "url" },
    ],
    sample: {
        headline: "Plánovaná odstávka v neděli",
        body: "Dobrý den,\n\nv neděli 24. 8. mezi 2:00 a 4:00 bude Chrlit nedostupný kvůli údržbě databáze.\n\nNaplánované publikování se posune automaticky — nic neztratíte.",
        ctaLabel: "",
        ctaUrl: "",
    },
    build: v => ({
        subject: v.headline,
        blocks: compact([
            heading(v.headline),
            ...markdownToBlocks(v.body),
            v.ctaUrl && button(v.ctaLabel || "Otevřít Chrlit", v.ctaUrl),
            paragraph("Tým Chrlit"),
        ]),
    }),
}
