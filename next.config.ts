import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile y-websocket and y-protocols (they need it).
  // yjs and lib0 ship pre-bundled dist files — do NOT transpile them
  // or Turbopack's SWC parser throws "Unexpected end of array".
  transpilePackages: ['y-websocket', 'y-protocols'],
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
