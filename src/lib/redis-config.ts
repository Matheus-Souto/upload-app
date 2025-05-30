import Redis from 'ioredis';

// Configuração do Redis
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  lazyConnect: true,
};

// Instância do Redis
export const redis = new Redis(redisConfig);

// Log de conexão
redis.on('connect', () => {
  console.log('✅ Conectado ao Redis');
});

redis.on('error', (error) => {
  console.error('❌ Erro na conexão Redis:', error);
});

redis.on('ready', () => {
  console.log('🚀 Redis pronto para uso');
}); 