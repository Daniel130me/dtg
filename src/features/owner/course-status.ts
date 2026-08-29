import type { CourseStatusValue } from "@/contracts/owner-courses";

// Shared presentation mapping for course status badges. The published/draft
// styles come from the original prototype design; archived extends the set.
export const COURSE_STATUS_LABELS: Record<CourseStatusValue, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export const COURSE_STATUS_BADGE_CLASS: Record<CourseStatusValue, string> = {
  DRAFT: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0",
  PUBLISHED: "bg-[#1d4ed8]/10 text-[#1d4ed8] dark:text-[#60a5fa] border-0",
  ARCHIVED: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-0",
};
