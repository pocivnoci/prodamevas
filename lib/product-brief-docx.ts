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
    PageBreak,
    Header,
    Footer,
    TabStopType,
    TabStopPosition,
    convertInchesToTwip,
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

// ─── Colors ──────────────────────────────────────────────────
const C = {
    brand: "E5534F",       // cinnabar
    dark: "1A1A1A",
    medium: "333333",
    light: "666666",
    muted: "999999",
    bg: "F7F7F7",
    bgAlt: "EFEFEF",
    white: "FFFFFF",
    border: "D0D0D0",
    borderLight: "E5E5E5",
    green: "2E7D32",
    amber: "E65100",
    red: "C62828",
}

// ─── Reusable builders ──────────────────────────────────────

const CELL_MARGIN = {
    top: convertInchesToTwip(0.06),
    bottom: convertInchesToTwip(0.06),
    left: convertInchesToTwip(0.12),
    right: convertInchesToTwip(0.12),
}

const TABLE_BORDER = {
    style: BorderStyle.SINGLE,
    size: 1,
    color: C.border,
}

const TABLE_BORDERS = {
    top: TABLE_BORDER,
    bottom: TABLE_BORDER,
    left: TABLE_BORDER,
    right: TABLE_BORDER,
}

function sectionTitle(text: string): Paragraph {
    return new Paragraph({
        spacing: { before: 360, after: 160 },
        children: [
            new TextRun({ text, bold: true, size: 28, font: "Calibri", color: C.dark }),
        ],
    })
}

function subTitle(text: string): Paragraph {
    return new Paragraph({
        spacing: { before: 240, after: 100 },
        children: [
            new TextRun({ text, bold: true, size: 22, font: "Calibri", color: C.medium }),
        ],
    })
}

function bodyText(text: string): Paragraph {
    return new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({ text, size: 20, font: "Calibri", color: C.medium })],
    })
}

function labelValueRow(label: string, value: string): Paragraph {
    return new Paragraph({
        spacing: { after: 60 },
        children: [
            new TextRun({ text: `${label}:  `, bold: true, size: 20, font: "Calibri", color: C.dark }),
            new TextRun({ text: value, size: 20, font: "Calibri", color: C.medium }),
        ],
    })
}

function bulletPoint(text: string, color = C.medium): Paragraph {
    return new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 50 },
        children: [new TextRun({ text, size: 20, font: "Calibri", color })],
    })
}

function spacer(pts = 100): Paragraph {
    return new Paragraph({ spacing: { before: pts }, children: [] })
}

function dividerLine(): Paragraph {
    return new Paragraph({
        spacing: { before: 200, after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.borderLight } },
        children: [],
    })
}

function numberedItem(num: number, text: string): Paragraph {
    return new Paragraph({
        spacing: { after: 60 },
        children: [
            new TextRun({ text: `${num}. `, bold: true, size: 20, font: "Calibri", color: C.brand }),
            new TextRun({ text, size: 20, font: "Calibri", color: C.medium }),
        ],
    })
}

// ─── Professional table ──────────────────────────────────────

function proTable(headers: string[], rows: string[][], widths?: number[]): Table {
    const colCount = headers.length
    const defaultWidth = Math.floor(100 / colCount)

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            // Header row
            new TableRow({
                tableHeader: true,
                children: headers.map((h, i) => new TableCell({
                    borders: TABLE_BORDERS,
                    shading: { type: ShadingType.SOLID, color: C.dark },
                    margins: CELL_MARGIN,
                    width: { size: widths?.[i] ?? defaultWidth, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({
                        spacing: { before: 40, after: 40 },
                        children: [new TextRun({
                            text: h.toUpperCase(),
                            bold: true,
                            size: 17,
                            font: "Calibri",
                            color: C.white,
                        })],
                    })],
                })),
            }),
            // Data rows with alternating background
            ...rows.map((row, rowIdx) => new TableRow({
                children: row.map((cell, i) => new TableCell({
                    borders: TABLE_BORDERS,
                    shading: { type: ShadingType.SOLID, color: rowIdx % 2 === 0 ? C.white : C.bg },
                    margins: CELL_MARGIN,
                    width: { size: widths?.[i] ?? defaultWidth, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({
                        spacing: { before: 30, after: 30 },
                        children: [new TextRun({
                            text: cell,
                            size: 19,
                            font: "Calibri",
                            color: i === 0 ? C.dark : C.medium,
                            bold: i === 0,
                        })],
                    })],
                })),
            })),
        ],
    })
}

// ─── Accent table (colored first column) ─────────────────────

function accentTable(rows: [string, string, string, string][], headerColor: string): Table {
    const headers = ["Scénář", "Prodané ks", "Tržby", "Čistý zisk"]
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                tableHeader: true,
                children: headers.map((h, i) => new TableCell({
                    borders: TABLE_BORDERS,
                    shading: { type: ShadingType.SOLID, color: C.dark },
                    margins: CELL_MARGIN,
                    width: { size: [35, 20, 22, 23][i], type: WidthType.PERCENTAGE },
                    children: [new Paragraph({
                        spacing: { before: 40, after: 40 },
                        children: [new TextRun({ text: h.toUpperCase(), bold: true, size: 17, font: "Calibri", color: C.white })],
                    })],
                })),
            }),
            ...rows.map((row, rowIdx) => {
                const colors = [C.red, C.amber, C.green]
                return new TableRow({
                    children: row.map((cell, i) => new TableCell({
                        borders: TABLE_BORDERS,
                        shading: { type: ShadingType.SOLID, color: rowIdx % 2 === 0 ? C.white : C.bg },
                        margins: CELL_MARGIN,
                        children: [new Paragraph({
                            spacing: { before: 30, after: 30 },
                            children: [new TextRun({
                                text: cell,
                                size: 19,
                                font: "Calibri",
                                color: i === 0 ? colors[rowIdx] || C.dark : C.medium,
                                bold: i === 0 || i === 3,
                            })],
                        })],
                    })),
                })
            }),
        ],
    })
}

// ─── Image fetcher ───────────────────────────────────────────

async function fetchImage(url: string, maxWidth = 420, maxHeight = 420): Promise<ImageRun | null> {
    try {
        const res = await fetch(url)
        if (!res.ok) return null
        const blob = await res.blob()
        const buffer = await blob.arrayBuffer()

        // Try to detect actual dimensions from the image
        // For now use reasonable defaults
        return new ImageRun({
            data: buffer,
            transformation: { width: maxWidth, height: maxHeight },
            type: "png",
        })
    } catch {
        return null
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════

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

    // Fetch product image
    const imageRun = visualUrl ? await fetchImage(visualUrl, 380, 380) : null

    const content: (Paragraph | Table)[] = []

    // ═══════════════════════════════════════════════════════════
    // PAGE 1: COVER
    // ═══════════════════════════════════════════════════════════

    content.push(
        spacer(600),
        // Brand
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
            children: [new TextRun({
                text: brandName.toUpperCase(),
                size: 22,
                font: "Calibri",
                bold: true,
                color: C.muted,
                characterSpacing: 200,
            })],
        }),
        // Title
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 40 },
            children: [new TextRun({
                text: "PRODUCT BRIEF",
                size: 56,
                font: "Calibri",
                bold: true,
                color: C.dark,
            })],
        }),
        // Decorative line
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [new TextRun({
                text: "━━━━━━━━━━━━━━━━━━━",
                size: 20,
                color: C.brand,
            })],
        }),
        // Product name
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
            children: [new TextRun({
                text: idea.name,
                size: 40,
                font: "Calibri",
                bold: true,
                color: C.brand,
            })],
        }),
        // Tagline
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({
                text: `„${idea.tagline}"`,
                size: 24,
                font: "Calibri",
                italics: true,
                color: C.light,
            })],
        }),
    )

    // Product image on cover
    if (imageRun) {
        content.push(
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
                children: [imageRun],
            }),
        )
    }

    // Type badge + date
    content.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
            children: [new TextRun({
                text: idea.type.toUpperCase(),
                size: 18,
                font: "Calibri",
                bold: true,
                color: C.white,
                shading: { type: ShadingType.SOLID, color: C.brand },
            })],
        }),
        spacer(200),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
                text: `Vytvořeno: ${now}`,
                size: 18,
                font: "Calibri",
                color: C.muted,
            })],
        }),
        // Page break
        new Paragraph({ children: [new PageBreak()] }),
    )

    // ═══════════════════════════════════════════════════════════
    // PAGE 2: PŘEHLED PRODUKTU
    // ═══════════════════════════════════════════════════════════

    content.push(
        sectionTitle("1  PŘEHLED PRODUKTU"),
        bodyText(idea.description),
        spacer(80),
        proTable(
            ["Vlastnost", "Hodnota"],
            [
                ["Typ produktu", idea.type],
                ["Materiál", idea.material],
                ["Rozměry", idea.dimensions],
                ["Výrobní metoda", idea.manufacturingMethod],
                ["Cenový rozsah", idea.priceRange],
            ],
            [40, 60],
        ),
    )

    // Production notes
    content.push(
        spacer(80),
        subTitle("Produkční poznámky"),
        bodyText(idea.productionNotes),
    )

    // ─── Branding Names ──────────────────────────────────────
    content.push(
        dividerLine(),
        sectionTitle("2  BRANDING & NAMING"),
        bodyText("Navrhované varianty názvu pro různé kontexty (e-shop, IG, balení):"),
        spacer(40),
    )
    idea.brandingNames.forEach((name, i) => {
        content.push(numberedItem(i + 1, name))
    })

    // ─── Product Variants ────────────────────────────────────
    content.push(
        dividerLine(),
        sectionTitle("3  VARIANTY PRODUKTU"),
        bodyText("Barevné, materiálové a designové varianty:"),
        spacer(40),
    )
    idea.variants.forEach(v => content.push(bulletPoint(v)))

    // Page break
    content.push(new Paragraph({ children: [new PageBreak()] }))

    // ═══════════════════════════════════════════════════════════
    // PAGE 3: BUSINESS ANALÝZA
    // ═══════════════════════════════════════════════════════════

    content.push(
        sectionTitle("4  BUSINESS ANALÝZA"),
        subTitle("Pricing, náklady & marže"),
        spacer(40),
        proTable(
            ["Parametr", "Hodnota"],
            [
                ["Odhadovaná cena za kus (sourcing)", analysis.estimatedUnitCost],
                ["Doporučená prodejní cena", analysis.recommendedRetailPrice],
                ["Marže na kus", analysis.marginPerUnit],
                ["Procentuální marže", analysis.marginPercent],
                ["MOQ od dodavatele", analysis.moqRecommendation],
                ["Doporučená 1. objednávka", analysis.firstBatchSize],
                ["Náklady 1. várky", analysis.firstBatchCost],
                ["Break-even (bod zvratu)", analysis.breakEvenUnits],
                ["Čas od objednávky po prodej", analysis.timeline],
            ],
            [55, 45],
        ),
    )

    // ─── Revenue Scenarios ───────────────────────────────────
    content.push(
        dividerLine(),
        sectionTitle("5  SCÉNÁŘE VÝDĚLKU  (3 měsíce)"),
        spacer(40),
        accentTable(
            [
                ["Pesimistický",  analysis.revenueScenarios.pessimistic.units,  analysis.revenueScenarios.pessimistic.revenue,  analysis.revenueScenarios.pessimistic.profit],
                ["Realistický",   analysis.revenueScenarios.realistic.units,    analysis.revenueScenarios.realistic.revenue,    analysis.revenueScenarios.realistic.profit],
                ["Optimistický",  analysis.revenueScenarios.optimistic.units,   analysis.revenueScenarios.optimistic.revenue,   analysis.revenueScenarios.optimistic.profit],
            ],
            C.brand,
        ),
    )

    // Page break
    content.push(new Paragraph({ children: [new PageBreak()] }))

    // ═══════════════════════════════════════════════════════════
    // PAGE 4: MARKETING
    // ═══════════════════════════════════════════════════════════

    content.push(
        sectionTitle("6  MARKETING & CÍLOVÁ SKUPINA"),
        subTitle("Cílová skupina"),
        bodyText(analysis.targetAudience),
        spacer(80),
        subTitle("Analýza konkurence"),
        bodyText(analysis.competitorAnalysis),
        spacer(80),
        subTitle("Virální potenciál"),
        bodyText(idea.viralAngle),
        spacer(80),
        subTitle("Proč to bude fungovat"),
        bodyText(idea.whyItWorks),
    )

    // ─── Launch Strategy ─────────────────────────────────────
    content.push(
        dividerLine(),
        sectionTitle("7  LAUNCH STRATEGIE"),
        spacer(40),
    )
    analysis.launchStrategy.forEach((step, i) => {
        content.push(numberedItem(i + 1, step))
    })

    // ─── Risks ───────────────────────────────────────────────
    content.push(
        dividerLine(),
        sectionTitle("8  RIZIKA & MITIGACE"),
        spacer(40),
    )
    analysis.risks.forEach(risk => {
        content.push(bulletPoint(`⚠  ${risk}`, C.dark))
    })

    // Page break
    content.push(new Paragraph({ children: [new PageBreak()] }))

    // ═══════════════════════════════════════════════════════════
    // PAGE 5: SUPPLIER MESSAGE
    // ═══════════════════════════════════════════════════════════

    content.push(
        sectionTitle("9  ZPRÁVA PRO DODAVATELE"),
        bodyText("Hotová anglická zpráva připravená k odeslání na Alibaba / Made-in-China:"),
        spacer(80),
    )

    // Supplier message in a styled box (using a single-cell table as a "box")
    content.push(
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({
                children: [new TableCell({
                    borders: {
                        top: { style: BorderStyle.SINGLE, size: 2, color: C.brand },
                        bottom: { style: BorderStyle.SINGLE, size: 1, color: C.borderLight },
                        left: { style: BorderStyle.SINGLE, size: 1, color: C.borderLight },
                        right: { style: BorderStyle.SINGLE, size: 1, color: C.borderLight },
                    },
                    shading: { type: ShadingType.SOLID, color: C.bg },
                    margins: {
                        top: convertInchesToTwip(0.15),
                        bottom: convertInchesToTwip(0.15),
                        left: convertInchesToTwip(0.2),
                        right: convertInchesToTwip(0.2),
                    },
                    children: [
                        new Paragraph({
                            spacing: { after: 80 },
                            children: [new TextRun({
                                text: "SUPPLIER INQUIRY",
                                bold: true,
                                size: 18,
                                font: "Calibri",
                                color: C.brand,
                                characterSpacing: 100,
                            })],
                        }),
                        ...idea.supplierMessage.split("\n").filter(Boolean).map(line =>
                            new Paragraph({
                                spacing: { after: 60 },
                                children: [new TextRun({
                                    text: line,
                                    size: 19,
                                    font: "Calibri",
                                    color: C.medium,
                                })],
                            })
                        ),
                    ],
                })],
            })],
        }),
    )

    // ─── Footer note ─────────────────────────────────────────
    content.push(
        spacer(300),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
                text: `— Dokument vygenerován AI systémem ${brandName} —`,
                size: 16,
                font: "Calibri",
                color: C.muted,
                italics: true,
            })],
        }),
    )

    // ═══════════════════════════════════════════════════════════
    // BUILD & DOWNLOAD
    // ═══════════════════════════════════════════════════════════

    const doc = new Document({
        creator: brandName,
        title: `Product Brief — ${idea.name}`,
        description: `Business brief pro produkt ${idea.name}`,
        styles: {
            default: {
                document: {
                    run: { font: "Calibri", size: 20, color: C.medium },
                },
                listParagraph: {
                    run: { font: "Calibri", size: 20 },
                },
            },
        },
        sections: [{
            properties: {
                page: {
                    margin: {
                        top: convertInchesToTwip(0.8),
                        bottom: convertInchesToTwip(0.7),
                        left: convertInchesToTwip(0.9),
                        right: convertInchesToTwip(0.9),
                    },
                },
            },
            headers: {
                default: new Header({
                    children: [new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [new TextRun({
                            text: `${brandName.toUpperCase()}  ·  PRODUCT BRIEF  ·  ${idea.name}`,
                            size: 14,
                            font: "Calibri",
                            color: C.muted,
                            characterSpacing: 60,
                        })],
                    })],
                }),
            },
            footers: {
                default: new Footer({
                    children: [new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({
                            text: `CONFIDENTIAL  ·  ${now}`,
                            size: 14,
                            font: "Calibri",
                            color: C.muted,
                            characterSpacing: 80,
                        })],
                    })],
                }),
            },
            children: content,
        }],
    })

    const blob = await Packer.toBlob(doc)
    const safeName = idea.name
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_áčďéěíňóřšťúůýž]/g, "")
        .slice(0, 30)
    saveAs(blob, `product_brief_${safeName}.docx`)
}
