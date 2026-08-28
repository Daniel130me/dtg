export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "DTG API",
    version: "1.0.0",
    description: "Versioned API contract for the DTG learning platform.",
  },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/health/live": {
      get: {
        operationId: "getLiveness",
        responses: { "200": { description: "Application process is running." } },
      },
    },
    "/health/ready": {
      get: {
        operationId: "getReadiness",
        responses: {
          "200": { description: "Required dependencies are ready." },
          "503": { description: "A required dependency is unavailable." },
        },
      },
    },
  },
} as const;
