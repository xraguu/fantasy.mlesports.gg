import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  generateRegularSeasonSchedule,
  shuffleTeams,
  generatePlayoffQuarterfinals,
} from "@/lib/scheduleGenerator";

/**
 * POST /api/admin/leagues/[leagueId]/generate-schedule
 * Generate matchup schedule for a fantasy league
 *
 * Request body:
 * - type: "regular" | "playoffs" (default: "regular")
 * - shuffle: boolean (shuffle team order before generating, default: true)
 *
 * Response:
 * {
 *   success: boolean,
 *   matchupsCreated: number,
 *   message: string
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    // Authentication check
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;
    const body = await request.json();
    const { type = "regular", shuffle = true } = body;

    // Fetch league with teams
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: {
        fantasyTeams: {
          orderBy: { draftPosition: "asc" },
        },
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    if (league.fantasyTeams.length < 2) {
      return NextResponse.json(
        { error: "Need at least 2 teams to generate a schedule" },
        { status: 400 }
      );
    }

    let matchupsCreated = 0;

    if (type === "regular") {
      // Generate regular season schedule (weeks 1-8)
      console.log(`Generating regular season schedule for league: ${league.name}`);

      // Get team IDs
      let teamIds = league.fantasyTeams.map((team: { id: string }) => team.id);

      // Optionally shuffle teams for randomness
      if (shuffle) {
        teamIds = shuffleTeams(teamIds);
        console.log("Shuffled team order for schedule variety");
      }

      // Generate matchups
      const matchups = generateRegularSeasonSchedule(teamIds);
      console.log(`Generated ${matchups.length} matchups for weeks 1-8`);

      // Delete existing regular season matchups (weeks 1-8)
      await prisma.matchup.deleteMany({
        where: {
          fantasyLeagueId: leagueId,
          week: {
            gte: 1,
            lte: 8,
          },
        },
      });

      // Create matchups in database
      await prisma.$transaction(
        matchups.map((matchup) =>
          prisma.matchup.create({
            data: {
              fantasyLeagueId: leagueId,
              week: matchup.week,
              homeTeamId: matchup.homeTeamId,
              awayTeamId: matchup.awayTeamId,
              isPlayoff: matchup.isPlayoff,
            },
          })
        )
      );

      matchupsCreated = matchups.length;

      return NextResponse.json({
        success: true,
        matchupsCreated,
        message: `Generated ${matchupsCreated} regular season matchups (weeks 1-8)`,
      });
    } else if (type === "playoffs") {
      // Generate playoff bracket (week 9)
      console.log(`Generating playoff bracket for league: ${league.name}`);

      // Get top 8 teams by standings
      // This requires calculating standings based on matchup results
      const teams = await prisma.fantasyTeam.findMany({
        where: { fantasyLeagueId: leagueId },
        include: {
          homeMatchups: {
            where: {
              week: {
                gte: 1,
                lte: 8,
              },
            },
          },
          awayMatchups: {
            where: {
              week: {
                gte: 1,
                lte: 8,
              },
            },
          },
        },
      });

      // Calculate wins for each team
      const standings = teams.map((team: { id: string; displayName: string; homeMatchups: { homeScore: number | null; awayScore: number | null }[]; awayMatchups: { homeScore: number | null; awayScore: number | null }[] }) => {
        let wins = 0;
        let losses = 0;
        let pointsFor = 0;
        let pointsAgainst = 0;

        // Count home matchups
        for (const matchup of team.homeMatchups) {
          if (matchup.homeScore !== null && matchup.awayScore !== null) {
            pointsFor += matchup.homeScore;
            pointsAgainst += matchup.awayScore;
            if (matchup.homeScore > matchup.awayScore) {
              wins++;
            } else {
              losses++;
            }
          }
        }

        // Count away matchups
        for (const matchup of team.awayMatchups) {
          if (matchup.homeScore !== null && matchup.awayScore !== null) {
            pointsFor += matchup.awayScore;
            pointsAgainst += matchup.homeScore;
            if (matchup.awayScore > matchup.homeScore) {
              wins++;
            } else {
              losses++;
            }
          }
        }

        return {
          id: team.id,
          displayName: team.displayName,
          wins,
          losses,
          pointsFor,
          pointsAgainst,
        };
      });

      // Sort by wins (descending), then by points for (descending)
      standings.sort((a: { wins: number; pointsFor: number }, b: { wins: number; pointsFor: number }) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.pointsFor - a.pointsFor;
      });

      // Get top 8 teams
      const top8TeamIds = standings.slice(0, 8).map((team: { id: string }) => team.id);

      if (top8TeamIds.length < 8) {
        return NextResponse.json(
          { error: "Need at least 8 teams to generate playoff bracket" },
          { status: 400 }
        );
      }

      // Generate playoff matchups for week 9
      const playoffMatchups = generatePlayoffQuarterfinals(top8TeamIds);
      console.log(`Generated ${playoffMatchups.length} playoff matchups for week 9`);

      // Delete existing playoff matchups (week 9)
      await prisma.matchup.deleteMany({
        where: {
          fantasyLeagueId: leagueId,
          week: 9,
        },
      });

      // Create playoff matchups in database
      await prisma.$transaction(
        playoffMatchups.map((matchup) =>
          prisma.matchup.create({
            data: {
              fantasyLeagueId: leagueId,
              week: matchup.week,
              homeTeamId: matchup.homeTeamId,
              awayTeamId: matchup.awayTeamId,
              isPlayoff: matchup.isPlayoff,
            },
          })
        )
      );

      matchupsCreated = playoffMatchups.length;

      return NextResponse.json({
        success: true,
        matchupsCreated,
        message: `Generated ${matchupsCreated} playoff matchups (week 9)`,
        standings: standings.slice(0, 8), // Return top 8 for reference
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid type. Must be "regular" or "playoffs"' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error generating schedule:", error);

    return NextResponse.json(
      {
        error: "Failed to generate schedule",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
