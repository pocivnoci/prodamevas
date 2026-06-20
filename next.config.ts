import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["@resvg/resvg-js", "sharp"],
    outputFileTracingIncludes: {
        "/**": ["instagram/fonts/**/*"],
        // Blog Markdown is read from the filesystem (lib/blog.ts) — bundle it.
        "/blog/**": ["content/blog/**/*"],
    },
    experimental: {
        // Server Actions body size limit (needed for image uploads >1MB)
        serverActions: {
            bodySizeLimit: "10mb",
        },
    },
};

export default nextConfig;
