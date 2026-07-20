import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { etDateTime } from "@/lib/timezone";

// GET /api/leagues/[leagueId] - Get league details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;

    // Fetch league with all relevant details
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: {
        fantasyTeams: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: {
            draftPosition: "asc",
          },
        },
        _count: {
          select: {
            fantasyTeams: true,
            matchups: true,
            trades: true,
            waivers: true,
          },
        },
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Check if user is a member of the league
    const isMember = league.fantasyTeams.some(
      (team) => team.ownerUserId === session.user.id
    );
    const isAdmin = session.user.role === "admin";

    if (!isMember && !isAdmin) {
      return NextResponse.json(
        { error: "You are not a member of this league" },
        { status: 403 }
      );
    }

    // Whether the real season calendar has actually reached week 1's start
    // date — distinct from draftStatus, since the draft can finish well
    // before the season itself begins. Defaults to false (not started) if
    // there's no week-dates configuration to check against yet.
    const settings = await prisma.seasonSettings.findFirst({
      where: { season: league.season },
      select: { weekDates: true },
    });
    const weekDates = settings?.weekDates as Array<{ week: number; startDate: string }> | undefined;
    const week1Start = weekDates?.find((w) => w.week === 1)?.startDate;
    const seasonStarted = !!week1Start && new Date() >= etDateTime(week1Start, 0, 0);

    return NextResponse.json({ league: { ...league, seasonStarted } });
  } catch (error) {
    console.error("Error fetching league:", error);
    return NextResponse.json(
      { error: "Failed to fetch league" },
      { status: 500 }
    );
  }
}

// PATCH /api/leagues/[leagueId] - Update league settings (admin only)
export async function PATCH(
  request: NextRequest,
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
      select: { id: true },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Only an admin can update league settings" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      name,
      maxTeams,
      currentWeek,
      playoffTeams,
      draftType,
      waiverSystem,
      faabBudget,
      rosterConfig,
    } = body;

    // Build update data object
    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (maxTeams !== undefined) updateData.maxTeams = maxTeams;
    if (currentWeek !== undefined) updateData.currentWeek = currentWeek;
    if (playoffTeams !== undefined) updateData.playoffTeams = playoffTeams;
    if (draftType !== undefined) {
      if (!["snake", "linear"].includes(draftType)) {
        return NextResponse.json(
          { error: "Draft type must be 'snake' or 'linear'" },
          { status: 400 }
        );
      }
      updateData.draftType = draftType;
    }
    if (waiverSystem !== undefined) {
      if (!["faab", "rolling", "fixed"].includes(waiverSystem)) {
        return NextResponse.json(
          { error: "Invalid waiver system" },
          { status: 400 }
        );
      }
      updateData.waiverSystem = waiverSystem;
    }
    if (faabBudget !== undefined) updateData.faabBudget = faabBudget;
    if (rosterConfig !== undefined) updateData.rosterConfig = rosterConfig;

    // Update the league
    const updatedLeague = await prisma.fantasyLeague.update({
      where: { id: leagueId },
      data: updateData,
    });

    return NextResponse.json({ league: updatedLeague });
  } catch (error) {
    console.error("Error updating league:", error);
    return NextResponse.json(
      { error: "Failed to update league" },
      { status: 500 }
    );
  }
}
