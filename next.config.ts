import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  poweredByHeader: false,
  // Keep rewrites/redirects minimal and never touch /share paths
  async rewrites() {
    return [];
  },
  async redirects() {
    return [];
  },
};

export default nextConfig;
