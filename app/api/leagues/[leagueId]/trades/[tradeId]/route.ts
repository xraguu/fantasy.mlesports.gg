import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { tradeVetoDeadline } from "@/lib/tradeExecution";
import { findLockedSlotForTeam, lockedTeamErrorMessage } from "@/lib/rosterLocks";
import { getTradeCutoff } from "@/lib/tradeCutoff";

/**
 * PATCH /api/leagues/[leagueId]/trades/[tradeId]
 * Accept or reject a trade
 * Body: { action: "accept" | "reject" }
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
    const { action } = body;

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
      select: { currentWeek: true, draftStatus: true },
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

    // Action is "accept" - don't execute yet. Trades auto-process 12 hours
    // after acceptance unless an admin vetoes them in that window (see
    // lib/tradeExecution.ts).
    const acceptedAt = new Date();
    const updatedTrade = await prisma.trade.update({
      where: { id: tradeId },
      data: {
        status: "awaiting_veto",
        acceptedAt,
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
