export interface WeekDateConfig {
  week: number;
  startDate: string;
  endDate: string;
}

/**
 * The actual date/time range to use when looking up real MLE matches for a
 * given week. Real match weekends regularly run past midnight of the
 * configured `endDate` into the early morning hours of the next calendar
 * day — a hard cutoff at `endDate` 23:59:59 was silently dropping those
 * matches (confirmed: ~74% of a real, audited data gap). The upper bound
 * extends to the START of the next configured week instead — there's
 * always a multi-day gap between weeks, so this can never accidentally
 * pull in the following week's matches. The last configured week has no
 * "next" week to bound it, so it gets a fixed 3-day cushion instead.
 *
 * Shared by every place that needs "which matches count as week N" — the
 * live Sprocket import, and every route that looks up real `Match` rows by
 * date range — so this fix (and any future one) can't drift between them.
 */
export function getWeekMatchRange(
  weekDates: WeekDateConfig[],
  week: number
): { start: Date; end: Date } | null {
  const sorted = [...weekDates].sort((a, b) => a.week - b.week);
  const config = sorted.find((w) => w.week === week);
  if (!config?.startDate || !config?.endDate) return null;

  const start = new Date(config.startDate);
  const nextConfig = sorted.find((w) => w.week === week + 1);
  const end = nextConfig?.startDate
    ? new Date(nextConfig.startDate)
    : (() => {
        const fallback = new Date(config.endDate);
        fallback.setDate(fallback.getDate() + 3);
        return fallback;
      })();

  return { start, end };
}
