import "server-only";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerEnv } from "@/server/config/env";
import { ApiError } from "@/server/http/errors";

interface R2Config {
  bucket: string;
  publicBaseUrl: string;
  client: S3Client;
}

let cachedConfig: R2Config | undefined;

export function getR2Config(): R2Config {
  if (cachedConfig) return cachedConfig;

  const env = getServerEnv();
  const publicBaseUrl = env.R2_PUBLIC_BASE_URL ?? env.R2_ENDPOINT;
  if (
    !env.R2_BUCKET ||
    !env.R2_S3_ENDPOINT ||
    !publicBaseUrl ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  ) {
    throw new ApiError(
      503,
      "MEDIA_STORAGE_UNAVAILABLE",
      "Course media storage is not configured.",
    );
  }

  cachedConfig = {
    bucket: env.R2_BUCKET,
    publicBaseUrl,
    client: new S3Client({
      region: "auto",
      endpoint: env.R2_S3_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    }),
  };
  return cachedConfig;
}

export function buildPublicObjectUrl(objectKey: string): string {
  const { publicBaseUrl } = getR2Config();
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  return new URL(encodedKey, `${publicBaseUrl.replace(/\/+$/, "")}/`).toString();
}

export async function createSignedPutUrl(input: {
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
}): Promise<string> {
  const { bucket, client } = getR2Config();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
    }),
    { expiresIn: input.expiresInSeconds },
  );
}

export async function inspectObject(objectKey: string): Promise<{
  contentLength: number;
  contentType: string | undefined;
}> {
  const { bucket, client } = getR2Config();
  const object = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  return {
    contentLength: object.ContentLength ?? 0,
    contentType: object.ContentType,
  };
}

export async function deleteObject(objectKey: string): Promise<void> {
  const { bucket, client } = getR2Config();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}

export function resetR2ConfigForTests(): void {
  cachedConfig?.client.destroy();
  cachedConfig = undefined;
}
