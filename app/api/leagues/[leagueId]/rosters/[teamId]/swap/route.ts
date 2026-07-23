import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { findLockedSlotForTeam, lockedTeamErrorMessage } from "@/lib/rosterLocks";
import { isTeamOnWaivers, clearWaiverPeriod, markTeamDroppedForWaivers } from "@/lib/waiverPeriods";
import { runAutoLockSweep, isWeekLocked } from "@/lib/autoLock";

/**
 * POST /api/leagues/[leagueId]/rosters/[teamId]/swap
 * Instantly replace a rostered MLE team with a free agent in the same slot
 * — used when a manager's roster is full and they pick up a genuine free
 * agent (no pending claim involved; unlike a waiver claim on a
 * "waiver"-status team, this takes effect immediately). Still respects
 * locks: an instant swap can't touch a currently-locked slot.
 * Body: { week: number, dropMleTeamId: string, addMleTeamId: string }
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

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { status: true },
    });
    if (user?.status === "suspended") {
      return NextResponse.json(
        { error: "Suspended users cannot modify their roster" },
        { status: 403 }
      );
    }

    const { leagueId, teamId } = await params;

    // Make sure lock state is current before checking it below (e.g. a swap
    // attempted right at the 3am ET boundary shouldn't slip through on a
    // stale isLocked value from before this request).
    await runAutoLockSweep(leagueId);

    const body = await req.json();
    const { week, dropMleTeamId, addMleTeamId } = body;

    if (!week || !dropMleTeamId || !addMleTeamId) {
      return NextResponse.json(
        { error: "Week, dropMleTeamId, and addMleTeamId are required" },
        { status: 400 }
      );
    }

    const fantasyTeam = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        fantasyLeagueId: true,
        ownerUserId: true,
        league: { select: { draftStatus: true, currentWeek: true, season: true } },
      },
    });

    if (!fantasyTeam) {
      return NextResponse.json({ error: "Fantasy team not found" }, { status: 404 });
    }
    if (fantasyTeam.ownerUserId !== session.user.id) {
      return NextResponse.json({ error: "You don't own this team" }, { status: 403 });
    }
    if (fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Team does not belong to this league" },
        { status: 400 }
      );
    }
    if (fantasyTeam.league.draftStatus !== "completed") {
      return NextResponse.json(
        { error: "Free agent pickups are not allowed until the draft is complete" },
        { status: 403 }
      );
    }
    // A week that's already fully over is settled history. Deliberately
    // `<` not `<=` — this route is genuine free-agency (not rearranging an
    // already-rostered team), which legitimately targets the current week;
    // findLockedSlotForTeam below already blocks touching a locked ACTIVE
    // slot during it.
    if (week < fantasyTeam.league.currentWeek) {
      return NextResponse.json(
        { error: "This week is already over and its roster can't be changed" },
        { status: 423 }
      );
    }

    // Roster composition can't change for ANY week — current or future —
    // while the current week's match weekend is actually live, same rule as
    // the plain add/drop routes. A swap is an add and a drop bundled
    // together, so it needs the identical blackout.
    if (await isWeekLocked(fantasyTeam.league.season, fantasyTeam.league.currentWeek)) {
      return NextResponse.json(
        { error: "Teams can't be swapped during the match weekend — try again once this week's matches are over." },
        { status: 423 }
      );
    }

    const slotToReplace = await prisma.rosterSlot.findFirst({
      where: { fantasyTeamId: teamId, week, mleTeamId: dropMleTeamId },
    });
    if (!slotToReplace) {
      return NextResponse.json(
        { error: "That team isn't on your roster this week" },
        { status: 400 }
      );
    }

    const lockedSlot = await findLockedSlotForTeam(teamId, week, dropMleTeamId);
    if (lockedSlot) {
      return NextResponse.json(
        { error: lockedTeamErrorMessage(lockedSlot.mleTeam) },
        { status: 400 }
      );
    }

    const addTeam = await prisma.mLETeam.findUnique({ where: { id: addMleTeamId } });
    if (!addTeam) {
      return NextResponse.json({ error: "MLE team not found" }, { status: 404 });
    }

    const alreadyRostered = await prisma.rosterSlot.findFirst({
      where: { week, mleTeamId: addMleTeamId, fantasyTeam: { fantasyLeagueId: leagueId } },
    });
    if (alreadyRostered) {
      return NextResponse.json(
        { error: "That team is already rostered by another manager this week" },
        { status: 400 }
      );
    }

    // Teams in the post-drop waiver clearance window can't be instant-swapped
    // in — they must be acquired via a pending waiver claim instead.
    if (await isTeamOnWaivers(leagueId, addMleTeamId)) {
      return NextResponse.json(
        { error: "That team is on waivers and must be acquired via a waiver claim" },
        { status: 400 }
      );
    }

    // The waiver-period writes below happen inside this same transaction —
    // doing them as separate calls after commit would leave a gap where the
    // roster's already updated but the dropped team doesn't look "on
    // waivers" yet, letting a concurrent request instant-add it as a plain
    // free agent and bypass clearance entirely.
    const updatedSlot = await prisma.$transaction(async (tx) => {
      const slot = await tx.rosterSlot.update({
        where: { id: slotToReplace.id },
        data: { mleTeamId: addMleTeamId },
        include: { mleTeam: true },
      });

      await tx.transaction.create({
        data: {
          fantasyLeagueId: leagueId,
          fantasyTeamId: teamId,
          userId: session.user.id!,
          type: "pickup",
          addTeamId: addMleTeamId,
          dropTeamId: dropMleTeamId,
          status: "approved",
          processedAt: new Date(),
        },
      });

      // Dropped team enters the waiver clearance window; the added team's
      // own clearance (if any) is cleared since it's now been picked up.
      await markTeamDroppedForWaivers(leagueId, dropMleTeamId, tx);
      await clearWaiverPeriod(leagueId, addMleTeamId, tx);

      return slot;
    });

    return NextResponse.json({
      success: true,
      rosterSlot: {
        id: updatedSlot.id,
        position: updatedSlot.position,
        slotIndex: updatedSlot.slotIndex,
        isLocked: updatedSlot.isLocked,
        mleTeam: {
          id: updatedSlot.mleTeam.id,
          name: updatedSlot.mleTeam.name,
          leagueId: updatedSlot.mleTeam.leagueId,
          slug: updatedSlot.mleTeam.slug,
          logoPath: updatedSlot.mleTeam.logoPath,
        },
      },
    });
  } catch (error) {
    console.error("Error swapping roster team:", error);
    return NextResponse.json({ error: "Failed to swap team" }, { status: 500 });
  }
}
