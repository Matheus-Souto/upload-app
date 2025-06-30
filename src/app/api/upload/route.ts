import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { queueProcessor } from "@/lib/queue-processor";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Não autorizado" },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const templates = formData.getAll("templates") as string[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado" },
        { status: 400 }
      );
    }

    // Verificar se há templates para todos os arquivos
    if (templates.length !== files.length) {
      return NextResponse.json(
        { error: "Cada arquivo deve ter um template selecionado" },
        { status: 400 }
      );
    }

    // Verificar limite de 10 arquivos
    if (files.length > 10) {
      return NextResponse.json(
        { error: "Máximo de 10 arquivos permitidos por upload" },
        { status: 400 }
      );
    }

    // Validar todos os arquivos primeiro
    for (const file of files) {
      if (file.type !== "application/pdf") {
        return NextResponse.json(
          { error: `Arquivo "${file.name}" não é um PDF. Apenas arquivos PDF são permitidos.` },
          { status: 400 }
        );
      }
    }

    // Validar templates
    const validTemplates = ['fatura-agibank', 'extrato-agibank', 'fatura-bmg', 'extrato-bmg', 'pje-remuneracao', 'pje-horas'];
    for (const template of templates) {
      if (!validTemplates.includes(template)) {
        return NextResponse.json(
          { error: `Template "${template}" não é válido` },
          { status: 400 }
        );
      }
    }

    const uploadResults = [];

    // Processar cada arquivo com seu template correspondente
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const template = templates[i];
      
      try {
        console.log(`📤 Processando ${file.name} com template: ${template}`);
        
        // Converter o arquivo para buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Salvar upload imediatamente no Supabase com status "pending"
        const { data, error } = await supabase
          .from('historico_uploads')
          .insert({
            nome_arquivo: file.name,
            status: 'pending',
            link: null,
            user_id: session.user.id
          })
          .select()
          .single();

        if (error) {
          console.error(`Erro ao salvar ${file.name} no Supabase:`, error);
          uploadResults.push({
            fileName: file.name,
            template,
            success: false,
            error: "Erro ao salvar histórico"
          });
          continue;
        }

        // Adicionar à fila de processamento com template
        await queueProcessor.addToQueue(
          data.id,
          buffer,
          file.name,
          session.user.id,
          template
        );

        uploadResults.push({
          id: data.id,
          fileName: data.nome_arquivo,
          template,
          status: data.status,
          createdAt: data.criado_em,
          success: true
        });

      } catch (fileError) {
        console.error(`Erro ao processar arquivo ${file.name}:`, fileError);
        uploadResults.push({
          fileName: file.name,
          template,
          success: false,
          error: "Erro ao processar arquivo"
        });
      }
    }

    const successCount = uploadResults.filter(result => result.success).length;
    const errorCount = uploadResults.length - successCount;

    // Retornar resposta com resultados de todos os uploads
    return NextResponse.json({
      message: `${successCount} arquivo(s) adicionado(s) à fila de processamento`,
      totalFiles: files.length,
      successCount,
      errorCount,
      results: uploadResults
    });

  } catch (error) {
    console.error("Erro no upload:", error);
    return NextResponse.json(
      { error: "Erro ao processar o upload" },
      { status: 500 }
    );
  }
} 