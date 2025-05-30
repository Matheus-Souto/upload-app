import { NextResponse } from "next/server";
import { queueProcessor } from "@/lib/queue-processor";

export async function GET() {
  try {
    const stats = await queueProcessor.getQueueStats();
    
    return NextResponse.json({
      stats,
      timestamp: new Date().toISOString(),
      message: "Estatísticas da fila obtidas com sucesso"
    });
  } catch (error) {
    console.error("Erro ao obter estatísticas da fila:", error);
    return NextResponse.json(
      { 
        error: "Erro ao obter estatísticas da fila",
        details: error instanceof Error ? error.message : "Erro desconhecido"
      },
      { status: 500 }
    );
  }
} 