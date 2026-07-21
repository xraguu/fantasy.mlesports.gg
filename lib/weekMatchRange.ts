import { prisma } from "./prisma";

// A week is split into three moments rather than a single start/end pair:
// `weekStart` is the pure calendar boundary a new fantasy week begins on
// (roster carry-forward, waiver-clearance release, waiver-priority reset —
// none of which have anything to do with when matches are actually played);
// `matchStart` is when that week's real MLE matches (and this app's roster
// lock / trade blackout) actually begin, which can legitimately fall several
// days after `weekStart`; `weekEnd` is when both the matches and the
// fantasy week are over (the two happen to coincide, so one field covers
// both). Every function below that used to read `startDate`/`endDate`
// now reads whichever of these three actually matches what it needs.
export interface WeekDateConfig {
  week: number;
  weekStart: string;
  matchStart: string;
  weekEnd: string;
}

/**
 * The actual date/time range to use when looking up real MLE matches for a
 * given week. Real match weekends regularly run past midnight of the
 * configured `weekEnd` into the early morning hours of the next calendar
 * day — a hard cutoff at `weekEnd` 23:59:59 was silently dropping those
 * matches (confirmed: ~74% of a real, audited data gap). The upper bound
 * extends to the START of the next configured week's matches instead —
 * there's always a multi-day gap between one week's matches ending and the
 * next week's beginning, so this can never accidentally pull in the
 * following week's matches. The last configured week has no "next" week to
 * bound it, so it gets a fixed 3-day cushion past `weekEnd` instead.
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
  if (!config?.matchStart || !config?.weekEnd) return null;

  const start = new Date(config.matchStart);
  const nextConfig = sorted.find((w) => w.week === week + 1);
  const end = nextConfig?.matchStart
    ? new Date(nextConfig.matchStart)
    : (() => {
        const fallback = new Date(config.weekEnd);
        fallback.setDate(fallback.getDate() + 3);
        return fallback;
      })();

  return { start, end };
}

/**
 * Same idea as getWeekMatchRange, but with a fallback for testing/misconfigured
 * leagues whose configured week dates don't correspond to when the real
 * matches actually happened (e.g. a test league dated "this week" while the
 * imported match data is from a real past season): if the configured range
 * has zero real Match rows in it, fall back to clustering every locally-known
 * real match (via PlayerMatchStats — only ever populated for the one season
 * actively imported, see scripts/import-csv-data.ts) into groups separated by
 * >2-day gaps, and use the Nth chronological cluster as a stand-in for week N.
 * Mirrors the identical fallback already used for live stats import (see
 * lib/sprocketStats.ts) — verified there to cleanly reproduce a real season's
 * actual week boundaries. Never touches a correctly-configured league: the
 * fallback only ever runs when the configured range comes up completely empty.
 */
export async function getEffectiveWeekMatchRange(
  weekDates: WeekDateConfig[],
  week: number
): Promise<{ start: Date; end: Date } | null> {
  const configuredRange = getWeekMatchRange(weekDates, week);
  if (configuredRange) {
    const anyMatch = await prisma.match.count({
      where: { scheduledDate: { gte: configuredRange.start, lt: configuredRange.end } },
    });
    if (anyMatch > 0) return configuredRange;
  }

  const statRows = await prisma.playerMatchStats.findMany({
    distinct: ["matchId"],
    select: { matchId: true },
  });
  if (statRows.length === 0) return configuredRange;

  const matches = await prisma.match.findMany({
    where: { id: { in: statRows.map((r) => r.matchId) } },
    select: { scheduledDate: true },
    orderBy: { scheduledDate: "asc" },
  });
  if (matches.length === 0) return configuredRange;

  const clusters: Date[][] = [];
  let current: Date[] = [];
  for (const m of matches) {
    if (current.length > 0) {
      const gapDays =
        (m.scheduledDate.getTime() - current[current.length - 1].getTime()) /
        (1000 * 60 * 60 * 24);
      if (gapDays > 2) {
        clusters.push(current);
        current = [];
      }
    }
    current.push(m.scheduledDate);
  }
  if (current.length > 0) clusters.push(current);

  const cluster = clusters[week - 1];
  if (!cluster || cluster.length === 0) return configuredRange;

  const start = cluster[0];
  const end = new Date(cluster[cluster.length - 1].getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
