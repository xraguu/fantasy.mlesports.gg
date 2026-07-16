import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calcFpts, getActiveScoringRules } from "@/lib/scoringService";

/**
 * GET /api/leagues/[leagueId]/mle-teams/[teamId]/weekly-breakdown
 * Returns this MLE team's real per-week esports stats and fantasy points,
 * sourced from TeamWeeklyStats (Sprocket imports) with opponent info resolved
 * via the Match schedule and SeasonSettings week date ranges.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;

    const weeklyStats = await prisma.teamWeeklyStats.findMany({
      where: { teamId },
      orderBy: { week: "asc" },
    });

    if (weeklyStats.length === 0) {
      return NextResponse.json({ weeks: [] });
    }

    const settings = await prisma.seasonSettings.findFirst({
      orderBy: { season: "desc" },
    });
    const weekDates =
      (settings?.weekDates as Array<{
        week: number;
        startDate: string;
        endDate: string;
      }>) ?? [];
    const rules = await getActiveScoringRules();

    const weeks = await Promise.all(
      weeklyStats.map(async (stat) => {
        const weekConfig = weekDates.find((w) => w.week === stat.week);
        let opponentName: string | null = null;
        let opponentStats: { goals: number; shots: number } | null = null;

        if (weekConfig?.startDate && weekConfig?.endDate) {
          const start = new Date(weekConfig.startDate);
          const end = new Date(weekConfig.endDate);
          end.setHours(23, 59, 59, 999);

          const match = await prisma.match.findFirst({
            where: {
              scheduledDate: { gte: start, lte: end },
              OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
            },
            include: { homeTeam: true, awayTeam: true },
          });

          if (match) {
            const isHome = match.homeTeamId === teamId;
            const oppTeam = isHome ? match.awayTeam : match.homeTeam;
            opponentName = oppTeam.name;

            const oppWeekStats = await prisma.teamWeeklyStats.findUnique({
              where: {
                teamId_week_gamemode: { teamId: oppTeam.id, week: stat.week, gamemode: stat.gamemode },
              },
            });
            if (oppWeekStats) {
              opponentStats = { goals: oppWeekStats.goals, shots: oppWeekStats.shots };
            }
          }
        }

        const fpts = calcFpts(stat, rules);

        return {
          week: stat.week,
          gamemode: stat.gamemode,
          opponent: opponentName ?? "—",
          fpts: Math.round(fpts * 10) / 10,
          sprocketRating: stat.sprocketRating,
          goals: stat.goals,
          saves: stat.saves,
          shots: stat.shots,
          assists: stat.assists,
          goalsAgainst: opponentStats?.goals ?? null,
          shotsAgainst: opponentStats?.shots ?? null,
          demosInflicted: stat.demosInflicted,
          demosTaken: stat.demosTaken,
          matchResult: `${stat.wins}-${stat.losses}`,
        };
      })
    );

    return NextResponse.json({ weeks });
  } catch (error) {
    console.error("Error fetching weekly breakdown:", error);
    return NextResponse.json(
      { error: "Failed to fetch weekly breakdown" },
      { status: 500 }
    );
  }
}
