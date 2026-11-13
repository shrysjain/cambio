import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    NEXT_PUBLIC_BUILD_TIME: process.env.VERCEL_GIT_COMMIT_COMMIT_DATE ?? new Date().toISOString(),
  },
};
export default config;
