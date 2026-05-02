import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ali-oss"],
  outputFileTracingIncludes: {
    "/*": [
      "src/generated/prisma/**/*",
      "node_modules/@prisma/**/*",
      "node_modules/prisma/**/*",
      "node_modules/sharp/**/*",
      "node_modules/ali-oss/**/*",
      "node_modules/quickjs-emscripten/**/*",
    ],
  },
  allowedDevOrigins: ["*"],
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;
