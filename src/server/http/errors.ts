import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ApiErrorDetail } from "@/contracts/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function validationError(error: z.ZodError): ApiError {
  return new ApiError(
    422,
    "VALIDATION_ERROR",
    "The request contains invalid fields.",
    error.issues.map((issue) => ({
      field: issue.path.join(".") || undefined,
      message: issue.message,
    })),
  );
}

export function mapInfrastructureError(error: unknown): ApiError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (error.code === "P2002") return new ApiError(409, "CONFLICT", "The requested value already exists.");
  if (error.code === "P2025") return new ApiError(404, "NOT_FOUND", "The requested resource was not found.");
  return null;
}
