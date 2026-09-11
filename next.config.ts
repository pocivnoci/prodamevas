import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["sharp", "ffmpeg-static"],
    outputFileTracingIncludes: {
        // Blog Markdown is read from the filesystem (lib/blog.ts) — bundle it.
        "/blog/**": ["content/blog/**/*"],
        // ffmpeg-static's BINARY (not just its JS) plus the subtitle font for every
        // route that renders a reel. Measured 2026-08-07: nft already traces
        // `node_modules/ffmpeg-static/ffmpeg` WITHOUT this entry, so the binary line
        // is a guard, not a fix — the pipeline resolves it at runtime
        // (`require("ffmpeg-static")` returns a path), exactly the dependency shape an
        // nft heuristic change could silently drop. The FONT is a real dependency:
        // `assets/fonts/Inter-Bold.ttf` is read only by libass via `fontsdir`, which
        // no tracer can see. job-resume finishes parked reels (video checkpoint), so it
        // needs both too. A missing binary/font is a hard, diagnosable failure
        // (instagram/reel-compositor.ts) — never a reel without subtitles.
        "/api/ig-run-job": ["node_modules/ffmpeg-static/ffmpeg", "assets/fonts/**/*"],
        "/api/cron/campaign-worker": ["node_modules/ffmpeg-static/ffmpeg", "assets/fonts/**/*"],
        "/api/cron/job-resume": ["node_modules/ffmpeg-static/ffmpeg", "assets/fonts/**/*"],
    },
    experimental: {
        // Server Actions body size limit (needed for image uploads >1MB)
        serverActions: {
            bodySizeLimit: "10mb",
        },
    },
    async rewrites() {
        return [
            {
                // Apple vyžaduje asociační soubor přesně na téhle cestě. Segment
                // začínající tečkou se v App Routeru jako složka chová nespolehlivě,
                // takže routa žije v /api a sem se jen přepisuje.
                source: "/.well-known/apple-developer-merchantid-domain-association",
                destination: "/api/apple-pay-domain",
            },
        ]
    },
};

export default nextConfig;
