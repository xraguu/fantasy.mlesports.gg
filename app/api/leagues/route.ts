import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateFantasyLeagueId } from "@/lib/id-generator";
import { getCurrentSeason } from "@/lib/currentWeek";

// GET /api/leagues - List leagues user has access to
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only show the current season's leagues in "My Leagues" — past-season
    // leagues are still viewable via the admin League Archive page.
    const currentSeason = await getCurrentSeason();

    // Get all leagues where user has a fantasy team
    const leagues = await prisma.fantasyLeague.findMany({
      where: {
        fantasyTeams: {
          some: {
            ownerUserId: session.user.id,
          },
        },
        ...(currentSeason !== null ? { season: currentSeason } : {}),
      },
      include: {
        fantasyTeams: {
          where: {
            ownerUserId: session.user.id,
          },
          include: {
            _count: {
              select: {
                roster: true,
              },
            },
          },
        },
        _count: {
          select: {
            fantasyTeams: true,
            matchups: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({ leagues });
  } catch (error) {
    console.error("Error fetching leagues:", error);
    return NextResponse.json(
      { error: "Failed to fetch leagues" },
      { status: 500 }
    );
  }
}

// POST /api/leagues - Create a new fantasy league
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is suspended
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { status: true },
    });

    if (user?.status === "suspended") {
      return NextResponse.json(
        { error: "Suspended users cannot create leagues" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      name,
      season,
      maxTeams = 12,
      draftType = "snake",
      waiverSystem = "rolling",
      faabBudget,
      rosterConfig,
      playoffTeams = 4,
    } = body;

    // Validation
    if (!name || !season) {
      return NextResponse.json(
        { error: "League name and season are required" },
        { status: 400 }
      );
    }

    if (!["snake", "linear"].includes(draftType)) {
      return NextResponse.json(
        { error: "Draft type must be 'snake' or 'linear'" },
        { status: 400 }
      );
    }

    if (!["faab", "rolling", "fixed"].includes(waiverSystem)) {
      return NextResponse.json(
        { error: "Invalid waiver system" },
        { status: 400 }
      );
    }

    if (waiverSystem === "faab" && !faabBudget) {
      return NextResponse.json(
        { error: "FAAB budget is required for FAAB waiver system" },
        { status: 400 }
      );
    }

    // Default roster configuration
    const defaultRosterConfig = {
      "2s": 2,
      "3s": 2,
      "flx": 1,
      "be": 3,
    };

    // Create the league
    const leagueId = generateFantasyLeagueId(season, name);
    const league = await prisma.fantasyLeague.create({
      data: {
        id: leagueId,
        name,
        season,
        maxTeams,
        draftType,
        waiverSystem,
        faabBudget: waiverSystem === "faab" ? faabBudget : null,
        rosterConfig: rosterConfig || defaultRosterConfig,
        playoffTeams,
        createdByUserId: session.user.id,
        currentWeek: 1,
      },
    });

    return NextResponse.json({ league }, { status: 201 });
  } catch (error) {
    console.error("Error creating league:", error);
    return NextResponse.json(
      { error: "Failed to create league" },
      { status: 500 }
    );
  }
}
