import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-neon",
    "@neondatabase/serverless",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    "@neon/env",
    "@neon/config",
    "ws",
  ],
};

export default nextConfig;
