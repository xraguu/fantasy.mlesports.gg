import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSeasonWeek } from "@/lib/currentWeek";

type WeekRow = {
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  wins: number;
  losses: number;
};

/** Sums a player's PlayerWeeklyStats rows for one gamemode into the same shape the Team modal's roster table expects. */
function sumWeeks(rows: WeekRow[]) {
  if (rows.length === 0) return null;
  return {
    totalGoals: rows.reduce((sum, r) => sum + r.goals, 0),
    totalShots: rows.reduce((sum, r) => sum + r.shots, 0),
    totalSaves: rows.reduce((sum, r) => sum + r.saves, 0),
    totalAssists: rows.reduce((sum, r) => sum + r.assists, 0),
    totalDemosInflicted: rows.reduce((sum, r) => sum + r.demosInflicted, 0),
    // Real games played, not weeks played — a week can be a multi-game series.
    gamesPlayed: rows.reduce((sum, r) => sum + r.wins + r.losses, 0),
  };
}

/**
 * GET /api/teams/[teamId]/players
 * Get the playing roster for a specific MLE team, each with their CURRENT-season
 * stats (summed PlayerWeeklyStats through the real current week) — not
 * last season's PlayerHistoricalStats. Before the season actually starts
 * (or for a player with no weeks recorded yet), stats come back null, same
 * as always — the Team modal already renders that as empty/dashes.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;

    // Find the team first to ensure it exists
    const team = await prisma.mLETeam.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        leagueId: true,
      },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Fetch this team's players, leaving out non-playing ones: franchise
    // staff (FM, GM, AGM, Captain) whose players.csv slot is "NONE", which
    // the import stores as no roster slot. They still show in the staff
    // section (GET /api/teams/[teamId]/staff).
    const players = await prisma.mLEPlayer.findMany({
      where: {
        teamId: teamId,
        OR: [{ rosterSlot: { not: null } }, { staffPosition: null }],
      },
      select: {
        id: true,
        name: true,
        skillGroup: true,
        salary: true,
        memberId: true,
        staffPosition: true,
        rosterSlot: true,
      },
    });

    const current = await getCurrentSeasonWeek();

    const weeklyByPlayer = new Map<string, WeekRow[]>();
    if (current && players.length > 0) {
      const weeklyRows = await prisma.playerWeeklyStats.findMany({
        where: {
          playerId: { in: players.map((p) => p.id) },
          season: current.season,
          week: { lte: current.week },
        },
        select: { playerId: true, gamemode: true, goals: true, shots: true, saves: true, assists: true, demosInflicted: true, wins: true, losses: true },
      });
      for (const row of weeklyRows) {
        const key = `${row.playerId}:${row.gamemode}`;
        if (!weeklyByPlayer.has(key)) weeklyByPlayer.set(key, []);
        weeklyByPlayer.get(key)!.push(row);
      }
    }

    const playersWithStats = players.map((player) => ({
      ...player,
      doublesStats: sumWeeks(weeklyByPlayer.get(`${player.id}:2s`) ?? []),
      standardStats: sumWeeks(weeklyByPlayer.get(`${player.id}:3s`) ?? []),
    }));

    return NextResponse.json({
      team: {
        id: team.id,
        name: team.name,
        leagueId: team.leagueId,
      },
      players: playersWithStats,
      currentSeasonWeek: current,
    });
  } catch (error) {
    console.error("Error fetching team players:", error);
    return NextResponse.json(
      { error: "Failed to fetch team players" },
      { status: 500 }
    );
  }
}
