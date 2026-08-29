import { NextResponse } from "next/server";
import { certificateIdParamSchema } from "@/contracts/certificates";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { getServerEnv } from "@/server/config/env";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { renderCertificatePdf } from "@/server/modules/certificates/certificate-pdf";
import { getMyCertificateDownload } from "@/server/modules/certificates/certificates.service";

interface RouteParams {
  params: Promise<{ certificateId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { certificateId } = await params;
    const data = await getMyCertificateDownload(
      user.id,
      parsePathParam(certificateIdParamSchema, certificateId),
    );

    const pdfBytes = await renderCertificatePdf({
      brandName: data.brandName,
      learnerName: data.learnerName,
      courseTitle: data.courseTitle,
      issuedAt: data.issuedAt,
      code: data.code,
      verificationUrl: `${getServerEnv().APP_URL}/certificates/${data.code}`,
    });

    // Raw file response (not the JSON envelope) — mirrors notes/export: the
    // download link IS the file. The copy widens pdf-lib's Uint8Array to a
    // plain ArrayBuffer-backed view so it satisfies the BodyInit typing.
    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="dtg-certificate-${data.code}.pdf"`,
        "cache-control": "no-store",
        "x-request-id": context.requestId,
      },
    });
  });
}
