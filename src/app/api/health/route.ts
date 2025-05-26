import { NextResponse } from "next/server";

export async function GET() {
  try {
    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "upload-app",
      version: process.env.npm_package_version || "1.0.0"
    }, { status: 200 });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: "Service unavailable"
    }, { status: 503 });
  }
} 