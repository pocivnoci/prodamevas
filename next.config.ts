import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["@resvg/resvg-js", "sharp"],
    outputFileTracingIncludes: {
        "/**": ["instagram/fonts/**/*"],
    },
} as NextConfig;

// Server Actions body size limit (needed for image uploads >1MB)
(nextConfig as any).serverActions = { bodySizeLimit: "10mb" };

export default nextConfig;
