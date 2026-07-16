import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";
import { getAvailableHistoricalSeasons } from "@/lib/teamHistoricalStats";

// GET /api/admin/settings - Get current season settings
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const season = searchParams.get("season");

    // Get the current or specified season settings
    let settings;
    if (season) {
      settings = await prisma.seasonSettings.findUnique({
        where: { season: parseInt(season) },
      });
    } else {
      // Get the most recent season settings
      settings = await prisma.seasonSettings.findFirst({
        orderBy: { season: "desc" },
      });
    }

    const availableHistoricalSeasons = await getAvailableHistoricalSeasons();

    // If no settings exist, return defaults
    if (!settings) {
      const latestLeague = await prisma.fantasyLeague.findFirst({
        orderBy: { season: "desc" },
        select: { season: true },
      });

      return NextResponse.json({
        settings: {
          season: latestLeague?.season ?? 1,
          currentWeek: 1,
          playoffStartWeek: 9,
          tradeCutoffWeek: 8,
          lineupLockTime: "03:00",
          weekDates: Array.from({ length: 10 }, (_, i) => ({
            week: i + 1,
            startDate: "",
            endDate: "",
          })),
          scoringRules: {
            goals: 2,
            shots: 0.1,
            saves: 1,
            assists: 1.5,
            demosInflicted: 0.5,
            demosTaken: -0.5,
            sprocketRatingRanges: [
              { min: 0, max: 30, points: 0 },
              { min: 31, max: 50, points: 5 },
              { min: 51, max: 70, points: 10 },
              { min: 71, max: 90, points: 15 },
              { min: 91, max: 100, points: 20 },
            ],
            gameWin: 10,
            gameLoss: 0,
          },
          waiverSchedule: [
            { day: "Wednesday", time: "03:00" },
            { day: "Sunday", time: "03:00" },
          ],
          draftStatsSeason: null,
        },
        availableHistoricalSeasons,
      });
    }

    return NextResponse.json({ settings, availableHistoricalSeasons });
  } catch (error) {
    console.error("Error fetching season settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch season settings" },
      { status: 500 }
    );
  }
}

// POST /api/admin/settings - Create or update season settings
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { weekDates, scoringRules, waiverSchedule, draftStatsSeason } = body;

    // Validate required fields
    if (!weekDates || !scoringRules) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate week dates array
    if (!Array.isArray(weekDates) || weekDates.length !== 10) {
      return NextResponse.json(
        { error: "Week dates must be an array of 10 weeks" },
        { status: 400 }
      );
    }

    // Season is no longer admin-entered — it's derived from the most
    // recently created league, since a season only really exists once a
    // league for it has been created.
    const latestLeague = await prisma.fantasyLeague.findFirst({
      orderBy: { season: "desc" },
      select: { season: true },
    });
    if (!latestLeague) {
      return NextResponse.json(
        { error: "Create a league first — settings apply to the season of your most recent league" },
        { status: 400 }
      );
    }
    const season = latestLeague.season;

    // currentWeek/tradeCutoffWeek/playoffStartWeek/lineupLockTime columns are
    // unused elsewhere (currentWeek is tracked per-league on FantasyLeague;
    // playoff start week and lineup lock time are now fixed rules computed
    // from league size / week dates, not admin-configurable; trade cutoff is
    // computed from weekDates via lib/tradeCutoff.ts) — kept populated with
    // harmless placeholder values so the non-nullable columns stay satisfied.
    const settings = await prisma.seasonSettings.upsert({
      where: { season },
      update: {
        weekDates,
        scoringRules,
        waiverSchedule: waiverSchedule || [],
        draftStatsSeason: draftStatsSeason || null,
      },
      create: {
        season,
        currentWeek: 1,
        playoffStartWeek: 9,
        tradeCutoffWeek: 8,
        lineupLockTime: "03:00",
        weekDates,
        scoringRules,
        waiverSchedule: waiverSchedule || [],
        draftStatsSeason: draftStatsSeason || null,
      },
    });

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "settings.save",
      description: `Updated season settings for season ${settings.season}`,
    });

    return NextResponse.json({ settings, success: true });
  } catch (error) {
    console.error("Error saving season settings:", error);
    return NextResponse.json(
      { error: "Failed to save season settings" },
      { status: 500 }
    );
  }
}
