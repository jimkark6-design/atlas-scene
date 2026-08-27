import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@remotion/renderer",
    "@remotion/bundler",
    "remotion",
    "esbuild",
    "@esbuild/win32-x64",
    "@remotion/compositor-win32-x64",
  ],
};

export default nextConfig;