import { prisma } from "@/lib/prisma";

/**
 * When an admin adds or drops an MLE team from a fantasy roster, any pending
 * trade or waiver claim referencing that same MLE team no longer makes
 * sense (it may no longer be available, or may already be on the roster it
 * was about to move to) — cancel them rather than let them execute later
 * against a roster the admin just changed out from under them.
 */
export async function cancelPendingTransactionsForMleTeam(
  leagueId: string,
  mleTeamId: string
): Promise<void> {
  const claims = await prisma.waiverClaim.findMany({
    where: {
      fantasyLeagueId: leagueId,
      status: "pending",
      OR: [{ addTeamId: mleTeamId }, { dropTeamId: mleTeamId }],
    },
  });
  for (const claim of claims) {
    await prisma.waiverClaim.update({
      where: { id: claim.id },
      data: { status: "denied", processedAt: new Date() },
    });
    await prisma.transaction.create({
      data: {
        fantasyLeagueId: leagueId,
        fantasyTeamId: claim.fantasyTeamId,
        userId: claim.userId,
        type: "waiver",
        addTeamId: claim.addTeamId,
        dropTeamId: claim.dropTeamId,
        waiverClaimId: claim.id,
        status: "denied",
        reason: "Cancelled — an admin modified a roster involving this team",
        processedAt: new Date(),
      },
    });
  }

  const trades = await prisma.trade.findMany({
    where: {
      fantasyLeagueId: leagueId,
      status: { in: ["pending", "awaiting_veto"] },
      OR: [{ proposerGives: { has: mleTeamId } }, { receiverGives: { has: mleTeamId } }],
    },
  });
  for (const trade of trades) {
    await prisma.trade.update({
      where: { id: trade.id },
      data: { status: "cancelled", executedAt: new Date() },
    });
    await prisma.transaction.create({
      data: {
        fantasyLeagueId: leagueId,
        fantasyTeamId: trade.proposerTeamId,
        userId: trade.proposerUserId,
        type: "trade",
        tradeId: trade.id,
        tradePartnerTeamId: trade.receiverTeamId,
        tradePartnerGave: trade.receiverGives,
        status: "cancelled",
        reason: "Cancelled — an admin modified a roster involved in this trade",
        processedAt: new Date(),
      },
    });
    await prisma.transaction.create({
      data: {
        fantasyLeagueId: leagueId,
        fantasyTeamId: trade.receiverTeamId,
        userId: trade.receiverUserId,
        type: "trade",
        tradeId: trade.id,
        tradePartnerTeamId: trade.proposerTeamId,
        tradePartnerGave: trade.proposerGives,
        status: "cancelled",
        reason: "Cancelled — an admin modified a roster involved in this trade",
        processedAt: new Date(),
      },
    });
  }
}
