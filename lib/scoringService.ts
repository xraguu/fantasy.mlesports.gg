import { prisma } from "./prisma";
import { generateAndSavePlayoffRound, nextPlayoffWeekToGenerate } from "./scheduleGenerator";
import { logAdminActivity } from "./adminActivity";

export interface SprocketRatingRange {
  min: number;
  max: number;
  points: number;
}

export interface ScoringRules {
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  sprocketRatingRanges: SprocketRatingRange[];
  gameWin: number;
  gameLoss: number;
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  goals: 2,
  shots: 0.1,
  saves: 1,
  assists: 1.5,
  demosInflicted: 0.5,
  demosTaken: -0.5,
  sprocketRatingRanges: [
    { min: 0, max: 30, points: 0 },
    { min: 31, max: 50, points: 5 },
    { min: 51, max: 70, points: 10 },
    { min: 71, max: 90, points: 15 },
    { min: 91, max: 100, points: 20 },
  ],
  gameWin: 10,
  gameLoss: 0,
};

/** Points added for a team's Sprocket Rating falling in a configured range (not multiplied) — 0 if it falls outside every configured range. */
export function sprocketRatingBonus(sprocketRating: number, ranges: SprocketRatingRange[]): number {
  const match = ranges.find((r) => sprocketRating >= r.min && sprocketRating <= r.max);
  return match?.points ?? 0;
}

export interface ScoreCalculationResult {
  slotsScored: number;
  matchupsUpdated: number;
  teamsWithNoStats: string[];
}

export async function getActiveScoringRules(): Promise<ScoringRules> {
  const settings = await prisma.seasonSettings.findFirst({
    orderBy: { season: "desc" },
  });
  const stored = settings?.scoringRules as Partial<ScoringRules> | undefined;
  if (!stored) return DEFAULT_SCORING_RULES;

  // Merge over defaults rather than trusting the stored JSON blob's shape
  // outright — e.g. a row saved before sprocketRatingRanges existed.
  return {
    ...DEFAULT_SCORING_RULES,
    ...stored,
    sprocketRatingRanges:
      Array.isArray(stored.sprocketRatingRanges) && stored.sprocketRatingRanges.length > 0
        ? stored.sprocketRatingRanges
        : DEFAULT_SCORING_RULES.sprocketRatingRanges,
  };
}

export function calcFpts(stats: {
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
    sprocketRatingBonus(stats.sprocketRating, rules.sprocketRatingRanges) +
    stats.wins * rules.gameWin
  );
}

type WeeklyStatsRow = {
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  sprocketRating: number;
  wins: number;
};

/**
 * Resolves a roster slot's fantasy points for the week from its team's 2s/3s
 * stat rows, based on the slot's position: "2s"/"3s" slots use that mode's
 * stats only; "flx"/"be" (bench) slots are best-ball — whichever mode scored
 * higher that week. Returns null if neither mode has stats for the team.
 */
function resolveSlotFpts(
  position: string,
  modes: { "2s"?: WeeklyStatsRow; "3s"?: WeeklyStatsRow },
  rules: ScoringRules
): number | null {
  if (position === "2s") {
    return modes["2s"] ? calcFpts(modes["2s"], rules) : null;
  }
  if (position === "3s") {
    return modes["3s"] ? calcFpts(modes["3s"], rules) : null;
  }
  // flex / bench: best-ball across whichever modes are available
  const twoSFpts = modes["2s"] ? calcFpts(modes["2s"], rules) : null;
  const threeSFpts = modes["3s"] ? calcFpts(modes["3s"], rules) : null;
  if (twoSFpts === null && threeSFpts === null) return null;
  return Math.max(twoSFpts ?? -Infinity, threeSFpts ?? -Infinity);
}

export async function calculateScoresForWeek(
  week: number,
  leagueId?: string,
  triggeredByUserId?: string
): Promise<ScoreCalculationResult> {
  // 1. Get scoring rules from most recent SeasonSettings
  const rules = await getActiveScoringRules();

  // 2. Get all TeamWeeklyStats for the week, grouped by team + gamemode
  const weekStats = await prisma.teamWeeklyStats.findMany({ where: { week } });
  const statsMap = new Map<string, { "2s"?: WeeklyStatsRow; "3s"?: WeeklyStatsRow }>();
  for (const s of weekStats) {
    if (!statsMap.has(s.teamId)) statsMap.set(s.teamId, {});
    statsMap.get(s.teamId)![s.gamemode as "2s" | "3s"] = s;
  }

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
    const modes = statsMap.get(slot.mleTeamId);
    const fpts = modes ? resolveSlotFpts(slot.position, modes, rules) : null;
    if (fpts === null) {
      teamsWithNoStats.push(slot.mleTeamId);
      continue;
    }

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
          position: { not: "be" },
        },
      }),
      prisma.rosterSlot.findMany({
        where: {
          fantasyTeamId: matchup.awayTeamId,
          week,
          position: { not: "be" },
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

  // 6. Auto-generate the next playoff round for any league whose week just
  // completed a round boundary (last regular-season week, or a playoff
  // round that isn't the final one) — this is what makes playoff bracket
  // progression automatic instead of requiring a manual admin trigger.
  const leagueIds = [...new Set(matchups.map((m) => m.fantasyLeagueId))];
  for (const affectedLeagueId of leagueIds) {
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: affectedLeagueId },
      select: { maxTeams: true, name: true },
    });
    if (!league) continue;

    const nextWeek = nextPlayoffWeekToGenerate(league.maxTeams, week);
    if (nextWeek === null) continue;

    try {
      const { matchupsCreated } = await generateAndSavePlayoffRound(affectedLeagueId, nextWeek);
      if (triggeredByUserId) {
        await logAdminActivity({
          adminUserId: triggeredByUserId,
          action: "schedule.auto_generate_playoff",
          description: `Auto-generated week ${nextWeek} playoff round for league "${league.name}" after week ${week} was scored (${matchupsCreated} matchups)`,
          targetType: "FantasyLeague",
          targetId: affectedLeagueId,
        });
      }
    } catch (error) {
      // Not every league is full / eligible yet — don't fail score
      // calculation over a playoff round that isn't ready to generate.
      console.error(
        `Could not auto-generate week ${nextWeek} playoffs for league ${affectedLeagueId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return {
    slotsScored,
    matchupsUpdated,
    teamsWithNoStats: [...new Set(teamsWithNoStats)],
  };
}
