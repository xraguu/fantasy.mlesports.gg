import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { processExpiredTradeVetoWindows } from "@/lib/tradeExecution";
import { getCurrentSeason, getCurrentSeasonWeek } from "@/lib/currentWeek";
import { countOverdueWaiverClaims } from "@/lib/waiverProcessing";
import { etDateTime } from "@/lib/timezone";
import type { WeekDateConfig } from "@/lib/weekMatchRange";

type WeekStatus = "upcoming" | "matchesSoon" | "inProgress" | "complete";

/**
 * GET /api/admin/dashboard
 * The admin dashboard's four quick stats, all scoped to active (non-archived)
 * leagues: the real calendar week, two health checks that should always be
 * 0 (unscored matchups in finished weeks, overdue waiver claims — each means
 * a background job has stopped running), and league/draft counts.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await processExpiredTradeVetoWindows();

    const now = new Date();
    const currentSeason = await getCurrentSeason();
    const activeLeagues = await prisma.fantasyLeague.findMany({
      where: currentSeason !== null ? { season: { gte: currentSeason } } : {},
      select: { id: true, season: true, draftStatus: true },
    });

    const weekDatesBySeason = new Map<number, WeekDateConfig[]>();
    const weekDatesFor = async (season: number) => {
      if (!weekDatesBySeason.has(season)) {
        const settings = await prisma.seasonSettings.findFirst({ where: { season } });
        const weekDates = (settings?.weekDates as WeekDateConfig[] | undefined) ?? [];
        weekDatesBySeason.set(season, [...weekDates].sort((a, b) => a.week - b.week));
      }
      return weekDatesBySeason.get(season)!;
    };

    // Matchups in weeks that have fully ended but still have no score — the
    // 2-hour stats refresh scores a week as soon as its matches start, so by
    // the week's end every matchup should have one.
    let unscoredMatchups = 0;
    for (const season of new Set(activeLeagues.map((l) => l.season))) {
      const endedWeeks = (await weekDatesFor(season))
        .filter((wd) => wd.weekEnd && now >= etDateTime(wd.weekEnd, 23, 59))
        .map((wd) => wd.week);
      if (endedWeeks.length === 0) continue;
      unscoredMatchups += await prisma.matchup.count({
        where: {
          fantasyLeagueId: { in: activeLeagues.filter((l) => l.season === season).map((l) => l.id) },
          week: { in: endedWeeks },
          OR: [{ homeScore: null }, { awayScore: null }],
        },
      });
    }

    let currentWeek: {
      season: number;
      week: number;
      totalWeeks: number;
      status: WeekStatus;
      date: string | null;
    } | null = null;
    const current = await getCurrentSeasonWeek();
    if (current) {
      const weekDates = await weekDatesFor(current.season);
      const first = weekDates[0];
      const last = weekDates[weekDates.length - 1];
      const wd = weekDates.find((w) => w.week === current.week);
      let status: WeekStatus = "inProgress";
      let date: string | null = wd?.weekEnd ?? null;
      if (first?.weekStart && now < etDateTime(first.weekStart, 0, 0)) {
        status = "upcoming";
        date = first.weekStart;
      } else if (last?.weekEnd && now >= etDateTime(last.weekEnd, 23, 59)) {
        status = "complete";
        date = null;
      } else if (wd?.matchStart && now < etDateTime(wd.matchStart, 0, 0)) {
        status = "matchesSoon";
        date = wd.matchStart;
      }
      currentWeek = { season: current.season, week: current.week, totalWeeks: weekDates.length, status, date };
    }

    return NextResponse.json({
      currentWeek,
      unscoredMatchups,
      overdueWaiverClaims: await countOverdueWaiverClaims(activeLeagues.map((l) => l.id)),
      activeLeagues: {
        total: activeLeagues.length,
        drafted: activeLeagues.filter((l) => l.draftStatus === "completed").length,
      },
    });
  } catch (error) {
    console.error("Error fetching admin dashboard stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard stats" },
      { status: 500 }
    );
  }
}
