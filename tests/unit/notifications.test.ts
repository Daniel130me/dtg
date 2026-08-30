import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_OUTBOX_ATTEMPTS,
  OUTBOX_TOPICS,
  outboxBackoffMs,
  planOutboxEvent,
  renderOutboxEmail,
} from "@/server/modules/notifications/outbox.dispatcher";
import {
  buildEnrolmentConfirmedEmail,
  classifyEmailError,
  escapeHtml,
  renderEmailLayout,
  renderExcerpt,
  sanitizeEmailSubject,
} from "@/server/email/email.logic";

// Pure planning matrix for the Phase 10 outbox dispatcher. The planner is
// deterministic given (topic, payload, resolution) so these tests need no
// database; payload shapes mirror the live emit sites exactly.

const LEARNER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "33333333-3333-4333-8333-333333333333";

describe("outbox backoff", () => {
  it("doubles from 30s per attempt", () => {
    assert.deepEqual([1, 2, 3, 5].map(outboxBackoffMs), [30_000, 60_000, 120_000, 480_000]);
  });

  it("caps at 15 minutes", () => {
    assert.equal(outboxBackoffMs(20), 15 * 60_000);
  });

  it("never explodes on zero or negative attempts", () => {
    assert.equal(outboxBackoffMs(0), 30_000);
  });

  it("allows MAX_OUTBOX_ATTEMPTS processing passes before failing", () => {
    assert.equal(MAX_OUTBOX_ATTEMPTS, 5);
  });
});

describe("planOutboxEvent matrix", () => {
  it("plans the enrolment confirmation notification and email", () => {
    const plan = planOutboxEvent(OUTBOX_TOPICS.enrolmentConfirmed, {
      enrolmentId: "enr-1",
      userId: LEARNER_ID,
      courseId: "course-1",
      courseTitle: "Next.js Masterclass",
      courseSlug: "complete-nextjs-react-masterclass",
    }, { recipientEmail: "learner@example.test", learnerName: "Ada" });

    assert.deepEqual(plan?.notifications, [{
      userId: LEARNER_ID,
      topic: "enrolment.confirmed",
      title: "You're enrolled in Next.js Masterclass",
      body: "Start learning now — your classroom is ready.",
      linkPath: "/learning/complete-nextjs-react-masterclass",
      dedupeKeySuffix: LEARNER_ID,
    }]);
    assert.equal(plan?.email?.template, "enrolmentConfirmed");
    assert.equal(plan?.email?.to, "learner@example.test");
  });

  it("keeps the in-app enrolment notification even without a recipient email", () => {
    const plan = planOutboxEvent(OUTBOX_TOPICS.enrolmentConfirmed, {
      enrolmentId: "enr-1",
      userId: LEARNER_ID,
      courseId: "course-1",
      courseTitle: "Next.js Masterclass",
      courseSlug: "nextjs",
    });
    assert.equal(plan?.notifications.length, 1);
    assert.equal(plan?.email, undefined);
  });

  it("plans assignment.graded from the real emit-site payload keys (studentUserId)", () => {
    const plan = planOutboxEvent(OUTBOX_TOPICS.assignmentGraded, {
      submissionId: "sub-1",
      assignmentId: "asg-1",
      courseId: "course-1",
      studentUserId: LEARNER_ID,
      score: 87,
      maxPoints: 100,
      scorePercent: 87,
    }, {
      courseSlug: "nextjs",
      courseTitle: "Next.js Masterclass",
      lessonId: "lesson-1",
      lessonTitle: "Assignment: Build a RSC Dashboard",
      gradeFeedback: "Great work",
      recipientEmail: "learner@example.test",
    });

    assert.deepEqual(plan?.notifications, [{
      userId: LEARNER_ID,
      topic: "assignment.graded",
      title: "Assignment graded: 87/100",
      linkPath: "/learning/nextjs/lesson-1",
      dedupeKeySuffix: LEARNER_ID,
    }]);
    assert.equal(plan?.email?.template, "assignmentGraded");
  });

  it("degrades assignment.graded to a shallow link when resolution lacks the lesson", () => {
    const plan = planOutboxEvent(OUTBOX_TOPICS.assignmentGraded, {
      submissionId: "sub-1",
      assignmentId: "asg-1",
      courseId: "course-1",
      studentUserId: LEARNER_ID,
      score: 0,
      maxPoints: 10,
    }, { courseSlug: "nextjs" });
    assert.equal(plan?.notifications[0]?.linkPath, "/learning/nextjs");
    assert.equal(plan?.email, undefined);
  });

  it("plans the certificate announcement with the verification url", () => {
    const plan = planOutboxEvent(OUTBOX_TOPICS.certificateIssued, {
      certificateId: "cert-1",
      userId: LEARNER_ID,
      courseId: "course-1",
      code: "ZZA5V5E3VWGT1Z1Z",
    }, { recipientEmail: "learner@example.test", verifyUrl: "https://dtg.test/certificates/ZZA5V5E3VWGT1Z1Z" });

    assert.equal(plan?.notifications[0]?.linkPath, "/certificates");
    assert.equal(plan?.email?.template, "certificateIssued");
  });

  it("notifies the thread author (never the replier) on discussion.thread_replied", () => {
    const payload = {
      threadId: "thread-1",
      courseId: "course-1",
      lessonId: "lesson-1",
      authorUserId: AUTHOR_ID,
    };
    const resolution = {
      threadAuthorUserId: LEARNER_ID,
      threadTitle: "How do server actions revalidate?",
      threadStatus: "ACTIVE",
      replyExcerpt: "  They   call revalidatePath.\n\nSee the docs.  ",
      courseSlug: "nextjs",
      recipientEmail: "author@example.test",
    };

    const plan = planOutboxEvent(OUTBOX_TOPICS.discussionThreadReplied, payload, resolution);
    assert.equal(plan?.notifications[0]?.userId, LEARNER_ID);
    assert.equal(
      plan?.notifications[0]?.title,
      "New reply to your question: How do server actions revalidate?",
    );
    assert.equal(plan?.notifications[0]?.linkPath, "/learning/nextjs/lesson-1");
    assert.equal(plan?.notifications[0]?.body, "They call revalidatePath. See the docs.");
  });

  it("treats a self-reply and a hidden thread as no-ops", () => {
    const payload = {
      threadId: "thread-1",
      courseId: "course-1",
      lessonId: "lesson-1",
      authorUserId: AUTHOR_ID,
    };
    assert.equal(
      planOutboxEvent(OUTBOX_TOPICS.discussionThreadReplied, payload, { threadAuthorUserId: AUTHOR_ID }),
      null,
    );
    assert.equal(
      planOutboxEvent(OUTBOX_TOPICS.discussionThreadReplied, payload, {
        threadAuthorUserId: LEARNER_ID,
        threadStatus: "HIDDEN",
      }),
      null,
    );
  });

  it("plans the owner question digest in-app only", () => {
    const plan = planOutboxEvent(OUTBOX_TOPICS.discussionThreadCreated, {
      courseId: "course-1",
      lessonId: "lesson-1",
      threadId: "thread-1",
      authorUserId: AUTHOR_ID,
    }, { ownerUserId: OWNER_ID, courseSlug: "nextjs", courseTitle: "Next.js Masterclass" });

    assert.equal(plan?.notifications[0]?.userId, OWNER_ID);
    assert.equal(plan?.email, undefined);
  });

  it("skips the owner digest when the owner asked the question", () => {
    assert.equal(
      planOutboxEvent(OUTBOX_TOPICS.discussionThreadCreated, {
        courseId: "course-1",
        lessonId: "lesson-1",
        threadId: "thread-1",
        authorUserId: OWNER_ID,
      }, { ownerUserId: OWNER_ID }),
      null,
    );
  });

  it("plans course.completed with no email (certificate email covers the moment)", () => {
    const plan = planOutboxEvent(OUTBOX_TOPICS.courseCompleted, {
      userId: LEARNER_ID,
      courseId: "course-1",
      completedAt: new Date().toISOString(),
    });
    assert.equal(plan?.notifications[0]?.linkPath, "/certificates");
    assert.equal(plan?.email, undefined);
  });

  it("plans review.owner_replied with the course link and reply excerpt", () => {
    const plan = planOutboxEvent(OUTBOX_TOPICS.reviewOwnerReplied, {
      reviewId: "review-1",
      courseId: "course-1",
      authorUserId: LEARNER_ID,
      reviewExcerpt: "Loved it",
      replyExcerpt: "Thank you for the detailed feedback!",
    }, { courseSlug: "nextjs", recipientEmail: "learner@example.test", courseUrl: "https://dtg.test/courses/nextjs" });

    assert.equal(plan?.notifications[0]?.linkPath, "/courses/nextjs");
    assert.equal(plan?.email?.template, "reviewReply");
  });

  it("completes no-op and unknown topics as null plans", () => {
    assert.equal(planOutboxEvent("review.created", {}), null);
    assert.equal(planOutboxEvent("review.updated", {}), null);
    assert.equal(planOutboxEvent("certificate.revoked", {}), null);
    assert.equal(planOutboxEvent("future.topic.from.a.newer.release", {}), null);
  });
});

describe("email error classification", () => {
  it("marks hard bounces and missing configuration as permanent", () => {
    assert.equal(classifyEmailError(new Error("550 5.1.1 recipient address rejected")), true);
    assert.equal(classifyEmailError(new Error("553 Invalid recipient")), true);
    assert.equal(classifyEmailError(new Error("SMTP is not configured.")), true);
    assert.equal(classifyEmailError(new Error("EMAIL_FROM is not configured.")), true);
  });

  it("marks transient failures as retryable", () => {
    assert.equal(classifyEmailError(new Error("Connection timeout after 30s")), false);
    assert.equal(classifyEmailError(new Error("421 Try again later")), false);
    assert.equal(classifyEmailError(new Error("451 Temporary local problem")), false);
  });
});

describe("email content helpers", () => {
  it("collapses and truncates excerpts with an ellipsis", () => {
    assert.equal(renderExcerpt("  a\n\n  b  "), "a b");
    const long = renderExcerpt("x".repeat(200));
    assert.equal(long.length, 120);
    assert.ok(long.endsWith("…"));
  });

  it("escapes hostile interpolations in templates", () => {
    const content = buildEnrolmentConfirmedEmail({
      courseTitle: '<script>alert("pwned")</script>',
      courseSlug: "nextjs",
    });
    assert.equal(content.html.includes("<script>"), false);
    assert.ok(content.html.includes(escapeHtml('<script>alert("pwned")</script>')));
    assert.ok(content.html.includes("/learning/nextjs"));
  });

  it("escapes layout headings and keeps the DTG footer", () => {
    const html = renderEmailLayout({
      heading: "Course completed — <b>not bold</b>",
      bodyHtml: "<p>body</p>",
    });
    assert.ok(html.includes("&lt;b&gt;not bold&lt;/b&gt;"));
    assert.ok(html.includes("DTG"));
    assert.ok(html.includes("Manage notifications in your profile."));
  });

  it("strips CR/LF from subjects (header injection)", () => {
    assert.equal(sanitizeEmailSubject("Hi\r\nBcc: victim@example.test"), "Hi Bcc: victim@example.test");
  });

  it("renders planned emails through the shared builders", () => {
    const rendered = renderOutboxEmail({
      to: "learner@example.test",
      template: "certificateIssued",
      params: {
        courseTitle: "Next.js Masterclass",
        verifyUrl: "https://dtg.test/certificates/ZZA5V5E3VWGT1Z1Z",
        certificateCode: "ZZA5V5E3VWGT1Z1Z",
      },
    });
    assert.ok(rendered.subject.includes("Next.js Masterclass"));
    assert.ok(rendered.html.includes("ZZA5V5E3VWGT1Z1Z"));
    assert.ok(rendered.text.includes("ZZA5V5E3VWGT1Z1Z"));
  });
});
