import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { processFlutterwaveWebhook } from "@/server/modules/payments/webhooks.service";

// Provider-to-server webhook: no session auth. Authenticity is enforced by the
// verif-hash signature inside processFlutterwaveWebhook, which fails closed
// (401) when the header is missing or FLUTTERWAVE_WEBHOOK_HASH is not set.
// ApiErrors (401 signature, 502 provider verify) propagate so Flutterwave
// retries; handled outcomes always answer 200 so it stops retrying.
export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    // Raw text (not JSON parsing) so the signature gate sees the exact bytes.
    const rawBody = await request.text();
    const verifHash = request.headers.get("verif-hash");
    const outcome = await processFlutterwaveWebhook(rawBody, verifHash);
    return apiSuccess(context, { outcome });
  });
}
