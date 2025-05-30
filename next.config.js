/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  webpack: (config, { isServer }) => {
    // Configurações para BullMQ funcionar com Next.js
    if (isServer) {
      config.externals.push({
        bullmq: 'commonjs bullmq',
        ioredis: 'commonjs ioredis',
      });
    }

    return config;
  },
  serverExternalPackages: ['bullmq', 'ioredis'],
};

module.exports = nextConfig;
