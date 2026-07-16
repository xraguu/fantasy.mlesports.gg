import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getMoneyConsolationSeeds, getProjectedFirstRound } from "@/lib/scheduleGenerator";
import { getFantasyStandings } from "@/lib/standings";

interface TeamDTO {
  id: string;
  teamName: string;
  managerName: string;
  rank: number | null;
}

/**
 * GET /api/leagues/[leagueId]/playoffs
 * Everything the Playoffs page needs in one call: the money/consolation
 * team-id split (fixed once the regular season ends), every real playoff
 * round generated so far (split into money vs consolation matchups, plus
 * any round-1 byes), and — only while no real playoff round exists yet — a
 * projection of what round 1 would look like based on current standings.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: { maxTeams: true },
    });
    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }
    if (![8, 10, 12].includes(league.maxTeams)) {
      return NextResponse.json(
        { error: "Bracket view isn't supported for this league size" },
        { status: 400 }
      );
    }
    const regularSeasonWeeks = league.maxTeams === 12 ? 7 : 8;

    let moneyTeamIds: string[] = [];
    let consolationTeamIds: string[] = [];
    let seedError: string | null = null;
    try {
      const seeds = await getMoneyConsolationSeeds(leagueId);
      moneyTeamIds = seeds.moneySeeds;
      consolationTeamIds = seeds.consolationSeeds;
    } catch (e) {
      seedError = e instanceof Error ? e.message : "Not enough managers yet to project a bracket";
    }

    // Real playoff matchups generated so far, grouped by week/round.
    const playoffMatchups = await prisma.matchup.findMany({
      where: { fantasyLeagueId: leagueId, isPlayoff: true },
      include: {
        homeTeam: { include: { owner: { select: { displayName: true } } } },
        awayTeam: { include: { owner: { select: { displayName: true } } } },
      },
      orderBy: [{ week: "asc" }, { id: "asc" }],
    });

    const toDTO = (m: (typeof playoffMatchups)[number]) => ({
      id: m.id,
      week: m.week,
      homeTeam: {
        id: m.homeTeam.id,
        teamName: m.homeTeam.displayName,
        managerName: m.homeTeam.owner.displayName,
      },
      awayTeam: {
        id: m.awayTeam.id,
        teamName: m.awayTeam.displayName,
        managerName: m.awayTeam.owner.displayName,
      },
      homeScore: m.homeScore,
      awayScore: m.awayScore,
    });

    const weeksWithPlayoffs = [...new Set(playoffMatchups.map((m) => m.week))].sort((a, b) => a - b);

    // Team display info for round-1 byes (real or projected) — pulled from
    // the standings result set rather than a second query, since we already
    // have every team's id from the seed split.
    const standingsForRanks = seedError ? [] : await getFantasyStandings(leagueId, regularSeasonWeeks);
    const rankByTeamId = new Map(standingsForRanks.map((s) => [s.teamId, s.rank]));
    const teamRows = seedError
      ? []
      : await prisma.fantasyTeam.findMany({
          where: { id: { in: [...moneyTeamIds, ...consolationTeamIds] } },
          include: { owner: { select: { displayName: true } } },
        });
    const teamDTOById = new Map<string, TeamDTO>(
      teamRows.map((t) => [
        t.id,
        {
          id: t.id,
          teamName: t.displayName,
          managerName: t.owner.displayName,
          rank: rankByTeamId.get(t.id) ?? null,
        },
      ])
    );

    const realRounds = weeksWithPlayoffs.map((week) => {
      const roundNumber = week - regularSeasonWeeks;
      const weekMatchups = playoffMatchups.filter((m) => m.week === week);
      const moneyMatchups = weekMatchups.filter((m) => moneyTeamIds.includes(m.homeTeamId));
      const consolationMatchups = weekMatchups.filter((m) => consolationTeamIds.includes(m.homeTeamId));

      // Byes only ever occur in round 1 of a 12-team league's money bracket —
      // any money-seed team not appearing in this round's real matchups.
      const playingTeamIds = new Set(moneyMatchups.flatMap((m) => [m.homeTeamId, m.awayTeamId]));
      const moneyByes = moneyTeamIds
        .filter((id) => !playingTeamIds.has(id))
        .map((id) => teamDTOById.get(id))
        .filter((t): t is TeamDTO => !!t);

      return {
        week,
        roundNumber,
        moneyByes,
        moneyMatchups: moneyMatchups.map(toDTO),
        consolationMatchups: consolationMatchups.map(toDTO),
      };
    });

    // Only project round 1 while no real playoff round exists yet.
    let projectedRound1: {
      moneyByes: TeamDTO[];
      moneyPairs: [TeamDTO, TeamDTO][];
      consolationPairs: [TeamDTO, TeamDTO][];
    } | null = null;

    if (realRounds.length === 0) {
      try {
        const projected = await getProjectedFirstRound(leagueId);
        const toTeamDTO = (id: string): TeamDTO =>
          teamDTOById.get(id) ?? { id, teamName: "Unknown", managerName: "", rank: null };
        projectedRound1 = {
          moneyByes: projected.moneyByeTeamIds.map(toTeamDTO),
          moneyPairs: projected.moneyPairs.map(([a, b]) => [toTeamDTO(a), toTeamDTO(b)]),
          consolationPairs: projected.consolationPairs.map(([a, b]) => [toTeamDTO(a), toTeamDTO(b)]),
        };
      } catch (e) {
        seedError = e instanceof Error ? e.message : "Not enough managers yet to project a bracket";
      }
    }

    return NextResponse.json({
      maxTeams: league.maxTeams,
      regularSeasonWeeks,
      error: seedError,
      realRounds,
      projectedRound1,
    });
  } catch (error) {
    console.error("Error building playoffs bracket:", error);
    return NextResponse.json(
      { error: "Failed to load playoffs bracket" },
      { status: 500 }
    );
  }
}
