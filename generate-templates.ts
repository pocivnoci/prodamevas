/**
 * Generate blank product templates for Sharp compositing
 */
import { generateImage } from "./instagram/gemini-client"
import * as fs from "fs"
import * as path from "path"

const templates = [
    {
        name: "tshirt_black_flat",
        prompt: "A plain solid black t-shirt laid completely flat on a pure black background. No wrinkles, no shadows, no design, no logo, no text, no pattern. Just a clean blank black t-shirt flat lay, perfectly centered, shot from directly above. The t-shirt chest area should be clearly visible and empty. Studio photograph, clean, minimal. Square crop.",
    },
    {
        name: "hoodie_black_flat",
        prompt: "A plain solid black hoodie laid completely flat on a pure black background. No wrinkles, no shadows, no design, no logo, no text, no pattern. Just a clean blank black hoodie flat lay, perfectly centered, shot from directly above. The hoodie chest area should be clearly visible and empty. Studio photograph, clean, minimal. Square crop.",
    }
]

async function main() {
    const dir = path.join(__dirname, "instagram", "templates")
    fs.mkdirSync(dir, { recursive: true })

    for (const t of templates) {
        console.log(`Generating template: ${t.name}...`)
        const buf = await generateImage(t.prompt, { aspectRatio: "1:1" })
        const filepath = path.join(dir, `${t.name}.png`)
        fs.writeFileSync(filepath, buf)
        console.log(`  ✅ Saved: ${filepath} (${(buf.length / 1024).toFixed(0)} KB)`)
    }
    console.log("\nDone!")
}
main()
