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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            // 'unsafe-inline' is required for Next's hydration scripts +
            // existing inline style attributes in components. Tighten with
            // nonces later if we audit out the inline usages.
            value: [
              "default-src 'self'",
              "img-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self' 'unsafe-inline'",
              "connect-src 'self'",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
        ],
      },
    ];
  },
};

export default config;
