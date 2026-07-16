import { prisma } from "@/lib/prisma";
import { getFantasyStandings } from "@/lib/standings";

export interface ScheduleMatchup {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  isPlayoff: boolean;
}

export interface ResultInput {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

function winner(r: ResultInput): string {
  return r.homeScore >= r.awayScore ? r.homeTeamId : r.awayTeamId;
}

function loser(r: ResultInput): string {
  return r.homeScore >= r.awayScore ? r.awayTeamId : r.homeTeamId;
}

export function shuffleTeams(teamIds: string[]): string[] {
  const shuffled = [...teamIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Circle-method round robin. Pads with a "BYE" placeholder if the team
 * count is odd; alternates home/away by week parity to balance home-field
 * advantage.
 */
export function generateRoundRobinSchedule(
  teamIds: string[],
  numWeeks: number
): ScheduleMatchup[] {
  if (teamIds.length < 2) {
    throw new Error("Need at least 2 teams to generate a round robin schedule");
  }

  const teams = [...teamIds];
  if (teams.length % 2 !== 0) teams.push("BYE");

  const n = teams.length;
  const matchups: ScheduleMatchup[] = [];
  const rotation = teams.slice(1);

  for (let week = 0; week < numWeeks; week++) {
    const roundTeams = [teams[0], ...rotation];
    for (let i = 0; i < n / 2; i++) {
      const teamA = roundTeams[i];
      const teamB = roundTeams[n - 1 - i];
      if (teamA === "BYE" || teamB === "BYE") continue;

      const isEvenWeek = week % 2 === 0;
      matchups.push({
        week: week + 1,
        homeTeamId: isEvenWeek ? teamA : teamB,
        awayTeamId: isEvenWeek ? teamB : teamA,
        isPlayoff: false,
      });
    }
    rotation.unshift(rotation.pop()!);
  }

  return matchups;
}

/** Regular season length depends on league size: 12-team leagues play 7 weeks (playoffs weeks 8-10), 8/10-team leagues play 8 weeks (playoffs weeks 9-10). */
export function generateRegularSeasonSchedule(
  teamIds: string[],
  leagueSize: number
): ScheduleMatchup[] {
  return generateRoundRobinSchedule(teamIds, leagueSize === 12 ? 7 : 8);
}

// ---------------------------------------------------------------------------
// Top-4 bracket (money bracket for 8/10-team leagues; also reused as-is for
// the 8-team league's 4-team consolation bracket, since that mirrors the
// money bracket's shape exactly).
// ---------------------------------------------------------------------------

/** seeds = [1st, 2nd, 3rd, 4th] (by whatever standings the caller passes in). Round 1: 1v4, 2v3. */
export function generateTop4BracketRound1(seeds: string[], week: number): ScheduleMatchup[] {
  if (seeds.length < 4) throw new Error("generateTop4BracketRound1 requires 4 seeds");
  return [
    { week, homeTeamId: seeds[0], awayTeamId: seeds[3], isPlayoff: true },
    { week, homeTeamId: seeds[1], awayTeamId: seeds[2], isPlayoff: true },
  ];
}

/** round1Results = [1v4 result, 2v3 result]. Winners play for 1st/2nd, losers play for 3rd/4th. */
export function generateTop4BracketRound2(
  round1Results: ResultInput[],
  week: number
): ScheduleMatchup[] {
  if (round1Results.length < 2) throw new Error("generateTop4BracketRound2 requires 2 results");
  const [r1, r2] = round1Results;
  return [
    { week, homeTeamId: winner(r1), awayTeamId: winner(r2), isPlayoff: true },
    { week, homeTeamId: loser(r1), awayTeamId: loser(r2), isPlayoff: true },
  ];
}

// ---------------------------------------------------------------------------
// Top-6 bracket with byes (money bracket for 12-team leagues).
// ---------------------------------------------------------------------------

/** seeds = [1st..6th]. 1st/2nd get byes. Round 1: 3v6, 4v5. */
export function generateTop6BracketRound1(seeds: string[], week: number): ScheduleMatchup[] {
  if (seeds.length < 6) throw new Error("generateTop6BracketRound1 requires 6 seeds");
  return [
    { week, homeTeamId: seeds[2], awayTeamId: seeds[5], isPlayoff: true },
    { week, homeTeamId: seeds[3], awayTeamId: seeds[4], isPlayoff: true },
  ];
}

/** seeds[0]=1st, seeds[1]=2nd. round1Results = [3v6 result, 4v5 result]. */
export function generateTop6BracketRound2(
  seeds: string[],
  round1Results: ResultInput[],
  week: number
): ScheduleMatchup[] {
  if (round1Results.length < 2) throw new Error("generateTop6BracketRound2 requires 2 results");
  const [r36, r45] = round1Results;
  return [
    { week, homeTeamId: seeds[0], awayTeamId: winner(r36), isPlayoff: true },
    { week, homeTeamId: seeds[1], awayTeamId: winner(r45), isPlayoff: true },
    { week, homeTeamId: loser(r36), awayTeamId: loser(r45), isPlayoff: true },
  ];
}

/** round2Results = [(1 vs W(3v6)) result, (2 vs W(4v5)) result] — the 5th/6th game isn't part of this round. */
export function generateTop6BracketRound3(
  round2Results: ResultInput[],
  week: number
): ScheduleMatchup[] {
  if (round2Results.length < 2) throw new Error("generateTop6BracketRound3 requires 2 results");
  const [r1, r2] = round2Results;
  return [
    { week, homeTeamId: winner(r1), awayTeamId: winner(r2), isPlayoff: true },
    { week, homeTeamId: loser(r1), awayTeamId: loser(r2), isPlayoff: true },
  ];
}

// ---------------------------------------------------------------------------
// 10-team consolation bracket (seeds 5-10), score-based waterfall.
// ---------------------------------------------------------------------------

/** seeds = [5th..10th]. Round 1: 5v10, 6v9, 7v8. */
export function generateConsolation10Round1(seeds: string[], week: number): ScheduleMatchup[] {
  if (seeds.length < 6) throw new Error("generateConsolation10Round1 requires 6 seeds");
  return [
    { week, homeTeamId: seeds[0], awayTeamId: seeds[5], isPlayoff: true },
    { week, homeTeamId: seeds[1], awayTeamId: seeds[4], isPlayoff: true },
    { week, homeTeamId: seeds[2], awayTeamId: seeds[3], isPlayoff: true },
  ];
}

/**
 * Round 2, decided by each team's ACTUAL round-1 score (not seed): the two
 * highest-scoring winners play each other (5th/6th), the two lowest-scoring
 * losers play each other (9th/10th), and the leftover winner/loser play each
 * other (7th/8th).
 */
export function generateConsolation10Round2(
  round1Results: ResultInput[],
  week: number
): ScheduleMatchup[] {
  if (round1Results.length < 3) throw new Error("generateConsolation10Round2 requires 3 results");

  const winners = round1Results
    .map((r) => ({ teamId: winner(r), score: Math.max(r.homeScore, r.awayScore) }))
    .sort((a, b) => b.score - a.score);
  const losers = round1Results
    .map((r) => ({ teamId: loser(r), score: Math.min(r.homeScore, r.awayScore) }))
    .sort((a, b) => a.score - b.score);

  const [bestWinner, midWinner, worstWinner] = winners;
  const [worstLoser, midLoser, bestLoser] = losers;

  return [
    { week, homeTeamId: bestWinner.teamId, awayTeamId: midWinner.teamId, isPlayoff: true },
    { week, homeTeamId: worstWinner.teamId, awayTeamId: bestLoser.teamId, isPlayoff: true },
    { week, homeTeamId: midLoser.teamId, awayTeamId: worstLoser.teamId, isPlayoff: true },
  ];
}

// ---------------------------------------------------------------------------
// 12-team consolation ladder (seeds 7-12), no byes. Winners move up a tier,
// losers move down a tier, each week re-paired against the adjacent tier.
// ---------------------------------------------------------------------------

/** seeds = [7th..12th]. Week 1: top=7v8, mid=9v10, bottom=11v12. */
export function generateLadderRound1(seeds: string[], week: number): ScheduleMatchup[] {
  if (seeds.length < 6) throw new Error("generateLadderRound1 requires 6 seeds");
  return [
    { week, homeTeamId: seeds[0], awayTeamId: seeds[1], isPlayoff: true },
    { week, homeTeamId: seeds[2], awayTeamId: seeds[3], isPlayoff: true },
    { week, homeTeamId: seeds[4], awayTeamId: seeds[5], isPlayoff: true },
  ];
}

/**
 * Same cascade rule for both the week8->9 and week9->10 transitions: the
 * mid-tier winner moves up to face the top-tier winner; the top-tier loser
 * drops down to face the bottom-tier winner; the mid-tier loser and
 * bottom-tier loser play each other at the bottom.
 */
export function generateLadderNextRound(
  prevRound: { top: ResultInput; mid: ResultInput; bottom: ResultInput },
  week: number
): ScheduleMatchup[] {
  const { top, mid, bottom } = prevRound;
  return [
    { week, homeTeamId: winner(top), awayTeamId: winner(mid), isPlayoff: true },
    { week, homeTeamId: loser(top), awayTeamId: winner(bottom), isPlayoff: true },
    { week, homeTeamId: loser(mid), awayTeamId: loser(bottom), isPlayoff: true },
  ];
}

// ---------------------------------------------------------------------------
// DB-aware orchestration
// ---------------------------------------------------------------------------

/**
 * Generates and saves the regular-season round-robin schedule for a league,
 * replacing any existing regular-season matchups. Called both from the admin
 * generate-schedule route and automatically once a league fills up.
 */
export async function generateAndSaveRegularSeason(leagueId: string): Promise<number> {
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    include: { fantasyTeams: { orderBy: { draftPosition: "asc" } } },
  });

  if (!league) throw new Error("League not found");
  if (league.fantasyTeams.length < 2) {
    throw new Error("Need at least 2 teams to generate a schedule");
  }

  const regularSeasonWeeks = league.maxTeams === 12 ? 7 : 8;
  const teamIds = shuffleTeams(league.fantasyTeams.map((t) => t.id));
  const matchups = generateRegularSeasonSchedule(teamIds, league.maxTeams);

  await prisma.matchup.deleteMany({
    where: { fantasyLeagueId: leagueId, week: { gte: 1, lte: regularSeasonWeeks } },
  });

  await prisma.$transaction(
    matchups.map((m) =>
      prisma.matchup.create({
        data: {
          fantasyLeagueId: leagueId,
          week: m.week,
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
          isPlayoff: m.isPlayoff,
        },
      })
    )
  );

  return matchups.length;
}

interface MatchupResultRow {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
}

function findResultByTeams(
  matchups: MatchupResultRow[],
  teamA: string,
  teamB: string
): ResultInput {
  const m = matchups.find(
    (mm) =>
      (mm.homeTeamId === teamA && mm.awayTeamId === teamB) ||
      (mm.homeTeamId === teamB && mm.awayTeamId === teamA)
  );
  if (!m) {
    throw new Error(
      "Could not find the previous round's matchup between these two teams — has it been generated yet?"
    );
  }
  if (m.homeScore == null || m.awayScore == null) {
    throw new Error(
      "The previous round's matchup hasn't been scored yet — import stats and calculate scores for that week first."
    );
  }
  return {
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
  };
}

async function getWeekMatchups(leagueId: string, week: number): Promise<MatchupResultRow[]> {
  return prisma.matchup.findMany({
    where: { fantasyLeagueId: leagueId, week },
    select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
}

/** 8 or 10-manager leagues: 2-round playoffs (money top-4 bracket + a same-size-or-larger consolation bracket). */
async function generateTop4LeaguePlayoffRound(args: {
  leagueId: string;
  week: number;
  playoffRound: number;
  moneySeeds: string[];
  consolationSeeds: string[];
  isTenTeam: boolean;
  firstPlayoffWeek: number;
}): Promise<ScheduleMatchup[]> {
  const { leagueId, week, playoffRound, moneySeeds, consolationSeeds, isTenTeam, firstPlayoffWeek } = args;

  if (playoffRound === 1) {
    const money = generateTop4BracketRound1(moneySeeds, week);
    const consolation = isTenTeam
      ? generateConsolation10Round1(consolationSeeds, week)
      : generateTop4BracketRound1(consolationSeeds, week);
    return [...money, ...consolation];
  }

  if (playoffRound === 2) {
    const round1Matchups = await getWeekMatchups(leagueId, firstPlayoffWeek);

    const moneyRound1Results: ResultInput[] = [
      findResultByTeams(round1Matchups, moneySeeds[0], moneySeeds[3]),
      findResultByTeams(round1Matchups, moneySeeds[1], moneySeeds[2]),
    ];
    const money = generateTop4BracketRound2(moneyRound1Results, week);

    let consolation: ScheduleMatchup[];
    if (isTenTeam) {
      const consolationRound1Results: ResultInput[] = [
        findResultByTeams(round1Matchups, consolationSeeds[0], consolationSeeds[5]),
        findResultByTeams(round1Matchups, consolationSeeds[1], consolationSeeds[4]),
        findResultByTeams(round1Matchups, consolationSeeds[2], consolationSeeds[3]),
      ];
      consolation = generateConsolation10Round2(consolationRound1Results, week);
    } else {
      const consolationRound1Results: ResultInput[] = [
        findResultByTeams(round1Matchups, consolationSeeds[0], consolationSeeds[3]),
        findResultByTeams(round1Matchups, consolationSeeds[1], consolationSeeds[2]),
      ];
      consolation = generateTop4BracketRound2(consolationRound1Results, week);
    }

    return [...money, ...consolation];
  }

  throw new Error(`Invalid playoff round ${playoffRound} for an 8/10-team league`);
}

/** 12-manager leagues: 3-round playoffs (money top-6 bracket w/ byes + a no-bye waterfall ladder). */
async function generateTwelveTeamPlayoffRound(args: {
  leagueId: string;
  week: number;
  playoffRound: number;
  moneySeeds: string[];
  consolationSeeds: string[];
  firstPlayoffWeek: number;
}): Promise<ScheduleMatchup[]> {
  const { leagueId, week, playoffRound, moneySeeds, consolationSeeds, firstPlayoffWeek } = args;

  if (playoffRound === 1) {
    const money = generateTop6BracketRound1(moneySeeds, week);
    const ladder = generateLadderRound1(consolationSeeds, week);
    return [...money, ...ladder];
  }

  if (playoffRound === 2) {
    const round1Matchups = await getWeekMatchups(leagueId, firstPlayoffWeek);

    const moneyRound1Results: ResultInput[] = [
      findResultByTeams(round1Matchups, moneySeeds[2], moneySeeds[5]),
      findResultByTeams(round1Matchups, moneySeeds[3], moneySeeds[4]),
    ];
    const money = generateTop6BracketRound2(moneySeeds, moneyRound1Results, week);

    const ladderRound1: { top: ResultInput; mid: ResultInput; bottom: ResultInput } = {
      top: findResultByTeams(round1Matchups, consolationSeeds[0], consolationSeeds[1]),
      mid: findResultByTeams(round1Matchups, consolationSeeds[2], consolationSeeds[3]),
      bottom: findResultByTeams(round1Matchups, consolationSeeds[4], consolationSeeds[5]),
    };
    const ladder = generateLadderNextRound(ladderRound1, week);

    return [...money, ...ladder];
  }

  if (playoffRound === 3) {
    const round1Matchups = await getWeekMatchups(leagueId, firstPlayoffWeek);
    const round2Matchups = await getWeekMatchups(leagueId, firstPlayoffWeek + 1);

    const moneyRound1Results: ResultInput[] = [
      findResultByTeams(round1Matchups, moneySeeds[2], moneySeeds[5]),
      findResultByTeams(round1Matchups, moneySeeds[3], moneySeeds[4]),
    ];
    const moneyRound2Expected = generateTop6BracketRound2(moneySeeds, moneyRound1Results, firstPlayoffWeek + 1);
    const moneyRound2Results: ResultInput[] = [
      findResultByTeams(round2Matchups, moneyRound2Expected[0].homeTeamId, moneyRound2Expected[0].awayTeamId),
      findResultByTeams(round2Matchups, moneyRound2Expected[1].homeTeamId, moneyRound2Expected[1].awayTeamId),
    ];
    const money = generateTop6BracketRound3(moneyRound2Results, week);

    const ladderRound1: { top: ResultInput; mid: ResultInput; bottom: ResultInput } = {
      top: findResultByTeams(round1Matchups, consolationSeeds[0], consolationSeeds[1]),
      mid: findResultByTeams(round1Matchups, consolationSeeds[2], consolationSeeds[3]),
      bottom: findResultByTeams(round1Matchups, consolationSeeds[4], consolationSeeds[5]),
    };
    const ladderRound2Expected = generateLadderNextRound(ladderRound1, firstPlayoffWeek + 1);
    const ladderRound2: { top: ResultInput; mid: ResultInput; bottom: ResultInput } = {
      top: findResultByTeams(round2Matchups, ladderRound2Expected[0].homeTeamId, ladderRound2Expected[0].awayTeamId),
      mid: findResultByTeams(round2Matchups, ladderRound2Expected[1].homeTeamId, ladderRound2Expected[1].awayTeamId),
      bottom: findResultByTeams(round2Matchups, ladderRound2Expected[2].homeTeamId, ladderRound2Expected[2].awayTeamId),
    };
    const ladder = generateLadderNextRound(ladderRound2, week);

    return [...money, ...ladder];
  }

  throw new Error(`Invalid playoff round ${playoffRound} for a 12-team league`);
}

/**
 * Generates and saves a single playoff round/week for a league, sized to its
 * manager count (8/10/12), reading back the previous round's real results
 * where needed. Called both from the admin generate-schedule route (manual
 * regen/override) and automatically after scores are calculated for a week
 * that completes a round (see calculateScoresForWeek in scoringService.ts).
 */
export async function generateAndSavePlayoffRound(
  leagueId: string,
  week: number
): Promise<{ matchupsCreated: number; leagueName: string }> {
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    include: { fantasyTeams: true },
  });

  if (!league) throw new Error("League not found");
  if (![8, 10, 12].includes(league.maxTeams)) {
    throw new Error("This league's maxTeams isn't 8, 10, or 12 — bracket generation isn't supported for this size");
  }
  if (league.fantasyTeams.length !== league.maxTeams) {
    throw new Error(`League must be full (${league.maxTeams} teams) to generate playoff rounds`);
  }

  const regularSeasonWeeks = league.maxTeams === 12 ? 7 : 8;
  const playoffRound = week - regularSeasonWeeks;
  if (playoffRound < 1) {
    throw new Error(`Week ${week} is a regular-season week, not a playoff week, for this league`);
  }

  const standings = await getFantasyStandings(leagueId, regularSeasonWeeks);
  if (standings.length !== league.maxTeams) {
    throw new Error("Could not compute full regular-season standings for this league");
  }

  const moneySeedCount = league.maxTeams === 12 ? 6 : 4;
  const moneySeeds = standings.slice(0, moneySeedCount).map((s) => s.teamId);
  const consolationSeeds = standings.slice(moneySeedCount).map((s) => s.teamId);

  const matchups =
    league.maxTeams === 8 || league.maxTeams === 10
      ? await generateTop4LeaguePlayoffRound({
          leagueId,
          week,
          playoffRound,
          moneySeeds,
          consolationSeeds,
          isTenTeam: league.maxTeams === 10,
          firstPlayoffWeek: regularSeasonWeeks + 1,
        })
      : await generateTwelveTeamPlayoffRound({
          leagueId,
          week,
          playoffRound,
          moneySeeds,
          consolationSeeds,
          firstPlayoffWeek: regularSeasonWeeks + 1,
        });

  await prisma.matchup.deleteMany({ where: { fantasyLeagueId: leagueId, week } });
  await prisma.$transaction(
    matchups.map((m) =>
      prisma.matchup.create({
        data: {
          fantasyLeagueId: leagueId,
          week: m.week,
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
          isPlayoff: m.isPlayoff,
        },
      })
    )
  );

  return { matchupsCreated: matchups.length, leagueName: league.name };
}

/**
 * Given a league and the week that was just scored, returns the next
 * playoff week to auto-generate, or null if there's nothing to generate
 * (mid regular-season, or playoffs are already fully generated at week 10).
 */
export function nextPlayoffWeekToGenerate(maxTeams: number, scoredWeek: number): number | null {
  if (![8, 10, 12].includes(maxTeams)) return null;
  const regularSeasonWeeks = maxTeams === 12 ? 7 : 8;
  const completesARound = scoredWeek === regularSeasonWeeks || (scoredWeek > regularSeasonWeeks && scoredWeek < 10);
  return completesARound ? scoredWeek + 1 : null;
}

export interface ProjectedBracket {
  maxTeams: number;
  moneyTeamIds: string[];
  consolationTeamIds: string[];
  moneyByeTeamIds: string[];
  moneyPairs: [string, string][];
  consolationPairs: [string, string][];
}

/**
 * The money/consolation bracket assignment is fixed the moment the regular
 * season ends (standings through the last regular-season week) — teams never
 * cross between the two brackets afterward, only get reshuffled within their
 * own. Frozen this way (rather than unrestricted "current" standings) so
 * this stays correct even after playoffs have started and later weeks have
 * been played, not just during the regular season.
 */
export async function getMoneyConsolationSeeds(
  leagueId: string
): Promise<{ maxTeams: number; moneySeeds: string[]; consolationSeeds: string[] }> {
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    select: { maxTeams: true },
  });
  if (!league) throw new Error("League not found");
  if (![8, 10, 12].includes(league.maxTeams)) {
    throw new Error("Bracket preview isn't supported for this league size");
  }

  const regularSeasonWeeks = league.maxTeams === 12 ? 7 : 8;
  const standings = await getFantasyStandings(leagueId, regularSeasonWeeks);
  const moneySeedCount = league.maxTeams === 12 ? 6 : 4;

  return {
    maxTeams: league.maxTeams,
    moneySeeds: standings.slice(0, moneySeedCount).map((s) => s.teamId),
    consolationSeeds: standings.slice(moneySeedCount).map((s) => s.teamId),
  };
}

/**
 * Preview of what round 1 of the playoff bracket would look like right now,
 * based on current (not-yet-final) standings — lets the Playoffs page show a
 * real bracket shape during the regular season, before playoffs are actually
 * generated. Reuses the exact same round-1 pairing functions the real
 * generator uses (with a placeholder week), so the preview can never drift
 * from what actually gets generated once the season ends with these
 * standings.
 */
export async function getProjectedFirstRound(leagueId: string): Promise<ProjectedBracket> {
  const { maxTeams, moneySeeds, consolationSeeds } = await getMoneyConsolationSeeds(leagueId);

  const toPairs = (matchups: ScheduleMatchup[]): [string, string][] =>
    matchups.map((m) => [m.homeTeamId, m.awayTeamId]);

  if (maxTeams === 12) {
    if (moneySeeds.length < 6 || consolationSeeds.length < 6) {
      throw new Error("Not enough managers yet to project a bracket");
    }
    return {
      maxTeams: 12,
      moneyTeamIds: moneySeeds,
      consolationTeamIds: consolationSeeds,
      moneyByeTeamIds: [moneySeeds[0], moneySeeds[1]],
      moneyPairs: toPairs(generateTop6BracketRound1(moneySeeds, 0)),
      consolationPairs: toPairs(generateLadderRound1(consolationSeeds, 0)),
    };
  }

  const isTenTeam = maxTeams === 10;
  const consolationNeeded = isTenTeam ? 6 : 4;
  if (moneySeeds.length < 4 || consolationSeeds.length < consolationNeeded) {
    throw new Error("Not enough managers yet to project a bracket");
  }

  return {
    maxTeams,
    moneyTeamIds: moneySeeds,
    consolationTeamIds: consolationSeeds,
    moneyByeTeamIds: [],
    moneyPairs: toPairs(generateTop4BracketRound1(moneySeeds, 0)),
    consolationPairs: isTenTeam
      ? toPairs(generateConsolation10Round1(consolationSeeds, 0))
      : toPairs(generateTop4BracketRound1(consolationSeeds, 0)),
  };
}
