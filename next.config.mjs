/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  // Next 14.2: runs src/instrumentation.ts register() once at server boot —
  // eager env validation so a bad deployment fails loudly, not per-request.
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["bcryptjs", "@prisma/client"],
  },
};

export default nextConfig;
