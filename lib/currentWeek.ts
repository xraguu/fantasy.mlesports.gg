import { prisma } from "@/lib/prisma";
import { etDateTime } from "@/lib/timezone";

interface WeekDateConfig {
  week: number;
  startDate: string;
  endDate: string;
}

/**
 * The latest configured week whose start date (midnight ET) has already
 * passed, given a season's weekDates — falls back to the first configured
 * week if none have started yet. Pure/no I/O so both callers below (global
 * "latest season" lookup and per-league lookup) share one definition of
 * "what week is it."
 */
export function computeCalendarWeek(weekDates: WeekDateConfig[]): number {
  const now = new Date();
  const sorted = [...weekDates].sort((a, b) => a.week - b.week);

  let currentWeek = sorted[0].week;
  for (const wd of sorted) {
    if (!wd.startDate) continue;
    if (now >= etDateTime(wd.startDate, 0, 0)) {
      currentWeek = wd.week;
    }
  }

  return currentWeek;
}

/**
 * The current season: whichever is most recent (a season only exists once a
 * league for it has been created). Returns null if no league exists yet.
 */
export async function getCurrentSeason(): Promise<number | null> {
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
