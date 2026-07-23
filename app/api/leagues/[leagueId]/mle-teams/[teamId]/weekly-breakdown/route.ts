import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calcFpts, getActiveScoringRules } from "@/lib/scoringService";
import { getEffectiveWeekMatchRange } from "@/lib/weekMatchRange";

/**
 * GET /api/leagues/[leagueId]/mle-teams/[teamId]/weekly-breakdown
 * Returns this MLE team's real per-week esports stats and fantasy points,
 * sourced from TeamWeeklyStats (Sprocket imports) with opponent info resolved
 * via the Match schedule and SeasonSettings week date ranges.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const { leagueId, teamId } = await params;

    // Real MLE match data already exists for every week of the season
    // (it's already over), but this app still paces fantasy stats one week
    // at a time — cap this league's breakdown at its own current week so a
    // manager can't see real stats for weeks that haven't "happened" yet
    // fantasy-wise, even though the underlying data is already there.
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: { currentWeek: true, season: true },
    });

    const weeklyStats = await prisma.teamWeeklyStats.findMany({
      where: {
        teamId,
        ...(league ? { week: { lte: league.currentWeek } } : {}),
      },
      orderBy: { week: "asc" },
    });

    if (weeklyStats.length === 0) {
      return NextResponse.json({ weeks: [] });
    }

    // Scoped to THIS league's own season — an unscoped "whichever
    // SeasonSettings row has the highest season number" could silently pick
    // an unrelated league's settings (a different Sprocket season, or a
    // week-dates config that doesn't match this league's real schedule).
    const settings = await prisma.seasonSettings.findFirst({
      where: { season: league?.season },
    });
    const weekDates =
      (settings?.weekDates as Array<{
        week: number;
        weekStart: string;
        matchStart: string;
        weekEnd: string;
      }>) ?? [];
    const rules = await getActiveScoringRules();

    const weeks = await Promise.all(
      weeklyStats.map(async (stat) => {
        let opponentName: string | null = null;
        let opponentStats: { goals: number; shots: number } | null = null;

        const range = await getEffectiveWeekMatchRange(weekDates, stat.week);
        if (range) {
          const { start, end } = range;

          const match = await prisma.match.findFirst({
            where: {
              scheduledDate: { gte: start, lt: end },
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
