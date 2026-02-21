import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

// TEMPORARY: Replace with your actual token
const ACCESS_TOKEN = "EAF7htOH3hn8BQnfm71Pw3Gk8mhbPiQOoseGZCT1nh23mSyVZCc1iYatODMK1EuhPNQpmgbbxJfnWkQMbh9ZAGrW8l38Jqo3rBxkuUPQ0H4LMNG3dHjIqvZCFdoXN7vk5V43yC6APrZAEiK3Tt2fZBuypy0ljwqAYlEUtYyZAL0O3900fdrV23xkvTksCSSXj0rQ1KEZCfkttTcT6kmbZCQpmYmm4mlZArnkSq5Oic83PmGFZBHZBxCAPu0XnrUlcypiwznTCyeblWVO7IRdfFXZAueCjwHCZAJEZCYnZAM3ngQZDZD"

async function testInstagramAPI() {
    console.log("\n" + "═".repeat(60))
    console.log("🧪 INSTAGRAM GRAPH API TEST")
    console.log("═".repeat(60))

    try {
        // Step 1: Get Facebook Pages
        console.log("\n📄 Krok 1: Získávám Facebook Pages...")
        const pagesUrl = `https://graph.facebook.com/v21.0/me/accounts?access_token=${ACCESS_TOKEN}`
        const pagesRes = await fetch(pagesUrl)
        const pagesData = await pagesRes.json()

        if (pagesData.error) {
            console.error("❌ Error:", pagesData.error.message)
            console.log("\n💡 Tip: Token může být neplatný nebo nemá správné permissions")
            return
        }

        if (!pagesData.data || pagesData.data.length === 0) {
            console.log("⚠️  Žádné Facebook Pages nenalezeny")
            console.log("💡 Vytvoř Facebook Page a propoj ji s Instagram účtem")
            return
        }

        console.log(`✅ Nalezeno ${pagesData.data.length} Facebook Page(s):`)
        pagesData.data.forEach((page: any, i: number) => {
            console.log(`   ${i + 1}. ${page.name} (ID: ${page.id})`)
        })

        // Use first page
        const page = pagesData.data[0]
        const PAGE_ID = page.id
        const PAGE_ACCESS_TOKEN = page.access_token

        console.log(`\n📌 Používám: ${page.name}`)

        // Step 2: Get Instagram Business Account
        console.log("\n📸 Krok 2: Získávám Instagram Business Account...")
        const igUrl = `https://graph.facebook.com/v21.0/${PAGE_ID}?fields=instagram_business_account&access_token=${PAGE_ACCESS_TOKEN}`
        const igRes = await fetch(igUrl)
        const igData = await igRes.json()

        if (igData.error) {
            console.error("❌ Error:", igData.error.message)
            return
        }

        if (!igData.instagram_business_account) {
            console.log("⚠️  Instagram Business Account není propojený s touto Page")
            console.log("💡 V Instagram app: Settings → Account type → Switch to Business → Connect to Facebook Page")
            return
        }

        const INSTAGRAM_ACCOUNT_ID = igData.instagram_business_account.id
        console.log(`✅ Instagram Account ID: ${INSTAGRAM_ACCOUNT_ID}`)

        // Step 3: Get Instagram profile info
        console.log("\n👤 Krok 3: Získávám Instagram profil info...")
        const profileUrl = `https://graph.facebook.com/v21.0/${INSTAGRAM_ACCOUNT_ID}?fields=id,username,name,profile_picture_url,followers_count,media_count&access_token=${PAGE_ACCESS_TOKEN}`
        const profileRes = await fetch(profileUrl)
        const profileData = await profileRes.json()

        if (profileData.error) {
            console.error("❌ Error:", profileData.error.message)
            return
        }

        console.log("✅ Instagram profil:")
        console.log(`   Username: @${profileData.username}`)
        console.log(`   Name: ${profileData.name}`)
        console.log(`   Followers: ${profileData.followers_count || "N/A"}`)
        console.log(`   Posts: ${profileData.media_count || "N/A"}`)

        // Step 4: Check permissions
        console.log("\n🔐 Krok 4: Kontroluji permissions...")
        const permUrl = `https://graph.facebook.com/v21.0/me/permissions?access_token=${ACCESS_TOKEN}`
        const permRes = await fetch(permUrl)
        const permData = await permRes.json()

        const granted = permData.data.filter((p: any) => p.status === "granted")
        console.log("✅ Granted permissions:")
        granted.forEach((p: any) => console.log(`   ✓ ${p.permission}`))

        const required = ["instagram_basic", "instagram_content_publish", "pages_read_engagement"]
        const missing = required.filter(r => !granted.find((g: any) => g.permission === r))

        if (missing.length > 0) {
            console.log("\n⚠️  Chybějící permissions:")
            missing.forEach(m => console.log(`   ✗ ${m}`))
        }

        // Summary
        console.log("\n" + "═".repeat(60))
        console.log("📋 SHRNUTÍ — Přidej do .env.local:")
        console.log("═".repeat(60))
        console.log(`INSTAGRAM_ACCOUNT_ID=${INSTAGRAM_ACCOUNT_ID}`)
        console.log(`INSTAGRAM_ACCESS_TOKEN=${PAGE_ACCESS_TOKEN}`)
        console.log("═".repeat(60) + "\n")

    } catch (err) {
        console.error("💥 Unexpected error:", err)
    }
}

testInstagramAPI()
