"use server"

import { loadConfig } from "@/instagram/configs"
import { generateText } from "@/instagram/gemini-client"
import { Type } from "@google/genai"
import { creditGuard } from "./credit-guard"

// ============================================
// PRODUCT BRIEF — AI Business Analysis
// ============================================

export interface ProductAnalysis {
    estimatedUnitCost: string
    recommendedRetailPrice: string
    marginPerUnit: string
    marginPercent: string
    moqRecommendation: string
    firstBatchSize: string
    firstBatchCost: string
    breakEvenUnits: string
    revenueScenarios: {
        pessimistic: { units: string; revenue: string; profit: string }
        realistic: { units: string; revenue: string; profit: string }
        optimistic: { units: string; revenue: string; profit: string }
    }
    targetAudience: string
    competitorAnalysis: string
    launchStrategy: string[]
    risks: string[]
    timeline: string
}

const ANALYSIS_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        estimatedUnitCost: { type: Type.STRING, description: "Odhadovaná cena za kus při objednávce z Číny (včetně dopravy, cla), např. '45-65 Kč'" },
        recommendedRetailPrice: { type: Type.STRING, description: "Doporučená prodejní cena pro zákazníka, např. '349 Kč'" },
        marginPerUnit: { type: Type.STRING, description: "Marže na kus v Kč, např. '284 Kč'" },
        marginPercent: { type: Type.STRING, description: "Procentuální marže, např. '81%'" },
        moqRecommendation: { type: Type.STRING, description: "Doporučené MOQ (minimum order quantity) od dodavatele, např. '100 ks'" },
        firstBatchSize: { type: Type.STRING, description: "Kolik kusů objednat v první várce — realisticky, např. '50-100 ks'" },
        firstBatchCost: { type: Type.STRING, description: "Celková cena první várky, např. '3 250 - 6 500 Kč'" },
        breakEvenUnits: { type: Type.STRING, description: "Kolik kusů musíš prodat aby se investice vrátila, např. '12 ks'" },
        revenueScenarios: {
            type: Type.OBJECT,
            properties: {
                pessimistic: {
                    type: Type.OBJECT,
                    properties: {
                        units: { type: Type.STRING, description: "Prodané kusy za 3 měsíce (pesimistický)" },
                        revenue: { type: Type.STRING, description: "Tržby" },
                        profit: { type: Type.STRING, description: "Čistý zisk" },
                    },
                    required: ["units", "revenue", "profit"],
                },
                realistic: {
                    type: Type.OBJECT,
                    properties: {
                        units: { type: Type.STRING, description: "Prodané kusy za 3 měsíce (realistický)" },
                        revenue: { type: Type.STRING, description: "Tržby" },
                        profit: { type: Type.STRING, description: "Čistý zisk" },
                    },
                    required: ["units", "revenue", "profit"],
                },
                optimistic: {
                    type: Type.OBJECT,
                    properties: {
                        units: { type: Type.STRING, description: "Prodané kusy za 3 měsíce (optimistický)" },
                        revenue: { type: Type.STRING, description: "Tržby" },
                        profit: { type: Type.STRING, description: "Čistý zisk" },
                    },
                    required: ["units", "revenue", "profit"],
                },
            },
            required: ["pessimistic", "realistic", "optimistic"],
        },
        targetAudience: { type: Type.STRING, description: "Cílová skupina — demografika, zájmy, chování (2-3 věty)" },
        competitorAnalysis: { type: Type.STRING, description: "Stručná analýza konkurence — kdo prodává něco podobného, za kolik, v čem jsme lepší (3-4 věty)" },
        launchStrategy: { type: Type.ARRAY, items: { type: Type.STRING }, description: "5 kroků launch strategie — konkrétní akce pro uvedení produktu na trh" },
        risks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3-4 hlavní rizika a jak je mitigovat" },
        timeline: { type: Type.STRING, description: "Časový odhad od objednávky po první prodej, např. '6-8 týdnů'" },
    },
    required: ["estimatedUnitCost", "recommendedRetailPrice", "marginPerUnit", "marginPercent", "moqRecommendation", "firstBatchSize", "firstBatchCost", "breakEvenUnits", "revenueScenarios", "targetAudience", "competitorAnalysis", "launchStrategy", "risks", "timeline"],
}

export async function analyzeProductForBrief(
    configName: string,
    idea: {
        name: string
        type: string
        description: string
        material: string
        dimensions: string
        manufacturingMethod: string
        priceRange: string
        variants: string[]
        supplierMessage: string
        viralAngle: string
        whyItWorks: string
        productionNotes: string
    }
): Promise<{ success: boolean; analysis?: ProductAnalysis; error?: string }> {
    try {
        // Credit check — brief costs 5 credits
        const guard = await creditGuard(configName, "product_brief")
        if (!guard.ok) return { success: false, error: guard.error }

        const config = await loadConfig(configName)

        const prompt = `Jsi product business analyst. Na základě produktového nápadu vygeneruj DETAILNÍ business analýzu.

## BRAND
${config.name} | ${config.website}

## PRODUKT
Název: ${idea.name}
Typ: ${idea.type}
Popis: ${idea.description}
Materiál: ${idea.material}
Rozměry: ${idea.dimensions}
Výroba: ${idea.manufacturingMethod}
Cenový rozsah (plánovaný): ${idea.priceRange}
Varianty: ${idea.variants.join(", ")}
Produkční poznámky: ${idea.productionNotes}
Virální angle: ${idea.viralAngle}
Proč to funguje: ${idea.whyItWorks}

## ÚKOL
Analyzuj tento produkt z BUSINESS hlediska. Buď REALISTICKÝ, ne optimistický.
- Odhadni reálné náklady na kus (sourcing z Číny, doprava, clo ~12%, DPH 21%)
- Doporuč prodejní cenu na českém trhu
- Spočítej marži
- Doporuč kolik kusů objednat poprvé (malý brand, testovací fáze)
- Navrhni 3 scénáře výdělku (3 měsíce po launchi)
- Identifikuj rizika

Buď konkrétní, piš čísla, ne vágní odhady.`

        const result = await generateText(prompt, {
            responseSchema: ANALYSIS_SCHEMA,
            temperature: 0.7,
        })

        const cleanText = result.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
        const analysis = JSON.parse(cleanText) as ProductAnalysis

        await guard.commit(`Brief: ${idea.name}`)

        return { success: true, analysis }
    } catch (err: any) {
        console.error("Product analysis error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}
