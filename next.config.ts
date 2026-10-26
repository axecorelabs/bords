import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile y-protocols (it needs it).
  // yjs and lib0 ship pre-bundled dist files — do NOT transpile them
  // or Turbopack's SWC parser throws "Unexpected end of array".
  transpilePackages: ['y-protocols'],
  // @upstash/ratelimit has no "exports" field — Turbopack can't resolve it.
  // resolveAlias gives Turbopack the explicit path. (Not listed in
  // serverExternalPackages: OpenNext/Workers must bundle them, otherwise the
  // pnpm-copied package misses its `uncrypto` dependency.)
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
