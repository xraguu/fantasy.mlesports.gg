import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// GET /api/admin/stats/manual - List all manual overrides
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const week = searchParams.get("week");
    const teamId = searchParams.get("teamId");

    const where: Prisma.ManualStatsOverrideWhereInput = {};
    if (week) where.week = parseInt(week);
    if (teamId) where.teamId = teamId;

    const overrides = await prisma.manualStatsOverride.findMany({
      where,
      orderBy: [{ week: "desc" }, { teamId: "asc" }],
    });

    return NextResponse.json({ overrides });
  } catch (error) {
    console.error("Error fetching manual stats overrides:", error);
    return NextResponse.json(
      { error: "Failed to fetch manual stats overrides" },
      { status: 500 }
    );
  }
}

// POST /api/admin/stats/manual - Create or update manual stats override
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin" || !session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      teamId,
      week,
      gamemode,
      goals,
      shots,
      saves,
      assists,
      demosInflicted,
      demosTaken,
      saveRate,
      gameRecord,
    } = body;

    // Validate required fields
    if (!teamId || !week || !gamemode) {
      return NextResponse.json(
        { error: "teamId, week, and gamemode ('2s' or '3s') are required" },
        { status: 400 }
      );
    }

    // Validate week is between 1-14
    if (week < 1 || week > 14) {
      return NextResponse.json(
        { error: "Week must be between 1 and 14" },
        { status: 400 }
      );
    }

    // Upsert the manual override (create or update if exists)
    const override = await prisma.manualStatsOverride.upsert({
      where: {
        teamId_week_gamemode: {
          teamId,
          week: parseInt(week),
          gamemode,
        },
      },
      update: {
        goals: parseInt(goals),
        shots: parseInt(shots),
        saves: parseInt(saves),
        assists: parseInt(assists),
        demosInflicted: parseInt(demosInflicted),
        demosTaken: parseInt(demosTaken),
        saveRate: parseFloat(saveRate),
        gameRecord,
        adminUserId: session.user.id,
      },
      create: {
        teamId,
        week: parseInt(week),
        gamemode,
        goals: parseInt(goals),
        shots: parseInt(shots),
        saves: parseInt(saves),
        assists: parseInt(assists),
        demosInflicted: parseInt(demosInflicted),
        demosTaken: parseInt(demosTaken),
        saveRate: parseFloat(saveRate),
        gameRecord,
        adminUserId: session.user.id,
      },
    });

    return NextResponse.json({ override });
  } catch (error) {
    console.error("Error saving manual stats override:", error);
    return NextResponse.json(
      { error: "Failed to save manual stats override" },
      { status: 500 }
    );
  }
}
