import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '*.remote-agent.svc.cluster.local',
    '*.preview.agent-sandbox-my-c1-gw.trae.ai',
  ],
};

export default nextConfig;
