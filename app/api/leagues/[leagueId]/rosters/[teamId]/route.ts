import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateRosterSlotId } from "@/lib/id-generator";
import { getTeamSeasonStats, TeamSeasonStatsRow, getWithinLeagueStandings } from "@/lib/teamSeasonStats";
import { runAutoLockSweep } from "@/lib/autoLock";
import { isTeamOnWaivers, clearWaiverPeriod, markTeamDroppedForWaivers } from "@/lib/waiverPeriods";
import { getFantasyStandings } from "@/lib/standings";
import { runWaiverProcessingSweep } from "@/lib/waiverProcessing";

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
    await runAutoLockSweep(leagueId);
    await runWaiverProcessingSweep(leagueId);

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
    const gamesPlayed = sortedMyMatchups.length;
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

    // Get roster slots for the specified week
    const rosterSlots = await prisma.rosterSlot.findMany({
      where: {
        fantasyTeamId: teamId,
        week,
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
      const weekConfig = weekDates.find((w) => w.week === week);

      const mleTeamIds = rosterSlots.map((s) => s.mleTeamId);
      const opponentByTeamId = new Map<string, { id: string; name: string; leagueId: string; slug: string; logoPath: string; primaryColor: string; secondaryColor: string }>();

      if (weekConfig?.startDate && weekConfig?.endDate) {
        const start = new Date(weekConfig.startDate);
        const end = new Date(weekConfig.endDate);
        end.setHours(23, 59, 59, 999);

        const matches = await prisma.match.findMany({
          where: {
            scheduledDate: { gte: start, lte: end },
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

      const statsByLens = new Map<"2s" | "3s", Awaited<ReturnType<typeof getTeamSeasonStats>>>();
      const rankByLens = new Map<"2s" | "3s", Map<string, number>>();
      const standingsByLens = new Map<"2s" | "3s", Awaited<ReturnType<typeof getWithinLeagueStandings>>>();
      for (const lens of ["2s", "3s"] as const) {
        const stats = await getTeamSeasonStats({ teamIds: allMleTeamIds, throughWeek: week, lens });
        statsByLens.set(lens, stats);
        const sorted = [...stats.entries()].sort((a, b) => b[1].fpts - a[1].fpts);
        const rank = new Map<string, number>();
        sorted.forEach(([id], idx) => rank.set(id, idx + 1));
        rankByLens.set(lens, rank);
        standingsByLens.set(lens, await getWithinLeagueStandings(week, lens));
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
          isLocked: slot.isLocked,
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

    // Check if target slot is occupied
    const targetSlot = await prisma.rosterSlot.findUnique({
      where: {
        fantasyTeamId_week_position_slotIndex: {
          fantasyTeamId: teamId,
          week: rosterSlot.week,
          position: newPosition,
          slotIndex: newSlotIndex,
        },
      },
    });

    // If target slot exists and is locked, can't swap
    if (targetSlot && targetSlot.isLocked) {
      return NextResponse.json(
        { error: "Target slot is locked and cannot be swapped" },
        { status: 400 }
      );
    }

    // Perform the swap/move
    if (targetSlot) {
      // Swap the two slots
      await prisma.$transaction([
        // Temporarily move target to a placeholder
        prisma.rosterSlot.update({
          where: { id: targetSlot.id },
          data: {
            position: "temp",
            slotIndex: 999,
          },
        }),
        // Move source to target position
        prisma.rosterSlot.update({
          where: { id: rosterSlotId },
          data: {
            position: newPosition,
            slotIndex: newSlotIndex,
          },
        }),
        // Move target to source position
        prisma.rosterSlot.update({
          where: { id: targetSlot.id },
          data: {
            position: rosterSlot.position,
            slotIndex: rosterSlot.slotIndex,
          },
        }),
      ]);
    } else {
      // Just move to empty slot
      await prisma.rosterSlot.update({
        where: { id: rosterSlotId },
        data: {
          position: newPosition,
          slotIndex: newSlotIndex,
        },
      });
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

    // Delete the roster slot and create transaction record
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
    });

    // Manager-initiated drop: the team enters the waiver clearance window
    // rather than going straight back to free agency.
    await markTeamDroppedForWaivers(leagueId, rosterSlot.mleTeamId);

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
