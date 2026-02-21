/**
 * End-to-end test: Design Generation Pipeline
 * Tests: Gemini text → JSON parse → Imagen 4 image → Supabase upload
 */
import { loadConfig } from "./instagram/configs"
import { generateDesignConcept } from "./instagram/product-generator"

async function main() {
    console.log("=== TEST: Design Generation Pipeline ===\n")

    const config = await loadConfig("hanzfans")
    console.log(`✅ Config loaded: ${config.name}\n`)

    console.log("🎨 Spouštím generateDesignConcept('cyberpunk skull', 'triko')...")
    console.log("   (Gemini text + Imagen image + Supabase upload)\n")

    const result = await generateDesignConcept(config, "cyberpunk skull", "triko")

    if (!result) {
        console.error("❌ FAIL: generateDesignConcept returned null!")
        process.exit(1)
    }

    console.log("\n=== VÝSLEDEK ===")
    console.log(`✅ Název: ${result.concept.name}`)
    console.log(`✅ Styl: ${result.concept.style}`)
    console.log(`✅ Barvy: ${result.concept.colors.join(", ")}`)
    console.log(`✅ Placement: ${result.concept.placement}`)
    console.log(`✅ Design URL: ${result.designUrl}`)
    console.log("\n🎉 Pipeline PROŠLA kompletně!")
}

main().catch(err => {
    console.error("❌ Pipeline SELHALA:", err)
    process.exit(1)
})
