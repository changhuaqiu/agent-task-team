import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    '@opentelemetry/api',
    '@opentelemetry/core',
    '@opentelemetry/exporter-trace-otlp-proto',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-trace-node',
  ],
  outputFileTracingExcludes: {
    '/*': [
      'src/test-helpers/**/*',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
  },
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '*.remote-agent.svc.cluster.local',
    '*.agent-sandbox-my-c1-gw.trae.ai',
    'run-agent-69f37b1bb49c0a1ee7c38329-mom7bgi4-preview.agent-sandbox-my-c1-gw.trae.ai',
  ],
};

export default nextConfig;
