import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runAutoLockSweep } from "@/lib/autoLock";

/**
 * PUT /api/leagues/[leagueId]/roster/update
 * Update roster slots for a fantasy team
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
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
        { error: "Suspended users cannot edit their roster" },
        { status: 403 }
      );
    }

    const { leagueId } = await params;
    const body = await req.json();
    const { fantasyTeamId, week, roster } = body;

    if (!fantasyTeamId || !week || !roster || !Array.isArray(roster)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Make sure lock state is current before checking it below (e.g. an
    // edit attempted right at the 3am ET boundary shouldn't slip through
    // on stale isLocked values).
    await runAutoLockSweep(leagueId);

    // Verify that the user owns this fantasy team
    const fantasyTeam = await prisma.fantasyTeam.findUnique({
      where: { id: fantasyTeamId },
      select: {
        id: true,
        ownerUserId: true,
        fantasyLeagueId: true,
        league: { select: { draftStatus: true } },
      },
    });

    if (!fantasyTeam) {
      return NextResponse.json({ error: "Fantasy team not found" }, { status: 404 });
    }

    if (fantasyTeam.ownerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "You can only update your own roster" },
        { status: 403 }
      );
    }

    if (fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Fantasy team does not belong to this league" },
        { status: 400 }
      );
    }

    // Rosters are entirely populated by the draft — there's nothing to edit
    // through this route until it's finished.
    if (fantasyTeam.league.draftStatus !== "completed") {
      return NextResponse.json(
        { error: "Roster changes are not allowed until the draft is complete" },
        { status: 403 }
      );
    }

    // Update roster slots
    // First, get the current roster slots to verify they exist and to update them
    const existingSlots = await prisma.rosterSlot.findMany({
      where: {
        fantasyTeamId: fantasyTeamId,
        week: week,
      },
    });

    // The client sends the whole roster on every save, not just the slots
    // it actually changed — so "included in the payload" isn't the same as
    // "being edited." Only treat a slot as a real edit if its team
    // assignment actually differs from what's already saved; otherwise a
    // save that only touches two unlocked slots would spuriously get
    // rejected over some other, untouched, already-locked slot that just
    // happened to be present in the full payload.
    const slotsToUpdate = roster
      .filter((slot: any) => slot.mleTeam)
      .map((slot: any) => {
        const existingSlot = existingSlots.find(
          (s) => s.position === slot.position && s.slotIndex === slot.slotIndex
        );
        return {
          slot,
          existingSlot,
          isActuallyChanging: !existingSlot || existingSlot.mleTeamId !== slot.mleTeam.id,
        };
      })
      .filter((entry) => entry.isActuallyChanging);

    // Reject the whole update if it targets any slot an admin has locked —
    // lock state is server-authoritative, never trust the client for it.
    const lockedTarget = slotsToUpdate.find((entry) => entry.existingSlot?.isLocked);
    if (lockedTarget) {
      return NextResponse.json(
        {
          error: `Slot ${lockedTarget.slot.position} #${lockedTarget.slot.slotIndex + 1} is locked and cannot be edited`,
        },
        { status: 423 }
      );
    }

    // Update each slot that's actually changing
    const updates = slotsToUpdate.map(({ slot, existingSlot }) => {
      if (existingSlot) {
        // Update existing slot
        return prisma.rosterSlot.update({
          where: { id: existingSlot.id },
          data: {
            mleTeamId: slot.mleTeam.id,
          },
        });
      } else {
        // Create new slot if it doesn't exist (can't already be locked — it
        // didn't exist yet, so lock state is always server-decided as false)
        return prisma.rosterSlot.create({
          data: {
            id: `${fantasyTeamId}-${week}-${slot.position}-${slot.slotIndex}`,
            fantasyTeamId: fantasyTeamId,
            mleTeamId: slot.mleTeam.id,
            week: week,
            position: slot.position,
            slotIndex: slot.slotIndex,
            isLocked: false,
            fantasyPoints: slot.fantasyPoints || 0,
          },
        });
      }
    });

    await Promise.all(updates);

    return NextResponse.json({
      success: true,
      message: "Roster updated successfully",
    });
  } catch (error) {
    console.error("Error updating roster:", error);
    return NextResponse.json(
      { error: "Failed to update roster" },
      { status: 500 }
    );
  }
}
