import { NextResponse } from "next/server";
import { openApiDocument } from "@/server/http/openapi";

export function GET() {
  return NextResponse.json(openApiDocument, {
    headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" },
  });
}
