import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/admin",
  output: "standalone",
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
