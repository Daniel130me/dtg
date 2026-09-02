/**
 * One-shot SMTP connectivity proof: nodemailer verify() (connect + auth, sends nothing),
 * then one clearly-labelled test email to the SMTP_USER's own address as end-to-end evidence.
 */
import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT ?? 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASSWORD;
const from = process.env.EMAIL_FROM;

if (!host || !user || !pass || !from) {
  console.error("SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM are required.");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  requireTLS: port === 587,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
  auth: { user, pass },
});

async function run(): Promise<void> {
  await transporter.verify();
  console.log(`1. verify(): connected to ${host}:${port} and authenticated as ${user} OK`);

  const info = await transporter.sendMail({
    from,
    to: user,
    subject: "[DTG] SMTP verification test — safe to ignore",
    text: `This is a one-time connectivity test from the DTG platform SMTP verification script.\nSent at ${new Date().toISOString()}.\nIf you received this, transactional email (verification links, notifications) is working.`,
    html: `<p>This is a one-time connectivity test from the <strong>DTG platform</strong> SMTP verification script.</p><p>Sent at ${new Date().toISOString()}.</p><p>If you received this, transactional email (verification links, notifications) is working.</p>`,
  });
  console.log(`2. Test email sent to ${user}: ${info.messageId}`);
}

run()
  .then(() => {
    console.log("SMTP VERIFICATION: ALL GREEN");
  })
  .catch((error: unknown) => {
    console.error("SMTP VERIFICATION FAILED:", error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exitCode = 1;
  })
  .finally(() => {
    transporter.close();
  });
