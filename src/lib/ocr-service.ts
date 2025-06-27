import axios from 'axios';
import FormData from 'form-data';

const OCR_API_BASE_URL = 'https://ruhmas-app-pdf-ocr-api.ugu7yu.easypanel.host';

export interface OcrOptions {
  enhancement_level?: 'conservative' | 'medium' | 'aggressive' | 'ultra';
  use_ai_engines?: boolean;
  engine_preference?: 'auto' | 'tesseract' | 'easyocr' | 'trocr' | 'consensus';
}

export interface OcrResponse {
  success: boolean;
  extracted_text?: string;
  error?: string;
  processing_time?: number;
  pages_processed?: number;
  pages?: Array<{
    page_number: number;
    text: string;
    confidence?: number;
  }>;
  statistics?: {
    total_pages: number;
    successful_pages: number;
    engine_used?: string;
    consensus_confidence?: number;
  };
}

interface AxiosErrorResponse {
  response?: {
    data?: {
      error?: string;
    };
  };
}

export class OcrService {
  private static instance: OcrService;

  public static getInstance(): OcrService {
    if (!OcrService.instance) {
      OcrService.instance = new OcrService();
    }
    return OcrService.instance;
  }

  /**
   * Extrai texto de um PDF usando a API de OCR
   */
  async extractTextFromPdf(
    pdfBuffer: Buffer,
    fileName: string,
    options: OcrOptions = {}
  ): Promise<OcrResponse> {
    try {
      console.log(`🔍 Iniciando extração de texto do PDF: ${fileName}`);
      console.log(`📊 Tamanho do arquivo: ${pdfBuffer.length} bytes`);

      // Configurações padrão
      const defaultOptions: Required<OcrOptions> = {
        enhancement_level: 'ultra',
        use_ai_engines: true,
        engine_preference: 'easyocr',
      };

      const finalOptions = { ...defaultOptions, ...options };

      // Criar FormData para enviar o arquivo
      const formData = new FormData();
      formData.append('file', pdfBuffer, {
        filename: fileName,
        contentType: 'application/pdf',
      });
      formData.append('enhancement_level', finalOptions.enhancement_level);
      formData.append('use_ai_engines', finalOptions.use_ai_engines.toString());
      formData.append('engine_preference', finalOptions.engine_preference);

      console.log(`🚀 Enviando PDF para extração de texto:`, {
        fileName,
        enhancement_level: finalOptions.enhancement_level,
        use_ai_engines: finalOptions.use_ai_engines,
        engine_preference: finalOptions.engine_preference,
        apiUrl: `${OCR_API_BASE_URL}/extract-text-hybrid/`
      });

      // Fazer a requisição para a API de OCR
      const response = await axios.post(
        `${OCR_API_BASE_URL}/extract-text-hybrid/`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'Content-Type': 'multipart/form-data',
          },
          timeout: 300000, // 5 minutos timeout
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      console.log(`✅ Texto extraído com sucesso do PDF: ${fileName}`);
      console.log(`📝 Tamanho do texto extraído: ${response.data.extracted_text?.length || 0} caracteres`);
      
      if (response.data.statistics) {
        console.log(`📊 Estatísticas do OCR:`, {
          total_pages: response.data.statistics.total_pages,
          successful_pages: response.data.statistics.successful_pages,
          engine_used: response.data.statistics.engine_used,
          consensus_confidence: response.data.statistics.consensus_confidence,
          processing_time: response.data.processing_time
        });
      }

      return {
        success: true,
        extracted_text: response.data.extracted_text,
        processing_time: response.data.processing_time,
        pages_processed: response.data.pages_processed,
        pages: response.data.pages,
        statistics: response.data.statistics,
      };

    } catch (error: unknown) {
      console.error(`❌ Erro ao extrair texto do PDF ${fileName}:`, error);

      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Erro desconhecido na extração de texto';

      const responseError = (error as AxiosErrorResponse)?.response?.data?.error;

      return {
        success: false,
        error: responseError || errorMessage,
      };
    }
  }

  /**
   * Processar arquivo PDF baseado no template selecionado
   */
  async processFileByTemplate(
    pdfBuffer: Buffer,
    fileName: string,
    template: string
  ): Promise<{ extractedText: string; templateType: string }> {
    console.log(`🎯 Processando arquivo ${fileName} com template: ${template}`);

    // Extrair texto do PDF primeiro
    const ocrResult = await this.extractTextFromPdf(pdfBuffer, fileName);

    if (!ocrResult.success || !ocrResult.extracted_text) {
      throw new Error(`Falha na extração de texto: ${ocrResult.error}`);
    }

    console.log(`✅ Texto extraído para template ${template}: ${ocrResult.extracted_text.length} caracteres`);

    return {
      extractedText: ocrResult.extracted_text,
      templateType: template,
    };
  }
}

// Exportar instância singleton
export const ocrService = OcrService.getInstance(); 