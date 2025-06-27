import axios from 'axios';
import { OcrResponse } from './ocr-service';

export type TemplateType = 'fatura-agibank' | 'extrato-agibank' | 'fatura-bmg' | 'extrato-bmg';

interface N8nResponse {
  success: boolean;
  link?: string;
  result?: string;
  error?: string;
}

interface TemplateWebhookConfig {
  url: string;
  description: string;
}

interface AxiosErrorResponse {
  response?: {
    data?: {
      error?: string;
    };
  };
}

export class TemplateWebhookService {
  private static instance: TemplateWebhookService;
  
  // Configuração dos webhooks por template
  private readonly webhookConfig: Record<TemplateType, TemplateWebhookConfig> = {
    'fatura-agibank': {
      url: process.env.N8N_WEBHOOK_FATURA_AGIBANK_URL || process.env.N8N_WEBHOOK_URL || '',
      description: 'Processamento de Faturas AGIBANK'
    },
    'extrato-agibank': {
      url: process.env.N8N_WEBHOOK_EXTRATO_AGIBANK_URL || process.env.N8N_WEBHOOK_URL || '',
      description: 'Processamento de Extratos AGIBANK'
    },
    'fatura-bmg': {
      url: process.env.N8N_WEBHOOK_FATURA_BMG_URL || process.env.N8N_WEBHOOK_URL || '',
      description: 'Processamento de Faturas BMG'
    },
    'extrato-bmg': {
      url: process.env.N8N_WEBHOOK_EXTRATO_BMG_URL || process.env.N8N_WEBHOOK_URL || '',
      description: 'Processamento de Extratos BMG'
    }
  };

  public static getInstance(): TemplateWebhookService {
    if (!TemplateWebhookService.instance) {
      TemplateWebhookService.instance = new TemplateWebhookService();
    }
    return TemplateWebhookService.instance;
  }

  /**
   * Processar dados do OCR através do webhook específico do template
   */
  async processOcrDataByTemplate(
    template: TemplateType,
    ocrResponse: OcrResponse,
    fileName: string,
    userId: string
  ): Promise<N8nResponse> {
    try {
      const webhookConfig = this.webhookConfig[template];
      
      if (!webhookConfig.url) {
        throw new Error(`Webhook URL não configurada para template: ${template}`);
      }

      console.log(`🚀 Enviando dados do OCR para n8n:`, {
        template,
        fileName,
        webhookUrl: webhookConfig.url,
        description: webhookConfig.description,
        textLength: ocrResponse.extracted_text?.length || 0
      });

      // Preparar payload para enviar ao n8n
      const payload = {
        template,
        fileName,
        userId,
        ocrData: {
          extracted_text: ocrResponse.extracted_text,
          processing_time: ocrResponse.processing_time,
          pages_processed: ocrResponse.pages_processed,
          filename: ocrResponse.filename,
          total_paginas: ocrResponse.total_paginas,
          texto_extraido: ocrResponse.texto_extraido,
          configuracao_global: ocrResponse.configuracao_global,
          estatisticas_globais: ocrResponse.estatisticas_globais,
          sucesso: ocrResponse.sucesso
        },
        metadata: {
          timestamp: new Date().toISOString(),
          template_description: webhookConfig.description
        }
      };

      // Enviar para o webhook do n8n
      const response = await axios.post(webhookConfig.url, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 300000, // 5 minutos timeout
      });

      console.log(`✅ Dados processados com sucesso pelo n8n para template ${template}:`, {
        fileName,
        template,
        responseData: response.data
      });

      return {
        success: true,
        link: response.data.link || response.data.result,
        result: response.data.result
      };

    } catch (error: unknown) {
      console.error(`❌ Erro ao processar template ${template} para ${fileName}:`, error);

      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Erro desconhecido no processamento do template';

      const responseError = (error as AxiosErrorResponse)?.response?.data?.error;

      return {
        success: false,
        error: responseError || errorMessage,
      };
    }
  }

  /**
   * Verificar se o webhook está configurado para o template
   */
  isWebhookConfigured(template: TemplateType): boolean {
    return !!this.webhookConfig[template].url;
  }

  /**
   * Obter configuração do webhook para um template
   */
  getWebhookConfig(template: TemplateType): TemplateWebhookConfig {
    return this.webhookConfig[template];
  }

  /**
   * Listar todos os templates configurados
   */
  getConfiguredTemplates(): Array<{ template: TemplateType; config: TemplateWebhookConfig }> {
    return Object.entries(this.webhookConfig)
      .filter(([, config]) => config.url)
      .map(([template, config]) => ({
        template: template as TemplateType,
        config
      }));
  }
}

// Exportar instância singleton
export const templateWebhookService = TemplateWebhookService.getInstance(); 