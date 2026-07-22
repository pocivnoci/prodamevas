import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["sharp"],
    outputFileTracingIncludes: {
        // Blog Markdown is read from the filesystem (lib/blog.ts) — bundle it.
        "/blog/**": ["content/blog/**/*"],
        // Reels: ffmpeg-static is spawned (not required), so NFT can't trace it;
        // the subtitle font is read by path. Needed on every route that can
        // render a reel (job runner, campaign worker, dashboard server actions).
        "/api/ig-run-job/**": ["node_modules/ffmpeg-static/ffmpeg", "instagram/assets/fonts/**"],
        "/api/cron/campaign-worker/**": ["node_modules/ffmpeg-static/ffmpeg", "instagram/assets/fonts/**"],
        "/dashboard/**": ["node_modules/ffmpeg-static/ffmpeg", "instagram/assets/fonts/**"],
    },
    experimental: {
        // Server Actions body size limit (needed for image uploads >1MB)
        serverActions: {
            bodySizeLimit: "10mb",
        },
    },
};

export default nextConfig;
