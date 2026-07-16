import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { processExpiredTradeVetoWindows, tradeVetoDeadline } from "@/lib/tradeExecution";

/**
 * GET /api/admin/transactions
 * Get all transactions (waivers, trades, history) for admin panel
 * Query params: ?leagueId=optional
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
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    // Auto-process any trades whose 12-hour veto window has closed since
    // the last time anyone loaded this page — keeps the list below accurate.
    await processExpiredTradeVetoWindows();

    const url = new URL(req.url);
    const leagueId = url.searchParams.get("leagueId");

    // Get all fantasy leagues
    const leagues = await prisma.fantasyLeague.findMany({
      select: {
        id: true,
        name: true,
        season: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Build where clause for filtering by league
    const leagueFilter = leagueId ? { fantasyLeagueId: leagueId } : {};

    // Get pending waiver claims
    const pendingWaivers = await prisma.waiverClaim.findMany({
      where: {
        ...leagueFilter,
        status: "pending",
      },
      include: {
        fantasyTeam: {
          select: {
            displayName: true,
          },
        },
        user: {
          select: {
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
      orderBy: {
        priority: "asc",
      },
    });

    // Get pending trades (genuinely pending, awaiting receiver response) and
    // trades awaiting an admin veto within their 12-hour window
    const pendingTrades = await prisma.trade.findMany({
      where: {
        ...leagueFilter,
        status: { in: ["pending", "awaiting_veto"] },
      },
      include: {
        proposerTeam: {
          select: {
            displayName: true,
          },
        },
        receiverTeam: {
          select: {
            displayName: true,
          },
        },
        proposer: {
          select: {
            displayName: true,
          },
        },
        receiver: {
          select: {
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
      orderBy: {
        createdAt: "desc",
      },
    });

    // Get transaction history from Transaction table
    const transactionHistory = await prisma.transaction.findMany({
      where: leagueFilter,
      include: {
        fantasyTeam: {
          select: {
            displayName: true,
          },
        },
        user: {
          select: {
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
      orderBy: {
        processedAt: "desc",
      },
      take: 50,
    });

    // Batch-resolve every real MLE team referenced anywhere below, so the
    // frontend can render real names/logos instead of bare IDs.
    const mleTeamIds = new Set<string>();
    pendingWaivers.forEach((c) => {
      if (c.addTeamId) mleTeamIds.add(c.addTeamId);
      if (c.dropTeamId) mleTeamIds.add(c.dropTeamId);
    });
    pendingTrades.forEach((t) => {
      t.proposerGives.forEach((id) => mleTeamIds.add(id));
      t.receiverGives.forEach((id) => mleTeamIds.add(id));
    });
    transactionHistory.forEach((tx) => {
      if (tx.addTeamId) mleTeamIds.add(tx.addTeamId);
      if (tx.dropTeamId) mleTeamIds.add(tx.dropTeamId);
      tx.tradePartnerGave.forEach((id) => mleTeamIds.add(id));
    });

    const mleTeams = await prisma.mLETeam.findMany({
      where: { id: { in: [...mleTeamIds] } },
      select: {
        id: true,
        name: true,
        leagueId: true,
        slug: true,
        logoPath: true,
        primaryColor: true,
        secondaryColor: true,
      },
    });
    const mleTeamMap = new Map(mleTeams.map((t) => [t.id, t]));

    // For trade-type history rows we also need "what this team gave" —
    // Transaction only stores what it received (tradePartnerGave), so pull
    // the source Trade rows to get the other side.
    const tradeIds = [
      ...new Set(transactionHistory.filter((tx) => tx.tradeId).map((tx) => tx.tradeId!)),
    ];
    const relatedTrades = await prisma.trade.findMany({
      where: { id: { in: tradeIds } },
      select: {
        id: true,
        proposerTeamId: true,
        receiverTeamId: true,
        proposerGives: true,
        receiverGives: true,
      },
    });
    const tradeMap = new Map(relatedTrades.map((t) => [t.id, t]));

    // Format pending waivers
    const formattedPendingWaivers = pendingWaivers.map((claim) => ({
      id: claim.id,
      priority: claim.priority,
      manager: claim.user.displayName,
      teamName: claim.fantasyTeam.displayName,
      fantasyLeague: claim.league.id,
      fantasyLeagueName: claim.league.name,
      addTeam: claim.addTeamId ? mleTeamMap.get(claim.addTeamId) ?? null : null,
      dropTeam: claim.dropTeamId ? mleTeamMap.get(claim.dropTeamId) ?? null : null,
      faabBid: claim.faabBid,
      status: claim.status,
      submitted: claim.createdAt,
    }));

    // Format pending trades
    const formattedPendingTrades = pendingTrades.map((trade) => ({
      id: trade.id,
      fantasyLeague: trade.league.id,
      fantasyLeagueName: trade.league.name,
      proposer: trade.proposer.displayName,
      proposerTeam: trade.proposerTeam.displayName,
      receiver: trade.receiver.displayName,
      receiverTeam: trade.receiverTeam.displayName,
      proposerGivesTeams: trade.proposerGives
        .map((id) => mleTeamMap.get(id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t)),
      receiverGivesTeams: trade.receiverGives
        .map((id) => mleTeamMap.get(id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t)),
      status: trade.status,
      submitted: trade.createdAt,
      acceptedAt: trade.acceptedAt,
      vetoDeadline: trade.acceptedAt ? tradeVetoDeadline(trade.acceptedAt) : null,
    }));

    // Format transaction history
    const formattedHistory = transactionHistory.map((transaction) => {
      const base = {
        id: transaction.id,
        type: transaction.type,
        fantasyLeague: transaction.league.id,
        fantasyLeagueName: transaction.league.name,
        manager: transaction.user.displayName,
        teamName: transaction.fantasyTeam.displayName,
        addTeam: transaction.addTeamId ? mleTeamMap.get(transaction.addTeamId) ?? null : null,
        dropTeam: transaction.dropTeamId ? mleTeamMap.get(transaction.dropTeamId) ?? null : null,
        status: transaction.status,
        processed: transaction.processedAt,
        reason: transaction.reason,
      };

      if (transaction.type === "trade" && transaction.tradeId) {
        const trade = tradeMap.get(transaction.tradeId);
        const gaveIds = trade
          ? transaction.fantasyTeamId === trade.proposerTeamId
            ? trade.proposerGives
            : trade.receiverGives
          : [];
        return {
          ...base,
          tradeGaveTeams: gaveIds
            .map((id) => mleTeamMap.get(id))
            .filter((t): t is NonNullable<typeof t> => Boolean(t)),
          tradeReceivedTeams: transaction.tradePartnerGave
            .map((id) => mleTeamMap.get(id))
            .filter((t): t is NonNullable<typeof t> => Boolean(t)),
        };
      }

      return base;
    });

    return NextResponse.json({
      leagues,
      pendingWaivers: formattedPendingWaivers,
      pendingTrades: formattedPendingTrades,
      transactionHistory: formattedHistory,
    });
  } catch (error) {
    console.error("Error fetching admin transactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}
