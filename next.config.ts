import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile @hocuspocus/provider and y-protocols (they need it).
  // yjs and lib0 ship pre-bundled dist files — do NOT transpile them
  // or Turbopack's SWC parser throws "Unexpected end of array".
  transpilePackages: ['@hocuspocus/provider', 'y-protocols'],
  // @upstash/ratelimit has no "exports" field — Turbopack can't resolve it.
  // serverExternalPackages prevents bundling; resolveAlias gives Turbopack the explicit path.
  serverExternalPackages: ['@upstash/ratelimit', '@upstash/redis'],
  turbopack: {
    resolveAlias: {
      '@upstash/ratelimit': '@upstash/ratelimit/dist/index.js',
    },
  },
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
