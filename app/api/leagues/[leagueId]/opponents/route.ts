import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTeamSeasonStats, GamemodeLens, lensForPosition, getWithinLeagueStandings, rankTeamsByFpts } from "@/lib/teamSeasonStats";
import { getFantasyStandings, formatPlacement } from "@/lib/standings";
import { runAutoLockSweep } from "@/lib/autoLock";
import { getEffectiveWeekMatchRange } from "@/lib/weekMatchRange";

/**
 * GET /api/leagues/[leagueId]/opponents
 * Get all opponents (other fantasy teams) in the league with their rosters
 * Query params: ?week=1
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;
    await runAutoLockSweep(leagueId);

    const url = new URL(req.url);
    const week = parseInt(url.searchParams.get("week") || "1");

    // Admin View League mode: an admin who's ALSO a manager in this league
    // wants to browse every team, including their own, the same way a pure
    // admin (not a manager here) would. Only trusted when the caller is
    // actually an admin — never take the client's word for it — so a normal
    // manager can never see themselves in their own opponents list.
    const adminViewRequested = url.searchParams.get("adminView") === "true";
    let excludeSelf = true;
    if (adminViewRequested) {
      const requester = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { role: true },
      });
      if (requester?.role === "admin") excludeSelf = false;
    }

    // Get the league with roster config
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        name: true,
        season: true,
        currentWeek: true,
        rosterConfig: true,
        waiverSystem: true,
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Parse roster config to know how many slots each position has
    // (position values are lowercase everywhere in this app: "2s"/"3s"/"flx"/"be")
    const rosterConfig = league.rosterConfig as any;
    const expectedSlots = [
      ...Array(rosterConfig["2s"] || 0).fill("2s"),
      ...Array(rosterConfig["3s"] || 0).fill("3s"),
      ...Array(rosterConfig.flx || 0).fill("flx"),
      ...Array(rosterConfig.be || 0).fill("be"),
    ];

    // Get all fantasy teams in the league (excluding current user's team,
    // unless this is a verified admin browsing in Admin View mode)
    const allTeams = await prisma.fantasyTeam.findMany({
      where: {
        fantasyLeagueId: leagueId,
        ...(excludeSelf ? { ownerUserId: { not: session.user.id } } : {}),
      },
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
        displayName: "asc",
      },
    });

    // Completed (resolved) transaction counts and currently-pending waiver
    // claim/trade counts, batched for every opponent at once rather than
    // per-team — "completed" is the full Transaction history log (approved,
    // denied, cancelled, vetoed all included, matching what the My Roster
    // Transactions tab already shows), "pending" is whatever hasn't been
    // resolved yet and so has no Transaction row at all yet (a pending
    // WaiverClaim, or a Trade still awaiting response or in its veto
    // window) — the two live in entirely different tables.
    const teamIds = allTeams.map((t) => t.id);

    const completedCounts = await prisma.transaction.groupBy({
      by: ["fantasyTeamId"],
      where: { fantasyTeamId: { in: teamIds } },
      _count: { _all: true },
    });
    const completedCountByTeam = new Map(
      completedCounts.map((c) => [c.fantasyTeamId, c._count._all])
    );

    const pendingWaiverCounts = await prisma.waiverClaim.groupBy({
      by: ["fantasyTeamId"],
      where: { fantasyTeamId: { in: teamIds }, status: "pending" },
      _count: { _all: true },
    });
    const pendingCountByTeam = new Map(
      pendingWaiverCounts.map((c) => [c.fantasyTeamId, c._count._all])
    );

    const pendingTrades = await prisma.trade.findMany({
      where: {
        OR: [
          { proposerTeamId: { in: teamIds } },
          { receiverTeamId: { in: teamIds } },
        ],
        status: { in: ["pending", "awaiting_veto"] },
      },
      select: { proposerTeamId: true, receiverTeamId: true },
    });
    for (const trade of pendingTrades) {
      if (teamIds.includes(trade.proposerTeamId)) {
        pendingCountByTeam.set(trade.proposerTeamId, (pendingCountByTeam.get(trade.proposerTeamId) ?? 0) + 1);
      }
      if (teamIds.includes(trade.receiverTeamId)) {
        pendingCountByTeam.set(trade.receiverTeamId, (pendingCountByTeam.get(trade.receiverTeamId) ?? 0) + 1);
      }
    }

    // Fetch every opponent's roster for this week up front, so the maps below
    // can be built once instead of per-team.
    const rosterSlotsByTeam = new Map(
      await Promise.all(
        allTeams.map(async (team) => {
          const slots = await prisma.rosterSlot.findMany({
            where: { fantasyTeamId: team.id, week },
            include: { mleTeam: true },
            orderBy: [{ position: "asc" }, { slotIndex: "asc" }],
          });
          return [team.id, slots] as const;
        })
      )
    );

    const allRosteredMleTeamIds = [
      ...new Set([...rosterSlotsByTeam.values()].flat().map((s) => s.mleTeamId)),
    ];

    // Real MLE opponent this week for every rostered team, via the Match
    // schedule + week date range (batched in one query for the whole page).
    // Scoped to THIS league's own season — an unscoped "whichever
    // SeasonSettings row has the highest season number" could silently pick
    // an unrelated league's settings.
    const settings = await prisma.seasonSettings.findFirst({
      where: { season: league.season },
    });
    const weekDates =
      (settings?.weekDates as Array<{ week: number; weekStart: string; matchStart: string; weekEnd: string }>) ?? [];
    const range = await getEffectiveWeekMatchRange(weekDates, week);

    const opponentByMleTeamId = new Map<string, { id: string; name: string; leagueId: string; slug: string; logoPath: string; primaryColor: string; secondaryColor: string }>();
    if (range && allRosteredMleTeamIds.length > 0) {
      const { start, end } = range;

      const matches = await prisma.match.findMany({
        where: {
          scheduledDate: { gte: start, lt: end },
          OR: [
            { homeTeamId: { in: allRosteredMleTeamIds } },
            { awayTeamId: { in: allRosteredMleTeamIds } },
          ],
        },
        include: { homeTeam: true, awayTeam: true },
      });

      for (const match of matches) {
        if (allRosteredMleTeamIds.includes(match.homeTeamId) && !opponentByMleTeamId.has(match.homeTeamId)) {
          opponentByMleTeamId.set(match.homeTeamId, match.awayTeam);
        }
        if (allRosteredMleTeamIds.includes(match.awayTeamId) && !opponentByMleTeamId.has(match.awayTeamId)) {
          opponentByMleTeamId.set(match.awayTeamId, match.homeTeam);
        }
      }
    }

    // Fprk/Oprk: rank every MLE team by cumulative fpts through this week,
    // once per lens (2s/3s/bestball) for the whole page — not per slot.
    const allMleTeams = await prisma.mLETeam.findMany({ select: { id: true } });
    const allMleTeamIds = allMleTeams.map((t) => t.id);

    // Real MLE match data already exists for every week of the season (it's
    // already over) — but this app still paces fantasy stats one week at a
    // time, so a manager previewing a future week's roster (currentWeek < a
    // requested week) shouldn't see real stats for weeks that haven't
    // "happened" yet fantasy-wise. Capped independently from `week` itself,
    // which still drives the actual roster/opponent preview below — that
    // part legitimately looks ahead.
    const statsWeek = Math.min(week, league.currentWeek);

    const rankByLens = new Map<GamemodeLens, Map<string, number>>();
    const statsByLens = new Map<GamemodeLens, Awaited<ReturnType<typeof getTeamSeasonStats>>>();
    const standingsByLens = new Map<GamemodeLens, Awaited<ReturnType<typeof getWithinLeagueStandings>>>();
    for (const lens of ["2s", "3s", "bestball"] as GamemodeLens[]) {
      const stats = await getTeamSeasonStats({ teamIds: allMleTeamIds, throughWeek: statsWeek, lens });
      statsByLens.set(lens, stats);
      rankByLens.set(lens, rankTeamsByFpts(stats));
      standingsByLens.set(lens, await getWithinLeagueStandings(statsWeek, lens, stats));
    }

    // All matchups in the league, fetched once and reused for every team's
    // last/current matchup lookup (previously refetched per-team, identical each time).
    const allLeagueMatchups = await prisma.matchup.findMany({
      where: { fantasyLeagueId: leagueId },
      include: {
        homeTeam: { select: { id: true, displayName: true } },
        awayTeam: { select: { id: true, displayName: true } },
      },
    });

    // Shared win/loss/points/rank source (honors double-win if enabled)
    const fantasyStandings = await getFantasyStandings(leagueId);
    const standingByTeamId = new Map(fantasyStandings.map((s) => [s.teamId, s]));

    // For each team, get their roster and calculate stats
    const opponents = allTeams.map((team) => {
      const rosterSlots = rosterSlotsByTeam.get(team.id) ?? [];
      const matchups = allLeagueMatchups.filter(
        (m) => m.homeTeamId === team.id || m.awayTeamId === team.id
      );

      const base = standingByTeamId.get(team.id);
      const wins = base?.wins ?? 0;
      const losses = base?.losses ?? 0;
      const totalPoints = base?.pointsFor ?? 0;

      // avgPoints' denominator has to stay regular-season only too — points
      // for is already regular-season only (getFantasyStandings excludes
      // playoffs), so dividing by a games-played count that includes
      // playoff games would understate the real average.
      const actualGamesPlayed = matchups.filter(
        (m) => !m.isPlayoff && m.homeScore !== null && m.awayScore !== null
      ).length;
      const avgPoints = actualGamesPlayed > 0 ? totalPoints / actualGamesPlayed : 0;

      const place = base?.rank ?? 0;

      // Get last and current matchup
      const sortedMatchups = matchups
        .filter((m) => m.homeScore !== null && m.awayScore !== null)
        .sort((a, b) => a.week - b.week);

      const lastMatchup = sortedMatchups[sortedMatchups.length - 2];
      const currentMatchup = sortedMatchups[sortedMatchups.length - 1];

      // Create a map of filled roster slots by position
      const filledSlots = new Map<string, (typeof rosterSlots)[0]>();
      rosterSlots.forEach((slot) => {
        filledSlots.set(`${slot.position}-${slot.slotIndex}`, slot);
      });

      // Build roster array with all expected slots (including empty ones)
      let seenCounts: Record<string, number> = {};
      const roster = expectedSlots.map((slotName) => {
        const slotIndex = seenCounts[slotName] ?? 0;
        seenCounts[slotName] = slotIndex + 1;

        const slot = filledSlots.get(`${slotName}-${slotIndex}`);

        if (!slot) {
          return {
            slot: slotName,
            id: "",
            name: "",
            leagueId: "",
            slug: "",
            logoPath: "",
            primaryColor: "",
            secondaryColor: "",
            score: 0,
            opponent: "",
            opponentTeam: null,
            opponentStanding: null,
            oprk: 0,
            fprk: 0,
            fpts: 0,
            avg: 0,
            last: 0,
            goals: 0,
            shots: 0,
            saves: 0,
            assists: 0,
            demos: 0,
            teamRecord: "",
            opponentGameRecord: "",
            opponentFantasyRank: 0,
          };
        }

        const lens = lensForPosition(slot.position);
        const s = statsByLens.get(lens)!.get(slot.mleTeamId);
        const fprk = rankByLens.get(lens)!.get(slot.mleTeamId) ?? 0;
        const oppTeam = opponentByMleTeamId.get(slot.mleTeamId);
        const oprk = oppTeam ? rankByLens.get(lens)!.get(oppTeam.id) ?? 0 : 0;
        const oppStats = oppTeam ? statsByLens.get(lens)!.get(oppTeam.id) : undefined;

        const oppStanding = oppTeam ? standingsByLens.get(lens)!.get(oppTeam.id) ?? null : null;

        return {
          slot: slotName,
          id: slot.mleTeamId,
          name: `${slot.mleTeam.leagueId} ${slot.mleTeam.name}`,
          leagueId: slot.mleTeam.leagueId,
          slug: slot.mleTeam.slug,
          logoPath: slot.mleTeam.logoPath,
          primaryColor: slot.mleTeam.primaryColor,
          secondaryColor: slot.mleTeam.secondaryColor,
          score: slot.fantasyPoints ?? 0,
          opponent: oppTeam ? `${oppTeam.leagueId} ${oppTeam.name}` : "",
          opponentTeam: oppTeam
            ? {
                id: oppTeam.id,
                name: oppTeam.name,
                leagueId: oppTeam.leagueId,
                slug: oppTeam.slug,
                logoPath: oppTeam.logoPath,
                primaryColor: oppTeam.primaryColor,
                secondaryColor: oppTeam.secondaryColor,
              }
            : null,
          opponentStanding: oppStanding,
          oprk,
          fprk,
          fpts: s?.fpts ?? 0,
          avg: s?.avg ?? 0,
          last: s?.last ?? 0,
          goals: s?.goals ?? 0,
          shots: s?.shots ?? 0,
          saves: s?.saves ?? 0,
          assists: s?.assists ?? 0,
          demos: s?.demosInflicted ?? 0,
          teamRecord: s?.record ?? "0-0",
          opponentGameRecord: oppStats?.record ?? "0-0",
          opponentFantasyRank: oprk,
        };
      });

      return {
        id: team.id,
        name: team.owner.displayName,
        teamName: team.displayName,
        record: `${wins}-${losses}`,
        place: place > 0 ? formatPlacement(place) : "N/A",
        totalPoints: Math.round(totalPoints),
        avgPoints: Math.round(avgPoints),
        currentWeek: league.currentWeek,
        waiverPriority: team.waiverPriority,
        faabRemaining: team.faabRemaining,
        completedTransactionCount: completedCountByTeam.get(team.id) ?? 0,
        pendingTransactionCount: pendingCountByTeam.get(team.id) ?? 0,
        lastMatchup: lastMatchup ? {
          id: lastMatchup.id,
          week: lastMatchup.week,
          myTeam: team.displayName,
          myScore: lastMatchup.homeTeamId === team.id ? Math.round(lastMatchup.homeScore || 0) : Math.round(lastMatchup.awayScore || 0),
          opponent: lastMatchup.homeTeamId === team.id ? lastMatchup.awayTeam.displayName : lastMatchup.homeTeam.displayName,
          opponentScore: lastMatchup.homeTeamId === team.id ? Math.round(lastMatchup.awayScore || 0) : Math.round(lastMatchup.homeScore || 0),
        } : undefined,
        currentMatchup: currentMatchup ? {
          id: currentMatchup.id,
          week: currentMatchup.week,
          myTeam: team.displayName,
          myScore: currentMatchup.homeTeamId === team.id ? Math.round(currentMatchup.homeScore || 0) : Math.round(currentMatchup.awayScore || 0),
          opponent: currentMatchup.homeTeamId === team.id ? currentMatchup.awayTeam.displayName : currentMatchup.homeTeam.displayName,
          opponentScore: currentMatchup.homeTeamId === team.id ? Math.round(currentMatchup.awayScore || 0) : Math.round(currentMatchup.homeScore || 0),
        } : undefined,
        teams: roster,
      };
    });

    return NextResponse.json({
      opponents,
      league: {
        id: league.id,
        name: league.name,
        currentWeek: league.currentWeek,
        waiverSystem: league.waiverSystem,
      },
    });
  } catch (error) {
    console.error("Error fetching opponents:", error);
    return NextResponse.json(
      { error: "Failed to fetch opponents" },
      { status: 500 }
    );
  }
}
