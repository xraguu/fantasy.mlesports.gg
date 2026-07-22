import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/prisma";
import { SPROCKET_BASE_URL, fetchCsvText } from "@/lib/sprocketStats";
import { getEffectiveWeekMatchRange } from "@/lib/weekMatchRange";

interface RoundRow {
  match_id: string;
  round_id: string;
  Home: string;
  "Home Goals": string;
  Away: string;
  "Away Goals": string;
}

interface PlayerStatRow {
  member_id: string;
  team_name: string;
  match_id: string;
  round_id: string;
  gpi: string;
  goals: string;
  saves: string;
  shots: string;
  assists: string;
  demos_inflicted: string;
  demos_taken: string;
}

function aggregateTeamStats(rows: PlayerStatRow[]) {
  let goals = 0,
    shots = 0,
    saves = 0,
    assists = 0,
    demosInflicted = 0,
    demosTaken = 0,
    gpiSum = 0;

  for (const r of rows) {
    goals += parseFloat(r.goals) || 0;
    shots += parseFloat(r.shots) || 0;
    saves += parseFloat(r.saves) || 0;
    assists += parseFloat(r.assists) || 0;
    demosInflicted += parseFloat(r.demos_inflicted) || 0;
    demosTaken += parseFloat(r.demos_taken) || 0;
    gpiSum += parseFloat(r.gpi) || 0;
  }

  return {
    goals: Math.round(goals),
    shots: Math.round(shots),
    saves: Math.round(saves),
    assists: Math.round(assists),
    demosInflicted: Math.round(demosInflicted),
    demosTaken: Math.round(demosTaken),
    sprocketRating: rows.length > 0 ? Math.round((gpiSum / rows.length) * 100) / 100 : 0,
  };
}

/**
 * GET /api/leagues/[leagueId]/mle-teams/[teamId]/match-details?week=X
 * Returns the real MLE-vs-MLE match series for this team in the given week:
 * per-round scores + team stats, and the distinct players who appeared for
 * each side (handles substitutions). Round/player-level detail isn't stored
 * in our DB, so it's fetched live from Sprocket, filtered to the match found
 * via the already-imported local Match row.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const { leagueId, teamId } = await params;
    const { searchParams } = new URL(request.url);
    const weekParam = searchParams.get("week");

    if (!weekParam) {
      return NextResponse.json({ error: "week is required" }, { status: 400 });
    }
    const week = parseInt(weekParam);

    // Real MLE match data already exists for every week of the season
    // (it's already over), but this app still paces fantasy stats one week
    // at a time — reject a request for a week beyond this league's own
    // current week, same as weekly-breakdown (the only real caller of this
    // route, which no longer surfaces a row to click for a future week).
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: { currentWeek: true, season: true },
    });
    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }
    if (week > league.currentWeek) {
      return NextResponse.json(
        { error: `Week ${week} hasn't happened yet for this league.` },
        { status: 400 }
      );
    }

    // Scoped to THIS league's own season — an unscoped "whichever
    // SeasonSettings row has the highest season number" previously picked
    // an arbitrary, possibly unrelated row (confirmed live: a different
    // league's settings, configured for a completely different Sprocket
    // season, made every match in this league look like it had no
    // round-by-round data, since the wrong season's rounds_sXX.csv was
    // being fetched every time).
    const settings = await prisma.seasonSettings.findFirst({
      where: { season: league.season },
    });
    if (!settings) {
      return NextResponse.json(
        { error: "No season settings configured" },
        { status: 404 }
      );
    }

    const weekDates = settings.weekDates as Array<{
      week: number;
      weekStart: string;
      matchStart: string;
      weekEnd: string;
    }>;
    const weekConfig = weekDates.find((w) => w.week === week);
    if (!weekConfig?.matchStart || !weekConfig?.weekEnd) {
      return NextResponse.json(
        { error: `No match date range configured for week ${week}` },
        { status: 404 }
      );
    }

    const { start, end } = (await getEffectiveWeekMatchRange(weekDates, week))!;

    const match = await prisma.match.findFirst({
      where: {
        scheduledDate: { gte: start, lt: end },
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      include: { homeTeam: true, awayTeam: true },
    });

    if (!match) {
      return NextResponse.json({
        match: null,
        message: "No match found for this team in the specified week",
      });
    }

    // The fantasy season number IS the real MLE season number by policy
    // (kept in sync via Admin Settings' "Current Season") — Sprocket's files
    // are named by that same number (e.g. "s19"), so no separate lookup or
    // translation is needed here.
    const sprocketSeason = league.season;

    const [roundsCsv, playerStatsCsv] = await Promise.all([
      fetchCsvText(`${SPROCKET_BASE_URL}/rounds_s${sprocketSeason}.csv`),
      fetchCsvText(`${SPROCKET_BASE_URL}/player_stats_s${sprocketSeason}.csv`),
    ]);

    const allRounds = parse(roundsCsv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as RoundRow[];
    const matchRounds = allRounds
      .filter((r) => r.match_id === match.id)
      .sort((a, b) => parseInt(a.round_id) - parseInt(b.round_id));

    const allPlayerStats = parse(playerStatsCsv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as PlayerStatRow[];
    const matchPlayerStats = allPlayerStats.filter((p) => p.match_id === match.id);

    // Distinct players per team across the whole series (handles substitutions)
    const homePlayerIds = new Set<string>();
    const awayPlayerIds = new Set<string>();
    for (const p of matchPlayerStats) {
      if (p.team_name === match.homeTeam.name) homePlayerIds.add(p.member_id);
      else if (p.team_name === match.awayTeam.name) awayPlayerIds.add(p.member_id);
    }

    const players = await prisma.mLEPlayer.findMany({
      where: { id: { in: [...homePlayerIds, ...awayPlayerIds] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(players.map((p) => [p.id, p.name]));

    const homePlayers = [...homePlayerIds].map((id) => nameById.get(id) ?? id);
    const awayPlayers = [...awayPlayerIds].map((id) => nameById.get(id) ?? id);

    const rounds = matchRounds.map((round, index) => {
      const roundStats = matchPlayerStats.filter((p) => p.round_id === round.round_id);
      const homeStats = aggregateTeamStats(
        roundStats.filter((p) => p.team_name === match.homeTeam.name)
      );
      const awayStats = aggregateTeamStats(
        roundStats.filter((p) => p.team_name === match.awayTeam.name)
      );

      const isHomeFirst = round.Home === match.homeTeam.name;
      const homeScore = parseInt(isHomeFirst ? round["Home Goals"] : round["Away Goals"]) || 0;
      const awayScore = parseInt(isHomeFirst ? round["Away Goals"] : round["Home Goals"]) || 0;

      return {
        roundNumber: index + 1,
        homeScore,
        awayScore,
        homeStats,
        awayStats,
      };
    });

    return NextResponse.json({
      week,
      homeTeam: {
        id: match.homeTeam.id,
        name: match.homeTeam.name,
        leagueId: match.homeTeam.leagueId,
        logoPath: match.homeTeam.logoPath,
        primaryColor: match.homeTeam.primaryColor,
        secondaryColor: match.homeTeam.secondaryColor,
      },
      awayTeam: {
        id: match.awayTeam.id,
        name: match.awayTeam.name,
        leagueId: match.awayTeam.leagueId,
        logoPath: match.awayTeam.logoPath,
        primaryColor: match.awayTeam.primaryColor,
        secondaryColor: match.awayTeam.secondaryColor,
      },
      homePlayers,
      awayPlayers,
      rounds,
    });
  } catch (error) {
    console.error("Error fetching match details:", error);
    return NextResponse.json(
      { error: "Failed to fetch match details" },
      { status: 500 }
    );
  }
}
