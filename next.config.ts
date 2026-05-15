import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Promoted out of `experimental` in Next.js 16
  cacheComponents: true,
  images: {
    unoptimized: true,
  },
};

export default config;
