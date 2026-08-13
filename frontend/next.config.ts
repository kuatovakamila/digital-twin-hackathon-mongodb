import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The TTS proxy streams audio; keep the default Node runtime for it.
  reactStrictMode: true,
};

export default nextConfig;
