import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "mammoth", "@napi-rs/canvas"],
  allowedDevOrigins: ["172.30.229.127", "localhost"],
  outputFileTracingIncludes: {
    "/api/parse-resume": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/mammoth/**/*",
      "./node_modules/@napi-rs/**/*",
    ],
  },
};

export default nextConfig;