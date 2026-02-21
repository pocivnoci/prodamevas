import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["@resvg/resvg-js", "sharp"],
    outputFileTracingIncludes: {
        "/**": ["instagram/fonts/**/*"],
    },
};

export default nextConfig;
