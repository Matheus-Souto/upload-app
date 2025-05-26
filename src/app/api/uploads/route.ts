import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Não autorizado" },
        { status: 401 }
      );
    }

    // Buscar uploads do usuário atual
    const { data, error } = await supabase
      .from('historico_uploads')
      .select('*')
      .eq('user_id', session.user.id)
      .order('criado_em', { ascending: false });

    if (error) {
      console.error('Erro ao buscar uploads:', error);
      return NextResponse.json(
        { error: "Erro ao buscar histórico" },
        { status: 500 }
      );
    }

    // Mapear dados para o formato esperado pelo frontend
    const uploads = data.map(upload => ({
      id: upload.id,
      fileName: upload.nome_arquivo,
      status: upload.status,
      createdAt: upload.criado_em,
      result: upload.link,
    }));

    return NextResponse.json(uploads);
  } catch (error) {
    console.error("Erro ao buscar uploads:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Não autorizado" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const uploadId = searchParams.get('id');

    if (!uploadId) {
      return NextResponse.json(
        { error: "ID do upload é obrigatório" },
        { status: 400 }
      );
    }

    // Verificar se o upload pertence ao usuário antes de deletar
    const { data: upload, error: fetchError } = await supabase
      .from('historico_uploads')
      .select('user_id')
      .eq('id', uploadId)
      .single();

    if (fetchError) {
      return NextResponse.json(
        { error: "Upload não encontrado" },
        { status: 404 }
      );
    }

    if (upload.user_id !== session.user.id) {
      return NextResponse.json(
        { error: "Não autorizado a excluir este upload" },
        { status: 403 }
      );
    }

    // Deletar o upload
    const { error: deleteError } = await supabase
      .from('historico_uploads')
      .delete()
      .eq('id', uploadId);

    if (deleteError) {
      console.error('Erro ao deletar upload:', deleteError);
      return NextResponse.json(
        { error: "Erro ao excluir upload" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao deletar upload:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
} 