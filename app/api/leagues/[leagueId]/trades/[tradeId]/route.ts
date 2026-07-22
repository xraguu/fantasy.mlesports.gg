import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { tradeVetoDeadline } from "@/lib/tradeExecution";
import { findLockedSlotForTeam, lockedTeamErrorMessage } from "@/lib/rosterLocks";
import { getTradeCutoff } from "@/lib/tradeCutoff";
import { isWeekLocked } from "@/lib/autoLock";
import { getRosterCapacity } from "@/lib/rosterSlotAssignment";

/**
 * PATCH /api/leagues/[leagueId]/trades/[tradeId]
 * Accept or reject a trade
 * Body: { action: "accept" | "reject", receiverDrops?: string[] }
 * receiverDrops is only needed when accepting a trade that was proposed
 * without regard for the receiver's roster capacity — a trade CAN be
 * proposed even if it would overflow the receiver, and it's only at this
 * accept step that the receiver picks what to drop to make room (mirrors
 * proposerDrops, which the proposer picks at propose time instead).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; tradeId: string }> }
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
        { error: "Suspended users cannot respond to trades" },
        { status: 403 }
      );
    }

    const { leagueId, tradeId } = await params;
    const body = await req.json();
    const { action, receiverDrops = [] } = body;

    if (action !== "accept" && action !== "reject") {
      return NextResponse.json(
        { error: "Invalid action. Must be 'accept' or 'reject'" },
        { status: 400 }
      );
    }

    // Get the trade
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        proposerTeam: true,
        receiverTeam: true,
      },
    });

    if (!trade) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    if (trade.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Trade does not belong to this league" },
        { status: 400 }
      );
    }

    // Only the receiver can accept/reject
    if (trade.receiverTeam.ownerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "Only the trade receiver can respond to this trade" },
        { status: 403 }
      );
    }

    // Check if trade is still pending
    if (trade.status !== "pending") {
      return NextResponse.json(
        { error: `Trade is already ${trade.status}` },
        { status: 400 }
      );
    }

    if (action === "reject") {
      // Simply update status to rejected
      const updatedTrade = await prisma.trade.update({
        where: { id: tradeId },
        data: {
          status: "rejected",
        },
      });

      return NextResponse.json({
        success: true,
        trade: updatedTrade,
      });
    }

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: { currentWeek: true, draftStatus: true, season: true, rosterConfig: true },
    });
    if (league?.draftStatus !== "completed") {
      return NextResponse.json(
        { error: "Trades are not allowed until the draft is complete" },
        { status: 403 }
      );
    }

    // The cutoff is only checked at propose time elsewhere — a trade
    // proposed before the deadline could otherwise still be accepted (and
    // executed) after it. Re-check here too.
    const tradeCutoff = await getTradeCutoff(leagueId);
    if (tradeCutoff && new Date() > tradeCutoff) {
      return NextResponse.json(
        { error: "The trade deadline has passed for this league" },
        { status: 403 }
      );
    }

    // Same match-weekend blackout as propose time — a trade could sit
    // pending across a whole weekend, so this has to be re-checked at
    // accept time too, not just when it was first proposed.
    if (league && (await isWeekLocked(league.season, league.currentWeek))) {
      return NextResponse.json(
        { error: "Trades can't be accepted during the match weekend — try again once this week's matches are over." },
        { status: 403 }
      );
    }

    // Neither side's offered teams can be locked at accept time either —
    // lock state may have changed since the trade was proposed.
    const currentWeek = league?.currentWeek ?? 1;

    for (const mleTeamId of trade.proposerGives) {
      const lockedSlot = await findLockedSlotForTeam(trade.proposerTeamId, currentWeek, mleTeamId);
      if (lockedSlot) {
        return NextResponse.json(
          { error: lockedTeamErrorMessage(lockedSlot.mleTeam) },
          { status: 400 }
        );
      }
    }
    for (const mleTeamId of trade.receiverGives) {
      const lockedSlot = await findLockedSlotForTeam(trade.receiverTeamId, currentWeek, mleTeamId);
      if (lockedSlot) {
        return NextResponse.json(
          { error: lockedTeamErrorMessage(lockedSlot.mleTeam) },
          { status: 400 }
        );
      }
    }
    for (const mleTeamId of receiverDrops as string[]) {
      const lockedSlot = await findLockedSlotForTeam(trade.receiverTeamId, currentWeek, mleTeamId);
      if (lockedSlot) {
        return NextResponse.json(
          { error: lockedTeamErrorMessage(lockedSlot.mleTeam) },
          { status: 400 }
        );
      }
    }

    // A team the receiver picked to drop (to make room) has to actually be
    // on their roster right now, and can't also be one of the teams they're
    // already sending out in this same trade.
    if ((receiverDrops as string[]).some((id) => trade.receiverGives.includes(id))) {
      return NextResponse.json(
        { error: "A team can't be both given away and dropped in the same trade" },
        { status: 400 }
      );
    }
    if ((receiverDrops as string[]).length > 0) {
      const receiverRosterTeamIds = new Set(
        (
          await prisma.rosterSlot.findMany({
            where: { fantasyTeamId: trade.receiverTeamId, week: currentWeek },
            select: { mleTeamId: true },
          })
        ).map((s) => s.mleTeamId)
      );
      const notOnRoster = (receiverDrops as string[]).find((id) => !receiverRosterTeamIds.has(id));
      if (notOnRoster) {
        return NextResponse.json(
          { error: "One of the teams selected to drop isn't on your roster" },
          { status: 400 }
        );
      }
    }

    // This trade may have been proposed without regard for whether it fits
    // on the receiver's roster (see propose/route.ts) — accepting it is
    // where that actually gets enforced. If receiverDrops don't make up the
    // difference, tell the receiver how many more teams to pick instead of
    // silently rejecting the whole trade.
    const capacity = getRosterCapacity(league?.rosterConfig);
    const receiverCount = await prisma.rosterSlot.count({
      where: { fantasyTeamId: trade.receiverTeamId, week: currentWeek },
    });
    const receiverAfter =
      receiverCount - trade.receiverGives.length - (receiverDrops as string[]).length + trade.proposerGives.length;
    if (receiverAfter > capacity) {
      const stillNeeded = receiverAfter - capacity;
      return NextResponse.json(
        {
          error: `Accepting this trade would leave your roster with more teams than it has slots for. Select ${stillNeeded} more team${stillNeeded === 1 ? "" : "s"} to drop.`,
          needsDropCount: receiverCount - trade.receiverGives.length + trade.proposerGives.length - capacity,
        },
        { status: 400 }
      );
    }

    // Action is "accept" - don't execute yet. Trades auto-process 12 hours
    // after acceptance unless an admin vetoes them in that window (see
    // lib/tradeExecution.ts).
    const acceptedAt = new Date();
    const updatedTrade = await prisma.trade.update({
      where: { id: tradeId },
      data: {
        status: "awaiting_veto",
        acceptedAt,
        receiverDrops: receiverDrops as string[],
      },
    });

    return NextResponse.json({
      success: true,
      trade: updatedTrade,
      vetoDeadline: tradeVetoDeadline(acceptedAt),
    });
  } catch (error) {
    console.error("Error updating trade:", error);
    return NextResponse.json(
      { error: "Failed to update trade" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/leagues/[leagueId]/trades/[tradeId]
 * Cancel a trade (only if you are the proposer and it's still pending)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; tradeId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, tradeId } = await params;

    // Get the trade
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        proposerTeam: true,
      },
    });

    if (!trade) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    if (trade.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Trade does not belong to this league" },
        { status: 400 }
      );
    }

    // Only the proposer can cancel
    if (trade.proposerTeam.ownerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "Only the trade proposer can cancel this trade" },
        { status: 403 }
      );
    }

    // Check if trade is still pending
    if (trade.status !== "pending") {
      return NextResponse.json(
        { error: `Cannot cancel a trade that is ${trade.status}` },
        { status: 400 }
      );
    }

    // Delete the trade
    await prisma.trade.delete({
      where: { id: tradeId },
    });

    return NextResponse.json({
      success: true,
      message: "Trade cancelled successfully",
    });
  } catch (error) {
    console.error("Error cancelling trade:", error);
    return NextResponse.json(
      { error: "Failed to cancel trade" },
      { status: 500 }
    );
  }
}
