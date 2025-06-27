import { Queue, Worker, Job } from 'bullmq';
import { supabase } from "./supabase";
import { ocrService } from './ocr-service';
import { templateWebhookService, TemplateType } from './template-webhook-service';

// Definir a interface para dados do job
interface UploadJobData {
  id: number;
  fileName: string;
  userId: string;
  fileBuffer: SerializedBuffer;
  template: string;
}

// Tipo para Buffer serializado pelo Redis
type SerializedBuffer = {
  type: 'Buffer';
  data: number[];
} | {
  data: number[];
} | Buffer;

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
async function processFileDirectly(id: number, fileName: string, userId: string, fileBuffer: SerializedBuffer, template: string) {
  console.log(`🔄 Processando arquivo diretamente: ${fileName} (ID: ${id})`);

  try {
    // VERIFICAÇÃO CRÍTICA: Verificar se o upload ainda deve ser processado
    const { data: currentStatus, error: statusError } = await supabase
      .from('historico_uploads')
      .select('status')
      .eq('id', id)
      .single();

    if (statusError) {
      console.error(`❌ Erro ao verificar status do upload ${id}:`, statusError);
      return;
    }

    if (currentStatus.status === 'cancelled') {
      console.log(`⚠️ Upload ${id} (${fileName}) foi cancelado, parando processamento`);
      return;
    }

    if (currentStatus.status === 'completed') {
      console.log(`⚠️ Upload ${id} (${fileName}) já foi processado, evitando duplicação`);
      return;
    }

    if (currentStatus.status === 'processing') {
      console.log(`⚠️ Upload ${id} (${fileName}) já está sendo processado, evitando duplicação`);
      return;
    }

    // Atualizar status para "processing"
    const { error: updateError } = await supabase
      .from('historico_uploads')
      .update({ status: 'processing' })
      .eq('id', id)
      .eq('status', 'pending'); // Só atualizar se ainda estiver pending

    if (updateError) {
      console.error(`❌ Erro ao atualizar status para processing:`, updateError);
      return;
    }

    // Verificar se a atualização foi bem-sucedida (evita processamento duplo)
    const { data: updatedStatus } = await supabase
      .from('historico_uploads')
      .select('status')
      .eq('id', id)
      .single();

    if (updatedStatus?.status !== 'processing') {
      console.log(`⚠️ Upload ${id} (${fileName}) não pôde ser marcado como processing, provavelmente já está sendo processado`);
      return;
    }

    // Debug: verificar o tipo e estrutura do fileBuffer
    console.log(`🔍 Debug ${fileName}:`, {
      isBuffer: Buffer.isBuffer(fileBuffer),
      type: typeof fileBuffer,
      constructor: fileBuffer?.constructor?.name,
      hasData: 'data' in fileBuffer && fileBuffer.data ? 'sim' : 'não',
      hasType: 'type' in fileBuffer && fileBuffer.type ? fileBuffer.type : 'undefined'
    });

    // Reconstituir Buffer se necessário (serialização do Redis)
    let actualBuffer: Buffer;
    
    if (Buffer.isBuffer(fileBuffer)) {
      actualBuffer = fileBuffer;
    } else if (typeof fileBuffer === 'object' && fileBuffer !== null && 'data' in fileBuffer && Array.isArray(fileBuffer.data)) {
      // Buffer serializado pelo Redis como { type: 'Buffer', data: [...] }
      console.log(`🔄 Reconstituindo Buffer para ${fileName} a partir de dados serializados`);
      actualBuffer = Buffer.from(fileBuffer.data);
    } else if (typeof fileBuffer === 'object' && fileBuffer !== null && 'type' in fileBuffer && fileBuffer.type === 'Buffer') {
      // Outra forma de serialização
      throw new Error(`Formato de Buffer não suportado para ${fileName}. Use a serialização com array de dados.`);
    } else {
      throw new Error(`Arquivo ${fileName} não pôde ser convertido para Buffer válido. Tipo recebido: ${typeof fileBuffer}`);
    }

    console.log(`📊 Tamanho do arquivo ${fileName}: ${actualBuffer.length} bytes`);

    // NOVA FUNCIONALIDADE: Extrair texto usando OCR baseado no template
    console.log(`🎯 Processando ${fileName} com template: ${template}`);
    
    let ocrResult;
    try {
      // Usar a função que inclui validação por template
      ocrResult = await ocrService.processFileByTemplate(actualBuffer, fileName, template);
      
      console.log(`✅ OCR concluído para ${fileName}:`, {
        template,
        textLength: ocrResult.extractedText.length,
        textPreview: ocrResult.extractedText.length > 0 ? ocrResult.extractedText.substring(0, 200) + '...' : '[SEM TEXTO]'
      });
    } catch (ocrError) {
      console.error(`❌ Erro no OCR para ${fileName}:`, ocrError);
      throw new Error(`Falha no OCR: ${ocrError}`);
    }

    // FLUXO ATUALIZADO: Enviar dados do OCR para webhook específico do template
    console.log(`🚀 Enviando dados do OCR para webhook do template: ${template}`);
    
    try {
      // Preparar payload com dados do OCR
      const ocrData = {
        success: true,
        extracted_text: ocrResult.extractedText,
        template: template,
        fileName: fileName
      };

      const n8nResult = await templateWebhookService.processOcrDataByTemplate(
        template as TemplateType,
        ocrData, // Enviar dados estruturados
        fileName,
        userId
      );

      if (!n8nResult.success) {
        throw new Error(`Erro no processamento do template: ${n8nResult.error}`);
      }

      console.log(`✅ Template ${template} processado com sucesso para ${fileName}:`, n8nResult);

      // Atualizar status para "completed" com o link
      await supabase
        .from('historico_uploads')
        .update({ 
          status: 'completed',
          link: n8nResult.link || n8nResult.result
        })
        .eq('id', id);

      return { 
        success: true, 
        fileName, 
        template,
        link: n8nResult.link || n8nResult.result,
        ocrTextLength: ocrResult.extractedText.length
      };

    } catch (templateError) {
      console.error(`❌ Erro no processamento do template ${template} para ${fileName}:`, templateError);
      throw templateError;
    }

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
      return await processFileDirectly(id, fileName, userId, fileBuffer, job.data.template);
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

  async addToQueue(id: number, fileBuffer: Buffer, fileName: string, userId: string, template: string): Promise<void> {
    try {
      // Se Redis não estiver disponível, processar diretamente
      if (!redisAvailable || !uploadQueue) {
        console.log(`⚠️ Redis não disponível, processando ${fileName} diretamente`);
        await processFileDirectly(id, fileName, userId, fileBuffer, template);
        return;
      }

      const job = await uploadQueue.add('process-upload', {
        id,
        fileName,
        userId,
        fileBuffer,
        template,
      }, {
        priority: 1, // Prioridade normal
        delay: 0,    // Processar imediatamente
      });

      console.log(`📄 Arquivo ${fileName} adicionado à fila Redis. Job ID: ${job.id}, Template: ${template}`);
    } catch (error) {
      console.error(`❌ Erro ao adicionar ${fileName} à fila:`, error);
      // Em caso de erro, tentar processar diretamente
      console.log(`🔄 Tentando processar ${fileName} diretamente...`);
      await processFileDirectly(id, fileName, userId, fileBuffer, template);
    }
  }

  async cancelFromQueue(uploadId: number): Promise<boolean> {
    try {
      console.log(`🔍 Tentando cancelar upload ${uploadId}...`);

      // Primeiro, verificar o status atual no banco de dados
      const { data: uploadData, error: fetchError } = await supabase
        .from('historico_uploads')
        .select('status, nome_arquivo')
        .eq('id', uploadId)
        .single();

      if (fetchError || !uploadData) {
        console.log(`❌ Upload ${uploadId} não encontrado no banco de dados`);
        return false;
      }

      console.log(`📊 Upload ${uploadId} (${uploadData.nome_arquivo}) - Status atual: ${uploadData.status}`);

      // Se já foi processado, completado ou cancelado, não precisa cancelar
      if (['completed', 'error', 'cancelled'].includes(uploadData.status)) {
        console.log(`⚠️ Upload ${uploadId} já foi ${uploadData.status}, não é possível cancelar`);
        return false;
      }

      // Se já está sendo processado, não pode cancelar
      if (uploadData.status === 'processing') {
        console.log(`⚠️ Upload ${uploadId} (${uploadData.nome_arquivo}) já está sendo processado, não é possível cancelar`);
        return false;
      }

      // Se Redis não estiver disponível, apenas atualizar o status no banco
      if (!redisAvailable || !uploadQueue) {
        console.log(`⚠️ Redis não disponível, atualizando status para cancelled no banco`);
        const { error: updateError } = await supabase
          .from('historico_uploads')
          .update({ status: 'cancelled' })
          .eq('id', uploadId)
          .eq('status', 'pending'); // Só cancelar se ainda estiver pending

        if (updateError) {
          console.error(`❌ Erro ao atualizar status para cancelled:`, updateError);
          return false;
        }
        return true;
      }

      // Buscar jobs na fila Redis
      const waitingJobs = await uploadQueue.getJobs(['waiting', 'delayed']);
      const activeJobs = await uploadQueue.getJobs(['active']);
      
      console.log(`🔍 Buscando job para upload ${uploadId} - Waiting: ${waitingJobs.length}, Active: ${activeJobs.length}`);

      // Debug: logar os IDs dos jobs ativos
      if (activeJobs.length > 0) {
        const activeIds = activeJobs.map(job => job.data?.id).filter(id => id !== undefined);
        console.log(`🔍 Jobs ativos encontrados: [${activeIds.join(', ')}]`);
      }

      // Encontrar o job correspondente ao uploadId
      let targetJob = waitingJobs.find(job => job.data.id === uploadId);
      
      if (targetJob) {
        // Job está aguardando, pode ser cancelado
        await targetJob.remove();
        
        // Atualizar status no banco para "cancelled"
        const { error: updateError } = await supabase
          .from('historico_uploads')
          .update({ status: 'cancelled' })
          .eq('id', uploadId)
          .eq('status', 'pending'); // Só cancelar se ainda estiver pending

        if (updateError) {
          console.error(`❌ Erro ao atualizar status para cancelled:`, updateError);
          return false;
        }

        console.log(`🚫 Upload ${uploadId} (${uploadData.nome_arquivo}) cancelado da fila Redis`);
        return true;
      }

      // Verificar se está sendo processado ativamente
      targetJob = activeJobs.find(job => job.data.id === uploadId);
      if (targetJob) {
        console.log(`⚠️ Upload ${uploadId} (${uploadData.nome_arquivo}) está sendo processado ativamente (Job ID: ${targetJob.id}), não é possível cancelar`);
        return false;
      }

      // Se chegou aqui, o job não está na fila
      console.log(`⚠️ Job ${uploadId} não encontrado na fila Redis`);
      
      // Verificar novamente o status no banco antes de cancelar
      const { data: finalStatus } = await supabase
        .from('historico_uploads')
        .select('status')
        .eq('id', uploadId)
        .single();

      if (finalStatus?.status === 'pending') {
        // Ainda está pending, pode ter sido adicionado à fila mas processado muito rapidamente
        // ou nunca foi adicionado à fila Redis, cancelar no banco
        const { error: updateError } = await supabase
          .from('historico_uploads')
          .update({ status: 'cancelled' })
          .eq('id', uploadId)
          .eq('status', 'pending');

        if (updateError) {
          console.error(`❌ Erro ao atualizar status para cancelled:`, updateError);
          return false;
        }
        console.log(`🚫 Status atualizado para cancelled para upload ${uploadId} (não encontrado na fila)`);
        return true;
      }

      console.log(`⚠️ Upload ${uploadId} não pôde ser cancelado - Status atual: ${finalStatus?.status}`);
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