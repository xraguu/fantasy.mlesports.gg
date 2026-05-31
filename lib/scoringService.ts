import { prisma } from "./prisma";

interface ScoringRules {
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  sprocketRating: number;
  gameWin: number;
  gameLoss: number;
}

const DEFAULT_SCORING_RULES: ScoringRules = {
  goals: 2,
  shots: 0.1,
  saves: 1,
  assists: 1.5,
  demosInflicted: 0.5,
  demosTaken: -0.5,
  sprocketRating: 0.1,
  gameWin: 10,
  gameLoss: 0,
};

export interface ScoreCalculationResult {
  slotsScored: number;
  matchupsUpdated: number;
  teamsWithNoStats: string[];
}

function calcFpts(stats: {
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  sprocketRating: number;
  wins: number;
}, rules: ScoringRules): number {
  return (
    stats.goals * rules.goals +
    stats.shots * rules.shots +
    stats.saves * rules.saves +
    stats.assists * rules.assists +
    stats.demosInflicted * rules.demosInflicted +
    stats.demosTaken * rules.demosTaken +
    stats.sprocketRating * rules.sprocketRating +
    stats.wins * rules.gameWin
  );
}

export async function calculateScoresForWeek(
  week: number,
  leagueId?: string
): Promise<ScoreCalculationResult> {
  // 1. Get scoring rules from most recent SeasonSettings
  const settings = await prisma.seasonSettings.findFirst({
    orderBy: { season: "desc" },
  });
  const rules: ScoringRules =
    (settings?.scoringRules as ScoringRules) ?? DEFAULT_SCORING_RULES;

  // 2. Get all TeamWeeklyStats for the week
  const weekStats = await prisma.teamWeeklyStats.findMany({ where: { week } });
  const statsMap = new Map(weekStats.map((s) => [s.teamId, s]));

  // 3. Get all RosterSlots for the week (optionally filtered by league)
  const slotWhere: Record<string, unknown> = { week };
  if (leagueId) {
    slotWhere.fantasyTeam = { fantasyLeagueId: leagueId };
  }

  const rosterSlots = await prisma.rosterSlot.findMany({
    where: slotWhere,
  });

  // 4. Calculate and write fantasy points per slot (ALL slots including bench)
  let slotsScored = 0;
  const teamsWithNoStats: string[] = [];

  for (const slot of rosterSlots) {
    const stats = statsMap.get(slot.mleTeamId);
    if (!stats) {
      teamsWithNoStats.push(slot.mleTeamId);
      continue;
    }

    const fpts = calcFpts(stats, rules);
    await prisma.rosterSlot.update({
      where: { id: slot.id },
      data: { fantasyPoints: Math.round(fpts * 10) / 10 },
    });
    slotsScored++;
  }

  // 5. Sum active (non-bench) slots per fantasy team and update Matchup scores
  const matchupWhere: Record<string, unknown> = { week };
  if (leagueId) {
    matchupWhere.fantasyLeagueId = leagueId;
  }

  const matchups = await prisma.matchup.findMany({ where: matchupWhere });
  let matchupsUpdated = 0;

  for (const matchup of matchups) {
    const [homeSlots, awaySlots] = await Promise.all([
      prisma.rosterSlot.findMany({
        where: {
          fantasyTeamId: matchup.homeTeamId,
          week,
          position: { not: "bench" },
        },
      }),
      prisma.rosterSlot.findMany({
        where: {
          fantasyTeamId: matchup.awayTeamId,
          week,
          position: { not: "bench" },
        },
      }),
    ]);

    const homeScore = homeSlots.reduce(
      (sum, s) => sum + (s.fantasyPoints ?? 0),
      0
    );
    const awayScore = awaySlots.reduce(
      (sum, s) => sum + (s.fantasyPoints ?? 0),
      0
    );

    await prisma.matchup.update({
      where: { id: matchup.id },
      data: {
        homeScore: Math.round(homeScore * 10) / 10,
        awayScore: Math.round(awayScore * 10) / 10,
      },
    });
    matchupsUpdated++;
  }

  return {
    slotsScored,
    matchupsUpdated,
    teamsWithNoStats: [...new Set(teamsWithNoStats)],
  };
}
