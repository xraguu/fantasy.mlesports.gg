import { prisma } from "@/lib/prisma";
import { etDateTime } from "@/lib/timezone";

/**
 * Trade cutoff = 11:59pm ET the night before a league's first playoff
 * week's real matches begin (`matchStart`, not the week's calendar
 * `weekStart`, which can fall several days earlier) — the whole point of a
 * cutoff is competitive fairness right before real playoff games are
 * played, not before the calendar week happens to turn over. First playoff
 * week depends on league size: week 8 for 12-manager leagues, week 9 for
 * 8/10-manager leagues.
 */
export async function getTradeCutoff(leagueId: string): Promise<Date | null> {
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    select: { maxTeams: true, season: true },
  });
  if (!league) return null;

  const firstPlayoffWeek = league.maxTeams === 12 ? 8 : 9;

  const settings = await prisma.seasonSettings.findFirst({
    where: { season: league.season },
    orderBy: { season: "desc" },
  });
  if (!settings) return null;

  const weekDates = settings.weekDates as Array<{
    week: number;
    weekStart: string;
    matchStart: string;
    weekEnd: string;
  }>;
  const playoffWeekConfig = weekDates.find((w) => w.week === firstPlayoffWeek);
  if (!playoffWeekConfig?.matchStart) return null;

  const matchStart = new Date(`${playoffWeekConfig.matchStart}T00:00:00Z`);
  const cutoffDay = new Date(matchStart.getTime() - 24 * 60 * 60 * 1000);
  const cutoffDateStr = cutoffDay.toISOString().slice(0, 10);

  return etDateTime(cutoffDateStr, 23, 59);
}
