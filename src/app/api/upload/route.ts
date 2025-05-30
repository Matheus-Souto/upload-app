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
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado" },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Apenas arquivos PDF são permitidos" },
        { status: 400 }
      );
    }

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
      console.error('Erro ao salvar no Supabase:', error);
      return NextResponse.json(
        { error: "Erro ao salvar histórico" },
        { status: 500 }
      );
    }

    // Adicionar à fila de processamento
    await queueProcessor.addToQueue(
      data.id,
      buffer,
      file.name,
      session.user.id
    );

    // Retornar resposta imediata com status pending
    return NextResponse.json({
      id: data.id,
      fileName: data.nome_arquivo,
      status: data.status,
      createdAt: data.criado_em,
      result: null,
      message: "Arquivo adicionado à fila de processamento"
    });

  } catch (error) {
    console.error("Erro no upload:", error);
    return NextResponse.json(
      { error: "Erro ao processar o upload" },
      { status: 500 }
    );
  }
} 