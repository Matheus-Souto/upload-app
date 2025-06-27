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
  filename?: string;
  total_paginas?: number;
  texto_extraido?: Array<{
    pagina: number;
    texto: string;
    engine_usado: string;
    metodo: string;
    confianca: number;
    estatisticas: {
      caracteres: number;
      linhas: number;
      palavras: number;
    };
    parametros: {
      enhancement_level: string;
      engine_preference: string;
      use_ai_engines: boolean;
    };
  }>;
  configuracao_global?: {
    enhancement_level: string;
    engine_preference: string;
    use_ai_engines: boolean;
  };
  estatisticas_globais?: {
    paginas_processadas: number;
    engines_utilizados: string[];
    confianca_media: number;
    tempo_processamento_segundos: number;
    total_caracteres: number;
    total_palavras: number;
    paginas_com_texto: number;
  };
  sucesso?: boolean;
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
      
      // DEBUG: Log completo da resposta da API
      console.log(`🔍 DEBUG - Resposta completa da API para ${fileName}:`, {
        sucesso: response.data.sucesso,
        filename: response.data.filename,
        total_paginas: response.data.total_paginas,
        texto_extraido_length: response.data.texto_extraido?.length || 0,
        primeira_pagina: response.data.texto_extraido?.[0] || null,
        estatisticas_globais: response.data.estatisticas_globais
      });
      
      // Mapear resposta da API para formato unificado
      const extractedText = response.data.texto_extraido
        ? response.data.texto_extraido.map((page: { texto: string }) => page.texto).join('\n\n')
        : '';
      
      console.log(`📝 Tamanho do texto extraído: ${extractedText.length} caracteres`);
      
      // DEBUG: Verificar se o texto foi extraído
      if (extractedText.length === 0) {
        console.warn(`⚠️ ATENÇÃO: Nenhum texto foi extraído do PDF ${fileName}`);
        console.log(`🔍 Verificar se API retornou sucesso:`, response.data.sucesso);
        console.log(`🔍 Dados brutos da API:`, JSON.stringify(response.data, null, 2));
      }

      if (response.data.estatisticas_globais) {
        console.log(`📊 Estatísticas do OCR:`, {
          total_paginas: response.data.total_paginas,
          paginas_processadas: response.data.estatisticas_globais.paginas_processadas,
          engines_utilizados: response.data.estatisticas_globais.engines_utilizados,
          confianca_media: response.data.estatisticas_globais.confianca_media,
          tempo_processamento: response.data.estatisticas_globais.tempo_processamento_segundos,
          total_caracteres: response.data.estatisticas_globais.total_caracteres
        });
      }

      return {
        success: true,
        extracted_text: extractedText,
        processing_time: response.data.estatisticas_globais?.tempo_processamento_segundos,
        pages_processed: response.data.estatisticas_globais?.paginas_processadas,
        // Manter dados originais da API
        filename: response.data.filename,
        total_paginas: response.data.total_paginas,
        texto_extraido: response.data.texto_extraido,
        configuracao_global: response.data.configuracao_global,
        estatisticas_globais: response.data.estatisticas_globais,
        sucesso: response.data.sucesso,
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

    if (!ocrResult.success) {
      throw new Error(`Falha na extração de texto: ${ocrResult.error}`);
    }

    // Verificar se há texto extraído ou se a API retornou sucesso
    if (!ocrResult.extracted_text && !ocrResult.sucesso) {
      throw new Error(`Nenhum texto foi extraído do PDF e API não retornou sucesso`);
    }

    // Mesmo se extracted_text estiver vazio, mas API retornou sucesso, continuar
    const textLength = ocrResult.extracted_text?.length || 0;
    console.log(`✅ Texto extraído para template ${template}: ${textLength} caracteres`);
    
    if (textLength === 0) {
      console.warn(`⚠️ PDF ${fileName} não contém texto legível, mas API retornou sucesso`);
    }

    return {
      extractedText: ocrResult.extracted_text || '',
      templateType: template,
    };
  }
}

// Exportar instância singleton
export const ocrService = OcrService.getInstance(); 