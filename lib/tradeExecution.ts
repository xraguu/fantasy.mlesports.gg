import { prisma } from "@/lib/prisma";
import { assignTeamToRosterSlot, getRosterCapacity } from "@/lib/rosterSlotAssignment";
import { markTeamDroppedForWaivers } from "@/lib/waiverPeriods";

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
    if (trade.status !== "awaiting_veto") return { executed: false as const }; // already resolved elsewhere

    const league = await tx.fantasyLeague.findUnique({
      where: { id: trade.fantasyLeagueId },
      select: { currentWeek: true, rosterConfig: true, season: true },
    });
    if (!league) throw new Error("League not found");
    const currentWeek = league.currentWeek;

    // Shared cancellation path — used both when an offered team got locked
    // in the meantime and when a roster no longer has room (see below).
    const cancelTrade = async (reason: string) => {
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
          reason,
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
          reason,
          processedAt: new Date(),
        },
      });
    };

    // Every team involved (either side's gives, or a team the proposer
    // picked to drop to make room) must still actually be sitting on the
    // roster it was on when the trade was proposed — a manager can freely
    // drop/trade/lose a team through some other route while this trade sits
    // in its 12-hour veto window, and once that's happened this trade's
    // terms no longer make sense (e.g. the "drop" leg would silently become
    // a no-op, letting the receiving side's incoming team overflow the
    // roster). Same for a team that's still there but got locked in the
    // meantime (its week started). Either way: cancel, don't execute.
    const allGives = [
      ...trade.proposerGives.map((mleTeamId) => ({ fantasyTeamId: trade.proposerTeamId, mleTeamId })),
      ...trade.receiverGives.map((mleTeamId) => ({ fantasyTeamId: trade.receiverTeamId, mleTeamId })),
      ...trade.proposerDrops.map((mleTeamId) => ({ fantasyTeamId: trade.proposerTeamId, mleTeamId })),
      ...trade.receiverDrops.map((mleTeamId) => ({ fantasyTeamId: trade.receiverTeamId, mleTeamId })),
    ];
    for (const { fantasyTeamId, mleTeamId } of allGives) {
      const slot = await tx.rosterSlot.findFirst({
        where: { fantasyTeamId, mleTeamId, week: currentWeek },
      });
      if (!slot) {
        await cancelTrade("Cancelled — a team involved is no longer on the roster it was on when the trade was proposed");
        return { executed: false as const };
      }
      if (slot.isLocked) {
        await cancelTrade("Cancelled — a team involved became locked before the trade could execute");
        return { executed: false as const };
      }
    }

    // Re-check roster capacity right before executing — this was already
    // validated when the trade was proposed, but the 12-hour veto window
    // gives plenty of time for either roster to fill up in the meantime
    // (a waiver claim, another trade), and assignTeamToRosterSlot's
    // capacity-overflow fallback (an extra unrenderable bench slot) is only
    // meant to be unreachable, not a real fallback path.
    const capacity = getRosterCapacity(league.rosterConfig);
    const [proposerCount, receiverCount] = await Promise.all([
      tx.rosterSlot.count({ where: { fantasyTeamId: trade.proposerTeamId, week: currentWeek } }),
      tx.rosterSlot.count({ where: { fantasyTeamId: trade.receiverTeamId, week: currentWeek } }),
    ]);
    const proposerAfter =
      proposerCount - trade.proposerGives.length - trade.proposerDrops.length + trade.receiverGives.length;
    const receiverAfter =
      receiverCount - trade.receiverGives.length - trade.receiverDrops.length + trade.proposerGives.length;
    if (proposerAfter > capacity || receiverAfter > capacity) {
      await cancelTrade("Cancelled — a roster no longer had room for this trade by the time it was set to execute");
      return { executed: false as const };
    }

    // Remove each side's outgoing teams first, so the incoming teams below
    // land in the freed-up slots (via assignTeamToRosterSlot's priority-
    // order empty-slot search) instead of always being pushed to the bench
    // regardless of what position they're replacing — and never past the
    // league's configured slot counts, which used to silently create
    // roster rows My Roster could never render.
    for (const mleTeamId of trade.proposerGives) {
      const slot = await tx.rosterSlot.findFirst({
        where: { fantasyTeamId: trade.proposerTeamId, mleTeamId, week: currentWeek },
      });
      if (slot) await tx.rosterSlot.delete({ where: { id: slot.id } });
    }
    for (const mleTeamId of trade.receiverGives) {
      const slot = await tx.rosterSlot.findFirst({
        where: { fantasyTeamId: trade.receiverTeamId, mleTeamId, week: currentWeek },
      });
      if (slot) await tx.rosterSlot.delete({ where: { id: slot.id } });
    }
    // Teams the proposer chose to drop to make room don't go to anyone —
    // they're just removed, same as a manual roster drop, and enter the
    // same post-drop waiver clearance window. Marked inside this same
    // transaction (not as a separate call after commit) so there's no gap
    // where the slot's gone but the team doesn't look "on waivers" yet for
    // a concurrent add request to slip through.
    for (const mleTeamId of trade.proposerDrops) {
      const slot = await tx.rosterSlot.findFirst({
        where: { fantasyTeamId: trade.proposerTeamId, mleTeamId, week: currentWeek },
      });
      if (slot) await tx.rosterSlot.delete({ where: { id: slot.id } });
      await markTeamDroppedForWaivers(trade.fantasyLeagueId, mleTeamId, tx);
    }
    // Teams the receiver chose to drop at accept time to make room — same
    // treatment as proposerDrops, just picked later in the trade's lifecycle.
    for (const mleTeamId of trade.receiverDrops) {
      const slot = await tx.rosterSlot.findFirst({
        where: { fantasyTeamId: trade.receiverTeamId, mleTeamId, week: currentWeek },
      });
      if (slot) await tx.rosterSlot.delete({ where: { id: slot.id } });
      await markTeamDroppedForWaivers(trade.fantasyLeagueId, mleTeamId, tx);
    }

    for (const mleTeamId of trade.receiverGives) {
      await assignTeamToRosterSlot(tx, {
        fantasyTeamId: trade.proposerTeamId,
        week: currentWeek,
        mleTeamId,
        rosterConfig: league.rosterConfig,
        season: league.season,
      });
    }
    for (const mleTeamId of trade.proposerGives) {
      await assignTeamToRosterSlot(tx, {
        fantasyTeamId: trade.receiverTeamId,
        week: currentWeek,
        mleTeamId,
        rosterConfig: league.rosterConfig,
        season: league.season,
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

    return { executed: true as const };
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
