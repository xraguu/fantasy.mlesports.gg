import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateFantasyLeagueId } from "@/lib/id-generator";
import { logAdminActivity } from "@/lib/adminActivity";
import { getCurrentSeason } from "@/lib/currentWeek";

// GET /api/admin/leagues - List all fantasy leagues (admin only)
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const leagues = await prisma.fantasyLeague.findMany({
      include: {
        fantasyTeams: {
          include: {
            owner: {
              select: {
                displayName: true,
                discordId: true,
              },
            },
          },
        },
        _count: {
          select: {
            fantasyTeams: true,
            draftPicks: true,
            matchups: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const currentSeason = await getCurrentSeason();

    return NextResponse.json({ leagues, currentSeason });
  } catch (error) {
    console.error("Error fetching leagues:", error);
    return NextResponse.json(
      { error: "Failed to fetch leagues" },
      { status: 500 }
    );
  }
}

// POST /api/admin/leagues - Create a new fantasy league (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin" || !session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      season,
      draftType = "snake",
      waiverSystem = "rolling",
      faabBudget,
      rosterConfig = {
        "2s": 2,
        "3s": 2,
        "flx": 1,
        "be": 3,
      },
      maxTeams = 12,
      playoffTeams = 4,
    } = body;

    // Validate required fields
    if (!name || !season) {
      return NextResponse.json(
        { error: "Name and season are required" },
        { status: 400 }
      );
    }

    // Validate draft type
    if (!["snake", "linear"].includes(draftType)) {
      return NextResponse.json(
        { error: "draftType must be 'snake' or 'linear'" },
        { status: 400 }
      );
    }

    // Validate waiver system
    if (!["faab", "rolling", "fixed"].includes(waiverSystem)) {
      return NextResponse.json(
        { error: "waiverSystem must be 'faab', 'rolling', or 'fixed'" },
        { status: 400 }
      );
    }

    // If FAAB, require budget
    if (waiverSystem === "faab" && !faabBudget) {
      return NextResponse.json(
        { error: "faabBudget is required for FAAB waiver system" },
        { status: 400 }
      );
    }

    // League size is restricted to 8, 10, or 12 managers
    const parsedMaxTeams = parseInt(maxTeams);
    if (![8, 10, 12].includes(parsedMaxTeams)) {
      return NextResponse.json(
        { error: "maxTeams must be 8, 10, or 12" },
        { status: 400 }
      );
    }

    // Generate custom league ID
    const leagueId = generateFantasyLeagueId(parseInt(season), name);

    // Create the league
    const league = await prisma.fantasyLeague.create({
      data: {
        id: leagueId,
        name,
        season: parseInt(season),
        maxTeams: parsedMaxTeams,
        playoffTeams: parseInt(playoffTeams),
        draftType,
        waiverSystem,
        faabBudget: faabBudget ? parseInt(faabBudget) : null,
        rosterConfig,
        createdByUserId: session.user.id,
      },
      include: {
        _count: {
          select: {
            fantasyTeams: true,
          },
        },
      },
    });

    await logAdminActivity({
      adminUserId: session.user.id,
      action: "league.create",
      description: `Created league "${league.name}" (season ${league.season}, ${league.maxTeams} teams)`,
      targetType: "FantasyLeague",
      targetId: league.id,
    });

    return NextResponse.json({ league, success: true }, { status: 201 });
  } catch (error) {
    console.error("Error creating league:", error);
    return NextResponse.json(
      { error: "Failed to create league" },
      { status: 500 }
    );
  }
}
