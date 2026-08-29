import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { executeRoute } from "@/server/http/route-handler";
import { exportMyNotes } from "@/server/modules/learning/notes.service";

/**
 * Returns the raw markdown download (not the JSON envelope): the client hits
 * this from a download link, so the response IS the file.
 */
export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { filename, markdown } = await exportMyNotes(user.id);
    return new NextResponse(markdown, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-request-id": context.requestId,
      },
    });
  });
}
