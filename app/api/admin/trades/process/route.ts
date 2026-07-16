import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";
import { executeTrade, tradeVetoDeadline } from "@/lib/tradeExecution";

/**
 * POST /api/admin/trades/process
 * Veto a trade that's in its 12-hour post-acceptance window (admin only).
 * Trades auto-process once that window closes without a veto — see
 * lib/tradeExecution.ts.
 * Body: { tradeId: string, reason?: string }
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
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { tradeId, reason } = body;

    if (!tradeId) {
      return NextResponse.json(
        { error: "Missing required field: tradeId" },
        { status: 400 }
      );
    }

    // Fetch the trade with manager display names for logging/messages
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        proposer: { select: { displayName: true } },
        receiver: { select: { displayName: true } },
      },
    });

    if (!trade) {
      return NextResponse.json(
        { error: "Trade not found" },
        { status: 404 }
      );
    }

    if (trade.status !== "awaiting_veto") {
      return NextResponse.json(
        { error: `Trade is not awaiting veto (status: ${trade.status})` },
        { status: 400 }
      );
    }

    const deadline = trade.acceptedAt ? tradeVetoDeadline(trade.acceptedAt) : null;
    if (!deadline || new Date() > deadline) {
      // Window already closed — auto-process it now instead of allowing a
      // late veto, same as the lazy sweep would do.
      await executeTrade(tradeId);
      return NextResponse.json(
        {
          error:
            "The 12-hour veto window has already passed — this trade has now been processed instead of vetoed.",
        },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.trade.update({
        where: { id: tradeId },
        data: {
          status: "vetoed",
          executedAt: new Date(),
        },
      });

      await tx.transaction.create({
        data: {
          fantasyLeagueId: trade.fantasyLeagueId,
          fantasyTeamId: trade.proposerTeamId,
          userId: trade.proposerUserId,
          type: "trade",
          tradeId: trade.id,
          tradePartnerTeamId: trade.receiverTeamId,
          tradePartnerGave: trade.receiverGives,
          status: "vetoed",
          reason: reason || "Vetoed by admin",
          processedAt: new Date(),
        },
      });

      await tx.transaction.create({
        data: {
          fantasyLeagueId: trade.fantasyLeagueId,
          fantasyTeamId: trade.receiverTeamId,
          userId: trade.receiverUserId,
          type: "trade",
          tradeId: trade.id,
          tradePartnerTeamId: trade.proposerTeamId,
          tradePartnerGave: trade.proposerGives,
          status: "vetoed",
          reason: reason || "Vetoed by admin",
          processedAt: new Date(),
        },
      });
    });

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "trade.veto",
      description: `Vetoed a trade between ${trade.proposer.displayName} and ${trade.receiver.displayName}`,
      targetType: "Trade",
      targetId: tradeId,
    });

    return NextResponse.json({
      success: true,
      message: "Trade vetoed successfully",
    });
  } catch (error) {
    console.error("Error processing trade:", error);
    return NextResponse.json(
      { error: "Failed to process trade" },
      { status: 500 }
    );
  }
}
