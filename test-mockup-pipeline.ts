/**
 * End-to-end test: Mockup Generation Pipeline
 * Tests: Imagen 4 mockup → Supabase upload to product-mockups bucket
 */
import { loadConfig } from "./instagram/configs"
import { generateProductMockup } from "./instagram/product-generator"

async function main() {
    console.log("=== TEST: Mockup Generation Pipeline ===\n")

    const config = await loadConfig("hanzfans")
    console.log(`✅ Config loaded: ${config.name}\n`)

    // Use the design URL from our previous test
    const designUrl = "https://nyvbxpjkwhcuugwevobu.supabase.co/storage/v1/object/public/product-designs/product-designs/hanzfans_nachtfahrer_cyber_skull_tee_1771716306769.png"

    console.log("👕 Spouštím generateProductMockup('triko')...")
    console.log(`   Design URL: ${designUrl.substring(0, 60)}...\n`)

    const result = await generateProductMockup(
        config,
        designUrl,
        "triko",
        "Cyberpunk skull with neon purple and green circuitry on black t-shirt, streetwear graphic design"
    )

    if (!result) {
        console.error("❌ FAIL: generateProductMockup returned null!")
        process.exit(1)
    }

    console.log("\n=== VÝSLEDEK ===")
    console.log(`✅ Mockup URL: ${result.mockupUrl}`)
    console.log("\n🎉 Mockup Pipeline PROŠLA!")
}

main().catch(err => {
    console.error("❌ Pipeline SELHALA:", err)
    process.exit(1)
})
