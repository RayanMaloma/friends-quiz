import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets phones on the same Wi-Fi use the dev server (http://192.168.x.x:3000).
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  // Local-only fallback database (used when Supabase env vars are missing).
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    qualities: [75],
  },
};

export default nextConfig;
