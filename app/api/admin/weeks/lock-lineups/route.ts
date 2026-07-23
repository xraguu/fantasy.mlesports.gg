import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";
import { runAutoLockSweep } from "@/lib/autoLock";

const POSITION_ORDER: Record<string, number> = { "2s": 0, "3s": 1, flx: 2, be: 3 };

interface LockLineupSlot {
  id: string;
  position: string;
  slotIndex: number;
  isLocked: boolean;
  mleTeam: { id: string; name: string; leagueId: string; logoPath: string } | null;
}

/**
 * GET /api/admin/weeks/lock-lineups
 * Get lineup lock status for all fantasy teams in a specific week
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const week = searchParams.get("week");
    const leagueId = searchParams.get("leagueId");

    if (!week) {
      return NextResponse.json(
        { error: "Week parameter is required" },
        { status: 400 }
      );
    }

    const weekNumber = parseInt(week, 10);

    await runAutoLockSweep(leagueId && leagueId !== "all" ? leagueId : undefined);

    // Build where clause
    const whereClause: Prisma.RosterSlotWhereInput = { week: weekNumber };
    if (leagueId && leagueId !== "all") {
      whereClause.fantasyTeam = { fantasyLeagueId: leagueId };
    }

    // Get all roster slots for the week
    const rosterSlots = await prisma.rosterSlot.findMany({
      where: whereClause,
      include: {
        fantasyTeam: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
              },
            },
            league: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        mleTeam: {
          select: {
            id: true,
            name: true,
            leagueId: true,
            logoPath: true,
          },
        },
      },
      orderBy: [
        { fantasyTeam: { league: { name: "asc" } } },
        { fantasyTeam: { displayName: "asc" } },
      ],
    });

    // Group by fantasy team and check if all slots are locked
    const teamMap = new Map();

    rosterSlots.forEach((slot) => {
      const teamId = slot.fantasyTeamId;
      if (!teamMap.has(teamId)) {
        teamMap.set(teamId, {
          fantasyTeamId: teamId,
          manager: slot.fantasyTeam.owner.displayName,
          teamName: slot.fantasyTeam.displayName,
          league: slot.fantasyTeam.league.name,
          leagueId: slot.fantasyTeam.league.id,
          week: weekNumber,
          slots: [],
        });
      }
      teamMap.get(teamId).slots.push({
        id: slot.id,
        position: slot.position,
        slotIndex: slot.slotIndex,
        isLocked: slot.isLocked,
        mleTeam: slot.mleTeam,
      });
    });

    // Convert map to array and add locked status
    const lineups = Array.from(teamMap.values()).map((team) => {
      team.slots.sort((a: LockLineupSlot, b: LockLineupSlot) => {
        const posDiff = (POSITION_ORDER[a.position] ?? 99) - (POSITION_ORDER[b.position] ?? 99);
        if (posDiff !== 0) return posDiff;
        return a.slotIndex - b.slotIndex;
      });

      // Bench slots never lock, so "fully locked" is judged only on the
      // lockable (non-bench) slots — otherwise no team could ever show as locked.
      const lockableSlots = team.slots.filter((slot: LockLineupSlot) => slot.position !== "be");
      const allLocked = lockableSlots.length > 0 && lockableSlots.every((slot: LockLineupSlot) => slot.isLocked);
      const anyLocked = lockableSlots.some((slot: LockLineupSlot) => slot.isLocked);

      return {
        ...team,
        locked: allLocked,
        partiallyLocked: anyLocked && !allLocked,
        lockedCount: team.slots.filter((slot: LockLineupSlot) => slot.isLocked).length,
        totalSlots: team.slots.length,
      };
    });

    return NextResponse.json({ lineups });
  } catch (error) {
    console.error("Error fetching lineup locks:", error);
    return NextResponse.json(
      { error: "Failed to fetch lineup locks" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/weeks/lock-lineups
 * Lock or unlock lineups for specific teams or all teams in a week
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { week, fantasyTeamId, action, leagueId, slotIds } = body;

    if (!week || !action) {
      return NextResponse.json(
        { error: "Week and action are required" },
        { status: 400 }
      );
    }

    const weekNumber = parseInt(week, 10);
    const isLocked = action === "lock";

    // If slotIds provided, lock/unlock specific slots
    if (slotIds && Array.isArray(slotIds)) {
      const result = await prisma.rosterSlot.updateMany({
        where: {
          id: { in: slotIds },
          // bench slots never lock — managers can always work the bench
          ...(isLocked ? { position: { not: "be" } } : {}),
        },
        data: {
          isLocked,
        },
      });

      await logAdminActivity({
        adminUserId: session.user.id!,
        action: "lineup.lock_slots",
        description: `${isLocked ? "Locked" : "Unlocked"} ${result.count} roster slot(s) for week ${weekNumber}`,
      });

      return NextResponse.json({
        success: true,
        message: `${result.count} slots ${isLocked ? "locked" : "unlocked"}`,
      });
    }

    // If fantasyTeamId provided, lock/unlock all slots for that team
    if (fantasyTeamId) {
      const result = await prisma.rosterSlot.updateMany({
        where: {
          fantasyTeamId,
          week: weekNumber,
          // bench slots never lock — managers can always work the bench
          ...(isLocked ? { position: { not: "be" } } : {}),
        },
        data: {
          isLocked,
        },
      });

      await logAdminActivity({
        adminUserId: session.user.id!,
        action: "lineup.lock_team",
        description: `${isLocked ? "Locked" : "Unlocked"} all slots for a team, week ${weekNumber}`,
        targetType: "FantasyTeam",
        targetId: fantasyTeamId,
      });

      return NextResponse.json({
        success: true,
        message: `All slots for team ${isLocked ? "locked" : "unlocked"}`,
        count: result.count,
      });
    }

    // Otherwise, lock/unlock all teams in the week (optionally filtered by league)
    const whereClause: Prisma.RosterSlotWhereInput = { week: weekNumber };
    if (leagueId && leagueId !== "all") {
      whereClause.fantasyTeam = { fantasyLeagueId: leagueId };
    }
    if (isLocked) {
      // bench slots never lock — managers can always work the bench
      whereClause.position = { not: "be" };
    }

    const result = await prisma.rosterSlot.updateMany({
      where: whereClause,
      data: {
        isLocked,
      },
    });

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "lineup.lock_week",
      description: `${isLocked ? "Locked" : "Unlocked"} all lineups for week ${weekNumber}${leagueId && leagueId !== "all" ? ` (league ${leagueId})` : ""}`,
    });

    return NextResponse.json({
      success: true,
      message: `All lineups ${isLocked ? "locked" : "unlocked"} for week ${weekNumber}`,
      count: result.count,
    });
  } catch (error) {
    console.error("Error locking/unlocking lineups:", error);
    return NextResponse.json(
      { error: "Failed to lock/unlock lineups" },
      { status: 500 }
    );
  }
}
