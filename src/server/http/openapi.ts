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
    "/auth/me": {
      get: {
        operationId: "getCurrentUser",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Current authenticated user." },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/auth/sessions": {
      get: {
        operationId: "listSessions",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Active sessions, excluding session tokens." },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/auth/sessions/revoke-others": {
      post: {
        operationId: "revokeOtherSessions",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Other sessions were revoked." },
          "401": { description: "Authentication is required." },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
    },
  },
} as const;
