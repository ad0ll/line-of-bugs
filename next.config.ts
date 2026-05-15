import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  cacheComponents: true,
  output: "standalone",
  outputFileTracingIncludes: {
    // better-sqlite3 loads its compiled .node binding via a runtime require
    // that Next's file-tracer occasionally misses. Include it explicitly so
    // .next/standalone is self-contained.
    "/*": ["node_modules/better-sqlite3/build/Release/*.node"],
  },
  images: { unoptimized: true },
};

export default config;
