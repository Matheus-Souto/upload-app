import { NextResponse } from "next/server";
import { redis } from "@/lib/redis-config";

export async function GET() {
  try {
    // Testar conexão Redis
    await redis.ping();
    
    return NextResponse.json({
      status: "success",
      message: "Redis conectado com sucesso!",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Erro na conexão Redis:", error);
    return NextResponse.json(
      { 
        status: "error", 
        message: "Falha na conexão Redis. Certifique-se que o Redis está rodando.",
        error: error instanceof Error ? error.message : "Erro desconhecido"
      },
      { status: 500 }
    );
  }
} 