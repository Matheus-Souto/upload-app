import { Queue, Worker, Job } from 'bullmq';
import axios from "axios";
import FormData from "form-data";
import { supabase } from "./supabase";

// Definir a interface para dados do job
interface UploadJobData {
  id: number;
  fileName: string;
  userId: string;
  fileBuffer: Buffer;
}

// Configuração de conexão Redis
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // BullMQ requer null
  retryDelayOnFailover: 100,
  lazyConnect: true,
};

// Criar a fila de uploads
const uploadQueue = new Queue<UploadJobData>('upload-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 10, // Manter apenas os últimos 10 jobs completos
    removeOnFail: 50,     // Manter os últimos 50 jobs falhados para debug
    attempts: 3,          // Tentar 3 vezes em caso de erro
    backoff: {
      type: 'exponential',
      delay: 5000,        // Delay inicial de 5 segundos
    },
  },
});

// Worker para processar jobs da fila
const uploadWorker = new Worker<UploadJobData>(
  'upload-processing',
  async (job: Job<UploadJobData>) => {
    const { id, fileName, userId, fileBuffer } = job.data;
    
    console.log(`🔄 Processando arquivo: ${fileName} (ID: ${id})`);

    try {
      // Atualizar status para "processing"
      await supabase
        .from('historico_uploads')
        .update({ status: 'processing' })
        .eq('id', id);

      // Update progress
      await job.updateProgress(25);

      // Montar o form-data para enviar ao n8n
      const n8nForm = new FormData();
      n8nForm.append("file", fileBuffer, fileName);
      n8nForm.append("fileName", fileName);
      n8nForm.append("userId", userId);

      await job.updateProgress(50);

      // Enviar para o webhook do n8n
      const n8nResponse = await axios.post(process.env.N8N_WEBHOOK_URL!, n8nForm, {
        headers: n8nForm.getHeaders(),
        timeout: 300000, // 5 minutos timeout
      });

      await job.updateProgress(75);

      console.log(`✅ Arquivo ${fileName} processado com sucesso:`, n8nResponse.data);

      // Atualizar status para "completed" com o link
      await supabase
        .from('historico_uploads')
        .update({ 
          status: 'completed',
          link: n8nResponse.data.link || n8nResponse.data.result
        })
        .eq('id', id);

      await job.updateProgress(100);

      return { success: true, fileName, link: n8nResponse.data.link || n8nResponse.data.result };

    } catch (error) {
      console.error(`❌ Erro ao processar arquivo ${fileName}:`, error);

      // Atualizar status para "error"
      await supabase
        .from('historico_uploads')
        .update({ status: 'error' })
        .eq('id', id);

      throw error; // Re-throw para que o BullMQ marque como failed
    }
  },
  { 
    connection: redisConnection,
    concurrency: 1 // Processar um arquivo por vez
  }
);

// Event listeners para logging
uploadWorker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completado`);
});

uploadWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} falhou:`, err.message);
});

uploadWorker.on('progress', (job, progress) => {
  console.log(`📊 Job ${job.id} progresso: ${progress}%`);
});

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
      throw error;
    }
  }

  async cancelFromQueue(uploadId: number): Promise<boolean> {
    try {
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
    await uploadQueue.drain();
    console.log('🧹 Fila limpa');
  }

  // Obter estatísticas da fila
  async getQueueStats() {
    try {
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
    await uploadWorker.close();
    await uploadQueue.close();
  }
}

export const queueProcessor = UploadQueueProcessor.getInstance();
export { uploadQueue, uploadWorker }; 