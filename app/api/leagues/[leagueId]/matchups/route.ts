import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/leagues/[leagueId]/matchups?week=X
 * Fetch matchups for a specific week
 *
 * Query params:
 * - week: number (optional, returns all matchups if not specified)
 *
 * Response:
 * {
 *   matchups: Array<{
 *     id: string,
 *     week: number,
 *     isPlayoff: boolean,
 *     homeTeam: {...},
 *     awayTeam: {...},
 *     homeScore: number | null,
 *     awayScore: number | null
 *   }>
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await params;
    const { searchParams } = new URL(request.url);
    const weekParam = searchParams.get("week");

    // Build query
    const where: Prisma.MatchupWhereInput = { fantasyLeagueId: leagueId };
    if (weekParam) {
      const week = parseInt(weekParam);
      if (!isNaN(week)) {
        where.week = week;
      }
    }

    // Fetch matchups with team data
    const matchups = await prisma.matchup.findMany({
      where,
      include: {
        homeTeam: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
              },
            },
            roster: {
              where: {
                week: weekParam ? parseInt(weekParam) : 1,
              },
              include: {
                mleTeam: true,
              },
            },
          },
        },
        awayTeam: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
              },
            },
            roster: {
              where: {
                week: weekParam ? parseInt(weekParam) : 1,
              },
              include: {
                mleTeam: true,
              },
            },
          },
        },
      },
      orderBy: [
        { week: "asc" },
        { id: "asc" },
      ],
    });

    // Format response
    const formattedMatchups = matchups.map((matchup) => ({
      id: matchup.id,
      week: matchup.week,
      isPlayoff: matchup.isPlayoff,
      homeTeam: {
        id: matchup.homeTeam.id,
        teamName: matchup.homeTeam.displayName,
        managerName: matchup.homeTeam.owner.displayName,
        managerId: matchup.homeTeam.owner.id,
        roster: matchup.homeTeam.roster.map((slot) => ({
          id: slot.id,
          position: slot.position,
          slotIndex: slot.slotIndex,
          fantasyPoints: slot.fantasyPoints || 0,
          isLocked: slot.isLocked,
          mleTeam: slot.mleTeam,
        })),
      },
      awayTeam: {
        id: matchup.awayTeam.id,
        teamName: matchup.awayTeam.displayName,
        managerName: matchup.awayTeam.owner.displayName,
        managerId: matchup.awayTeam.owner.id,
        roster: matchup.awayTeam.roster.map((slot) => ({
          id: slot.id,
          position: slot.position,
          slotIndex: slot.slotIndex,
          fantasyPoints: slot.fantasyPoints || 0,
          isLocked: slot.isLocked,
          mleTeam: slot.mleTeam,
        })),
      },
      homeScore: matchup.homeScore,
      awayScore: matchup.awayScore,
    }));

    return NextResponse.json({ matchups: formattedMatchups });
  } catch (error) {
    console.error("Error fetching matchups:", error);

    return NextResponse.json(
      {
        error: "Failed to fetch matchups",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
