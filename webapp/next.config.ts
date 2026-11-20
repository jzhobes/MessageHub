import path from 'path';

import * as dotenv from 'dotenv';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

import type { NextConfig } from 'next';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export default function nextConfig(phase: string): NextConfig {
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const basePath = isDemo ? process.env.NEXT_PUBLIC_BASE_PATH || '' : '';

  return {
    devIndicators: false,
    ...(isDemo
      ? {
          ...(phase === PHASE_PRODUCTION_BUILD ? { output: 'export' } : {}),
          trailingSlash: true,
          basePath,
          assetPrefix: basePath,
          images: { unoptimized: true },
        }
      : {}),
  };
}
