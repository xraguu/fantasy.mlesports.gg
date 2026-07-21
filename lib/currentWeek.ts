import { prisma } from "@/lib/prisma";
import { etDateTime } from "@/lib/timezone";
import { WeekDateConfig } from "@/lib/weekMatchRange";

/**
 * The latest configured week whose calendar boundary (weekStart, midnight
 * ET) has already passed, given a season's weekDates — falls back to the
 * first configured week if none have started yet. Deliberately keyed off
 * `weekStart`, not `matchStart` — "what week is it" is a pure calendar
 * question, independent of whether that week's matches have actually
 * started yet. Pure/no I/O so both callers below (global "latest season"
 * lookup and per-league lookup) share one definition of "what week is it."
 */
export function computeCalendarWeek(weekDates: WeekDateConfig[]): number {
  const now = new Date();
  const sorted = [...weekDates].sort((a, b) => a.week - b.week);

  let currentWeek = sorted[0].week;
  for (const wd of sorted) {
    if (!wd.weekStart) continue;
    if (now >= etDateTime(wd.weekStart, 0, 0)) {
      currentWeek = wd.week;
    }
  }

  return currentWeek;
}

/**
 * The current season — an explicit admin setting (AppSettings.currentSeason,
 * editable from Admin > Settings), not derived. It used to be "whichever
 * league has the highest season number," which broke the moment ANY league
 * anywhere (e.g. a one-off test league) had a higher season than the
 * leagues actually in play that season, since it silently became "current"
 * for the whole platform. Falls back to the newest league's season if no
 * admin has set one yet (e.g. right after this setting was introduced), and
 * to null if there are no leagues at all.
 */
export async function getCurrentSeason(): Promise<number | null> {
  const appSettings = await prisma.appSettings.findUnique({ where: { id: "global" } });
  if (appSettings?.currentSeason != null) {
    return appSettings.currentSeason;
  }

  const latestLeague = await prisma.fantasyLeague.findFirst({
    orderBy: { season: "desc" },
    select: { season: true },
  });
  return latestLeague?.season ?? null;
}

/**
 * Determines "the current week" for automatic stats refresh: the season is
 * whichever is most recent (matches the same rule Settings uses — a season
 * only exists once a league for it has been created), and the week is
 * computed via computeCalendarWeek. Returns null if there's no season/week-
 * dates configuration to work from.
 */
export async function getCurrentSeasonWeek(): Promise<{ season: number; week: number } | null> {
  const season = await getCurrentSeason();
  if (season === null) return null;

  const week = await getCalendarWeekForSeason(season);
  if (week === null) return null;

  return { season, week };
}

/**
 * Same calendar-week computation as getCurrentSeasonWeek, but scoped to a
 * specific season rather than always "the latest one" — used to keep each
 * individual FantasyLeague.currentWeek in sync with its own season's
 * schedule (see lib/autoLock.ts), since multiple seasons' leagues can
 * technically coexist in the data.
 */
export async function getCalendarWeekForSeason(season: number): Promise<number | null> {
  const settings = await prisma.seasonSettings.findFirst({ where: { season } });
  const weekDates = settings?.weekDates as WeekDateConfig[] | undefined;
  if (!weekDates || weekDates.length === 0) return null;

  return computeCalendarWeek(weekDates);
}
