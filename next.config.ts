import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    cacheComponents: true,
  },
  images: {
    unoptimized: true,
  },
};

export default config;
