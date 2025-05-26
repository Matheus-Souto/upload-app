import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Habilitar standalone output para Docker
  output: 'standalone',
  
  // Configurações para produção
  experimental: {
    // Otimizações para build
  },
  
  // Configurar imagens se necessário
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
