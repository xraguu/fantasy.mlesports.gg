import { prisma } from "@/lib/prisma";

export const TRADE_VETO_WINDOW_MS = 12 * 60 * 60 * 1000;

export function tradeVetoDeadline(acceptedAt: Date): Date {
  return new Date(acceptedAt.getTime() + TRADE_VETO_WINDOW_MS);
}

/**
 * Actually executes an accepted trade: swaps the traded MLE teams between
 * the two fantasy rosters for the league's current week, marks the trade
 * "accepted", and writes the two Transaction history rows. Used both by the
 * 12-hour auto-process sweep and (defensively) inline if a veto attempt
 * arrives after the window has already closed.
 */
export async function executeTrade(tradeId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const trade = await tx.trade.findUnique({ where: { id: tradeId } });
    if (!trade) throw new Error("Trade not found");
    if (trade.status !== "awaiting_veto") return; // already resolved elsewhere

    const league = await tx.fantasyLeague.findUnique({
      where: { id: trade.fantasyLeagueId },
      select: { currentWeek: true },
    });
    if (!league) throw new Error("League not found");
    const currentWeek = league.currentWeek;

    // If either side's offered team got locked in the meantime (e.g. its
    // week started while this trade sat in its 12-hour veto window), don't
    // execute — cancel instead, same as an admin roster edit would.
    const allGives = [
      ...trade.proposerGives.map((mleTeamId) => ({ fantasyTeamId: trade.proposerTeamId, mleTeamId })),
      ...trade.receiverGives.map((mleTeamId) => ({ fantasyTeamId: trade.receiverTeamId, mleTeamId })),
    ];
    for (const { fantasyTeamId, mleTeamId } of allGives) {
      const lockedSlot = await tx.rosterSlot.findFirst({
        where: { fantasyTeamId, mleTeamId, week: currentWeek, isLocked: true },
      });
      if (lockedSlot) {
        await tx.trade.update({
          where: { id: tradeId },
          data: { status: "cancelled", executedAt: new Date() },
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
            status: "cancelled",
            reason: "Cancelled — a team involved became locked before the trade could execute",
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
            status: "cancelled",
            reason: "Cancelled — a team involved became locked before the trade could execute",
            processedAt: new Date(),
          },
        });
        return;
      }
    }

    for (const mleTeamId of trade.proposerGives) {
      const slot = await tx.rosterSlot.findFirst({
        where: { fantasyTeamId: trade.proposerTeamId, mleTeamId, week: currentWeek },
      });
      if (slot) await tx.rosterSlot.delete({ where: { id: slot.id } });
    }

    for (const mleTeamId of trade.receiverGives) {
      const existingSlots = await tx.rosterSlot.findMany({
        where: { fantasyTeamId: trade.proposerTeamId, week: currentWeek },
      });
      const position = "be";
      const slotIndex = existingSlots.filter((s) => s.position === position).length;
      await tx.rosterSlot.create({
        data: {
          id: `${trade.proposerTeamId}-${currentWeek}-${position}-${slotIndex}`,
          fantasyTeamId: trade.proposerTeamId,
          mleTeamId,
          week: currentWeek,
          position,
          slotIndex,
          isLocked: false,
        },
      });
    }

    for (const mleTeamId of trade.receiverGives) {
      const slot = await tx.rosterSlot.findFirst({
        where: { fantasyTeamId: trade.receiverTeamId, mleTeamId, week: currentWeek },
      });
      if (slot) await tx.rosterSlot.delete({ where: { id: slot.id } });
    }

    for (const mleTeamId of trade.proposerGives) {
      const existingSlots = await tx.rosterSlot.findMany({
        where: { fantasyTeamId: trade.receiverTeamId, week: currentWeek },
      });
      const position = "be";
      const slotIndex = existingSlots.filter((s) => s.position === position).length;
      await tx.rosterSlot.create({
        data: {
          id: `${trade.receiverTeamId}-${currentWeek}-${position}-${slotIndex}`,
          fantasyTeamId: trade.receiverTeamId,
          mleTeamId,
          week: currentWeek,
          position,
          slotIndex,
          isLocked: false,
        },
      });
    }

    await tx.trade.update({
      where: { id: tradeId },
      data: { status: "accepted", executedAt: new Date() },
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
        status: "approved",
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
        status: "approved",
        processedAt: new Date(),
      },
    });
  });
}

/**
 * Auto-processes every trade whose 12-hour veto window has expired without
 * an admin veto. There's no cron infrastructure in this app, so this is
 * called lazily from the read paths that display pending trades (the admin
 * transactions panel) — the delay between the window closing and the next
 * page load is imperceptible for a fantasy-sports trade deadline.
 */
export async function processExpiredTradeVetoWindows(): Promise<number> {
  const cutoff = new Date(Date.now() - TRADE_VETO_WINDOW_MS);
  const expired = await prisma.trade.findMany({
    where: { status: "awaiting_veto", acceptedAt: { lte: cutoff } },
    select: { id: true },
  });

  for (const trade of expired) {
    try {
      await executeTrade(trade.id);
    } catch (error) {
      console.error(`Failed to auto-process expired trade ${trade.id}:`, error);
    }
  }

  return expired.length;
}
