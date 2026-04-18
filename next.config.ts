import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@langchain/langgraph",
    "@langchain/langgraph-checkpoint-postgres",
    "pg",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
