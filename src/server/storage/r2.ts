import "server-only";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
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

export async function createMultipartUpload(input: {
  objectKey: string;
  contentType: string;
}): Promise<string> {
  const { bucket, client } = getR2Config();
  const result = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
    }),
  );
  if (!result.UploadId) {
    throw new ApiError(502, "MEDIA_UPLOAD_INIT_FAILED", "Media storage did not start the upload.");
  }
  return result.UploadId;
}

export async function createSignedUploadPartUrl(input: {
  objectKey: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds: number;
}): Promise<string> {
  const { bucket, client } = getR2Config();
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: bucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
    }),
    { expiresIn: input.expiresInSeconds },
  );
}

export async function finishMultipartUpload(input: {
  objectKey: string;
  uploadId: string;
  parts: CompletedPart[];
}): Promise<void> {
  const { bucket, client } = getR2Config();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
      MultipartUpload: { Parts: input.parts },
    }),
  );
}

export async function abortMultipartUpload(input: {
  objectKey: string;
  uploadId: string;
}): Promise<void> {
  const { bucket, client } = getR2Config();
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
    }),
  );
}

export async function createSignedGetUrl(input: {
  objectKey: string;
  expiresInSeconds: number;
}): Promise<string> {
  const { bucket, client } = getR2Config();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: input.objectKey }),
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

export async function deleteObjects(objectKeys: string[]): Promise<void> {
  if (objectKeys.length === 0) return;
  const { bucket, client } = getR2Config();
  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: objectKeys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}

export function resetR2ConfigForTests(): void {
  cachedConfig?.client.destroy();
  cachedConfig = undefined;
}
