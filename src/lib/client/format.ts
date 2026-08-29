/**
 * Display formatting helpers shared by public and owner surfaces.
 * All money arrives as integer minor units plus an explicit currency,
 * so formatting happens at the edge (browser) and never in the API.
 */

export function formatPrice(priceMinor: number, currency: string): string {
  if (priceMinor === 0) return "Free";
  const major = priceMinor / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: major % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    // Unknown currency codes fall back to a symbol-less amount.
    return `${major.toFixed(2)} ${currency}`;
  }
}

/** 185 -> "3h 5m"; 45 -> "45m"; 0 -> "—". */
export function formatDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return "—";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** "12:30" clock string -> "12m 30s" style readable duration for lessons. */
export function formatLessonDuration(durationSeconds: number): string {
  if (durationSeconds <= 0) return "—";
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/** BEGINNER -> "Beginner" (title-cased enum value). */
export function formatLevel(level: string): string {
  return level.charAt(0) + level.slice(1).toLowerCase();
}

/** Compact enrollment counts: 3421 -> "3,421". */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
