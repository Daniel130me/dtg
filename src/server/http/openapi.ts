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
    "/health/diagnostics": {
      get: {
        operationId: "getHealthDiagnostics",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Owner-only deep diagnostics: database latency, provider configuration, queue lag, process/release info." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
        },
      },
    },
    "/metrics": {
      get: {
        operationId: "getOwnerMetrics",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Owner-only in-process metrics snapshot (counters, request-duration histogram, queue-lag gauges) with rolling-window alert evaluation." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Metrics are disabled via METRICS_ENABLED." },
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
    "/catalog/categories": {
      get: {
        operationId: "listCatalogCategories",
        responses: {
          "200": { description: "Active categories with their published course counts." },
        },
      },
    },
    "/courses": {
      get: {
        operationId: "listPublishedCourses",
        parameters: [
          { name: "search", in: "query", schema: { type: "string", maxLength: 100 } },
          { name: "category", in: "query", schema: { type: "string" } },
          {
            name: "level",
            in: "query",
            schema: { type: "string", enum: ["BEGINNER", "INTERMEDIATE", "ADVANCED"] },
          },
          {
            name: "price",
            in: "query",
            schema: { type: "string", enum: ["ALL", "FREE", "PAID"], default: "ALL" },
          },
          {
            name: "sort",
            in: "query",
            schema: {
              type: "string",
              enum: ["NEWEST", "POPULAR", "RATING", "PRICE_ASC", "PRICE_DESC"],
              default: "NEWEST",
            },
          },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 24 } },
        ],
        responses: {
          "200": { description: "Cursor-paginated published courses." },
          "422": { description: "Query or cursor validation failed." },
        },
      },
    },
    "/courses/{slug}": {
      get: {
        operationId: "getPublishedCourseBySlug",
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Published course detail with curriculum and instructor." },
          "404": { description: "The course does not exist or is not published." },
          "422": { description: "Path validation failed." },
        },
      },
    },
    "/courses/{slug}/enroll": {
      post: {
        operationId: "enrollInFreeCourse",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Enrolment created, or the existing one returned (idempotent)." },
          "401": { description: "Authentication is required." },
          "404": { description: "The course does not exist." },
          "422": { description: "The course is not published or requires checkout." },
        },
      },
    },
    "/courses/{slug}/enrolment": {
      get: {
        operationId: "getCourseEnrolmentState",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "The caller's enrolment state for the course." },
          "401": { description: "Authentication is required." },
          "404": { description: "The course does not exist." },
          "422": { description: "Path validation failed." },
        },
      },
    },
    "/courses/{slug}/checkout": {
      post: {
        operationId: "initializeCheckout",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description:
              "Checkout session pointing at the Flutterwave hosted payment page (requires FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_HASH).",
          },
          "401": { description: "Authentication is required." },
          "404": { description: "The course does not exist." },
          "422": { description: "The course is not published or is free." },
          "503": { description: "No launch payment provider is configured yet." },
        },
      },
    },
    "/payments/flutterwave/webhook": {
      post: {
        operationId: "receiveFlutterwaveWebhook",
        responses: {
          "200": {
            description:
              "Delivery handled; the outcome (fulfilled/recorded/rejected/duplicate) is returned so the provider stops retrying.",
          },
          "401": { description: "The verif-hash signature is missing or invalid." },
          "502": { description: "Provider verification failed; the provider will retry the delivery." },
        },
      },
    },
    "/payments/orders/{orderId}": {
      get: {
        operationId: "getPaymentOrderStatus",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "orderId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "The caller's order status with its latest payment summary." },
          "401": { description: "Authentication is required." },
          "404": { description: "Order not found or not owned by the caller." },
          "422": { description: "Path validation failed." },
        },
      },
    },
    "/payments/orders/{orderId}/reconcile": {
      post: {
        operationId: "reconcilePaymentOrder",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "orderId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Fresh order status after server-side reconciliation." },
          "401": { description: "Authentication is required." },
          "404": { description: "Order not found or not owned by the caller." },
          "422": { description: "Body validation failed." },
          "502": { description: "Provider verification failed." },
        },
      },
    },
    "/owner/payments/{paymentId}/refund": {
      post: {
        operationId: "refundOwnerPayment",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "paymentId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Refund requested at the provider and recorded." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Payment not found." },
          "422": { description: "Refund not allowed (payment not captured or amount exceeds captured)." },
        },
      },
    },
    "/learning/enrolments": {
      get: {
        operationId: "listMyEnrolments",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["ACTIVE", "COMPLETED"] } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 24 } },
        ],
        responses: {
          "200": {
            description:
              "Cursor-paginated my-learning enrolment list; ACTIVE/COMPLETED enrolments carry a progress block (completedLessons/totalLessons/progressPercent).",
          },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/learning/dashboard": {
      get: {
        operationId: "getLearnerDashboard",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Learner stat tiles plus the continue-learning rail." },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/learning/courses/{slug}/progress": {
      get: {
        operationId: "getCourseProgress",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description:
              "Published curriculum with the caller's per-lesson completion map (zero progress when not enrolled).",
          },
          "401": { description: "Authentication is required." },
          "404": { description: "The course does not exist or is not published." },
          "422": { description: "Path validation failed." },
        },
      },
    },
    "/learning/lessons/{lessonId}": {
      get: {
        operationId: "getLessonAccess",
        // Optional auth: signed-out visitors may read preview lessons.
        security: [{ sessionCookie: [] }, {}],
        description:
          "Resolves the caller's access level. Works signed-out: preview lessons are readable anonymously, everything else answers access NONE with content stripped.",
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Lesson detail behind the access rules (content null when locked)." },
          "404": { description: "The lesson does not exist or is not published." },
          "422": { description: "Path validation failed." },
        },
      },
    },
    "/learning/lessons/{lessonId}/progress": {
      post: {
        operationId: "markLessonProgress",
        security: [{ sessionCookie: [] }],
        description: "Monotonic, idempotent completion: the only accepted body is { completed: true }.",
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Completion recorded (or repeated) with the course progress snapshot." },
          "401": { description: "Authentication is required." },
          "404": { description: "The lesson does not exist or is not published." },
          "422": {
            description:
              "The caller is not enrolled (COURSE_NOT_ENROLLED), or the body attempted to reverse completion (LESSON_COMPLETION_MONOTONIC).",
          },
        },
      },
    },
    "/learning/lessons/{lessonId}/note": {
      get: {
        operationId: "getLessonNote",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "The caller's note for the lesson, or null when none saved." },
          "401": { description: "Authentication is required." },
          "422": { description: "Path validation failed." },
        },
      },
      put: {
        operationId: "saveLessonNote",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Note upserted (one note per learner per lesson)." },
          "401": { description: "Authentication is required." },
          "404": { description: "The lesson does not exist or is not published." },
          "422": { description: "Not enrolled in the lesson's course, or body validation failed." },
        },
      },
      delete: {
        operationId: "deleteLessonNote",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Note deleted (idempotent; succeeds without a note)." },
          "401": { description: "Authentication is required." },
          "422": { description: "Path validation failed." },
        },
      },
    },
    "/learning/notes/export": {
      get: {
        operationId: "exportMyNotes",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": {
            description: "Markdown download (text/markdown attachment) of every saved note.",
          },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/learning/lessons/{lessonId}/threads": {
      get: {
        operationId: "listLessonThreads",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 20 } },
        ],
        responses: {
          "200": { description: "Cursor-paginated active question threads (newest activity first)." },
          "401": { description: "Authentication is required." },
          "404": { description: "The lesson does not exist or is not published." },
          "422": { description: "Not enrolled and not a preview lesson, or query validation failed." },
        },
      },
      post: {
        operationId: "createLessonThread",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "201": { description: "Thread created with its opening question post." },
          "401": { description: "Authentication is required." },
          "404": { description: "The lesson does not exist or is not published." },
          "422": { description: "Not enrolled in the lesson's course, or body validation failed." },
        },
      },
    },
    "/learning/threads/{threadId}": {
      get: {
        operationId: "getDiscussionThread",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "threadId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
        ],
        responses: {
          "200": { description: "Thread detail with its ascending reply page." },
          "401": { description: "Authentication is required." },
          "404": { description: "Thread missing, hidden, or on an unpublished lesson." },
          "422": { description: "Not enrolled and not a preview lesson, or query validation failed." },
        },
      },
    },
    "/learning/threads/{threadId}/replies": {
      post: {
        operationId: "replyToThread",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "threadId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "201": { description: "Reply posted; thread counters updated." },
          "401": { description: "Authentication is required." },
          "404": { description: "Thread missing, hidden, or on an unpublished lesson." },
          "422": { description: "Not enrolled and not a preview lesson, or body validation failed." },
        },
      },
    },
    "/owner/discussions/threads/{threadId}": {
      patch: {
        operationId: "moderateDiscussionThread",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "threadId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Thread status updated (hiding filters it from learner reads)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Thread not found." },
          "422": { description: "Body validation failed." },
        },
      },
    },
    "/owner/discussions/posts/{postId}": {
      patch: {
        operationId: "moderateDiscussionPost",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "postId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Post status updated (hiding filters only that post)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Post not found." },
          "422": { description: "Body validation failed." },
        },
      },
    },
    // ------------------------------------------------------------------
    // Phase 9: quizzes, assignments, grading, and certificates.
    // ------------------------------------------------------------------
    "/owner/lessons/{lessonId}/quiz": {
      get: {
        operationId: "getQuizAuthoring",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Quiz authoring view with the answer key (or null when none is configured)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "The lesson does not exist." },
        },
      },
      put: {
        operationId: "updateQuizAuthoring",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Quiz replaced transactionally; version bumped; published attempts keep their snapshots." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "The lesson does not exist or is not a QUIZ lesson." },
          "422": { description: "Authoring validation failed (e.g. a question without a correct option)." },
        },
      },
      delete: {
        operationId: "deleteQuizAuthoring",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Quiz detached from the lesson (idempotent)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
        },
      },
    },
    "/owner/lessons/{lessonId}/assignment": {
      get: {
        operationId: "getAssignmentAuthoring",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Assignment authoring view (or null when none is configured)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "The lesson does not exist." },
        },
      },
      put: {
        operationId: "updateAssignmentAuthoring",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Assignment brief saved." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "The lesson does not exist or is not an ASSIGNMENT lesson." },
          "422": { description: "Authoring validation failed." },
        },
      },
      delete: {
        operationId: "deleteAssignmentAuthoring",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Assignment detached from the lesson (idempotent)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
        },
      },
    },
    "/learning/lessons/{lessonId}/quiz": {
      get: {
        operationId: "getQuizLearnerView",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Quiz structure (sanitized: no answer key) with the caller's attempt state." },
          "401": { description: "Authentication is required." },
          "404": { description: "The lesson does not exist or has no quiz." },
          "422": { description: "Not enrolled in the lesson's course." },
        },
      },
    },
    "/learning/lessons/{lessonId}/quiz/attempts": {
      post: {
        operationId: "startQuizAttempt",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "201": { description: "Attempt started (or the in-flight attempt resumed) with sanitized snapshot questions." },
          "401": { description: "Authentication is required." },
          "404": { description: "The lesson does not exist or has no quiz." },
          "422": { description: "Not enrolled, or the attempt limit is reached." },
        },
      },
    },
    "/learning/quiz/attempts/{attemptId}": {
      get: {
        operationId: "getQuizAttemptResult",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "attemptId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Submitted attempt review with per-question correctness." },
          "401": { description: "Authentication is required." },
          "404": { description: "Attempt not found or not owned by the caller." },
          "422": { description: "The attempt has not been submitted yet." },
        },
      },
    },
    "/learning/quiz/attempts/{attemptId}/submit": {
      post: {
        operationId: "submitQuizAttempt",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "attemptId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Attempt scored server-side; review payload returned." },
          "401": { description: "Authentication is required." },
          "404": { description: "Attempt not found or not owned by the caller." },
          "422": { description: "Already submitted, the deadline has passed, or body validation failed." },
        },
      },
    },
    "/learning/lessons/{lessonId}/assignment": {
      get: {
        operationId: "getAssignmentLearnerView",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Assignment brief with the caller's submissions and grades." },
          "401": { description: "Authentication is required." },
          "404": { description: "The lesson does not exist or has no assignment." },
          "422": { description: "Not enrolled in the lesson's course." },
        },
      },
    },
    "/learning/lessons/{lessonId}/assignment/submissions": {
      post: {
        operationId: "createAssignmentSubmission",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "201": { description: "Submission recorded." },
          "401": { description: "Authentication is required." },
          "404": { description: "The lesson does not exist or has no assignment." },
          "422": { description: "Not enrolled, deadline passed, resubmission not allowed, or body validation failed." },
        },
      },
    },
    "/owner/grading/submissions": {
      get: {
        operationId: "listGradingQueue",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "courseId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["SUBMITTED", "GRADED", "RETURNED"] } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
        ],
        responses: {
          "200": { description: "Cursor-paginated assignment submissions (newest first)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
        },
      },
    },
    "/owner/grading/submissions/{submissionId}": {
      get: {
        operationId: "getGradingDetail",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "submissionId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Submission detail with the full grade history." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Submission not found." },
        },
      },
    },
    "/owner/grading/submissions/{submissionId}/grade": {
      post: {
        operationId: "gradeSubmission",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "submissionId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Grade recorded (appended history); submission marked graded." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Submission not found." },
          "422": { description: "Score out of range or body validation failed." },
        },
      },
    },
    "/learning/certificates": {
      get: {
        operationId: "listMyCertificates",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Issued certificates plus completed courses that are still claimable." },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/learning/courses/{slug}/certificate": {
      post: {
        operationId: "issueMyCertificate",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Certificate issued (idempotent: an existing one is returned unchanged)." },
          "401": { description: "Authentication is required." },
          "404": { description: "Course not found or not published." },
          "422": { description: "Certificate eligibility is not met yet." },
        },
      },
    },
    "/learning/certificates/{certificateId}/download": {
      get: {
        operationId: "downloadMyCertificate",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "certificateId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "PDF download (application/pdf attachment) of the caller's certificate." },
          "401": { description: "Authentication is required." },
          "404": { description: "Certificate not found or not owned by the caller." },
          "422": { description: "The certificate has been revoked." },
        },
      },
    },
    "/owner/certificates/{certificateId}/revoke": {
      post: {
        operationId: "revokeCertificate",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "certificateId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Certificate revoked; public verification reflects the revoked status." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Certificate not found." },
          "422": { description: "Body validation failed or already revoked." },
        },
      },
    },
    "/certificates/{code}": {
      get: {
        operationId: "verifyCertificate",
        parameters: [
          { name: "code", in: "path", required: true, schema: { type: "string", minLength: 6, maxLength: 32 } },
        ],
        responses: {
          "200": { description: "Minimal public verification payload (no email; display name and course title only)." },
          "404": { description: "No certificate carries this code." },
          "422": { description: "Code validation failed." },
        },
      },
    },
    "/owner/courses": {
      get: {
        operationId: "listOwnerCourses",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] } },
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: {
          "200": { description: "Cursor-paginated owner course list." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
        },
      },
      post: {
        operationId: "createCourse",
        security: [{ sessionCookie: [] }],
        responses: {
          "201": { description: "Course created as a draft." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "422": { description: "Invalid course fields or inactive category." },
        },
      },
    },
    "/owner/courses/{courseId}": {
      get: {
        operationId: "getOwnerCourse",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "courseId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "expectedVersion", in: "query", schema: { type: "integer", minimum: 1 } },
        ],
        responses: {
          "200": { description: "Full owner course detail with curriculum." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Course not found." },
          "409": { description: "Version conflict." },
        },
      },
      patch: {
        operationId: "updateCourse",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "courseId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Updated owner course detail." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Course not found." },
          "409": { description: "Version conflict." },
        },
      },
      delete: {
        operationId: "deleteCourse",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "courseId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Draft course deleted." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Course not found." },
          "409": { description: "Course is not a draft." },
        },
      },
    },
    "/owner/courses/{courseId}/publish": {
      post: {
        operationId: "publishCourse",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "courseId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Course published." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Course not found." },
          "409": { description: "Course is already published." },
          "422": { description: "Course content is incomplete (details list failing checks)." },
        },
      },
    },
    "/owner/courses/{courseId}/archive": {
      post: {
        operationId: "archiveCourse",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "courseId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Published course archived." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Course not found." },
          "409": { description: "Invalid status transition." },
        },
      },
    },
    "/owner/courses/{courseId}/unpublish": {
      post: {
        operationId: "unpublishCourse",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "courseId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Archived course returned to draft." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Course not found." },
          "409": { description: "Invalid status transition." },
        },
      },
    },
    "/owner/courses/{courseId}/sections": {
      post: {
        operationId: "createSection",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "courseId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "201": { description: "Section appended to the course." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Course not found." },
        },
      },
    },
    "/owner/sections/{sectionId}": {
      patch: {
        operationId: "renameSection",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "sectionId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Section renamed." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Section not found." },
          "409": { description: "Version conflict." },
        },
      },
      delete: {
        operationId: "deleteSection",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "sectionId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Section and its lessons deleted." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Section not found." },
        },
      },
    },
    "/owner/sections/{sectionId}/position": {
      post: {
        operationId: "reorderSection",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "sectionId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Section reordered; returns the final section order." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Section not found." },
        },
      },
    },
    "/owner/sections/{sectionId}/lessons": {
      post: {
        operationId: "createLesson",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "sectionId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "201": { description: "Lesson appended to the section." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Section not found." },
        },
      },
    },
    "/owner/lessons/{lessonId}": {
      patch: {
        operationId: "updateLesson",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Lesson updated." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Lesson not found." },
        },
      },
      delete: {
        operationId: "deleteLesson",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Lesson deleted; remaining lessons renumbered." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Lesson not found." },
        },
      },
    },
    "/owner/lessons/{lessonId}/move": {
      post: {
        operationId: "moveLesson",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "lessonId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Lesson moved to the target section position." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Lesson or target section not found." },
          "422": { description: "Target section belongs to a different course." },
        },
      },
    },
    "/courses/{slug}/reviews": {
      get: {
        operationId: "listCourseReviews",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
        ],
        responses: {
          "200": { description: "Public, VISIBLE-only review page for a published course (newest first)." },
          "404": { description: "Course not found or not published." },
        },
      },
    },
    "/courses/{slug}/reviews/mine": {
      get: {
        operationId: "getMyReview",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The caller's own review for the course, or null." },
          "401": { description: "Authentication is required." },
          "404": { description: "Course not found." },
        },
      },
      put: {
        operationId: "upsertMyReview",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Review created or updated (verified-enrolment gate). Rating aggregates recomputed." },
          "401": { description: "Authentication is required." },
          "404": { description: "Course not found or not published." },
          "422": { description: "Body validation failed or no verified enrolment." },
        },
      },
      delete: {
        operationId: "deleteMyReview",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The caller's review was withdrawn; aggregates recomputed." },
          "401": { description: "Authentication is required." },
          "404": { description: "No review to withdraw." },
          "422": { description: "Course mismatch." },
        },
      },
    },
    "/owner/reviews": {
      get: {
        operationId: "listOwnerReviews",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "status", in: "query", schema: { type: "string", enum: ["VISIBLE", "HIDDEN"] } },
          { name: "courseId", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Owner moderation page across all courses (newest first)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
        },
      },
    },
    "/owner/reviews/{reviewId}/status": {
      put: {
        operationId: "moderateReview",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "reviewId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Moderation status applied; rating aggregates recomputed." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Review not found." },
          "422": { description: "Body validation failed." },
        },
      },
    },
    "/owner/reviews/{reviewId}/reply": {
      put: {
        operationId: "replyToReview",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "reviewId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Owner reply upserted (visible reply on the review)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Review not found." },
          "422": { description: "Body validation failed." },
        },
      },
    },
    "/learning/notifications": {
      get: {
        operationId: "listNotifications",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
          { name: "unreadOnly", in: "query", schema: { type: "string", enum: ["true", "false"] } },
        ],
        responses: {
          "200": { description: "The caller's notification page (newest first) with the unread badge count." },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/learning/notifications/unread-count": {
      get: {
        operationId: "getUnreadNotificationCount",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Unread notification count for the caller." },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/learning/notifications/{notificationId}/read": {
      post: {
        operationId: "markNotificationRead",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "notificationId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Notification marked read (idempotent)." },
          "401": { description: "Authentication is required." },
          "404": { description: "Notification not found for the caller." },
        },
      },
    },
    "/learning/notifications/read-all": {
      post: {
        operationId: "markAllNotificationsRead",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Every unread notification for the caller marked read; count of rows touched." },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/support/contact": {
      post: {
        operationId: "submitContact",
        responses: {
          "201": { description: "Contact submission accepted; a support notification is sent asynchronously." },
          "422": { description: "Validation failed or spam controls rejected the submission." },
          "429": { description: "Rate limit exceeded." },
        },
      },
    },
    "/owner/outbox/dispatch": {
      post: {
        operationId: "dispatchOutbox",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "One dispatcher sweep executed; counts of processed events returned." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
        },
      },
    },
    "/owner/analytics": {
      get: {
        operationId: "getOwnerAnalytics",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Owner dashboard read model (totals, 6-month trend, top courses, recent activity, freshness stamp)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
        },
      },
    },
    "/owner/students": {
      get: {
        operationId: "listOwnerStudents",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "q", in: "query", schema: { type: "string", maxLength: 100 } },
          { name: "status", in: "query", schema: { type: "string", enum: ["ACTIVE", "SUSPENDED"] } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
        ],
        responses: {
          "200": { description: "Cursor-paginated, field-minimized learner rows with per-page aggregates." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "422": { description: "Query validation failed." },
        },
      },
    },
    "/owner/students/{userId}": {
      get: {
        operationId: "getOwnerStudent",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Learner detail with per-enrolment progress rows." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "User not found." },
        },
      },
    },
    "/owner/users/{userId}/status": {
      post: {
        operationId: "setOwnerUserStatus",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Status changed; suspension also revoked the target's sessions." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "User not found." },
          "422": { description: "Target is the owner or the caller themselves." },
        },
      },
    },
    "/owner/support/contact": {
      get: {
        operationId: "listOwnerContactSubmissions",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["NEW", "ARCHIVED"] } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
        ],
        responses: {
          "200": { description: "Cursor-paginated contact submissions (retention-purged rows included with nulls)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
        },
      },
    },
    "/owner/support/contact/{submissionId}": {
      patch: {
        operationId: "setOwnerContactStatus",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "submissionId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Submission status updated (NEW or ARCHIVED)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Submission not found." },
        },
      },
    },
    "/owner/audit": {
      get: {
        operationId: "listOwnerAudit",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "actorId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "action", in: "query", schema: { type: "string", maxLength: 100 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: {
          "200": { description: "Cursor-paginated audit trail, newest first." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "422": { description: "Query validation failed." },
        },
      },
    },
    "/owner/exports": {
      post: {
        operationId: "createOwnerExport",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Export job processed inline; COMPLETED jobs carry rowCount and expiry." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "422": { description: "Body validation failed." },
        },
      },
      get: {
        operationId: "listOwnerExports",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Export job history (newest first, no file content); expired jobs are flipped first." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
        },
      },
    },
    "/owner/exports/{exportJobId}/download": {
      get: {
        operationId: "downloadOwnerExport",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: "exportJobId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "CSV file stream (text/csv attachment)." },
          "401": { description: "Authentication is required." },
          "403": { description: "Owner access is required." },
          "404": { description: "Export job not found." },
          "410": { description: "The export file has expired and was purged." },
          "409": { description: "The export never completed." },
        },
      },
    },
    "/account/profile": {
      get: {
        operationId: "getAccountProfile",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "The caller's account profile, notification preferences, and quick-badge stats." },
          "401": { description: "Authentication is required." },
          "404": { description: "The account was not found." },
        },
      },
      patch: {
        operationId: "updateAccountProfile",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Allowlisted profile fields applied; the refreshed profile is returned." },
          "401": { description: "Authentication is required." },
          "404": { description: "The account was not found." },
          "422": { description: "Body validation failed (unknown fields rejected)." },
        },
      },
    },
    "/account/password": {
      post: {
        operationId: "changeAccountPassword",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Password rotated; every session except the caller's was revoked." },
          "400": { description: "Current password is incorrect." },
          "401": { description: "Authentication is required." },
          "422": { description: "Body validation failed or the new password equals the current one." },
          "429": { description: "Rate limit exceeded." },
        },
      },
    },
    "/account/export": {
      get: {
        operationId: "exportAccountData",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Personal-data archive (application/json attachment)." },
          "401": { description: "Authentication is required." },
          "429": { description: "Rate limit exceeded." },
        },
      },
    },
    "/account/delete": {
      post: {
        operationId: "deleteAccount",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Account anonymized and sessions revoked; the session cookie is cleared." },
          "401": { description: "Authentication is required." },
          "404": { description: "The account was not found." },
          "409": { description: "The account state changed; deletion was not completed." },
          "422": { description: "Confirmation word mismatch, owner account, or non-ACTIVE account." },
          "429": { description: "Rate limit exceeded." },
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
