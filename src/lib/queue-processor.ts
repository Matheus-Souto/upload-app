import axios from "axios";
import FormData from "form-data";
import { supabase } from "./supabase";

interface QueueItem {
  id: number;
  file: Buffer;
  fileName: string;
  userId: string;
}

class UploadQueueProcessor {
  private static instance: UploadQueueProcessor;
  private queue: QueueItem[] = [];
  private isProcessing = false;

  static getInstance(): UploadQueueProcessor {
    if (!UploadQueueProcessor.instance) {
      UploadQueueProcessor.instance = new UploadQueueProcessor();
    }
    return UploadQueueProcessor.instance;
  }

  async addToQueue(id: number, file: Buffer, fileName: string, userId: string): Promise<void> {
    this.queue.push({ id, file, fileName, userId });
    console.log(`Arquivo ${fileName} adicionado à fila. Posição: ${this.queue.length}`);
    
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    console.log(`Iniciando processamento da fila. Itens na fila: ${this.queue.length}`);

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      await this.processItem(item);
    }

    this.isProcessing = false;
    console.log("Processamento da fila concluído");
  }

  private async processItem(item: QueueItem): Promise<void> {
    console.log(`Processando arquivo: ${item.fileName} (ID: ${item.id})`);

    try {
      // Atualizar status para "processing"
      await supabase
        .from('historico_uploads')
        .update({ status: 'processing' })
        .eq('id', item.id);

      // Montar o form-data para enviar ao n8n
      const n8nForm = new FormData();
      n8nForm.append("file", item.file, item.fileName);
      n8nForm.append("fileName", item.fileName);
      n8nForm.append("userId", item.userId);

      // Enviar para o webhook do n8n
      const n8nResponse = await axios.post(process.env.N8N_WEBHOOK_URL!, n8nForm, {
        headers: n8nForm.getHeaders(),
        timeout: 300000, // 5 minutos timeout
      });

      console.log(`Arquivo ${item.fileName} processado com sucesso:`, n8nResponse.data);

      // Atualizar status para "completed" com o link
      await supabase
        .from('historico_uploads')
        .update({ 
          status: 'completed',
          link: n8nResponse.data.link || n8nResponse.data.result
        })
        .eq('id', item.id);

    } catch (error) {
      console.error(`Erro ao processar arquivo ${item.fileName}:`, error);

      // Atualizar status para "error"
      await supabase
        .from('historico_uploads')
        .update({ status: 'error' })
        .eq('id', item.id);
    }
  }

  async cancelFromQueue(id: number): Promise<boolean> {
    // Procurar e remover da fila se ainda não estiver sendo processado
    const queueIndex = this.queue.findIndex(item => item.id === id);
    
    if (queueIndex !== -1) {
      // Arquivo ainda está na fila, pode ser removido
      const removedItem = this.queue.splice(queueIndex, 1)[0];
      console.log(`Arquivo ${removedItem.fileName} removido da fila`);
      
      // Atualizar status no banco para "cancelled"
      await supabase
        .from('historico_uploads')
        .update({ status: 'cancelled' })
        .eq('id', id);
      
      return true;
    }
    
    // Se não está na fila, verificar se está sendo processado
    // Não podemos cancelar um arquivo que já está sendo processado
    return false;
  }

  getQueueStatus(): { queueLength: number; isProcessing: boolean } {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing
    };
  }
}

export const queueProcessor = UploadQueueProcessor.getInstance(); 