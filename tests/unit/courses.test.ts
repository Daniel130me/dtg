import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@/server/http/errors";
import {
  clampInsertPosition,
  collectPublishIssues,
  pickAvailableSlug,
  reorderedSectionPositions,
  slugifyTitle,
  type PublishCheckInput,
} from "@/server/modules/courses/courses.logic";
import {
  createCourseSchema,
  lessonCreateSchema,
  moveLessonSchema,
  parsePathParam,
  reorderSectionSchema,
  sectionUpdateSchema,
  courseIdParamSchema,
  updateCourseSchema,
} from "@/server/modules/courses/courses.schemas";

const UUID = "5f00ed84-39e2-4ac7-b09b-7218c8ebd22c";

const publishableCourse: PublishCheckInput = {
  title: "Mastering Product Photography",
  shortDescription: "Learn to shoot products that sell.",
  description: "A complete guide to lighting, styling, and editing product photos for online stores.",
  categoryId: UUID,
  priceMinor: 4_900,
  sections: [{ id: UUID, title: "Getting started", lessonCount: 3 }],
};

describe("course slug generation", () => {
  it("slugifies titles into lowercase dash-separated slugs", () => {
    assert.equal(slugifyTitle("Intro to UX Design!"), "intro-to-ux-design");
    assert.equal(slugifyTitle("  Build & Ship APIs  "), "build-ship-apis");
  });

  it("transliterates accents and collapses separator runs", () => {
    assert.equal(slugifyTitle("Café Résumé — 2024"), "cafe-resume-2024");
  });

  it("falls back to a default slug when nothing usable remains", () => {
    assert.equal(slugifyTitle("???"), "course");
    assert.equal(slugifyTitle("---"), "course");
  });

  it("truncates long titles while leaving room for collision suffixes", () => {
    const slug = slugifyTitle("a".repeat(400));
    assert.ok(slug.length <= 156);
    assert.ok(!slug.endsWith("-"));
  });

  it("returns the base slug when it is free", () => {
    assert.equal(pickAvailableSlug("intro-to-ux", []), "intro-to-ux");
  });

  it("appends the first free numeric suffix on conflicts", () => {
    assert.equal(pickAvailableSlug("intro-to-ux", ["intro-to-ux"]), "intro-to-ux-2");
    assert.equal(
      pickAvailableSlug("intro-to-ux", ["intro-to-ux", "intro-to-ux-2", "intro-to-ux-4"]),
      "intro-to-ux-3",
    );
  });

  it("ignores slugs that merely share a prefix", () => {
    assert.equal(pickAvailableSlug("intro", ["intro-to-ux", "introduction"]), "intro");
  });

  it("returns null when the bounded candidate window is exhausted", () => {
    const taken = ["intro"];
    for (let suffix = 2; suffix <= 101; suffix += 1) taken.push(`intro-${suffix}`);
    assert.equal(pickAvailableSlug("intro", taken), null);
  });
});

describe("publish check assembly", () => {
  it("returns no issues for a complete course", () => {
    assert.deepEqual(collectPublishIssues(publishableCourse), []);
  });

  it("reports every failing requirement at once", () => {
    const issues = collectPublishIssues({
      title: "",
      shortDescription: "short",
      description: "too short",
      categoryId: "",
      priceMinor: -1,
      sections: [
        { id: "s1", title: "Empty section", lessonCount: 0 },
        { id: "s2", title: "Full section", lessonCount: 2 },
      ],
    });

    assert.deepEqual(
      issues.map((issue) => issue.field),
      ["title", "shortDescription", "description", "categoryId", "priceMinor", "sections"],
    );
    assert.match(issues[5].message, /Empty section/);
  });

  it("reports a missing section list", () => {
    const issues = collectPublishIssues({ ...publishableCourse, sections: [] });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "sections");
  });
});

describe("position renumbering math", () => {
  const sections = [
    { id: "a", position: 1 },
    { id: "b", position: 2 },
    { id: "c", position: 3 },
  ];

  it("clamps insert positions into the valid slot range", () => {
    assert.equal(clampInsertPosition(0, 3), 1);
    assert.equal(clampInsertPosition(2, 3), 2);
    assert.equal(clampInsertPosition(99, 3), 4);
    assert.equal(clampInsertPosition(1, 0), 1);
  });

  it("moves a section down and renumbers the shifted block", () => {
    assert.deepEqual(reorderedSectionPositions(sections, "a", 3), [
      { id: "b", position: 1 },
      { id: "c", position: 2 },
      { id: "a", position: 3 },
    ]);
  });

  it("moves a section up and renumbers the shifted block", () => {
    assert.deepEqual(reorderedSectionPositions(sections, "c", 1), [
      { id: "c", position: 1 },
      { id: "a", position: 2 },
      { id: "b", position: 3 },
    ]);
  });

  it("clamps out-of-range requests to the first and last slots", () => {
    assert.deepEqual(
      reorderedSectionPositions(sections, "a", 0).map((section) => section.position),
      [1, 2, 3],
    );
    assert.deepEqual(
      reorderedSectionPositions(sections, "a", 99).map((section) => section.position),
      [1, 2, 3],
    );
  });

  it("keeps a single-section course stable", () => {
    assert.deepEqual(reorderedSectionPositions([{ id: "a", position: 1 }], "a", 7), [
      { id: "a", position: 1 },
    ]);
  });
});

describe("owner course schemas", () => {
  const validCreate = {
    title: "Mastering Product Photography",
    shortDescription: "Learn to shoot products that sell.",
    description:
      "A complete guide to lighting, styling, and editing product photos for online stores.",
    categoryId: UUID,
    level: "BEGINNER",
  };

  it("applies language, price, duration, and preview defaults", () => {
    const parsed = createCourseSchema.parse(validCreate);
    assert.equal(parsed.language, "English");
    assert.equal(parsed.priceMinor, 0);
    assert.equal(parsed.slug, undefined);
    assert.deepEqual(parsed.curriculum, []);

    const lesson = lessonCreateSchema.parse({ title: "Welcome", type: "VIDEO" });
    assert.equal(lesson.durationSeconds, 0);
    assert.equal(lesson.isPreview, false);
  });

  it("validates and defaults an initial curriculum atomically", () => {
    const parsed = createCourseSchema.parse({
      ...validCreate,
      promoVideoUrl: "https://video.example.test/preview",
      curriculum: [
        {
          title: "Getting started",
          lessons: [{ title: "Welcome aboard", type: "VIDEO" }],
        },
      ],
    });

    assert.equal(parsed.curriculum[0].lessons[0].durationSeconds, 0);
    assert.equal(parsed.curriculum[0].lessons[0].isPreview, false);
    assert.equal(parsed.promoVideoUrl, "https://video.example.test/preview");
  });

  it("rejects invalid nested curriculum and promo links", () => {
    assert.throws(() =>
      createCourseSchema.parse({
        ...validCreate,
        promoVideoUrl: "not-a-url",
        curriculum: [{ title: "x", lessons: [{ title: "y", type: "VIDEO" }] }],
      }),
    );
    assert.throws(() =>
      createCourseSchema.parse({
        ...validCreate,
        promoVideoUrl: "javascript:alert(1)",
      }),
    );
  });

  it("enforces field bounds", () => {
    assert.throws(() => createCourseSchema.parse({ ...validCreate, title: "abc" }));
    assert.throws(() => createCourseSchema.parse({ ...validCreate, priceMinor: 10_000_001 }));
    assert.throws(() =>
      lessonCreateSchema.parse({ title: "Welcome", type: "VIDEO", durationSeconds: 86_401 }),
    );
  });

  it("keeps the slug out of update payloads and rejects empty updates", () => {
    const parsed = updateCourseSchema.parse({ title: "New title", expectedVersion: 3 });
    assert.equal(parsed.expectedVersion, 3);
    assert.throws(() => updateCourseSchema.parse({}));
  });

  it("requires at least one section update field", () => {
    assert.deepEqual(sectionUpdateSchema.parse({ title: "New name" }), { title: "New name" });
    assert.throws(() => sectionUpdateSchema.parse({}));
  });

  it("validates move and reorder payloads", () => {
    assert.deepEqual(moveLessonSchema.parse({ sectionId: UUID, position: 2 }), {
      sectionId: UUID,
      position: 2,
    });
    assert.throws(() => moveLessonSchema.parse({ sectionId: UUID, position: 0 }));
    assert.deepEqual(reorderSectionSchema.parse({ position: 1 }), { position: 1 });
    assert.throws(() => reorderSectionSchema.parse({ position: -3 }));
  });

  it("rejects malformed route parameters with a validation error", () => {
    assert.equal(parsePathParam(courseIdParamSchema, UUID), UUID);
    try {
      parsePathParam(courseIdParamSchema, "not-a-uuid");
      assert.fail("expected parsePathParam to throw");
    } catch (error) {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 422);
      assert.equal(error.code, "VALIDATION_ERROR");
    }
  });
});
