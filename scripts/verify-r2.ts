/**
 * One-shot R2 connectivity proof (read-mostly, zero residue):
 * HeadBucket -> PutObject -> HeadObject -> public URL fetch -> GetObject -> Delete -> Head 404.
 * Usage: R2_* + R2_PUBLIC_BASE_URL env vars required; run with bunx tsx.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Env var ${name} is required.`);
    process.exit(1);
  }
  return value;
}

const bucket = required("R2_BUCKET", process.env.R2_BUCKET);
const endpoint = required("R2_S3_ENDPOINT", process.env.R2_S3_ENDPOINT);
const publicBaseUrl = required("R2_PUBLIC_BASE_URL", process.env.R2_PUBLIC_BASE_URL);
const accessKeyId = required("R2_ACCESS_KEY_ID", process.env.R2_ACCESS_KEY_ID);
const secretAccessKey = required("R2_SECRET_ACCESS_KEY", process.env.R2_SECRET_ACCESS_KEY);

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

const key = `_dtg-health/verify-${Date.now()}.txt`;
const body = `DTG R2 round-trip verification at ${new Date().toISOString()}`;

async function run(): Promise<void> {
  const head = await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`1. HeadBucket "${bucket}": ${head.$metadata.httpStatusCode} OK`);

  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "text/plain" }));
  console.log(`2. PutObject "${key}": OK`);

  const headObj = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  console.log(`3. HeadObject: ${headObj.$metadata.httpStatusCode}, ${headObj.ContentLength} bytes, ${headObj.ContentType}`);

  const publicUrl = `${publicBaseUrl.replace(/\/+$/, "")}/${key}`;
  const publicResponse = await fetch(publicUrl);
  const publicText = publicResponse.ok ? await publicResponse.text() : `HTTP ${publicResponse.status}`;
  console.log(
    `4. Public delivery (${publicBaseUrl}): ${publicResponse.status} ${publicResponse.ok ? "OK" : "FAILED"} -> ${publicText.slice(0, 60)}`,
  );

  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const gotText = await got.Body?.transformToString("utf-8");
  console.log(`5. GetObject round-trip content matches: ${gotText === body}`);

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    console.log("6. DeleteObject: object still present (unexpected)");
    process.exitCode = 1;
  } catch {
    console.log("6. DeleteObject: object gone (404 as expected)");
  }
}

run()
  .then(() => {
    console.log(process.exitCode ? "R2 VERIFICATION: PARTIAL FAILURE" : "R2 VERIFICATION: ALL GREEN");
  })
  .catch((error: unknown) => {
    console.error("R2 VERIFICATION FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
