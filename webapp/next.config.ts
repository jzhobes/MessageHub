import path from 'path';

import * as dotenv from 'dotenv';

import type { NextConfig } from 'next';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const nextConfig: NextConfig = {
  devIndicators: false,
};

export default nextConfig;
