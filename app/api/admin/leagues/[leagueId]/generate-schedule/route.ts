import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  generateAndSaveRegularSeason,
  generateAndSavePlayoffRound,
} from "@/lib/scheduleGenerator";
import { logAdminActivity } from "@/lib/adminActivity";

/**
 * POST /api/admin/leagues/[leagueId]/generate-schedule
 * Generate (or regenerate) matchups for a specific week. Playoff rounds now
 * also generate automatically after scores are calculated for the previous
 * round (see calculateScoresForWeek in lib/scoringService.ts) — this route
 * is for the initial regular season kick-off and manual regen/override.
 *
 * Request body: { week: number }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;
    const body = await request.json();
    const week: number = body.week;

    if (!week || week < 1 || week > 10) {
      return NextResponse.json({ error: "week must be between 1 and 10" }, { status: 400 });
    }

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: { name: true, maxTeams: true },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    if (![8, 10, 12].includes(league.maxTeams)) {
      return NextResponse.json(
        { error: "This league's maxTeams isn't 8, 10, or 12 — bracket generation isn't supported for this size" },
        { status: 400 }
      );
    }

    const regularSeasonWeeks = league.maxTeams === 12 ? 7 : 8;

    if (week <= regularSeasonWeeks) {
      const matchupsCreated = await generateAndSaveRegularSeason(leagueId);
      await logAdminActivity({
        adminUserId: session.user.id!,
        action: "schedule.generate_regular",
        description: `Generated regular season schedule for league "${league.name}" (${matchupsCreated} matchups)`,
        targetType: "FantasyLeague",
        targetId: leagueId,
      });
      return NextResponse.json({
        success: true,
        matchupsCreated,
        message: `Generated ${matchupsCreated} regular season matchups (weeks 1-${regularSeasonWeeks})`,
      });
    }

    const { matchupsCreated, leagueName } = await generateAndSavePlayoffRound(leagueId, week);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "schedule.generate_playoff",
      description: `Generated week ${week} playoff round for league "${leagueName}" (${matchupsCreated} matchups)`,
      targetType: "FantasyLeague",
      targetId: leagueId,
    });

    return NextResponse.json({
      success: true,
      matchupsCreated,
      message: `Generated ${matchupsCreated} playoff matchups for week ${week}`,
    });
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
