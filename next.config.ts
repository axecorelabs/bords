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
  // Disable source maps in production to prevent information disclosure
  // if build artifacts are publicly exposed
  productionBrowserSourceMaps: false,
  webpack: (config, { isServer }) => {
    if (!isServer && process.env.NODE_ENV === 'production') {
      config.devtool = false  // Disable client source maps in production
    }
    return config
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
