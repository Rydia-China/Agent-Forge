import type { NextConfig } from "next";

const traceExcludes = [
  "./backups/**/*",
  "./temp/**/*",
  "./logs/**/*",
  "./docs/**/*",
  "./FC/**/*",
  "./prisma/backups/**/*",
  "./prisma/dev.db",
  "./test.json",
  "./test-system-prompt.ts",
  "./dev.log",
  "./AGENTS.md",
  "./CLAUDE.md",
  "./*.tsbuildinfo",
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ali-oss"],
  outputFileTracingIncludes: {
    "/*": [
      "src/generated/prisma/**/*",
      "node_modules/sharp/**/*",
      "node_modules/ali-oss/**/*",
      "node_modules/quickjs-emscripten/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/*": traceExcludes,
    "/instrumentation": traceExcludes,
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
