import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["@resvg/resvg-js", "sharp"],
    outputFileTracingIncludes: {
        "/**": ["instagram/fonts/**/*"],
    },
    experimental: {
        // Server Actions body size limit (needed for image uploads >1MB)
        serverActions: {
            bodySizeLimit: "10mb",
        },
    },
};

export default nextConfig;
