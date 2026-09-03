import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  learnerDashboardSchema,
  moderationUpdateSchema,
  ownerThreadListQuerySchema,
  OWNER_THREAD_PAGE_LIMIT_DEFAULT,
  OWNER_THREAD_PAGE_LIMIT_MAX,
  progressResultSchema,
  progressUpdateSchema,
  replyCreateSchema,
  threadDetailSchema,
} from "@/contracts/learning";
import {
  buildNotesExportMarkdown,
  compareCurriculumOrder,
  computeProgressPercent,
  describeLessonAccess,
  evaluateLessonCompletionGate,
  LESSON_COMPLETION_GATE_ASSIGNMENT,
  LESSON_COMPLETION_GATE_QUIZ,
  pickContinueLearningCourses,
  pickNextLesson,
  shouldCompleteCourse,
} from "@/server/modules/learning/learning.logic";

describe("progress percent", () => {
  it("is 0 when the course has no lessons (never NaN)", () => {
    assert.equal(computeProgressPercent(0, 0), 0);
    assert.equal(computeProgressPercent(2, 0), 0);
  });

  it("floors fractional percentages", () => {
    assert.equal(computeProgressPercent(3, 4), 75);
    assert.equal(computeProgressPercent(1, 3), 33);
    assert.equal(computeProgressPercent(2, 3), 66);
  });

  it("reaches exactly 100 when everything is completed and clamps overflow", () => {
    assert.equal(computeProgressPercent(4, 4), 100);
    assert.equal(computeProgressPercent(7, 4), 100);
  });
});

describe("course completion gate", () => {
  it("never completes an empty course", () => {
    assert.equal(shouldCompleteCourse(0, 0), false);
  });

  it("completes only when every lesson is done", () => {
    assert.equal(shouldCompleteCourse(4, 5), false);
    assert.equal(shouldCompleteCourse(5, 5), true);
    assert.equal(shouldCompleteCourse(6, 5), true);
  });
});

describe("lesson access matrix", () => {
  it("treats draft lessons as not-found even for enrolled learners", () => {
    assert.equal(
      describeLessonAccess({ enrolmentStatus: "ACTIVE", isPreview: false, lessonStatus: "DRAFT" }),
      "NOT_FOUND",
    );
  });

  it("gives ACTIVE and COMPLETED enrolments full access", () => {
    for (const status of ["ACTIVE", "COMPLETED"]) {
      assert.equal(
        describeLessonAccess({ enrolmentStatus: status, isPreview: false, lessonStatus: "PUBLISHED" }),
        "ENROLLED",
      );
    }
  });

  it("keeps preview lessons public for non-enrolled and revoked callers", () => {
    assert.equal(
      describeLessonAccess({ enrolmentStatus: null, isPreview: true, lessonStatus: "PUBLISHED" }),
      "PREVIEW",
    );
    assert.equal(
      describeLessonAccess({ enrolmentStatus: "REVOKED", isPreview: true, lessonStatus: "PUBLISHED" }),
      "PREVIEW",
    );
  });

  it("answers NONE behind the paywall otherwise", () => {
    assert.equal(
      describeLessonAccess({ enrolmentStatus: null, isPreview: false, lessonStatus: "PUBLISHED" }),
      "NONE",
    );
    assert.equal(
      describeLessonAccess({ enrolmentStatus: "REVOKED", isPreview: false, lessonStatus: "PUBLISHED" }),
      "NONE",
    );
  });
});

describe("next lesson choice", () => {
  const curriculum = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("skips completed lessons in curriculum order", () => {
    const completed = new Set(["a"]);
    assert.deepEqual(pickNextLesson(curriculum, completed), { id: "b" });
  });

  it("returns null when everything is completed or the curriculum is empty", () => {
    assert.equal(pickNextLesson(curriculum, new Set(["a", "b", "c"])), null);
    assert.equal(pickNextLesson([], new Set()), null);
  });

  it("starts at the first lesson for a fresh learner", () => {
    assert.deepEqual(pickNextLesson(curriculum, new Set()), { id: "a" });
  });
});

describe("curriculum ordering", () => {
  it("orders by section position before lesson position", () => {
    assert.equal(
      compareCurriculumOrder({ sectionPosition: 1, position: 3 }, { sectionPosition: 2, position: 1 }),
      -1,
    );
    assert.equal(
      compareCurriculumOrder({ sectionPosition: 2, position: 1 }, { sectionPosition: 2, position: 2 }),
      -1,
    );
    assert.equal(
      compareCurriculumOrder({ sectionPosition: 3, position: 1 }, { sectionPosition: 3, position: 1 }),
      0,
    );
  });
});

describe("continue-learning rail selection", () => {
  it("leads with courses that have progress, latest activity first", () => {
    const picked = pickContinueLearningCourses(
      [
        { courseId: "untapped", lastActivityAt: null, enrolledAt: "2026-01-01T00:00:00.000Z" },
        { courseId: "stale", lastActivityAt: "2026-01-05T00:00:00.000Z", enrolledAt: "2026-01-02T00:00:00.000Z" },
        { courseId: "fresh", lastActivityAt: "2026-02-01T00:00:00.000Z", enrolledAt: "2026-01-03T00:00:00.000Z" },
      ],
      3,
    );
    assert.deepEqual(picked, ["fresh", "stale", "untapped"]);
  });

  it("fills remaining slots with untouched courses, newest enrolment first", () => {
    const picked = pickContinueLearningCourses(
      [
        { courseId: "old", lastActivityAt: null, enrolledAt: "2026-01-01T00:00:00.000Z" },
        { courseId: "new", lastActivityAt: null, enrolledAt: "2026-03-01T00:00:00.000Z" },
      ],
      1,
    );
    assert.deepEqual(picked, ["new"]);
  });

  it("respects the rail limit", () => {
    const candidates = ["a", "b", "c", "d"].map((courseId, index) => ({
      courseId,
      lastActivityAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      enrolledAt: "2026-01-01T00:00:00.000Z",
    }));
    assert.deepEqual(pickContinueLearningCourses(candidates, 2), ["d", "c"]);
  });
});

describe("notes export rendering", () => {
  it("groups notes under one course heading and renders lesson blocks", () => {
    const markdown = buildNotesExportMarkdown([
      { courseTitle: "React Basics", lessonTitle: "Props", date: "2026-02-01", body: "Props flow down." },
      { courseTitle: "React Basics", lessonTitle: "State", date: "2026-02-02", body: "State is local." },
      { courseTitle: "SQL", lessonTitle: "Joins", date: "2026-02-03", body: "INNER JOIN filters." },
    ]);
    const lines = markdown.split("\n");
    assert.deepEqual(lines.filter((line) => line.startsWith("# ")), ["# React Basics", "# SQL"]);
    assert.ok(markdown.includes("## Props — 2026-02-01\n\nProps flow down."));
    assert.ok(markdown.includes("## State — 2026-02-02\n\nState is local."));
    assert.ok(markdown.includes("## Joins — 2026-02-03\n\nINNER JOIN filters."));
  });

  it("has an honest empty state", () => {
    assert.equal(buildNotesExportMarkdown([]), "# My notes\n\nNo saved notes yet.\n");
  });
});

describe("lesson completion gate (Coursera-style assessment enforcement)", () => {
  it("never gates VIDEO or TEXT lessons", () => {
    for (const lessonType of ["VIDEO", "TEXT"] as const) {
      const decision = evaluateLessonCompletionGate({ lessonType, quizPassed: false, assignmentSubmitted: false });
      assert.equal(decision.allowed, true);
      assert.equal(decision.reason, null);
    }
  });

  it("gates a QUIZ lesson until a passed attempt exists", () => {
    const blocked = evaluateLessonCompletionGate({ lessonType: "QUIZ", quizPassed: false, assignmentSubmitted: null });
    assert.deepEqual(blocked, {
      allowed: false,
      reason: LESSON_COMPLETION_GATE_QUIZ,
      message: "Pass the quiz to complete this lesson.",
    });
    const allowed = evaluateLessonCompletionGate({ lessonType: "QUIZ", quizPassed: true, assignmentSubmitted: null });
    assert.equal(allowed.allowed, true);
  });

  it("gates an ASSIGNMENT lesson until a submission exists", () => {
    const blocked = evaluateLessonCompletionGate({ lessonType: "ASSIGNMENT", quizPassed: null, assignmentSubmitted: false });
    assert.deepEqual(blocked, {
      allowed: false,
      reason: LESSON_COMPLETION_GATE_ASSIGNMENT,
      message: "Submit the assignment to complete this lesson.",
    });
    const allowed = evaluateLessonCompletionGate({ lessonType: "ASSIGNMENT", quizPassed: null, assignmentSubmitted: true });
    assert.equal(allowed.allowed, true);
  });

  it("does not gate assessment lessons with nothing authored (half-configured lessons stay completable)", () => {
    const unauthoredQuiz = evaluateLessonCompletionGate({ lessonType: "QUIZ", quizPassed: null, assignmentSubmitted: null });
    assert.equal(unauthoredQuiz.allowed, true);
    const unauthoredAssignment = evaluateLessonCompletionGate({
      lessonType: "ASSIGNMENT",
      quizPassed: null,
      assignmentSubmitted: null,
    });
    assert.equal(unauthoredAssignment.allowed, true);
  });
});

describe("owner Q&A contracts", () => {
  it("applies bounded defaults and accepts each moderation filter", () => {
    assert.deepEqual(ownerThreadListQuerySchema.parse({}), {
      limit: OWNER_THREAD_PAGE_LIMIT_DEFAULT,
      status: "ALL",
    });
    assert.equal(ownerThreadListQuerySchema.parse({ status: "ACTIVE" }).status, "ACTIVE");
    assert.equal(ownerThreadListQuerySchema.parse({ status: "HIDDEN" }).status, "HIDDEN");
  });

  it("rejects oversized pages and unsupported status values", () => {
    assert.throws(() =>
      ownerThreadListQuerySchema.parse({ limit: OWNER_THREAD_PAGE_LIMIT_MAX + 1 }),
    );
    assert.throws(() => ownerThreadListQuerySchema.parse({ status: "DELETED" }));
  });

  it("trims replies, rejects empty messages, and allowlists moderation state", () => {
    assert.deepEqual(replyCreateSchema.parse({ body: "  I can help with that.  " }), {
      body: "I can help with that.",
    });
    assert.throws(() => replyCreateSchema.parse({ body: "   " }));
    assert.deepEqual(moderationUpdateSchema.parse({ status: "HIDDEN" }), { status: "HIDDEN" });
    assert.throws(() => moderationUpdateSchema.parse({ status: "DELETED" }));
    assert.deepEqual(moderationUpdateSchema.parse({ status: "ACTIVE", role: "OWNER" }), {
      status: "ACTIVE",
    });
  });
});

describe("learning wire contracts", () => {
  const lesson = {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    title: "Components",
    type: "VIDEO",
    durationSeconds: 600,
    isPreview: true,
  };

  it("parses a full learner dashboard DTO", () => {
    const dashboard = learnerDashboardSchema.parse({
      stats: { enrolledCourses: 2, completedCourses: 1, lessonsCompleted: 7, minutesCompleted: 45 },
      continueLearning: [
        {
          courseId: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
          courseSlug: "react-basics",
          courseTitle: "React Basics",
          categoryName: "Web Development",
          thumbnailUrl: null,
          totalLessons: 12,
          totalMinutes: 180,
          completedLessons: 7,
          progressPercent: 58,
          nextLesson: lesson,
          lastActivityAt: "2026-02-01T10:00:00.000Z",
        },
      ],
    });
    assert.equal(dashboard.continueLearning[0].nextLesson?.title, "Components");
    // The rail accepts a course with nothing left to watch.
    const drained = learnerDashboardSchema.parse({
      stats: { enrolledCourses: 0, completedCourses: 0, lessonsCompleted: 0, minutesCompleted: 0 },
      continueLearning: [
        { ...dashboard.continueLearning[0], nextLesson: null },
      ],
    });
    assert.equal(drained.continueLearning[0].nextLesson, null);
  });

  it("parses a progress result and rejects non-monotonic bodies", () => {
    const result = progressResultSchema.parse({
      lessonId: lesson.id,
      completed: true,
      totalLessons: 12,
      completedLessons: 8,
      progressPercent: 66,
      courseCompleted: false,
    });
    assert.equal(result.completed, true);

    assert.throws(() => progressUpdateSchema.parse({ completed: false }));
    assert.throws(() => progressUpdateSchema.parse({}));
  });

  it("parses a thread detail with its reply page", () => {
    const detail = threadDetailSchema.parse({
      thread: {
        id: "3f2504e0-4f89-11d3-9a0c-0305e82c3303",
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        title: "How do keys work?",
        status: "ACTIVE",
        postCount: 2,
        lastActivityAt: "2026-02-02T10:00:00.000Z",
        createdAt: "2026-02-01T10:00:00.000Z",
        author: { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3304", name: "Ada" },
      },
      posts: [
        {
          id: "3f2504e0-4f89-11d3-9a0c-0305e82c3305",
          body: "Keys identify elements across renders.",
          status: "ACTIVE",
          createdAt: "2026-02-02T10:00:00.000Z",
          author: { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3304", name: "Ada" },
        },
      ],
      nextCursor: null,
      totalPosts: 1,
    });
    assert.equal(detail.thread.postCount, 2);
    assert.equal(detail.totalPosts, 1);
    assert.throws(() =>
      threadDetailSchema.parse({
        ...detail,
        thread: { ...detail.thread, status: "DELETED" },
      }),
    );
  });
});
