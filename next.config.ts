import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

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
    // React's dev tooling uses eval() for callstack reconstruction; production
    // never does. Allow it in dev only so the prod CSP stays tight.
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
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
              scriptSrc,
              "connect-src 'self'",
              "font-src 'self' data:",
              "frame-src 'none'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
