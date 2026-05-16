/**
 * Product Brief PDF Generator
 * ============================
 * Generates a professional product brief as styled HTML, opens it in
 * a new browser tab, and triggers the browser's print dialog (Save as PDF).
 *
 * Why this approach:
 * - Czech characters work perfectly (browser rendering)
 * - Tables render correctly everywhere
 * - Professional CSS print styling
 * - Zero external dependencies
 * - Works on all browsers
 */

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

export function generateProductBriefPDF(
    idea: ProductIdeaInput,
    analysis: ProductAnalysis,
    brandName: string,
    visualUrl?: string,
): void {
    const now = new Date().toLocaleDateString("cs-CZ", {
        year: "numeric",
        month: "long",
        day: "numeric",
    })

    const html = `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<title>Product Brief — ${esc(idea.name)}</title>
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

    :root {
        --brand: #E5534F;
        --dark: #1a1a1a;
        --medium: #333;
        --light: #666;
        --muted: #999;
        --bg: #f7f7f7;
        --border: #e0e0e0;
        --white: #fff;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--medium);
        font-size: 11pt;
        line-height: 1.5;
        background: white;
    }

    @page {
        size: A4;
        margin: 20mm 18mm 18mm 18mm;
    }

    @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
        .page-break { page-break-before: always; }
    }

    /* ─── Print button ─── */
    .print-bar {
        position: fixed; top: 0; left: 0; right: 0;
        background: var(--dark); color: white;
        padding: 12px 24px; display: flex; align-items: center; gap: 16px;
        z-index: 1000; font-size: 13px;
    }
    .print-bar button {
        background: var(--brand); color: white; border: none;
        padding: 8px 24px; border-radius: 6px; font-weight: 700;
        cursor: pointer; font-size: 13px;
    }
    .print-bar button:hover { opacity: 0.9; }

    .container { max-width: 210mm; margin: 0 auto; padding: 60px 0 0 0; }

    @media print { .container { padding: 0; max-width: none; } }

    /* ─── Cover ─── */
    .cover {
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; min-height: 90vh; text-align: center;
        padding: 60px 40px;
    }
    .cover-brand {
        font-size: 11pt; font-weight: 700; letter-spacing: 6px;
        color: var(--muted); text-transform: uppercase; margin-bottom: 16px;
    }
    .cover-title {
        font-size: 36pt; font-weight: 900; color: var(--dark);
        letter-spacing: -1px; margin-bottom: 8px;
    }
    .cover-line {
        width: 120px; height: 3px; background: var(--brand);
        margin: 16px auto 24px;
    }
    .cover-product {
        font-size: 22pt; font-weight: 800; color: var(--brand);
        margin-bottom: 8px;
    }
    .cover-tagline {
        font-size: 13pt; font-style: italic; color: var(--light);
        margin-bottom: 32px;
    }
    .cover-image {
        max-width: 340px; max-height: 340px; border-radius: 8px;
        margin-bottom: 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .cover-badge {
        display: inline-block; background: var(--brand); color: white;
        padding: 4px 16px; border-radius: 4px; font-size: 9pt;
        font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
        margin-bottom: 24px;
    }
    .cover-date { font-size: 9pt; color: var(--muted); }

    /* ─── Sections ─── */
    .section { margin-bottom: 32px; }

    h2 {
        font-size: 16pt; font-weight: 800; color: var(--dark);
        border-bottom: 2px solid var(--brand); padding-bottom: 6px;
        margin-bottom: 16px; letter-spacing: -0.3px;
    }
    h3 {
        font-size: 12pt; font-weight: 700; color: var(--dark);
        margin-bottom: 8px; margin-top: 20px;
    }
    p { margin-bottom: 10px; }

    .label-value { margin-bottom: 4px; }
    .label-value strong { color: var(--dark); }

    /* ─── Tables ─── */
    table {
        width: 100%; border-collapse: collapse; margin: 12px 0 20px;
        font-size: 10pt;
    }
    th {
        background: var(--dark); color: white; text-align: left;
        padding: 8px 12px; font-weight: 700; font-size: 8pt;
        letter-spacing: 1.5px; text-transform: uppercase;
    }
    td {
        padding: 7px 12px; border-bottom: 1px solid var(--border);
    }
    tr:nth-child(even) td { background: var(--bg); }
    td:first-child { font-weight: 600; color: var(--dark); }

    /* ─── Scenario colors ─── */
    .scenario-pessimistic td:first-child { color: #C62828; }
    .scenario-realistic td:first-child { color: #E65100; }
    .scenario-optimistic td:first-child { color: #2E7D32; }
    .scenario-pessimistic td:last-child,
    .scenario-realistic td:last-child,
    .scenario-optimistic td:last-child { font-weight: 700; }

    /* ─── Lists ─── */
    .numbered-list { list-style: none; padding: 0; counter-reset: item; }
    .numbered-list li {
        counter-increment: item; padding: 4px 0 4px 28px;
        position: relative;
    }
    .numbered-list li::before {
        content: counter(item) ".";
        position: absolute; left: 0; font-weight: 800;
        color: var(--brand); width: 22px;
    }
    ul.clean { list-style: none; padding: 0; }
    ul.clean li { padding: 3px 0 3px 20px; position: relative; }
    ul.clean li::before {
        content: "→"; position: absolute; left: 0; color: var(--brand);
        font-weight: 700;
    }
    ul.risk-list { list-style: none; padding: 0; }
    ul.risk-list li {
        padding: 6px 0 6px 24px; position: relative;
        border-left: 3px solid #FFA726; margin-bottom: 6px;
        background: #FFF8E1; padding-left: 12px; border-radius: 0 4px 4px 0;
    }

    /* ─── Supplier box ─── */
    .supplier-box {
        background: var(--bg); border-top: 3px solid var(--brand);
        border-radius: 0 0 6px 6px; padding: 20px 24px; margin-top: 12px;
        font-size: 10pt; line-height: 1.7;
    }
    .supplier-box .label {
        font-size: 8pt; font-weight: 700; letter-spacing: 2px;
        color: var(--brand); text-transform: uppercase; margin-bottom: 8px;
    }

    /* ─── Footer ─── */
    .page-footer {
        text-align: center; font-size: 8pt; color: var(--muted);
        padding-top: 24px; margin-top: 40px;
        border-top: 1px solid var(--border);
        letter-spacing: 2px; text-transform: uppercase;
    }

    /* ─── Header ─── */
    .page-header {
        text-align: right; font-size: 7pt; color: var(--muted);
        letter-spacing: 1.5px; text-transform: uppercase;
        margin-bottom: 20px; padding-bottom: 8px;
        border-bottom: 1px solid var(--border);
    }
</style>
</head>
<body>

<!-- Print button (hidden when printing) -->
<div class="print-bar no-print">
    <button onclick="window.print()">📄 Uložit jako PDF</button>
    <span>Otevře se dialogové okno — zvol „Uložit jako PDF"</span>
</div>

<div class="container">

<!-- ═══════════════════════════════════════════ -->
<!-- COVER PAGE -->
<!-- ═══════════════════════════════════════════ -->
<div class="cover">
    <div class="cover-brand">${esc(brandName)}</div>
    <div class="cover-title">PRODUCT BRIEF</div>
    <div class="cover-line"></div>
    <div class="cover-product">${esc(idea.name)}</div>
    <div class="cover-tagline">„${esc(idea.tagline)}"</div>
    ${visualUrl ? `<img src="${esc(visualUrl)}" class="cover-image" alt="${esc(idea.name)}" crossorigin="anonymous" />` : ""}
    <div class="cover-badge">${esc(idea.type)}</div>
    <div class="cover-date">Vytvořeno: ${now}</div>
</div>

<!-- ═══════════════════════════════════════════ -->
<!-- PRODUCT OVERVIEW -->
<!-- ═══════════════════════════════════════════ -->
<div class="page-break"></div>
<div class="page-header">${esc(brandName)} &middot; PRODUCT BRIEF &middot; ${esc(idea.name)}</div>

<div class="section">
    <h2>1&ensp;Přehled produktu</h2>
    <p>${esc(idea.description)}</p>

    <table>
        <tr><th style="width:40%">Vlastnost</th><th>Hodnota</th></tr>
        <tr><td>Typ produktu</td><td>${esc(idea.type)}</td></tr>
        <tr><td>Materiál</td><td>${esc(idea.material)}</td></tr>
        <tr><td>Rozměry</td><td>${esc(idea.dimensions)}</td></tr>
        <tr><td>Výrobní metoda</td><td>${esc(idea.manufacturingMethod)}</td></tr>
        <tr><td>Cenový rozsah</td><td>${esc(idea.priceRange)}</td></tr>
    </table>

    <h3>Produkční poznámky</h3>
    <p>${esc(idea.productionNotes)}</p>
</div>

<!-- BRANDING -->
<div class="section">
    <h2>2&ensp;Branding &amp; Naming</h2>
    <p>Navrhované varianty názvu:</p>
    <ol class="numbered-list">
        ${idea.brandingNames.map(n => `<li>${esc(n)}</li>`).join("\n        ")}
    </ol>
</div>

<!-- VARIANTS -->
<div class="section">
    <h2>3&ensp;Varianty produktu</h2>
    <ul class="clean">
        ${idea.variants.map(v => `<li>${esc(v)}</li>`).join("\n        ")}
    </ul>
</div>

<!-- ═══════════════════════════════════════════ -->
<!-- BUSINESS ANALYSIS -->
<!-- ═══════════════════════════════════════════ -->
<div class="page-break"></div>
<div class="page-header">${esc(brandName)} &middot; PRODUCT BRIEF &middot; ${esc(idea.name)}</div>

<div class="section">
    <h2>4&ensp;Business analýza</h2>
    <h3>Pricing, náklady &amp; marže</h3>
    <table>
        <tr><th style="width:55%">Parametr</th><th>Hodnota</th></tr>
        <tr><td>Odhadovaná cena/ks (sourcing)</td><td>${esc(analysis.estimatedUnitCost)}</td></tr>
        <tr><td>Doporučená prodejní cena</td><td><strong>${esc(analysis.recommendedRetailPrice)}</strong></td></tr>
        <tr><td>Marže na kus</td><td>${esc(analysis.marginPerUnit)}</td></tr>
        <tr><td>Procentuální marže</td><td><strong>${esc(analysis.marginPercent)}</strong></td></tr>
        <tr><td>MOQ od dodavatele</td><td>${esc(analysis.moqRecommendation)}</td></tr>
        <tr><td>Doporučená 1. objednávka</td><td>${esc(analysis.firstBatchSize)}</td></tr>
        <tr><td>Náklady 1. várky</td><td>${esc(analysis.firstBatchCost)}</td></tr>
        <tr><td>Break-even</td><td>${esc(analysis.breakEvenUnits)}</td></tr>
        <tr><td>Čas od objednávky po prodej</td><td>${esc(analysis.timeline)}</td></tr>
    </table>
</div>

<!-- REVENUE SCENARIOS -->
<div class="section">
    <h2>5&ensp;Scénáře výdělku&ensp;(3 měsíce)</h2>
    <table>
        <tr><th style="width:30%">Scénář</th><th>Prodané ks</th><th>Tržby</th><th>Čistý zisk</th></tr>
        <tr class="scenario-pessimistic">
            <td>🔴 Pesimistický</td>
            <td>${esc(analysis.revenueScenarios.pessimistic.units)}</td>
            <td>${esc(analysis.revenueScenarios.pessimistic.revenue)}</td>
            <td>${esc(analysis.revenueScenarios.pessimistic.profit)}</td>
        </tr>
        <tr class="scenario-realistic">
            <td>🟡 Realistický</td>
            <td>${esc(analysis.revenueScenarios.realistic.units)}</td>
            <td>${esc(analysis.revenueScenarios.realistic.revenue)}</td>
            <td>${esc(analysis.revenueScenarios.realistic.profit)}</td>
        </tr>
        <tr class="scenario-optimistic">
            <td>🟢 Optimistický</td>
            <td>${esc(analysis.revenueScenarios.optimistic.units)}</td>
            <td>${esc(analysis.revenueScenarios.optimistic.revenue)}</td>
            <td>${esc(analysis.revenueScenarios.optimistic.profit)}</td>
        </tr>
    </table>
</div>

<!-- ═══════════════════════════════════════════ -->
<!-- MARKETING -->
<!-- ═══════════════════════════════════════════ -->
<div class="page-break"></div>
<div class="page-header">${esc(brandName)} &middot; PRODUCT BRIEF &middot; ${esc(idea.name)}</div>

<div class="section">
    <h2>6&ensp;Marketing &amp; cílová skupina</h2>

    <h3>Cílová skupina</h3>
    <p>${esc(analysis.targetAudience)}</p>

    <h3>Analýza konkurence</h3>
    <p>${esc(analysis.competitorAnalysis)}</p>

    <h3>Virální potenciál</h3>
    <p>${esc(idea.viralAngle)}</p>

    <h3>Proč to bude fungovat</h3>
    <p>${esc(idea.whyItWorks)}</p>
</div>

<!-- LAUNCH STRATEGY -->
<div class="section">
    <h2>7&ensp;Launch strategie</h2>
    <ol class="numbered-list">
        ${analysis.launchStrategy.map(s => `<li>${esc(s)}</li>`).join("\n        ")}
    </ol>
</div>

<!-- RISKS -->
<div class="section">
    <h2>8&ensp;Rizika &amp; mitigace</h2>
    <ul class="risk-list">
        ${analysis.risks.map(r => `<li>${esc(r)}</li>`).join("\n        ")}
    </ul>
</div>

<!-- ═══════════════════════════════════════════ -->
<!-- SUPPLIER -->
<!-- ═══════════════════════════════════════════ -->
<div class="page-break"></div>
<div class="page-header">${esc(brandName)} &middot; PRODUCT BRIEF &middot; ${esc(idea.name)}</div>

<div class="section">
    <h2>9&ensp;Zpráva pro dodavatele</h2>
    <p>Hotová anglická zpráva připravená k odeslání na Alibaba / Made-in-China:</p>
    <div class="supplier-box">
        <div class="label">Supplier Inquiry</div>
        ${idea.supplierMessage.split("\n").filter(Boolean).map(line => `<p>${esc(line)}</p>`).join("\n        ")}
    </div>
</div>

<!-- FOOTER -->
<div class="page-footer">
    Confidential &middot; ${now} &middot; Vygenerováno AI systémem ${esc(brandName)}
</div>

</div>
</body>
</html>`

    // Open in new tab and trigger print
    const blob = new Blob([html], { type: "text/html;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, "_blank")
    if (win) {
        // Auto-trigger print after images load
        win.addEventListener("load", () => {
            setTimeout(() => {
                // Revoke URL after print dialog closes
                win.addEventListener("afterprint", () => URL.revokeObjectURL(url))
            }, 500)
        })
    }
}

/** Escape HTML entities */
function esc(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}
