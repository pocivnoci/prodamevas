import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["sharp", "ffmpeg-static"],
    outputFileTracingIncludes: {
        // Blog Markdown is read from the filesystem (lib/blog.ts) — bundle it.
        "/blog/**": ["content/blog/**/*"],
        // ffmpeg-static's BINARY (not just its JS) for the two routes that render a
        // reel. Measured 2026-08-07: nft already traces `node_modules/ffmpeg-static/
        // ffmpeg` into both routes WITHOUT this entry, so this is a guard, not a fix —
        // the reel pipeline resolves the binary at runtime (`require("ffmpeg-static")`
        // returns a path), which is exactly the shape of dependency an nft heuristic
        // change could silently drop. And the failure mode is silent: the orchestrator
        // catches the spawn error and ships the reel with no voiceover and no
        // subtitles. Cheap to pin, expensive to notice missing.
        "/api/ig-run-job": ["node_modules/ffmpeg-static/ffmpeg"],
        "/api/cron/campaign-worker": ["node_modules/ffmpeg-static/ffmpeg"],
    },
    experimental: {
        // Server Actions body size limit (needed for image uploads >1MB)
        serverActions: {
            bodySizeLimit: "10mb",
        },
    },
};

export default nextConfig;
