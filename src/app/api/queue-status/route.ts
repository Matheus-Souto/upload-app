import { NextResponse } from "next/server";
import { queueProcessor } from "@/lib/queue-processor";

export async function GET() {
  try {
    const status = queueProcessor.getQueueStatus();
    
    return NextResponse.json({
      queueLength: status.queueLength,
      isProcessing: status.isProcessing,
      message: status.queueLength > 0 
        ? `${status.queueLength} arquivo(s) na fila`
        : "Fila vazia"
    });
  } catch (error) {
    console.error("Erro ao obter status da fila:", error);
    return NextResponse.json(
      { error: "Erro ao obter status da fila" },
      { status: 500 }
    );
  }
} 