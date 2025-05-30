import { Queue, Worker, Job } from 'bullmq';
import axios from "axios";
import FormData from "form-data";
import { supabase } from "./supabase";
import { Readable } from 'stream';

// Definir a interface para dados do job
interface UploadJobData {
  id: number;
  fileName: string;
  userId: string;
  fileBuffer: Buffer;
}

// Flag para verificar se Redis está disponível
let redisAvailable = false;

// Configuração de conexão Redis
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // BullMQ requer null
  retryDelayOnFailover: 100,
  lazyConnect: true,
  connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '30000'),
  commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT || '15000'),
  keepAlive: parseInt(process.env.REDIS_KEEP_ALIVE || '30000'),
  enableOfflineQueue: false,   // Desabilitar fila offline
  // Configurações de retry
  retryDelayOnClusterDown: 300,
  // Pool de conexões
  family: 4,                   // IPv4
  db: 0,                       // Database 0
};

let uploadQueue: Queue<UploadJobData> | null = null;
let uploadWorker: Worker<UploadJobData> | null = null;

// Função para processar arquivo diretamente (fallback)
async function processFileDirectly(id: number, fileName: string, userId: string, fileBuffer: Buffer) {
  console.log(`🔄 Processando arquivo diretamente: ${fileName} (ID: ${id})`);

  try {
    // Atualizar status para "processing"
    await supabase
      .from('historico_uploads')
      .update({ status: 'processing' })
      .eq('id', id);

    // Converter Buffer para stream legível
    const fileStream = new Readable({
      read() {
        this.push(fileBuffer);
        this.push(null); // Sinaliza fim do stream
      }
    });

    // Montar o form-data para enviar ao n8n
    const n8nForm = new FormData();
    n8nForm.append("file", fileStream, {
      filename: fileName,
      contentType: 'application/pdf'
    });
    n8nForm.append("fileName", fileName);
    n8nForm.append("userId", userId);

    // Enviar para o webhook do n8n
    const n8nResponse = await axios.post(process.env.N8N_WEBHOOK_URL!, n8nForm, {
      headers: n8nForm.getHeaders(),
      timeout: 300000, // 5 minutos timeout
    });

    console.log(`✅ Arquivo ${fileName} processado com sucesso:`, n8nResponse.data);

    // Atualizar status para "completed" com o link
    await supabase
      .from('historico_uploads')
      .update({ 
        status: 'completed',
        link: n8nResponse.data.link || n8nResponse.data.result
      })
      .eq('id', id);

    return { success: true, fileName, link: n8nResponse.data.link || n8nResponse.data.result };

  } catch (error) {
    console.error(`❌ Erro ao processar arquivo ${fileName}:`, error);

    // Atualizar status para "error"
    await supabase
      .from('historico_uploads')
      .update({ status: 'error' })
      .eq('id', id);

    throw error;
  }
}

// Tentar inicializar Redis
try {
  // Criar a fila de uploads
  uploadQueue = new Queue('upload-processing', {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 50,    // Manter mais jobs completos para análise
      removeOnFail: 100,       // Manter mais jobs falhados para debug
      attempts: 5,             // Mais tentativas em produção
      backoff: {
        type: 'exponential',
        delay: 10000,          // Delay inicial de 10 segundos
      },
    },
  });

  // Worker para processar jobs da fila
  uploadWorker = new Worker<UploadJobData>(
    'upload-processing',
    async (job: Job<UploadJobData>) => {
      const { id, fileName, userId, fileBuffer } = job.data;
      return await processFileDirectly(id, fileName, userId, fileBuffer);
    },
    { 
      connection: redisConnection,
      concurrency: 1,          // Processar um arquivo por vez
      // Configurações de polling otimizadas para produção
      stalledInterval: 60000,  // 1 minuto para detectar jobs travados
      maxStalledCount: 3,      // Máximo 3 tentativas para jobs travados
    }
  );

  // Event listeners para logging
  uploadWorker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completado com sucesso em ${new Date().toISOString()}`);
  });

  uploadWorker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} falhou em ${new Date().toISOString()}:`, {
      error: err.message,
      stack: err.stack,
      jobData: job?.data ? { fileName: job.data.fileName, id: job.data.id } : 'undefined'
    });
  });

  uploadWorker.on('progress', (job, progress) => {
    console.log(`📊 Job ${job.id} progresso: ${progress}% - ${job.data.fileName}`);
  });

  uploadWorker.on('stalled', (jobId) => {
    console.warn(`⚠️ Job ${jobId} travado (stalled) em ${new Date().toISOString()}`);
  });

  uploadWorker.on('error', (err) => {
    console.error(`❌ Erro no worker em ${new Date().toISOString()}:`, err);
  });

  redisAvailable = true;
  console.log('✅ Redis conectado e fila inicializada');

} catch (error) {
  console.warn('⚠️ Redis não disponível, usando processamento direto:', error);
  redisAvailable = false;
}

class UploadQueueProcessor {
  private static instance: UploadQueueProcessor;

  static getInstance(): UploadQueueProcessor {
    if (!UploadQueueProcessor.instance) {
      UploadQueueProcessor.instance = new UploadQueueProcessor();
    }
    return UploadQueueProcessor.instance;
  }

  async addToQueue(id: number, fileBuffer: Buffer, fileName: string, userId: string): Promise<void> {
    try {
      // Se Redis não estiver disponível, processar diretamente
      if (!redisAvailable || !uploadQueue) {
        console.log(`⚠️ Redis não disponível, processando ${fileName} diretamente`);
        await processFileDirectly(id, fileName, userId, fileBuffer);
        return;
      }

      const job = await uploadQueue.add('process-upload', {
        id,
        fileName,
        userId,
        fileBuffer,
      }, {
        priority: 1, // Prioridade normal
        delay: 0,    // Processar imediatamente
      });

      console.log(`📄 Arquivo ${fileName} adicionado à fila Redis. Job ID: ${job.id}`);
    } catch (error) {
      console.error(`❌ Erro ao adicionar ${fileName} à fila:`, error);
      // Em caso de erro, tentar processar diretamente
      console.log(`🔄 Tentando processar ${fileName} diretamente...`);
      await processFileDirectly(id, fileName, userId, fileBuffer);
    }
  }

  async cancelFromQueue(uploadId: number): Promise<boolean> {
    try {
      // Se Redis não estiver disponível, não é possível cancelar
      if (!redisAvailable || !uploadQueue) {
        console.log(`⚠️ Redis não disponível, não é possível cancelar upload ${uploadId}`);
        return false;
      }

      // Buscar jobs ativos na fila
      const waitingJobs = await uploadQueue.getJobs(['waiting', 'delayed']);
      const activeJobs = await uploadQueue.getJobs(['active']);
      
      // Encontrar o job correspondente ao uploadId
      let targetJob = waitingJobs.find(job => job.data.id === uploadId);
      
      if (targetJob) {
        // Job está aguardando, pode ser cancelado
        await targetJob.remove();
        
        // Atualizar status no banco para "cancelled"
        await supabase
          .from('historico_uploads')
          .update({ status: 'cancelled' })
          .eq('id', uploadId);

        console.log(`🚫 Upload ${uploadId} cancelado da fila Redis`);
        return true;
      }

      // Verificar se está sendo processado
      targetJob = activeJobs.find(job => job.data.id === uploadId);
      if (targetJob) {
        console.log(`⚠️ Não é possível cancelar job ativo: ${uploadId}`);
        return false;
      }

      console.log(`⚠️ Job não encontrado na fila para upload ${uploadId}`);
      return false;
    } catch (error) {
      console.error(`❌ Erro ao cancelar upload ${uploadId}:`, error);
      return false;
    }
  }

  async getQueueStatus(): Promise<{ queueLength: number; isProcessing: boolean }> {
    try {
      // Se Redis não estiver disponível, retornar status vazio
      if (!redisAvailable || !uploadQueue) {
        return { queueLength: 0, isProcessing: false };
      }

      const waitingJobs = await uploadQueue.getJobs(['waiting', 'delayed']);
      const activeJobs = await uploadQueue.getJobs(['active']);
      
      return {
        queueLength: waitingJobs.length,
        isProcessing: activeJobs.length > 0
      };
    } catch (error) {
      console.error('❌ Erro ao obter status da fila:', error);
      return { queueLength: 0, isProcessing: false };
    }
  }

  // Método para limpar fila (útil para desenvolvimento)
  async clearQueue(): Promise<void> {
    if (!redisAvailable || !uploadQueue) {
      console.log('⚠️ Redis não disponível para limpar fila');
      return;
    }
    await uploadQueue.drain();
    console.log('🧹 Fila limpa');
  }

  // Obter estatísticas da fila
  async getQueueStats() {
    try {
      // Se Redis não estiver disponível, retornar estatísticas vazias
      if (!redisAvailable || !uploadQueue) {
        return {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          total: 0,
          isProcessing: false,
          error: true
        };
      }

      const waiting = await uploadQueue.getWaiting();
      const active = await uploadQueue.getActive();
      const completed = await uploadQueue.getCompleted();
      const failed = await uploadQueue.getFailed();
      
      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        total: waiting.length + active.length + completed.length + failed.length,
        isProcessing: active.length > 0
      };
    } catch (error) {
      console.error("Erro ao obter estatísticas da fila:", error);
      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        total: 0,
        isProcessing: false,
        error: true
      };
    }
  }

  // Método para fechar conexões (importante para cleanup)
  async close(): Promise<void> {
    if (uploadWorker) {
      await uploadWorker.close();
    }
    if (uploadQueue) {
      await uploadQueue.close();
    }
  }
}

export const queueProcessor = UploadQueueProcessor.getInstance();
export { uploadQueue, uploadWorker }; 