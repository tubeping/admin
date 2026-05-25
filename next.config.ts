import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/admin",
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
