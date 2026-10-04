import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Stop `next dev` from writing AGENTS.md/CLAUDE.md into apps/web: agent instructions live
  // only in the repo-root CLAUDE.md.
  agentRules: false,
  // Workspace packages are published as TypeScript source.
  transpilePackages: ['@invoiceguard/shared', '@invoiceguard/db', '@invoiceguard/storage'],
  // Node-only libraries with native or dynamic requires stay out of the bundle.
  serverExternalPackages: ['pg', 'ioredis', 'pino', '@aws-sdk/client-s3', 'nodemailer'],
};

export default config;
