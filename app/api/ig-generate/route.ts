import { NextResponse } from "next/server"
import { generateOnePost } from "@/instagram/autopilot"
import { withRetry } from "@/utils/retry"

export const maxDuration = 300 // 5 minutes Vercel limit

export async function POST(req: Request) {
    try {
        const body = await req.json()

        const result = await withRetry(
            () => generateOnePost({
                configName: body.configName,
                type: body.type,
                topic: body.topic,
                dryRun: body.dryRun,
            }),
            2,
            "Post generation API"
        )

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
        }, { status: 500 })
    }
}
