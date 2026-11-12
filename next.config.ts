import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
};
export default config;
