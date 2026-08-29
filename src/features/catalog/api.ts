import type { z } from "zod";
import {
  courseListQuerySchema,
  type CategoryDto,
  type CourseDetailDto,
  type PaginatedCoursesDto,
} from "@/contracts/catalog";
import { apiRequest } from "@/lib/client/api-client";

const CATALOG_BASE_PATH = "/api/v1";

/**
 * Input form of the catalog list query. The API applies the schema defaults
 * for `price`, `sort` and `limit` (see courseListQuerySchema), so callers only
 * send the fields they care about — e.g. fetchCourses({ sort: "POPULAR", limit: 6 }).
 * The contract's exported `CourseListQuery` is the *output* type (defaults filled
 * in); deriving the input type from the same schema keeps everything in sync.
 */
export type CourseListQueryInput = z.input<typeof courseListQuerySchema>;

/** Serializes the query to a query string, skipping empty values so API defaults apply. */
function buildQueryString(query: CourseListQueryInput): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function fetchCourses(query: CourseListQueryInput): Promise<PaginatedCoursesDto> {
  const queryString = buildQueryString(query);
  const path = queryString
    ? `${CATALOG_BASE_PATH}/courses?${queryString}`
    : `${CATALOG_BASE_PATH}/courses`;
  return apiRequest<PaginatedCoursesDto>(path);
}

export function fetchCourseDetail(slug: string): Promise<CourseDetailDto> {
  return apiRequest<CourseDetailDto>(
    `${CATALOG_BASE_PATH}/courses/${encodeURIComponent(slug)}`,
  );
}

/**
 * The categories endpoint wraps the array in `{ categories }`; unwrap it here
 * so callers receive the list directly.
 */
export async function fetchCategories(): Promise<CategoryDto[]> {
  const payload = await apiRequest<{ categories: CategoryDto[] }>(
    `${CATALOG_BASE_PATH}/catalog/categories`,
  );
  return payload.categories;
}
