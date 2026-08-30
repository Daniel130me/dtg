import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { consumeRateLimit } from "@/server/http/rate-limit";
import { RATE_LIMIT_POLICIES } from "@/server/http/rate-limit-policies";
import { executeRoute } from "@/server/http/route-handler";
import { exportAccountData } from "@/server/modules/accounts/accounts.service";
import { accountExportFilename } from "@/contracts/accounts";

/**
 * GET /api/v1/account/export — the raw JSON download (not the JSON envelope):
 * the client hits this from a "download my data" action, so the response IS
 * the file. The sensitive rate-limit window also throttles how often a
 * personal-data archive can be shipped out of one account.
 */
export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    await consumeRateLimit(user.id, RATE_LIMIT_POLICIES.accountSensitive);

    const document = await exportAccountData(user.id);
    return new NextResponse(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${accountExportFilename(document.generatedAt)}"`,
        "cache-control": "no-store",
        "x-request-id": context.requestId,
      },
    });
  });
}
