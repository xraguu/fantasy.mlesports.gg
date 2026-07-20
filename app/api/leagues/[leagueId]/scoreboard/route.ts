import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFantasyStandings, formatPlacement } from "@/lib/standings";
import { runAutoLockSweep } from "@/lib/autoLock";

/**
 * GET /api/leagues/[leagueId]/scoreboard?week=X
 * Get all matchups for a specific week with team rosters
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
    await runAutoLockSweep(leagueId);

    const { searchParams } = new URL(req.url);
    const weekParam = searchParams.get("week");
    const week = weekParam ? parseInt(weekParam) : 1;

    if (isNaN(week) || week < 1 || week > 10) {
      return NextResponse.json({ error: "Invalid week" }, { status: 400 });
    }

    // Get the league
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        name: true,
        currentWeek: true,
        rosterConfig: true,
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // For weeks 9-10 (playoffs), return empty matchups if they haven't been generated yet
    // Get all matchups for this week
    const matchups = await prisma.matchup.findMany({
      where: {
        fantasyLeagueId: leagueId,
        week: week,
      },
      include: {
        homeTeam: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
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
          },
        },
      },
      orderBy: {
        id: "asc",
      },
    });

    // If no matchups for this week (e.g., playoffs not started), return empty array
    if (matchups.length === 0) {
      return NextResponse.json({ matchups: [], week, league });
    }

    // Shared win/loss/points/rank source (honors double-win if enabled)
    const fantasyStandings = await getFantasyStandings(leagueId);
    const teamRecords = new Map(
      fantasyStandings.map((s) => [s.teamId, { wins: s.wins, losses: s.losses }])
    );

    const getPlacement = (teamId: string) => {
      const standing = fantasyStandings.find((s) => s.teamId === teamId);
      return standing ? formatPlacement(standing.rank) : "-";
    };

    // Get rosters for each team in the matchups
    const formattedMatchups = await Promise.all(
      matchups.map(async (matchup) => {
        const homeRecord = teamRecords.get(matchup.homeTeamId) || {
          wins: 0,
          losses: 0,
        };
        const awayRecord = teamRecords.get(matchup.awayTeamId) || {
          wins: 0,
          losses: 0,
        };

        // Get rosters for both teams
        const homeRoster = await prisma.rosterSlot.findMany({
          where: {
            fantasyTeamId: matchup.homeTeamId,
            week: week,
          },
          include: {
            mleTeam: {
              include: {
                league: true,
              },
            },
          },
          orderBy: [{ position: "asc" }, { slotIndex: "asc" }],
        });

        const awayRoster = await prisma.rosterSlot.findMany({
          where: {
            fantasyTeamId: matchup.awayTeamId,
            week: week,
          },
          include: {
            mleTeam: {
              include: {
                league: true,
              },
            },
          },
          orderBy: [{ position: "asc" }, { slotIndex: "asc" }],
        });

        // Get roster config to fill empty slots
        const rosterConfig = league.rosterConfig as {
          "2s": number;
          "3s": number;
          flx: number;
          be: number;
        };

        const fillRosterSlots = (
          roster: typeof homeRoster,
          teamId: string
        ) => {
          const slots: any[] = [];
          const positions = [
            ...Array(rosterConfig["2s"]).fill("2s"),
            ...Array(rosterConfig["3s"]).fill("3s"),
            ...Array(rosterConfig.flx).fill("flx"),
            ...Array(rosterConfig.be).fill("be"),
          ];

          positions.forEach((position, index) => {
            const existingSlot = roster.find(
              (s) =>
                s.position === position &&
                s.slotIndex ===
                  positions.slice(0, index).filter((p) => p === position).length
            );

            if (existingSlot) {
              slots.push({
                id: existingSlot.id,
                position: existingSlot.position,
                slotIndex: existingSlot.slotIndex,
                fantasyPoints: existingSlot.fantasyPoints || 0,
                // fantasyPoints is only ever null before that team's stats
                // for the week have been imported — distinct from "played
                // and scored exactly 0", which the `|| 0` above would
                // otherwise make indistinguishable from "hasn't played yet".
                played: existingSlot.fantasyPoints !== null,
                isLocked: existingSlot.isLocked,
                mleTeam: existingSlot.mleTeam
                  ? {
                      id: existingSlot.mleTeam.id,
                      name: existingSlot.mleTeam.name,
                      leagueId: existingSlot.mleTeam.leagueId,
                      slug: existingSlot.mleTeam.slug,
                      logoPath: existingSlot.mleTeam.logoPath,
                      primaryColor: existingSlot.mleTeam.primaryColor,
                      secondaryColor: existingSlot.mleTeam.secondaryColor,
                    }
                  : null,
              });
            } else {
              // Empty slot — no team assigned, so it can never "play."
              slots.push({
                id: `empty-${teamId}-${position}-${index}`,
                position: position,
                slotIndex: positions
                  .slice(0, index)
                  .filter((p) => p === position).length,
                fantasyPoints: 0,
                played: false,
                isLocked: false,
                mleTeam: null,
              });
            }
          });

          return slots;
        };

        const homeRosterFilled = fillRosterSlots(homeRoster, matchup.homeTeamId);
        const awayRosterFilled = fillRosterSlots(awayRoster, matchup.awayTeamId);

        return {
          id: matchup.id,
          week: matchup.week,
          team1: {
            id: matchup.homeTeamId,
            teamName: matchup.homeTeam.displayName,
            managerName: matchup.homeTeam.owner.displayName,
            managerId: matchup.homeTeam.owner.id,
            record: `${homeRecord.wins}-${homeRecord.losses}`,
            standing: getPlacement(matchup.homeTeamId),
            score: matchup.homeScore || 0,
            roster: homeRosterFilled,
          },
          team2: {
            id: matchup.awayTeamId,
            teamName: matchup.awayTeam.displayName,
            managerName: matchup.awayTeam.owner.displayName,
            managerId: matchup.awayTeam.owner.id,
            record: `${awayRecord.wins}-${awayRecord.losses}`,
            standing: getPlacement(matchup.awayTeamId),
            score: matchup.awayScore || 0,
            roster: awayRosterFilled,
          },
        };
      })
    );

    return NextResponse.json({
      matchups: formattedMatchups,
      week,
      league: {
        id: league.id,
        name: league.name,
        currentWeek: league.currentWeek,
      },
    });
  } catch (error) {
    console.error("Error fetching scoreboard:", error);
    return NextResponse.json(
      { error: "Failed to fetch scoreboard" },
      { status: 500 }
    );
  }
}
