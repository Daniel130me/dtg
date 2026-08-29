import { NextResponse } from "next/server";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { preflightHeaders } from "@/server/http/cors";

export async function GET(request: Request) {
  return executeRoute(request, (context) =>
    apiSuccess(context, {
      name: "DTG API",
      version: "v1",
      documentation: "/api/v1/openapi.json",
    }),
  );
}

export async function OPTIONS(request: Request) {
  return executeRoute(
    request,
    () => new NextResponse(null, { status: 204, headers: preflightHeaders(request) }),
  );
}
