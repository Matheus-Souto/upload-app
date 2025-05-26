import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import axios from "axios";
import FormData from "form-data";
import { supabase } from "@/lib/supabase";

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

    // Montar o form-data para enviar ao n8n
    const n8nForm = new FormData();
    n8nForm.append("file", buffer, file.name);
    n8nForm.append("fileName", file.name);
    n8nForm.append("userId", session.user.id);

    try {
      // Enviar para o webhook do n8n e logar a resposta
      const n8nResponse = await axios.post(process.env.N8N_WEBHOOK_URL!, n8nForm, {
        headers: n8nForm.getHeaders(),
      });

      console.log('Resposta do n8n:', n8nResponse.data);

      // Salvar upload no Supabase com status "completed" se o n8n processou com sucesso
      const { data, error } = await supabase
        .from('historico_uploads')
        .insert({
          nome_arquivo: file.name,
          status: 'completed',
          link: n8nResponse.data.link,
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

      return NextResponse.json({
        id: data.id,
        fileName: data.nome_arquivo,
        status: data.status,
        createdAt: data.criado_em,
        result: data.link,
      });

    } catch (n8nError) {
      console.error('Erro no processamento do n8n:', n8nError);
      
      // Salvar upload com status de erro se o n8n falhar
      const { data, error } = await supabase
        .from('historico_uploads')
        .insert({
          nome_arquivo: file.name,
          status: 'error',
          link: null,
          user_id: session.user.id
        })
        .select()
        .single();

      if (error) {
        console.error('Erro ao salvar no Supabase:', error);
      }

      return NextResponse.json(
        { 
          error: "Erro ao processar arquivo no n8n",
          id: data?.id,
          fileName: file.name,
          status: 'error'
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Erro no upload:", error);
    return NextResponse.json(
      { error: "Erro ao processar o upload" },
      { status: 500 }
    );
  }
} 