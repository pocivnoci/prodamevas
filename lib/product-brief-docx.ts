/**
 * Product Brief DOCX Generator
 * =============================
 * Generates a professional .docx document from a ProductIdea + AI business analysis.
 * Runs entirely client-side using the `docx` npm package.
 */

import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    BorderStyle,
    HeadingLevel,
    ShadingType,
    ImageRun,
} from "docx"
import { saveAs } from "file-saver"
import type { ProductAnalysis } from "@/app/actions/product-brief-actions"

interface ProductIdeaInput {
    name: string
    brandingNames: string[]
    type: string
    tagline: string
    description: string
    material: string
    dimensions: string
    manufacturingMethod: string
    priceRange: string
    viralAngle: string
    whyItWorks: string
    productionNotes: string
    variants: string[]
    supplierMessage: string
}

// ─── Helpers ─────────────────────────────────────────────────

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1): Paragraph {
    return new Paragraph({ heading: level, children: [new TextRun({ text, bold: true })] })
}

function body(text: string): Paragraph {
    return new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text, size: 22 })],
    })
}

function bulletItem(text: string): Paragraph {
    return new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 60 },
        children: [new TextRun({ text, size: 22 })],
    })
}

function labelValue(label: string, value: string): Paragraph {
    return new Paragraph({
        spacing: { after: 80 },
        children: [
            new TextRun({ text: `${label}: `, bold: true, size: 22 }),
            new TextRun({ text: value, size: 22 }),
        ],
    })
}

function divider(): Paragraph {
    return new Paragraph({
        spacing: { before: 200, after: 200 },
        border: {
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
        },
        children: [],
    })
}

function makeTable(headers: string[], rows: string[][]): Table {
    const noBorder = { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" }
    const borders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                children: headers.map(h => new TableCell({
                    borders,
                    shading: { type: ShadingType.SOLID, color: "2D2D2D" },
                    width: { size: Math.floor(100 / headers.length), type: WidthType.PERCENTAGE },
                    children: [new Paragraph({
                        children: [new TextRun({ text: h, bold: true, size: 20, color: "FFFFFF" })],
                    })],
                })),
            }),
            ...rows.map(row => new TableRow({
                children: row.map(cell => new TableCell({
                    borders,
                    children: [new Paragraph({
                        children: [new TextRun({ text: cell, size: 20 })],
                    })],
                })),
            })),
        ],
    })
}

// ─── Main Generator ──────────────────────────────────────────

export async function generateProductBriefDOCX(
    idea: ProductIdeaInput,
    analysis: ProductAnalysis,
    brandName: string,
    visualUrl?: string,
): Promise<void> {
    const now = new Date().toLocaleDateString("cs-CZ", {
        year: "numeric",
        month: "long",
        day: "numeric",
    })

    // Try to fetch product visual for embedding
    let imageRun: ImageRun | null = null
    if (visualUrl) {
        try {
            const response = await fetch(visualUrl)
            const blob = await response.blob()
            const buffer = await blob.arrayBuffer()
            imageRun = new ImageRun({
                data: buffer,
                transformation: { width: 300, height: 300 },
                type: "png",
            })
        } catch {
            // Skip image if fetch fails
        }
    }

    const sections: (Paragraph | Table)[] = []

    // ─── COVER ───────────────────────────────────────────────
    sections.push(
        new Paragraph({ spacing: { before: 800 }, children: [] }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [new TextRun({ text: brandName.toUpperCase(), size: 28, bold: true, color: "888888" })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({ text: "PRODUCT BRIEF", size: 52, bold: true })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [new TextRun({ text: idea.name, size: 36, bold: true, color: "E5534F" })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({ text: `„${idea.tagline}"`, size: 24, italics: true, color: "666666" })],
        }),
    )

    // Product visual
    if (imageRun) {
        sections.push(
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
                children: [imageRun],
            }),
        )
    }

    sections.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: now, size: 20, color: "999999" })],
        }),
        new Paragraph({ children: [], pageBreakBefore: true }),
    )

    // ─── 1. PŘEHLED PRODUKTU ─────────────────────────────────
    sections.push(
        heading("1. Přehled produktu"),
        labelValue("Název", idea.name),
        labelValue("Typ", idea.type),
        labelValue("Tagline", idea.tagline),
        body(idea.description),
        divider(),
        labelValue("Materiál", idea.material),
        labelValue("Rozměry", idea.dimensions),
        labelValue("Výroba", idea.manufacturingMethod),
        labelValue("Produkční poznámky", idea.productionNotes),
    )

    // ─── 2. BRANDING OPTIONS ─────────────────────────────────
    sections.push(
        divider(),
        heading("2. Varianty názvů"),
        body("Alternativní názvy pro branding a marketing:"),
    )
    idea.brandingNames.forEach((name, i) => {
        sections.push(bulletItem(`${i + 1}. ${name}`))
    })

    // ─── 3. VARIANTY PRODUKTU ────────────────────────────────
    sections.push(
        divider(),
        heading("3. Varianty produktu"),
    )
    idea.variants.forEach(v => sections.push(bulletItem(v)))

    // ─── 4. BUSINESS ANALÝZA ─────────────────────────────────
    sections.push(
        new Paragraph({ children: [], pageBreakBefore: true }),
        heading("4. Business analýza"),
        heading("Pricing & marže", HeadingLevel.HEADING_2),
        makeTable(
            ["Parametr", "Hodnota"],
            [
                ["Odhadovaná cena/ks (sourcing)", analysis.estimatedUnitCost],
                ["Doporučená prodejní cena", analysis.recommendedRetailPrice],
                ["Marže na kus", analysis.marginPerUnit],
                ["Procentuální marže", analysis.marginPercent],
                ["MOQ od dodavatele", analysis.moqRecommendation],
                ["Doporučená první objednávka", analysis.firstBatchSize],
                ["Náklady první várky", analysis.firstBatchCost],
                ["Break-even (bod zvratu)", analysis.breakEvenUnits],
                ["Časový rámec", analysis.timeline],
            ],
        ),
    )

    // ─── 5. SCÉNÁŘE VÝDĚLKU ──────────────────────────────────
    sections.push(
        divider(),
        heading("5. Scénáře výdělku (3 měsíce)", HeadingLevel.HEADING_2),
        makeTable(
            ["Scénář", "Prodané kusy", "Tržby", "Čistý zisk"],
            [
                ["🔴 Pesimistický", analysis.revenueScenarios.pessimistic.units, analysis.revenueScenarios.pessimistic.revenue, analysis.revenueScenarios.pessimistic.profit],
                ["🟡 Realistický", analysis.revenueScenarios.realistic.units, analysis.revenueScenarios.realistic.revenue, analysis.revenueScenarios.realistic.profit],
                ["🟢 Optimistický", analysis.revenueScenarios.optimistic.units, analysis.revenueScenarios.optimistic.revenue, analysis.revenueScenarios.optimistic.profit],
            ],
        ),
    )

    // ─── 6. MARKETING ────────────────────────────────────────
    sections.push(
        new Paragraph({ children: [], pageBreakBefore: true }),
        heading("6. Marketing & cílová skupina"),
        heading("Cílová skupina", HeadingLevel.HEADING_2),
        body(analysis.targetAudience),
        heading("Konkurence", HeadingLevel.HEADING_2),
        body(analysis.competitorAnalysis),
        heading("Virální potenciál", HeadingLevel.HEADING_2),
        body(idea.viralAngle),
        heading("Proč to bude fungovat", HeadingLevel.HEADING_2),
        body(idea.whyItWorks),
    )

    // ─── 7. LAUNCH STRATEGIE ─────────────────────────────────
    sections.push(
        divider(),
        heading("7. Launch strategie"),
    )
    analysis.launchStrategy.forEach((step, i) => {
        sections.push(bulletItem(`${i + 1}. ${step}`))
    })

    // ─── 8. RIZIKA ───────────────────────────────────────────
    sections.push(
        divider(),
        heading("8. Rizika & mitigace"),
    )
    analysis.risks.forEach(risk => sections.push(bulletItem(risk)))

    // ─── 9. ZPRÁVA PRO DODAVATELE ────────────────────────────
    sections.push(
        new Paragraph({ children: [], pageBreakBefore: true }),
        heading("9. Zpráva pro dodavatele (Alibaba)"),
        body("Hotová anglická zpráva k odeslání dodavateli:"),
        new Paragraph({
            spacing: { before: 100, after: 200 },
            shading: { type: ShadingType.SOLID, color: "F5F5F5" },
            children: [new TextRun({ text: idea.supplierMessage, size: 20, italics: true })],
        }),
    )

    // ─── BUILD DOCUMENT ──────────────────────────────────────
    const doc = new Document({
        creator: brandName,
        title: `Product Brief — ${idea.name}`,
        description: `Business brief pro produkt ${idea.name} od ${brandName}`,
        sections: [{
            properties: {},
            children: sections,
        }],
    })

    const blob = await Packer.toBlob(doc)
    const safeName = idea.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_áčďéěíňóřšťúůýž]/g, "").slice(0, 30)
    saveAs(blob, `product_brief_${safeName}.docx`)
}
