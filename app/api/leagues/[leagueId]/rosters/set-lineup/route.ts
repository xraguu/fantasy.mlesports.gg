import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runAutoLockSweep } from "@/lib/autoLock";

/**
 * POST /api/leagues/[leagueId]/rosters/set-lineup
 * Update roster lineup - move teams between positions (bench/starters)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;

    // Make sure lock state is current before checking it below (e.g. an
    // edit attempted right at the 3am ET boundary shouldn't slip through on
    // a stale isLocked value from before this request).
    await runAutoLockSweep(leagueId);

    const body = await req.json();
    const { fantasyTeamId, week, updates } = body;

    if (!fantasyTeamId || !week || !updates || !Array.isArray(updates)) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    // Verify the user owns this fantasy team
    const fantasyTeam = await prisma.fantasyTeam.findUnique({
      where: {
        id: fantasyTeamId,
        fantasyLeagueId: leagueId,
      },
      select: {
        ownerUserId: true,
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
        { error: "You do not own this fantasy team" },
        { status: 403 }
      );
    }

    // Check if any of the slots being updated are locked
    const slotIds = updates.map((u: any) => u.slotId);
    const slots = await prisma.rosterSlot.findMany({
      where: {
        id: { in: slotIds },
      },
      select: {
        id: true,
        isLocked: true,
      },
    });

    const lockedSlots = slots.filter((s) => s.isLocked);
    if (lockedSlots.length > 0) {
      return NextResponse.json(
        {
          error: "Lineup is locked",
          message: "One or more roster slots are locked and cannot be modified",
          lockedSlotIds: lockedSlots.map((s) => s.id),
        },
        { status: 423 } // 423 Locked
      );
    }

    // Perform the updates
    await prisma.$transaction(
      updates.map((update: { slotId: string; position: string }) =>
        prisma.rosterSlot.update({
          where: {
            id: update.slotId,
          },
          data: {
            position: update.position,
          },
        })
      )
    );

    return NextResponse.json({
      success: true,
      message: "Lineup updated successfully",
    });
  } catch (error) {
    console.error("Error setting lineup:", error);
    return NextResponse.json(
      { error: "Failed to update lineup" },
      { status: 500 }
    );
  }
}
