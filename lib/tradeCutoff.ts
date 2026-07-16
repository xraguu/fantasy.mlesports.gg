import { prisma } from "@/lib/prisma";
import { etDateTime } from "@/lib/timezone";

/**
 * Trade cutoff = 11:59pm ET the night before a league's first playoff week
 * starts. First playoff week depends on league size: week 8 for 12-manager
 * leagues, week 9 for 8/10-manager leagues.
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
    startDate: string;
    endDate: string;
  }>;
  const playoffWeekConfig = weekDates.find((w) => w.week === firstPlayoffWeek);
  if (!playoffWeekConfig?.startDate) return null;

  const startDate = new Date(`${playoffWeekConfig.startDate}T00:00:00Z`);
  const cutoffDay = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
  const cutoffDateStr = cutoffDay.toISOString().slice(0, 10);

  return etDateTime(cutoffDateStr, 23, 59);
}
