import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// On-demand certificate renderer (deviation: no R2 storage yet, so the PDF is
// generated at download time instead of an async pipeline). Landscape A4 with
// a decorative double border, brand header, learner name, course title, issue
// date, verification code and a "Verify at ..." footer.

const PAGE_WIDTH = 842; // A4 landscape (297mm)
const PAGE_HEIGHT = 595; // 210mm
const CONTENT_WIDTH = PAGE_WIDTH - 160;
const BRAND_COLOR = rgb(0.06, 0.45, 0.42); // DTG teal
const ACCENT_COLOR = rgb(0.85, 0.65, 0.18); // amber/gold accent
const TEXT_COLOR = rgb(0.13, 0.15, 0.15);
const MUTED_COLOR = rgb(0.45, 0.48, 0.48);
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });

export interface CertificatePdfInput {
  brandName: string;
  learnerName: string;
  courseTitle: string;
  issuedAt: Date;
  code: string;
  verificationUrl: string;
}

/**
 * The built-in standard fonts are WinAnsi-encoded and throw on emoji/CJK, so
 * unsupported glyphs degrade to "?" instead of failing the whole download.
 */
function toEncodableText(value: string): string {
  return value.replace(/[^\u0020-\u007E\u00A1-\u00FF]/g, "?").trim() || "?";
}

/** Shrinks a font size until the text fits the given width (poster-safe). */
function fitFontSize(text: string, font: PDFFont, maxSize: number, minSize: number): number {
  let size = maxSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > CONTENT_WIDTH) size -= 1;
  return size;
}

function drawCentered(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color: ReturnType<typeof rgb>): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y, size, font, color });
}

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const brand = toEncodableText(input.brandName);
  const learnerName = toEncodableText(input.learnerName);
  const courseTitle = toEncodableText(input.courseTitle);

  // Decorative double border: thick teal frame, thin gold inner line.
  page.drawRectangle({
    x: 24,
    y: 24,
    width: PAGE_WIDTH - 48,
    height: PAGE_HEIGHT - 48,
    borderColor: BRAND_COLOR,
    borderWidth: 2,
  });
  page.drawRectangle({
    x: 32,
    y: 32,
    width: PAGE_WIDTH - 64,
    height: PAGE_HEIGHT - 64,
    borderColor: ACCENT_COLOR,
    borderWidth: 0.75,
  });

  drawCentered(page, brand, bold, 20, PAGE_HEIGHT - 100, BRAND_COLOR);
  drawCentered(page, "Certificate of Completion", bold, 32, PAGE_HEIGHT - 160, TEXT_COLOR);
  drawCentered(page, "This certifies that", font, 13, PAGE_HEIGHT - 210, MUTED_COLOR);

  const nameSize = fitFontSize(learnerName, bold, 40, 18);
  drawCentered(page, learnerName, bold, nameSize, PAGE_HEIGHT - 270, TEXT_COLOR);

  drawCentered(page, "has successfully completed the course", font, 13, PAGE_HEIGHT - 315, MUTED_COLOR);
  const courseSize = fitFontSize(courseTitle, bold, 24, 12);
  drawCentered(page, courseTitle, bold, courseSize, PAGE_HEIGHT - 355, TEXT_COLOR);

  drawCentered(page, `Issued on ${DATE_FORMAT.format(input.issuedAt)}`, font, 12, 130, TEXT_COLOR);
  drawCentered(page, `Verification code: ${input.code}`, font, 11, 105, MUTED_COLOR);
  drawCentered(page, `Verify at ${input.verificationUrl}`, font, 10, 70, BRAND_COLOR);

  return doc.save();
}
