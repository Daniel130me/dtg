import type { Prisma } from "@prisma/client";
import type { CourseStatus, LessonStatus, LessonType } from "@prisma/client";
import type {
  OwnerCourseDetailDto,
  OwnerCourseListItemDto,
  OwnerLessonDto,
  OwnerSectionDto,
} from "@/contracts/owner-courses";
import {
  COURSE_TITLE_MIN_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  MIN_POSITION,
  SHORT_DESCRIPTION_MIN_LENGTH,
  SLUG_MAX_LENGTH,
} from "@/server/modules/courses/courses.schemas";

// Pure authoring logic: slug handling, publish validation, position math, and
// Prisma-row-to-DTO mappers. No database access — everything here is unit
// testable in isolation.

export const SECONDS_PER_MINUTE = 60;
export const COURSE_VERSION_INCREMENT = 1;

const SLUG_SUFFIX_RESERVE = 4; // Room for "-100"-style collision suffixes.
export const SLUG_CANDIDATE_LIMIT = 100; // Bounded retry window for slug conflicts.
const SLUG_FALLBACK = "course";

// Converts a course title (or explicit slug) into a URL-safe slug. Accents are
// transliterated via NFKD decomposition; the result is truncated to leave room
// for collision suffixes so every candidate still fits the 160-char column.
export function slugifyTitle(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH - SLUG_SUFFIX_RESERVE)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : SLUG_FALLBACK;
}

// Picks the first free slug among `base`, `base-2`, ... `base-101`. Returns
// null when every candidate is taken so the caller can surface a conflict.
// `takenSlugs` comes from a single startsWith query scoped to the base.
export function pickAvailableSlug(base: string, takenSlugs: Iterable<string>): string | null {
  const taken = new Set(takenSlugs);
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= SLUG_CANDIDATE_LIMIT + 1; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

export interface PublishCheckInput {
  title: string;
  shortDescription: string;
  description: string;
  categoryId: string;
  priceMinor: number;
  sections: Array<{
    id: string;
    title: string;
    lessonCount: number;
    missingVideoTitles?: string[];
  }>;
}

export interface PublishIssue {
  field: string;
  message: string;
}

// Aggregates every failing publish requirement so the owner sees all gaps in
// one round trip instead of fixing them one by one.
export function collectPublishIssues(course: PublishCheckInput): PublishIssue[] {
  const issues: PublishIssue[] = [];

  if (course.title.trim().length < COURSE_TITLE_MIN_LENGTH) {
    issues.push({ field: "title", message: "A title is required before publishing." });
  }
  if (course.shortDescription.trim().length < SHORT_DESCRIPTION_MIN_LENGTH) {
    issues.push({
      field: "shortDescription",
      message: "A short description is required before publishing.",
    });
  }
  if (course.description.trim().length < DESCRIPTION_MIN_LENGTH) {
    issues.push({ field: "description", message: "A description is required before publishing." });
  }
  // Defensive: categoryId is NOT NULL in the schema, but publish must never
  // proceed on an unset category.
  if (course.categoryId.length === 0) {
    issues.push({ field: "categoryId", message: "A category is required before publishing." });
  }
  // Defensive: the schema enforces this at write time too.
  if (course.priceMinor < 0) {
    issues.push({ field: "priceMinor", message: "The price cannot be negative." });
  }
  if (course.sections.length === 0) {
    issues.push({ field: "sections", message: "Add at least one section before publishing." });
  }
  for (const section of course.sections) {
    if (section.lessonCount === 0) {
      issues.push({
        field: "sections",
        message: `Section "${section.title}" needs at least one lesson.`,
      });
    }
    for (const lessonTitle of section.missingVideoTitles ?? []) {
      issues.push({
        field: "sections",
        message: `Video lesson "${lessonTitle}" needs a lecture video before publishing.`,
      });
    }
  }

  return issues;
}

export interface PositionedItem {
  id: string;
  position: number;
}

// Clamps a requested 1-based insert position to the valid slot range for a
// list that will hold `existingCount` other items plus the inserted one.
export function clampInsertPosition(requestedPosition: number, existingCount: number): number {
  return Math.min(Math.max(requestedPosition, MIN_POSITION), existingCount + MIN_POSITION);
}

// Computes the final 1..n position assignment after moving one section to the
// requested position (clamped). The caller writes these back inside a
// transaction after shifting all positions to a temporary negative offset.
export function reorderedSectionPositions(
  sections: PositionedItem[],
  targetSectionId: string,
  requestedPosition: number,
): PositionedItem[] {
  const ordered = [...sections].sort((a, b) => a.position - b.position);
  const withoutTarget = ordered.filter((section) => section.id !== targetSectionId);
  const insertIndex = clampInsertPosition(requestedPosition, withoutTarget.length) - 1;
  withoutTarget.splice(insertIndex, 0, { id: targetSectionId, position: 0 });
  return withoutTarget.map((section, index) => ({ id: section.id, position: index + 1 }));
}

// ---------------------------------------------------------------------------
// Row-to-DTO mappers (structural inputs; dates become ISO strings here).
// ---------------------------------------------------------------------------

interface CourseSummaryRow {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  level: string;
  language: string;
  priceMinor: number;
  currency: string;
  status: CourseStatus;
  version: number;
  totalSections: number;
  totalLessons: number;
  totalMinutes: number;
  enrollmentCount: number;
  ratingAverage: Prisma.Decimal | null;
  ratingCount: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; slug: string; name: string } | null;
}

interface LessonRow {
  id: string;
  sectionId: string;
  title: string;
  type: LessonType;
  status: LessonStatus;
  position: number;
  durationSeconds: number;
  isPreview: boolean;
  content: string | null;
  videoUrl: string | null;
  videoFileName: string | null;
  videoContentType: string | null;
  videoSizeBytes: bigint | null;
  videoUploadedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SectionRow {
  id: string;
  title: string;
  position: number;
  lessons: LessonRow[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseDetailRow extends CourseSummaryRow {
  description: string;
  thumbnailUrl: string | null;
  promoVideoUrl: string | null;
  sections: SectionRow[];
  requirements: Array<{ id: string; position: number; text: string }>;
  outcomes: Array<{ id: string; position: number; text: string }>;
}

export function toOwnerLessonDto(lesson: LessonRow): OwnerLessonDto {
  return {
    id: lesson.id,
    sectionId: lesson.sectionId,
    title: lesson.title,
    type: lesson.type,
    status: lesson.status,
    position: lesson.position,
    durationSeconds: lesson.durationSeconds,
    isPreview: lesson.isPreview,
    content: lesson.content,
    videoUrl: lesson.videoUrl,
    videoFileName: lesson.videoFileName,
    videoContentType: lesson.videoContentType,
    videoSizeBytes: lesson.videoSizeBytes === null ? null : Number(lesson.videoSizeBytes),
    videoUploadedAt: lesson.videoUploadedAt?.toISOString() ?? null,
    createdAt: lesson.createdAt.toISOString(),
    updatedAt: lesson.updatedAt.toISOString(),
  };
}

export function toOwnerSectionDto(section: SectionRow): OwnerSectionDto {
  return {
    id: section.id,
    title: section.title,
    position: section.position,
    lessons: section.lessons.map(toOwnerLessonDto),
    createdAt: section.createdAt.toISOString(),
    updatedAt: section.updatedAt.toISOString(),
  };
}

export function toOwnerCourseListItemDto(row: CourseSummaryRow): OwnerCourseListItemDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    shortDescription: row.shortDescription,
    level: row.level,
    language: row.language,
    priceMinor: row.priceMinor,
    currency: row.currency,
    status: row.status,
    version: row.version,
    totalSections: row.totalSections,
    totalLessons: row.totalLessons,
    totalMinutes: row.totalMinutes,
    enrollmentCount: row.enrollmentCount,
    ratingAverage: row.ratingAverage === null ? null : Number(row.ratingAverage),
    ratingCount: row.ratingCount,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    category: row.category ? { ...row.category } : null,
  };
}

export function toOwnerCourseDetailDto(row: CourseDetailRow): OwnerCourseDetailDto {
  return {
    ...toOwnerCourseListItemDto(row),
    description: row.description,
    thumbnailUrl: row.thumbnailUrl,
    promoVideoUrl: row.promoVideoUrl,
    sections: row.sections.map(toOwnerSectionDto),
    requirements: row.requirements.map((requirement) => ({ ...requirement })),
    outcomes: row.outcomes.map((outcome) => ({ ...outcome })),
  };
}
