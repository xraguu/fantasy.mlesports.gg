import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";
import { getAvailableHistoricalSeasons } from "@/lib/teamHistoricalStats";
import { getCurrentSeason } from "@/lib/currentWeek";

// GET /api/admin/settings - Get current season settings
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const seasonParam = searchParams.get("season");

    // Without ?season=, this loads the Current Season (Admin Settings'
    // explicit setting, falling back to the newest league's season) — the
    // same season POST below saves to, and the one scoring, waivers, and
    // week tracking all read from. It used to load (and save to) whichever
    // league had the highest season number, which silently wrote a new
    // season's dates over the current season's when that one wasn't the
    // newest yet.
    const season = seasonParam ? parseInt(seasonParam, 10) : await getCurrentSeason();
    const settings =
      season !== null && Number.isFinite(season)
        ? await prisma.seasonSettings.findUnique({ where: { season } })
        : null;

    const availableHistoricalSeasons = await getAvailableHistoricalSeasons();

    // Every distinct season a league actually exists for — the option list
    // for the "Current Season" dropdown (a different, admin-set concept from
    // draftStatsSeason's imported-stats seasons above).
    const leagueSeasonRows = await prisma.fantasyLeague.findMany({
      distinct: ["season"],
      select: { season: true },
      orderBy: { season: "desc" },
    });
    const availableLeagueSeasons = leagueSeasonRows.map((r) => r.season);

    const appSettings = await prisma.appSettings.findUnique({ where: { id: "global" } });
    const currentSeason = appSettings?.currentSeason ?? null;

    // If no settings exist for this season yet, return defaults (isNew lets
    // the page keep the scoring/waiver setup it already has instead)
    if (!settings) {
      return NextResponse.json({
        isNew: true,
        editingSeason: season,
        settings: {
          season: season ?? 1,
          currentWeek: 1,
          playoffStartWeek: 9,
          tradeCutoffWeek: 8,
          lineupLockTime: "03:00",
          weekDates: Array.from({ length: 10 }, (_, i) => ({
            week: i + 1,
            weekStart: "",
            matchStart: "",
            weekEnd: "",
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
        availableLeagueSeasons,
        currentSeason,
      });
    }

    return NextResponse.json({
      isNew: false,
      editingSeason: season,
      settings,
      availableHistoricalSeasons,
      availableLeagueSeasons,
      currentSeason,
    });
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
    const { weekDates, scoringRules, waiverSchedule, draftStatsSeason, currentSeason, editingSeason } = body;

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

    // currentSeason is a separate, global concept from everything else this
    // route saves (see AppSettings in schema.prisma) — it isn't tied to any
    // one season's row, so it's validated on its own (and only written
    // below, once everything else has passed validation).
    const changesCurrentSeason = currentSeason !== undefined && currentSeason !== null;
    if (changesCurrentSeason) {
      const seasonExists = await prisma.fantasyLeague.findFirst({
        where: { season: currentSeason },
        select: { id: true },
      });
      if (!seasonExists) {
        return NextResponse.json(
          { error: "That season doesn't have any leagues — pick one that does" },
          { status: 400 }
        );
      }
    }

    // Dates/scoring/waivers always save to the Current Season (including
    // one being picked in this same save) — the season everything else
    // reads them from.
    const season: number | null = changesCurrentSeason ? currentSeason : await getCurrentSeason();
    if (season === null) {
      return NextResponse.json(
        { error: "Create a league first — settings apply to the current season" },
        { status: 400 }
      );
    }
    // The page says which season's dates it's showing; refuse to write them
    // into a different one (e.g. "Most recent league" picked while a
    // Current Season is still set).
    if (editingSeason !== undefined && editingSeason !== season) {
      return NextResponse.json(
        { error: `These dates are for Season ${editingSeason}, but the current season is ${season} — reload the page and try again` },
        { status: 400 }
      );
    }

    if (changesCurrentSeason) {
      await prisma.appSettings.upsert({
        where: { id: "global" },
        update: { currentSeason },
        create: { id: "global", currentSeason },
      });
    }

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

    return NextResponse.json({ settings, currentSeason: currentSeason ?? null, success: true });
  } catch (error) {
    console.error("Error saving season settings:", error);
    return NextResponse.json(
      { error: "Failed to save season settings" },
      { status: 500 }
    );
  }
}
