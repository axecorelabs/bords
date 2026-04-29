import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile @hocuspocus/provider and y-protocols (they need it).
  // yjs and lib0 ship pre-bundled dist files — do NOT transpile them
  // or Turbopack's SWC parser throws "Unexpected end of array".
  transpilePackages: ['@hocuspocus/provider', 'y-protocols'],
  // @upstash packages have no "exports" field — Turbopack can't resolve them.
  // Mark as server externals so Node.js handles resolution instead.
  serverExternalPackages: ['@upstash/ratelimit', '@upstash/redis'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'placehold.co',
      },
    ],
  },
};

export default nextConfig;
