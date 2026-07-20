import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateRosterSlotId } from "@/lib/id-generator";
import { getTeamSeasonStats, TeamSeasonStatsRow, getWithinLeagueStandings, rankTeamsByFpts } from "@/lib/teamSeasonStats";
import { runAutoLockSweep } from "@/lib/autoLock";
import { isTeamOnWaivers, clearWaiverPeriod, markTeamDroppedForWaivers } from "@/lib/waiverPeriods";
import { getFantasyStandings } from "@/lib/standings";
import { runWaiverProcessingSweep } from "@/lib/waiverProcessing";
import { getEffectiveWeekMatchRange } from "@/lib/weekMatchRange";

/**
 * GET /api/leagues/[leagueId]/rosters/[teamId]
 * Get all roster slots for a fantasy team for a specific week
 * Query params: ?week=1
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;
    // Waivers first, then the week/lock sweep — the auto-lock sweep is what
    // resets a "fixed" league's waiver priority the moment a new week
    // begins (see lib/autoLock.ts). Running it before processing pending
    // claims would resolve claims submitted under the OLD week's priority
    // order against the NEW week's just-reset order instead, whenever the
    // admin-configured waiver-processing time falls at/after that week
    // boundary. Processing claims against the still-current priority first
    // means this call order can never produce that mismatch.
    await runWaiverProcessingSweep(leagueId);
    await runAutoLockSweep(leagueId);

    const url = new URL(req.url);
    const week = parseInt(url.searchParams.get("week") || "1");

    // Verify the fantasy team exists and user has access
    const fantasyTeam = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
      include: {
        league: {
          select: {
            id: true,
            currentWeek: true,
            rosterConfig: true,
            waiverSystem: true,
          },
        },
        owner: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    });

    if (!fantasyTeam) {
      return NextResponse.json(
        { error: "Fantasy team not found" },
        { status: 404 }
      );
    }

    if (fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Team does not belong to this league" },
        { status: 400 }
      );
    }

    // Real record/rank/points, from the shared standings calculator so this
    // page can never diverge from Standings/Opponents/Scoreboard/Leaderboard
    // (this route used to re-derive wins/losses locally with a falsy check
    // — `!m.homeScore` — that silently dropped legitimate 0-point matchups,
    // and didn't honor FantasyLeague.doubleWinEnabled bonus wins/losses at
    // all, unlike every other page showing standings-derived numbers).
    const standings = await getFantasyStandings(leagueId);
    const myStanding = standings.find((s) => s.teamId === teamId);
    const totalTeams = standings.length;
    const rank = myStanding?.rank ?? 0;
    const myWins = myStanding?.wins ?? 0;
    const myLosses = myStanding?.losses ?? 0;
    const totalPoints = myStanding?.pointsFor ?? 0;

    // Last/Current Matchup boxes need the actual Matchup rows (opponent
    // names, per-matchup scores) — standings only has aggregate totals.
    const myMatchups = await prisma.matchup.findMany({
      where: {
        fantasyLeagueId: leagueId,
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      include: {
        homeTeam: { select: { id: true, displayName: true } },
        awayTeam: { select: { id: true, displayName: true } },
      },
    });

    const sortedMyMatchups = myMatchups
      .filter((m) => m.homeScore !== null && m.awayScore !== null)
      .sort((a, b) => a.week - b.week);

    // Average is points-per-week-actually-played — deliberately NOT
    // (wins + losses), since double-win bonus credit isn't a separate game.
    // Playoff matchups don't count toward standings (totalPoints above is
    // already regular-season only via getFantasyStandings), so they're
    // excluded from this denominator too — but NOT from sortedMyMatchups
    // itself, since last/current matchup below should still show a real
    // playoff game while one's in progress.
    const gamesPlayed = sortedMyMatchups.filter((m) => !m.isPlayoff).length;
    const avgPoints = gamesPlayed > 0 ? totalPoints / gamesPlayed : 0;
    const lastMatchupRow = sortedMyMatchups[sortedMyMatchups.length - 2];
    const currentMatchupRow = sortedMyMatchups[sortedMyMatchups.length - 1];

    const toMatchupSummary = (m: typeof lastMatchupRow) =>
      m
        ? {
            id: m.id,
            week: m.week,
            myTeam: fantasyTeam.displayName,
            myScore: m.homeTeamId === teamId ? Math.round(m.homeScore || 0) : Math.round(m.awayScore || 0),
            opponent: m.homeTeamId === teamId ? m.awayTeam.displayName : m.homeTeam.displayName,
            opponentScore: m.homeTeamId === teamId ? Math.round(m.awayScore || 0) : Math.round(m.homeScore || 0),
          }
        : undefined;

    // Get roster slots for the specified week. A future week (past
    // currentWeek) doesn't get its own real rows until its lock boundary
    // actually passes (see lib/autoLock.ts's carry-forward step) — until
    // then, show it as a live mirror of the current roster, since that's
    // exactly what it'll be frozen into the moment it starts. A trade or
    // waiver pickup right now should be visible on every future week
    // immediately, not just once each one individually rolls over. Past
    // weeks are real history and never get this fallback.
    //
    // But a manager can also edit a future week directly (My Roster lets
    // you navigate ahead and swap teams there) — /roster/update writes
    // those real rows immediately, before that week's own carry-forward
    // ever runs. Once that's happened, this route must read the future
    // week's own rows back, not keep substituting the current week's — a
    // blanket substitution would silently discard the edit on next load,
    // which is exactly the "swap reverts after it loads" bug this guards
    // against.
    let isFutureWeekPreview = week > fantasyTeam.league.currentWeek;
    if (isFutureWeekPreview) {
      const futureWeekHasOwnRows = await prisma.rosterSlot.count({
        where: { fantasyTeamId: teamId, week },
      });
      if (futureWeekHasOwnRows > 0) isFutureWeekPreview = false;
    }
    const rosterWeek = isFutureWeekPreview ? fantasyTeam.league.currentWeek : week;

    // Bye/off week: this week's matchups have been generated for the league
    // (someone's playing) but this team isn't in any of them — either a real
    // round-1 bracket bye (12-team money bracket's top 2 seeds) or a team
    // that's simply skipping this week (e.g. the 12-team money bracket's
    // round-1 losers, who sit out the semifinal week and meet each other for
    // 5th/6th in the final week instead) or an odd-team-count regular-season
    // round-robin bye. Never true for a week nobody's matchups exist for yet.
    const weekMatchups = await prisma.matchup.findMany({
      where: { fantasyLeagueId: leagueId, week },
      select: { homeTeamId: true, awayTeamId: true },
    });
    const isByeWeek =
      weekMatchups.length > 0 &&
      !weekMatchups.some((m) => m.homeTeamId === teamId || m.awayTeamId === teamId);

    const rosterSlots = await prisma.rosterSlot.findMany({
      where: {
        fantasyTeamId: teamId,
        week: rosterWeek,
      },
      include: {
        mleTeam: true,
      },
      orderBy: [{ position: "asc" }, { slotIndex: "asc" }],
    });

    let enrichedSlots: any[] = [];

    if (rosterSlots.length > 0) {
      // Real MLE opponent this week, via the Match schedule + week date range
      // (same join pattern as weekly-breakdown), batched for the whole roster.
      const settings = await prisma.seasonSettings.findFirst({
        orderBy: { season: "desc" },
      });
      const weekDates =
        (settings?.weekDates as Array<{ week: number; startDate: string; endDate: string }>) ?? [];
      const range = await getEffectiveWeekMatchRange(weekDates, week);

      const mleTeamIds = rosterSlots.map((s) => s.mleTeamId);
      const opponentByTeamId = new Map<string, { id: string; name: string; leagueId: string; slug: string; logoPath: string; primaryColor: string; secondaryColor: string }>();

      if (range) {
        const { start, end } = range;

        const matches = await prisma.match.findMany({
          where: {
            scheduledDate: { gte: start, lt: end },
            OR: [{ homeTeamId: { in: mleTeamIds } }, { awayTeamId: { in: mleTeamIds } }],
          },
          include: { homeTeam: true, awayTeam: true },
        });

        for (const match of matches) {
          if (mleTeamIds.includes(match.homeTeamId) && !opponentByTeamId.has(match.homeTeamId)) {
            opponentByTeamId.set(match.homeTeamId, match.awayTeam);
          }
          if (mleTeamIds.includes(match.awayTeamId) && !opponentByTeamId.has(match.awayTeamId)) {
            opponentByTeamId.set(match.awayTeamId, match.homeTeam);
          }
        }
      }

      // Fprk/Oprk: rank every MLE team by cumulative fpts through this week,
      // computed once for both 2s and 3s (every slot can be toggled between
      // either mode in the UI, regardless of which slot type it sits in).
      const allMleTeams = await prisma.mLETeam.findMany({ select: { id: true } });
      const allMleTeamIds = allMleTeams.map((t) => t.id);

      // Real MLE match data already exists for every week of the season
      // (it's already over) — but this app still paces fantasy stats one
      // week at a time, so previewing a future week's lineup shouldn't
      // surface real stats for weeks that haven't "happened" yet
      // fantasy-wise. Capped independently from `week` itself, which still
      // drives the roster/opponent preview above — that part legitimately
      // looks ahead.
      const statsWeek = Math.min(week, fantasyTeam.league.currentWeek);

      const statsByLens = new Map<"2s" | "3s", Awaited<ReturnType<typeof getTeamSeasonStats>>>();
      const rankByLens = new Map<"2s" | "3s", Map<string, number>>();
      const standingsByLens = new Map<"2s" | "3s", Awaited<ReturnType<typeof getWithinLeagueStandings>>>();
      for (const lens of ["2s", "3s"] as const) {
        const stats = await getTeamSeasonStats({ teamIds: allMleTeamIds, throughWeek: statsWeek, lens });
        statsByLens.set(lens, stats);
        rankByLens.set(lens, rankTeamsByFpts(stats));
        standingsByLens.set(lens, await getWithinLeagueStandings(statsWeek, lens, stats));
      }

      const toStatBundle = (s: TeamSeasonStatsRow | undefined) => ({
        record: s?.record ?? "0-0",
        goals: s?.goals ?? 0,
        shots: s?.shots ?? 0,
        saves: s?.saves ?? 0,
        assists: s?.assists ?? 0,
        demos: s?.demosInflicted ?? 0,
        fpts: s?.fpts ?? 0,
        avg: s?.avg ?? 0,
        last: s?.last ?? 0,
        score: s?.score ?? 0,
      });

      enrichedSlots = rosterSlots.map((slot) => {
        const stats2s = statsByLens.get("2s")!.get(slot.mleTeamId);
        const stats3s = statsByLens.get("3s")!.get(slot.mleTeamId);
        const fprk2s = rankByLens.get("2s")!.get(slot.mleTeamId) ?? null;
        const fprk3s = rankByLens.get("3s")!.get(slot.mleTeamId) ?? null;

        const opponentTeam = opponentByTeamId.get(slot.mleTeamId) ?? null;
        const oprk2s = opponentTeam ? rankByLens.get("2s")!.get(opponentTeam.id) ?? null : null;
        const oprk3s = opponentTeam ? rankByLens.get("3s")!.get(opponentTeam.id) ?? null : null;

        // Default view: matches the slot's own type for 2s/3s slots; for
        // flex/bench, defaults to whichever mode actually scored higher that
        // week (matching the best-ball logic used to compute fantasyPoints).
        const defaultMode: "2s" | "3s" =
          slot.position === "2s"
            ? "2s"
            : slot.position === "3s"
            ? "3s"
            : (stats3s?.score ?? 0) > (stats2s?.score ?? 0)
            ? "3s"
            : "2s";

        return {
          id: slot.id,
          position: slot.position,
          slotIndex: slot.slotIndex,
          // A future week previewed off the current week's real rows (see
          // isFutureWeekPreview above) hasn't actually started yet — it
          // shouldn't borrow the current week's lock status along with its
          // team assignments, or it'd show as locked before it's even begun.
          isLocked: isFutureWeekPreview ? false : slot.isLocked,
          fantasyPoints: slot.fantasyPoints,
          defaultMode,
          mleTeam: {
            id: slot.mleTeam.id,
            name: slot.mleTeam.name,
            leagueId: slot.mleTeam.leagueId,
            slug: slot.mleTeam.slug,
            logoPath: slot.mleTeam.logoPath,
            primaryColor: slot.mleTeam.primaryColor,
            secondaryColor: slot.mleTeam.secondaryColor,
            status: "rostered" as const,
            rosteredBy: {
              rosterName: fantasyTeam.displayName,
              managerName: fantasyTeam.owner.displayName,
            },
            stats: {
              "2s": toStatBundle(stats2s),
              "3s": toStatBundle(stats3s),
            },
          },
          opponent: opponentTeam
            ? {
                id: opponentTeam.id,
                name: opponentTeam.name,
                leagueId: opponentTeam.leagueId,
                slug: opponentTeam.slug,
                logoPath: opponentTeam.logoPath,
                primaryColor: opponentTeam.primaryColor,
                secondaryColor: opponentTeam.secondaryColor,
                record: {
                  "2s": statsByLens.get("2s")!.get(opponentTeam.id)?.record ?? "0-0",
                  "3s": statsByLens.get("3s")!.get(opponentTeam.id)?.record ?? "0-0",
                },
                standing: {
                  "2s": standingsByLens.get("2s")!.get(opponentTeam.id) ?? null,
                  "3s": standingsByLens.get("3s")!.get(opponentTeam.id) ?? null,
                },
              }
            : null,
          oprk: { "2s": oprk2s, "3s": oprk3s },
          fprk: { "2s": fprk2s, "3s": fprk3s },
        };
      });
    }

    return NextResponse.json({
      fantasyTeam: {
        id: fantasyTeam.id,
        displayName: fantasyTeam.displayName,
        shortCode: fantasyTeam.shortCode,
        ownerDisplayName: fantasyTeam.owner.displayName,
        faabRemaining: fantasyTeam.faabRemaining,
        waiverPriority: fantasyTeam.waiverPriority,
        isOwner: fantasyTeam.ownerUserId === session.user.id,
      },
      league: {
        id: fantasyTeam.league.id,
        currentWeek: fantasyTeam.league.currentWeek,
        rosterConfig: fantasyTeam.league.rosterConfig,
        waiverSystem: fantasyTeam.league.waiverSystem,
      },
      week,
      isByeWeek,
      rosterSlots: enrichedSlots,
      record: { wins: myWins, losses: myLosses },
      rank,
      totalTeams,
      totalPoints: Math.round(totalPoints),
      avgPoints: Math.round(avgPoints * 10) / 10,
      lastMatchup: toMatchupSummary(lastMatchupRow),
      currentMatchup: toMatchupSummary(currentMatchupRow),
    });
  } catch (error) {
    console.error("Error fetching roster:", error);
    return NextResponse.json(
      { error: "Failed to fetch roster" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/leagues/[leagueId]/rosters/[teamId]
 * Add an MLE team to a roster slot (for pickups/trades)
 * Body: { week: number, position: string, slotIndex: number, mleTeamId: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;

    // Make sure lock state is current before checking it below (e.g. an
    // add attempted right at the 3am ET boundary shouldn't slip through on
    // a stale isLocked value from before this request).
    await runAutoLockSweep(leagueId);

    const body = await req.json();
    const { week, position, slotIndex, mleTeamId } = body;

    // Validate required fields
    if (!week || !position || slotIndex === undefined || !mleTeamId) {
      return NextResponse.json(
        { error: "Missing required fields: week, position, slotIndex, mleTeamId" },
        { status: 400 }
      );
    }

    // Verify the fantasy team exists and user owns it
    const fantasyTeam = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
      include: {
        league: {
          select: {
            id: true,
            rosterConfig: true,
            draftStatus: true,
          },
        },
      },
    });

    if (!fantasyTeam) {
      return NextResponse.json(
        { error: "Fantasy team not found" },
        { status: 404 }
      );
    }

    if (fantasyTeam.ownerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "You don't own this team" },
        { status: 403 }
      );
    }

    if (fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Team does not belong to this league" },
        { status: 400 }
      );
    }

    // Free agent pickups only open up once the draft has filled every
    // roster — until then, teams are acquired exclusively via the draft.
    if (fantasyTeam.league.draftStatus !== "completed") {
      return NextResponse.json(
        { error: "Free agent pickups are not allowed until the draft is complete" },
        { status: 403 }
      );
    }

    // Validate position and slotIndex against rosterConfig
    const rosterConfig = fantasyTeam.league.rosterConfig as any;
    const positionKey = position.toLowerCase();
    const maxSlots = rosterConfig[positionKey];

    if (maxSlots === undefined) {
      return NextResponse.json(
        { error: `Invalid position: ${position}` },
        { status: 400 }
      );
    }

    if (slotIndex >= maxSlots) {
      return NextResponse.json(
        { error: `Invalid slotIndex ${slotIndex} for position ${position}. Max is ${maxSlots - 1}` },
        { status: 400 }
      );
    }

    // Check if MLE team exists
    const mleTeam = await prisma.mLETeam.findUnique({
      where: { id: mleTeamId },
    });

    if (!mleTeam) {
      return NextResponse.json(
        { error: "MLE team not found" },
        { status: 404 }
      );
    }

    // Teams in the post-drop waiver clearance window can't be instant-added —
    // they must be acquired via a pending waiver claim instead.
    if (await isTeamOnWaivers(leagueId, mleTeamId)) {
      return NextResponse.json(
        { error: "This team is on waivers and must be acquired via a waiver claim" },
        { status: 400 }
      );
    }

    // Check if slot already exists (would be an update, not create)
    const existingSlot = await prisma.rosterSlot.findUnique({
      where: {
        fantasyTeamId_week_position_slotIndex: {
          fantasyTeamId: teamId,
          week,
          position,
          slotIndex,
        },
      },
    });

    if (existingSlot) {
      return NextResponse.json(
        { error: "Slot already occupied. Use PATCH to update." },
        { status: 400 }
      );
    }

    // Create the roster slot and transaction record in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Generate custom roster slot ID
      const rosterSlotId = generateRosterSlotId(teamId, week, position, slotIndex);

      const rosterSlot = await tx.rosterSlot.create({
        data: {
          id: rosterSlotId,
          fantasyTeamId: teamId,
          mleTeamId,
          week,
          position,
          slotIndex,
          isLocked: false,
        },
        include: {
          mleTeam: true,
        },
      });

      // Create transaction record for FA pickup
      await tx.transaction.create({
        data: {
          fantasyLeagueId: leagueId,
          fantasyTeamId: teamId,
          userId: session.user.id,
          type: "pickup",
          addTeamId: mleTeamId,
          dropTeamId: null,
          status: "approved",
          processedAt: new Date(),
        },
      });

      return rosterSlot;
    });

    await clearWaiverPeriod(leagueId, mleTeamId);

    return NextResponse.json({
      success: true,
      rosterSlot: {
        id: result.id,
        position: result.position,
        slotIndex: result.slotIndex,
        isLocked: result.isLocked,
        mleTeam: {
          id: result.mleTeam.id,
          name: result.mleTeam.name,
          leagueId: result.mleTeam.leagueId,
          slug: result.mleTeam.slug,
          logoPath: result.mleTeam.logoPath,
        },
      },
    });
  } catch (error) {
    console.error("Error adding to roster:", error);
    return NextResponse.json(
      { error: "Failed to add to roster" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/leagues/[leagueId]/rosters/[teamId]
 * Update roster slot (move teams between slots for lineup changes)
 * Body: { rosterSlotId: string, newPosition: string, newSlotIndex: number }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;

    // Make sure lock state is current before checking it below (e.g. a
    // move attempted right at the 3am ET boundary shouldn't slip through on
    // a stale isLocked value from before this request).
    await runAutoLockSweep(leagueId);

    const body = await req.json();
    const { rosterSlotId, newPosition, newSlotIndex } = body;

    if (!rosterSlotId || !newPosition || newSlotIndex === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: rosterSlotId, newPosition, newSlotIndex" },
        { status: 400 }
      );
    }

    // Get the roster slot to update
    const rosterSlot = await prisma.rosterSlot.findUnique({
      where: { id: rosterSlotId },
      include: {
        fantasyTeam: {
          include: {
            league: {
              select: {
                id: true,
                rosterConfig: true,
              },
            },
          },
        },
      },
    });

    if (!rosterSlot) {
      return NextResponse.json(
        { error: "Roster slot not found" },
        { status: 404 }
      );
    }

    // Verify ownership and league
    if (rosterSlot.fantasyTeam.ownerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "You don't own this team" },
        { status: 403 }
      );
    }

    if (rosterSlot.fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Team does not belong to this league" },
        { status: 400 }
      );
    }

    // Check if locked
    if (rosterSlot.isLocked) {
      return NextResponse.json(
        { error: "This roster slot is locked and cannot be modified" },
        { status: 400 }
      );
    }

    // Validate new position
    const rosterConfig = rosterSlot.fantasyTeam.league.rosterConfig as any;
    const positionKey = newPosition.toLowerCase();
    const maxSlots = rosterConfig[positionKey];

    if (maxSlots === undefined) {
      return NextResponse.json(
        { error: `Invalid position: ${newPosition}` },
        { status: 400 }
      );
    }

    if (newSlotIndex >= maxSlots) {
      return NextResponse.json(
        { error: `Invalid slotIndex ${newSlotIndex} for position ${newPosition}. Max is ${maxSlots - 1}` },
        { status: 400 }
      );
    }

    // The actual move/swap runs as one transaction that RE-READS both slots
    // and gates every write on the exact state just read, instead of the
    // findUnique-then-blind-update this used to be. Two rapid clicks (or any
    // other overlapping PATCH for slots sharing a row) used to both read the
    // same pre-move snapshot and both write their own version of the "swap",
    // which could leave the same mleTeam sitting in two slots at once.
    // Gating each update's WHERE clause on the position/slotIndex we just
    // read means a losing concurrent request's update simply matches zero
    // rows once it's actually applied (Postgres re-checks the WHERE clause
    // against the committed row when the lock is acquired) — it throws and
    // the whole transaction rolls back cleanly instead of corrupting state.
    try {
      await prisma.$transaction(async (tx) => {
        const freshSlot = await tx.rosterSlot.findUnique({ where: { id: rosterSlotId } });
        if (!freshSlot) throw new Error("SLOT_GONE");
        if (freshSlot.isLocked) throw new Error("SLOT_LOCKED");

        const targetSlot = await tx.rosterSlot.findUnique({
          where: {
            fantasyTeamId_week_position_slotIndex: {
              fantasyTeamId: teamId,
              week: freshSlot.week,
              position: newPosition,
              slotIndex: newSlotIndex,
            },
          },
        });

        if (targetSlot && targetSlot.isLocked) {
          throw new Error("TARGET_LOCKED");
        }

        if (targetSlot) {
          // Swap the two slots, each write gated on the state just read.
          const step1 = await tx.rosterSlot.updateMany({
            where: { id: targetSlot.id, position: newPosition, slotIndex: newSlotIndex },
            data: { position: "temp", slotIndex: 999 },
          });
          if (step1.count === 0) throw new Error("CONFLICT");

          const step2 = await tx.rosterSlot.updateMany({
            where: { id: rosterSlotId, position: freshSlot.position, slotIndex: freshSlot.slotIndex },
            data: { position: newPosition, slotIndex: newSlotIndex },
          });
          if (step2.count === 0) throw new Error("CONFLICT");

          const step3 = await tx.rosterSlot.updateMany({
            where: { id: targetSlot.id, position: "temp", slotIndex: 999 },
            data: { position: freshSlot.position, slotIndex: freshSlot.slotIndex },
          });
          if (step3.count === 0) throw new Error("CONFLICT");
        } else {
          const step = await tx.rosterSlot.updateMany({
            where: { id: rosterSlotId, position: freshSlot.position, slotIndex: freshSlot.slotIndex },
            data: { position: newPosition, slotIndex: newSlotIndex },
          });
          if (step.count === 0) throw new Error("CONFLICT");
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === "SLOT_LOCKED") {
        return NextResponse.json(
          { error: "This roster slot is locked and cannot be modified" },
          { status: 400 }
        );
      }
      if (error instanceof Error && error.message === "TARGET_LOCKED") {
        return NextResponse.json(
          { error: "Target slot is locked and cannot be swapped" },
          { status: 400 }
        );
      }
      if (error instanceof Error && (error.message === "CONFLICT" || error.message === "SLOT_GONE")) {
        return NextResponse.json(
          { error: "This lineup changed before your edit went through — refresh and try again" },
          { status: 409 }
        );
      }
      throw error;
    }

    // Fetch updated roster
    const updatedRoster = await prisma.rosterSlot.findMany({
      where: {
        fantasyTeamId: teamId,
        week: rosterSlot.week,
      },
      include: {
        mleTeam: true,
      },
      orderBy: [{ position: "asc" }, { slotIndex: "asc" }],
    });

    return NextResponse.json({
      success: true,
      rosterSlots: updatedRoster.map((slot) => ({
        id: slot.id,
        position: slot.position,
        slotIndex: slot.slotIndex,
        isLocked: slot.isLocked,
        mleTeam: {
          id: slot.mleTeam.id,
          name: slot.mleTeam.name,
          leagueId: slot.mleTeam.leagueId,
          slug: slot.mleTeam.slug,
          logoPath: slot.mleTeam.logoPath,
        },
      })),
    });
  } catch (error) {
    console.error("Error updating roster:", error);
    return NextResponse.json(
      { error: "Failed to update roster" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/leagues/[leagueId]/rosters/[teamId]
 * Remove an MLE team from a roster slot (drops)
 * Body: { rosterSlotId: string }
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;

    // Make sure lock state is current before checking it below (e.g. a drop
    // attempted right at the 3am ET boundary shouldn't slip through on a
    // stale isLocked value from before this request).
    await runAutoLockSweep(leagueId);

    const body = await req.json();
    const { rosterSlotId } = body;

    if (!rosterSlotId) {
      return NextResponse.json(
        { error: "Missing required field: rosterSlotId" },
        { status: 400 }
      );
    }

    // Get the roster slot
    const rosterSlot = await prisma.rosterSlot.findUnique({
      where: { id: rosterSlotId },
      include: {
        fantasyTeam: {
          include: {
            league: {
              select: {
                id: true,
                draftStatus: true,
              },
            },
          },
        },
      },
    });

    if (!rosterSlot) {
      return NextResponse.json(
        { error: "Roster slot not found" },
        { status: 404 }
      );
    }

    // Verify ownership
    if (rosterSlot.fantasyTeam.ownerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "You don't own this team" },
        { status: 403 }
      );
    }

    if (rosterSlot.fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Team does not belong to this league" },
        { status: 400 }
      );
    }

    if (rosterSlot.fantasyTeam.league.draftStatus !== "completed") {
      return NextResponse.json(
        { error: "Roster drops are not allowed until the draft is complete" },
        { status: 403 }
      );
    }

    // Check if locked
    if (rosterSlot.isLocked) {
      return NextResponse.json(
        { error: "This roster slot is locked and cannot be removed" },
        { status: 400 }
      );
    }

    // Delete the roster slot, create the transaction record, and mark the
    // team as on-waivers all in the same transaction — doing the waiver-
    // period write as a separate call after this commits would leave a gap
    // where the slot is already gone but the team doesn't look "on waivers"
    // yet, letting a concurrent add request slip through as a normal free-
    // agent pickup and bypass clearance entirely.
    await prisma.$transaction(async (tx) => {
      await tx.rosterSlot.delete({
        where: { id: rosterSlotId },
      });

      // Create transaction record for drop
      await tx.transaction.create({
        data: {
          fantasyLeagueId: leagueId,
          fantasyTeamId: teamId,
          userId: session.user.id,
          type: "drop",
          addTeamId: null,
          dropTeamId: rosterSlot.mleTeamId,
          status: "approved",
          processedAt: new Date(),
        },
      });

      // Manager-initiated drop: the team enters the waiver clearance window
      // rather than going straight back to free agency.
      await markTeamDroppedForWaivers(leagueId, rosterSlot.mleTeamId, tx);
    });

    return NextResponse.json({
      success: true,
      message: "Roster slot removed successfully",
    });
  } catch (error) {
    console.error("Error removing from roster:", error);
    return NextResponse.json(
      { error: "Failed to remove from roster" },
      { status: 500 }
    );
  }
}
