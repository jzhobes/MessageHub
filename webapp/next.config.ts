import type { NextConfig } from 'next';
import path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from project root (MessageHub/.env)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
