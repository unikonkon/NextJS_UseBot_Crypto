import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // dukascopy-node / fastest-validator optionally require cli-highlight + prettier
  // at runtime only for error formatting. Mark as external so the bundler does
  // not try to resolve those optional deps.
  serverExternalPackages: ["dukascopy-node", "fastest-validator"],
};

export default nextConfig;
