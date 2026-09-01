import { CategoryStatus, CourseStatus, LessonStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  FREE_PRICE_MINOR,
  COURSE_SORTS,
  courseListQuerySchema,
  courseSlugParamSchema,
  deriveBadge,
  type CategoryDto,
  type CourseDetailDto,
  type CourseListQuery,
  type CourseListItemDto,
  type CourseSortKey,
  type PaginatedCoursesDto,
} from "@/contracts/catalog";
import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";

// Fallback for the instructor title line: the schema has no dedicated title
// column, so the profile bio doubles as the title per the catalog contract.
const INSTRUCTOR_TITLE_FALLBACK = "Instructor";

/** Cursor values may only hold integers, ISO datetimes, or decimal strings. */
const DECIMAL_CURSOR_PATTERN = /^\d+(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Cursor pagination (opaque to clients)
//
// The cursor encodes the full sort tuple of the last row on a page plus the
// row id, so keyset pagination is exact for every sort. RATING needs two
// values (ratingAverage, ratingCount) because ratingCount is part of its
// order; a bare (value, id) tuple would duplicate rows across pages.
// ---------------------------------------------------------------------------

type CourseCursorField =
  | "publishedAt"
  | "enrollmentCount"
  | "priceMinor"
  | "ratingAverage"
  | "ratingCount";

/** JSON-serializable cursor value as stored in the encoded cursor. */
type CursorValue = string | number | null;
/** Value handed to Prisma filters after decoding (DateTime columns need Date). */
type CursorOperand = Date | string | number | null;

interface CursorColumnSpec {
  field: CourseCursorField;
  direction: "asc" | "desc";
  /** Nullable columns are ordered NULLS LAST when descending. */
  nullable: boolean;
}

interface CursorColumnCodec {
  read: (row: CourseListRow) => CursorValue;
  parse: (value: CursorValue) => CursorOperand;
}

interface CourseCursor {
  sort: CourseSortKey;
  values: CursorOperand[];
  id: string;
}

const courseListSelect = {
  id: true,
  slug: true,
  title: true,
  shortDescription: true,
  level: true,
  language: true,
  priceMinor: true,
  currency: true,
  thumbnailUrl: true,
  totalSections: true,
  totalLessons: true,
  totalMinutes: true,
  enrollmentCount: true,
  ratingAverage: true,
  ratingCount: true,
  publishedAt: true,
  category: { select: { name: true, slug: true } },
} satisfies Prisma.CourseSelect;

type CourseListRow = Prisma.CourseGetPayload<{ select: typeof courseListSelect }>;

const courseDetailSelect = {
  ...courseListSelect,
  status: true,
  description: true,
  promoVideoUrl: true,
  requirements: { orderBy: { position: "asc" }, select: { text: true } },
  outcomes: { orderBy: { position: "asc" }, select: { text: true } },
  sections: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      position: true,
      lessons: {
        where: { status: LessonStatus.PUBLISHED },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          type: true,
          position: true,
          durationSeconds: true,
          isPreview: true,
          content: true,
          videoUrl: true,
        },
      },
    },
  },
  creator: { select: { name: true, profile: { select: { displayName: true, bio: true } } } },
} satisfies Prisma.CourseSelect;

type CourseDetailRow = Prisma.CourseGetPayload<{ select: typeof courseDetailSelect }>;

const COURSE_SORT_SPECS: Record<
  CourseSortKey,
  { orderBy: Prisma.CourseOrderByWithRelationInput[]; cursorColumns: CursorColumnSpec[] }
> = {
  NEWEST: {
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    cursorColumns: [{ field: "publishedAt", direction: "desc", nullable: true }],
  },
  POPULAR: {
    orderBy: [{ enrollmentCount: "desc" }, { id: "desc" }],
    cursorColumns: [{ field: "enrollmentCount", direction: "desc", nullable: false }],
  },
  RATING: {
    orderBy: [
      { ratingAverage: { sort: "desc", nulls: "last" } },
      { ratingCount: "desc" },
      { id: "desc" },
    ],
    cursorColumns: [
      { field: "ratingAverage", direction: "desc", nullable: true },
      { field: "ratingCount", direction: "desc", nullable: false },
    ],
  },
  PRICE_ASC: {
    orderBy: [{ priceMinor: "asc" }, { id: "desc" }],
    cursorColumns: [{ field: "priceMinor", direction: "asc", nullable: false }],
  },
  PRICE_DESC: {
    orderBy: [{ priceMinor: "desc" }, { id: "desc" }],
    cursorColumns: [{ field: "priceMinor", direction: "desc", nullable: false }],
  },
};

const CURSOR_COLUMN_CODEC: Record<CourseCursorField, CursorColumnCodec> = {
  publishedAt: {
    read: (row) => row.publishedAt?.toISOString() ?? null,
    parse: (value) => (value === null ? null : new Date(z.iso.datetime().parse(value))),
  },
  enrollmentCount: {
    read: (row) => row.enrollmentCount,
    parse: (value) => z.number().int().parse(value),
  },
  priceMinor: {
    read: (row) => row.priceMinor,
    parse: (value) => z.number().int().parse(value),
  },
  ratingAverage: {
    // Decimal values travel as exact decimal strings, never floats.
    read: (row) => (row.ratingAverage === null ? null : row.ratingAverage.toString()),
    parse: (value) =>
      value === null ? null : z.string().regex(DECIMAL_CURSOR_PATTERN).parse(value),
  },
  ratingCount: {
    read: (row) => row.ratingCount,
    parse: (value) => z.number().int().parse(value),
  },
};

const courseCursorEnvelopeSchema = z.object({
  sort: z.enum(COURSE_SORTS),
  values: z.array(z.union([z.string(), z.number(), z.null()])),
  id: z.uuid(),
});

function invalidCursorError(): ApiError {
  return new ApiError(422, "INVALID_CURSOR", "The pagination cursor is invalid.");
}

function encodeCourseCursor(sort: CourseSortKey, row: CourseListRow): string {
  const payload = {
    sort,
    values: COURSE_SORT_SPECS[sort].cursorColumns.map((column) =>
      CURSOR_COLUMN_CODEC[column.field].read(row),
    ),
    id: row.id,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCourseCursor(encoded: string, expectedSort: CourseSortKey): CourseCursor {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw invalidCursorError();
  }

  const parsed = courseCursorEnvelopeSchema.safeParse(payload);
  if (!parsed.success || parsed.data.sort !== expectedSort) throw invalidCursorError();

  const columns = COURSE_SORT_SPECS[parsed.data.sort].cursorColumns;
  if (parsed.data.values.length !== columns.length) throw invalidCursorError();

  const values = columns.map((column, index) => {
    try {
      return CURSOR_COLUMN_CODEC[column.field].parse(parsed.data.values[index]);
    } catch {
      throw invalidCursorError();
    }
  });
  return { sort: parsed.data.sort, values, id: parsed.data.id };
}

/**
 * Generic keyset comparator: rows strictly after the cursor under the column
 * order plus the `id desc` tie-break. Built from the innermost key outwards.
 */
function buildCursorWhere(
  columns: readonly CursorColumnSpec[],
  values: readonly CursorOperand[],
  cursorId: string,
): Prisma.CourseWhereInput {
  // Prisma's where-input union cannot be indexed with a computed key, so the
  // construction goes through this single narrow helper.
  const withField = (field: CourseCursorField, condition: unknown): Prisma.CourseWhereInput =>
    ({ [field]: condition }) as Prisma.CourseWhereInput;

  let remaining: Prisma.CourseWhereInput = { id: { lt: cursorId } };
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const column = columns[index];
    const operand = values[index];
    if (operand === null) {
      // Descending nullable columns sort NULLS LAST: after a NULL cursor
      // value only further NULL rows remain.
      remaining = { AND: [withField(column.field, null), remaining] };
      continue;
    }
    const comparisonOperator = column.direction === "asc" ? "gt" : "lt";
    const branches: Prisma.CourseWhereInput[] = [
      withField(column.field, { [comparisonOperator]: operand }),
    ];
    // NULL rows trail every non-null value in a descending NULLS-LAST sort.
    if (column.direction === "desc" && column.nullable) {
      branches.push(withField(column.field, null));
    }
    branches.push({ AND: [withField(column.field, operand), remaining] });
    remaining = { OR: branches };
  }
  return remaining;
}

// ---------------------------------------------------------------------------
// Row shaping
// ---------------------------------------------------------------------------

function toCourseListItemDto(row: CourseListRow): CourseListItemDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    shortDescription: row.shortDescription,
    level: row.level,
    language: row.language,
    priceMinor: row.priceMinor,
    currency: row.currency,
    isFree: row.priceMinor === FREE_PRICE_MINOR,
    categoryName: row.category.name,
    categorySlug: row.category.slug,
    thumbnailUrl: row.thumbnailUrl,
    totalSections: row.totalSections,
    totalLessons: row.totalLessons,
    totalMinutes: row.totalMinutes,
    enrollmentCount: row.enrollmentCount,
    ratingAverage: row.ratingAverage === null ? null : row.ratingAverage.toNumber(),
    ratingCount: row.ratingCount,
    // PUBLISHED courses are stamped on publish; the empty string only guards
    // the anomalous null case.
    publishedAt: row.publishedAt?.toISOString() ?? "",
    badge: deriveBadge({
      priceMinor: row.priceMinor,
      publishedAt: row.publishedAt,
      enrollmentCount: row.enrollmentCount,
    }),
  };
}

function toCourseDetailDto(row: CourseDetailRow): CourseDetailDto {
  const profile = row.creator.profile;
  return {
    ...toCourseListItemDto(row),
    description: row.description,
    promoVideoUrl: row.promoVideoUrl,
    requirements: row.requirements.map((requirement) => requirement.text),
    outcomes: row.outcomes.map((outcome) => outcome.text),
    sections: row.sections.map((section) => ({
      id: section.id,
      title: section.title,
      position: section.position,
      lessons: section.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        type: lesson.type,
        position: lesson.position,
        durationSeconds: lesson.durationSeconds,
        isPreview: lesson.isPreview,
        // Empty bodies count as no content.
        hasContent: Boolean(lesson.content),
        videoUrl: lesson.videoUrl,
      })),
    })),
    instructor: {
      name: profile?.displayName ?? row.creator.name,
      title: profile?.bio ?? INSTRUCTOR_TITLE_FALLBACK,
      bio: profile?.bio ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

function publishedCourseFilters(query: CourseListQuery): Prisma.CourseWhereInput[] {
  const filters: Prisma.CourseWhereInput[] = [{ status: CourseStatus.PUBLISHED }];
  if (query.category) filters.push({ category: { slug: query.category } });
  if (query.level) filters.push({ level: query.level });
  if (query.price === "FREE") filters.push({ priceMinor: FREE_PRICE_MINOR });
  if (query.price === "PAID") filters.push({ priceMinor: { gt: FREE_PRICE_MINOR } });
  if (query.search) {
    filters.push({
      OR: [
        { title: { contains: query.search, mode: "insensitive" } },
        { shortDescription: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }
  return filters;
}

/**
 * List published courses with filters, sorting, and keyset pagination.
 * Query budget: 2 (one findMany + one count for the cursor-independent total).
 */
export async function listPublishedCourses(query: CourseListQuery): Promise<PaginatedCoursesDto> {
  const parsed = courseListQuerySchema.parse(query);
  const sortSpec = COURSE_SORT_SPECS[parsed.sort];
  const filters = publishedCourseFilters(parsed);

  const where: Prisma.CourseWhereInput = { AND: filters };
  if (parsed.cursor) {
    const cursor = decodeCourseCursor(parsed.cursor, parsed.sort);
    where.AND = [...filters, buildCursorWhere(sortSpec.cursorColumns, cursor.values, cursor.id)];
  }

  // One extra row detects whether a next page exists.
  const [rows, total] = await Promise.all([
    db.course.findMany({
      where,
      orderBy: sortSpec.orderBy,
      take: parsed.limit + 1,
      select: courseListSelect,
    }),
    db.course.count({ where: { AND: filters } }),
  ]);

  const hasMore = rows.length > parsed.limit;
  const items = (hasMore ? rows.slice(0, parsed.limit) : rows).map(toCourseListItemDto);
  const nextCursor = hasMore ? encodeCourseCursor(parsed.sort, rows[parsed.limit - 1]) : null;
  return { items, nextCursor, total };
}

/**
 * Fetch one published course with category, curriculum, requirements,
 * outcomes, and instructor. Query budget: 1 (single findUnique with nested
 * selects; the status check happens in memory to keep it to one query).
 */
export async function getPublishedCourseBySlug(input: { slug: string }): Promise<CourseDetailDto> {
  const { slug } = courseSlugParamSchema.parse(input);
  const course = await db.course.findUnique({ where: { slug }, select: courseDetailSelect });
  if (!course || course.status !== CourseStatus.PUBLISHED) {
    throw new ApiError(
      404,
      "COURSE_NOT_FOUND",
      "The requested course does not exist or is not published.",
    );
  }
  return toCourseDetailDto(course);
}

/**
 * Active categories ordered by sortOrder with their published course counts.
 * Query budget: 1 (the count is a filtered _count on the same query).
 */
export async function listActiveCategories(): Promise<CategoryDto[]> {
  const categories = await db.category.findMany({
    where: { status: CategoryStatus.ACTIVE },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      icon: true,
      _count: { select: { courses: { where: { status: CourseStatus.PUBLISHED } } } },
    },
  });
  return categories.map((category) => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
    icon: category.icon,
    courseCount: category._count.courses,
  }));
}
