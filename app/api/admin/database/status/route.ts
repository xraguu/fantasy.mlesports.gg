import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeason } from "@/lib/currentWeek";
import { etDateTime } from "@/lib/timezone";
import type { WeekDateConfig } from "@/lib/weekMatchRange";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/admin/database/status
 * Health of the site's data for the admin Database page, in four parts: the
 * current season's imported stats, the current season's league activity,
 * users, and the database itself. "Active" means the same thing it does
 * everywhere else in the admin panel: season >= the current season.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentSeason = await getCurrentSeason();
    // No current season yet means nothing counts as active (season -1 matches nothing)
    const season = currentSeason ?? -1;
    const activeLeague = { season: { gte: season } };
    const archivedLeague = { season: { lt: season } };

    const [appSettings, seasonSettings] = await Promise.all([
      prisma.appSettings.findUnique({ where: { id: "global" } }),
      prisma.seasonSettings.findUnique({ where: { season } }),
    ]);

    // ---- 1. Current season's imported stats ------------------------------
    const weekDates = (seasonSettings?.weekDates as WeekDateConfig[] | undefined) ?? [];
    const sortedWeeks = [...weekDates].filter((w) => w.weekStart && w.weekEnd).sort((a, b) => a.week - b.week);
    // The season's MLE matches are the ones scheduled between its first week's
    // start and its last week's end (the schedule has no season of its own)
    const seasonRange =
      sortedWeeks.length > 0
        ? {
            gte: etDateTime(sortedWeeks[0].weekStart, 0, 0),
            lte: etDateTime(sortedWeeks[sortedWeeks.length - 1].weekEnd, 23, 59),
          }
        : null;

    const [weeklyByWeek, scheduledMatches, playedMatches, historicalRows, players, playersOnTeams, staff, overrides] =
      await Promise.all([
        prisma.teamWeeklyStats.groupBy({ by: ["week"], where: { season }, _count: true, orderBy: { week: "asc" } }),
        seasonRange ? prisma.match.count({ where: { scheduledDate: seasonRange } }) : 0,
        seasonRange ? prisma.match.count({ where: { scheduledDate: seasonRange, completed: true } }) : 0,
        prisma.teamHistoricalStats.findMany({ distinct: ["season"], select: { season: true } }),
        prisma.mLEPlayer.count(),
        prisma.mLEPlayer.count({ where: { teamId: { not: null } } }),
        prisma.mLEPlayer.count({ where: { staffPosition: { not: null } } }),
        prisma.manualStatsOverride.count({ where: { season } }),
      ]);

    // "Season 18" / "Season 18 Playoffs" -> 18, regular seasons only
    const historicalSeasons = historicalRows
      .map((r) => r.season)
      .filter((s) => !s.includes("Playoffs"))
      .map((s) => parseInt(s.replace(/\D/g, ""), 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    // ---- 2. Current season's league activity ------------------------------
    const [leagues, teams, matchupsTotal, matchupsScored, transactions, tradesCompleted, tradesPending, waiversPending] =
      await Promise.all([
        prisma.fantasyLeague.findMany({ where: activeLeague, select: { draftStatus: true, maxTeams: true } }),
        prisma.fantasyTeam.count({ where: { league: activeLeague } }),
        prisma.matchup.count({ where: { league: activeLeague } }),
        prisma.matchup.count({ where: { league: activeLeague, homeScore: { not: null }, awayScore: { not: null } } }),
        prisma.transaction.count({ where: { league: activeLeague } }),
        // Went through — status "approved" now, "accepted" on older trades
        prisma.trade.count({ where: { league: activeLeague, executedAt: { not: null } } }),
        prisma.trade.count({ where: { league: activeLeague, status: { in: ["pending", "awaiting_veto"] } } }),
        prisma.waiverClaim.count({ where: { league: activeLeague, status: "pending" } }),
      ]);

    // ---- 3. Users ---------------------------------------------------------
    const [usersTotal, usersNew, admins, suspended, usersInActiveLeague] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) } } }),
      prisma.user.count({ where: { role: "admin" } }),
      prisma.user.count({ where: { status: "suspended" } }),
      prisma.user.count({ where: { fantasyTeams: { some: { league: activeLeague } } } }),
    ]);

    // ---- 4. The database itself -------------------------------------------
    const [sizeResult, connectionResult, maxResult, reservedResult, largestTables] = await Promise.all([
      prisma.$queryRaw<{ size: string }[]>`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
      prisma.$queryRaw<{ used: bigint }[]>`SELECT count(*) AS used FROM pg_stat_activity WHERE backend_type = 'client backend'`,
      prisma.$queryRaw<{ max_connections: string }[]>`SHOW max_connections`,
      prisma.$queryRaw<{ superuser_reserved_connections: string }[]>`SHOW superuser_reserved_connections`,
      prisma.$queryRaw<{ name: string; size: string }[]>`
        SELECT relname AS name, pg_size_pretty(pg_total_relation_size(relid)) AS size
        FROM pg_catalog.pg_statio_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 5`,
    ]);

    // Everything stored for past-season leagues, which nothing on the site
    // edits anymore
    const [archivedLeagues, ...archivedCounts] = await Promise.all([
      prisma.fantasyLeague.count({ where: archivedLeague }),
      prisma.fantasyTeam.count({ where: { league: archivedLeague } }),
      prisma.rosterSlot.count({ where: { fantasyTeam: { league: archivedLeague } } }),
      prisma.matchup.count({ where: { league: archivedLeague } }),
      prisma.draftPick.count({ where: { league: archivedLeague } }),
      prisma.transaction.count({ where: { league: archivedLeague } }),
      prisma.trade.count({ where: { league: archivedLeague } }),
      prisma.waiverClaim.count({ where: { league: archivedLeague } }),
    ]);

    const maxConnections = parseInt(maxResult[0]?.max_connections ?? "0", 10);
    const reservedConnections = parseInt(reservedResult[0]?.superuser_reserved_connections ?? "0", 10);

    return NextResponse.json({
      status: "connected",
      currentSeason,
      stats: {
        lastRefresh: appSettings?.statsRefreshedAt
          ? {
              at: appSettings.statsRefreshedAt,
              ok: appSettings.statsRefreshOk ?? false,
              note: appSettings.statsRefreshNote,
            }
          : null,
        weeklyStats: {
          weeks: weeklyByWeek.map((w) => w.week),
          rows: weeklyByWeek.reduce((sum, w) => sum + w._count, 0),
        },
        schedule: seasonRange ? { scheduled: scheduledMatches, played: playedMatches } : null,
        historicalSeasons,
        players: { total: players, onTeams: playersOnTeams, staff },
        manualOverrides: overrides,
      },
      activity: {
        leagues: {
          total: leagues.length,
          drafted: leagues.filter((l) => l.draftStatus === "completed").length,
          drafting: leagues.filter((l) => l.draftStatus === "in_progress" || l.draftStatus === "paused").length,
        },
        managers: { filled: teams, slots: leagues.reduce((sum, l) => sum + l.maxTeams, 0) },
        matchups: { scored: matchupsScored, total: matchupsTotal },
        transactions,
        trades: { completed: tradesCompleted, pending: tradesPending },
        pendingWaiverClaims: waiversPending,
      },
      users: {
        total: usersTotal,
        newLast30Days: usersNew,
        admins,
        suspended,
        notInActiveLeague: usersTotal - usersInActiveLeague,
      },
      database: {
        size: sizeResult[0]?.size ?? "unknown",
        connections: {
          used: Number(connectionResult[0]?.used ?? 0),
          available: maxConnections - reservedConnections,
        },
        largestTables,
        archived: {
          leagues: archivedLeagues,
          rows: archivedCounts.reduce((sum, n) => sum + n, 0),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching database status:", error);
    return NextResponse.json(
      { status: "error", error: "Failed to fetch database status" },
      { status: 500 }
    );
  }
}
