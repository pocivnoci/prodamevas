import { NextResponse } from "next/server"
import { generateOnePost } from "@/instagram/autopilot"

export const maxDuration = 300 // 5 minutes Vercel limit

export async function POST(req: Request) {
    try {
        const body = await req.json()

        // Auto-heal wrapped locally
        let attempt = 0
        const maxRetries = 2
        let result = null

        const retryableErrors = [
            "503", "UNAVAILABLE", "overloaded", "high demand",
            "ECONNRESET", "ETIMEDOUT", "fetch failed",
            "socket hang up", "network",
        ]

        while (attempt <= maxRetries) {
            try {
                result = await generateOnePost({
                    configName: body.configName,
                    type: body.type,
                    topic: body.topic,
                    dryRun: body.dryRun,
                })
                break
            } catch (err: any) {
                const msg = String(err?.message || err)
                const isRetryable = retryableErrors.some(e => msg.toLowerCase().includes(e.toLowerCase()))

                if (!isRetryable || attempt >= maxRetries) {
                    throw err
                }
                attempt++
                const delay = attempt * 5000
                console.log(`⏳ Post generation API: retry ${attempt}/${maxRetries} in ${delay / 1000}s (${msg.substring(0, 80)})...`)
                await new Promise(r => setTimeout(r, delay))
            }
        }

        if (!result) throw new Error("Failed to generate post")

        return NextResponse.json({
            success: true,
            postId: result.id,
            caption: result.caption,
            imageUrl: result.imageUrl,
        })
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || "Unknown error"
        console.error("IG generation API error:", errorMessage)
        return NextResponse.json({
            success: false,
            error: errorMessage.substring(0, 500),
        }, { status: 500 }) // Return 500 so UI can catch it
    }
}
