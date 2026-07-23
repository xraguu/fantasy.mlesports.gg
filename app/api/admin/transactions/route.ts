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

    // For trade-type history rows we need the full gives/drops from both
    // sides — Transaction only stores what it received (tradePartnerGave),
    // so pull the source Trade rows to get the other side.
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
        proposerDrops: true,
        receiverDrops: true,
      },
    });
    const tradeMap = new Map(relatedTrades.map((t) => [t.id, t]));

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
      t.proposerDrops.forEach((id) => mleTeamIds.add(id));
      t.receiverDrops.forEach((id) => mleTeamIds.add(id));
    });
    transactionHistory.forEach((tx) => {
      if (tx.addTeamId) mleTeamIds.add(tx.addTeamId);
      if (tx.dropTeamId) mleTeamIds.add(tx.dropTeamId);
      tx.tradePartnerGave.forEach((id) => mleTeamIds.add(id));
    });
    relatedTrades.forEach((t) => {
      t.proposerGives.forEach((id) => mleTeamIds.add(id));
      t.receiverGives.forEach((id) => mleTeamIds.add(id));
      t.proposerDrops.forEach((id) => mleTeamIds.add(id));
      t.receiverDrops.forEach((id) => mleTeamIds.add(id));
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

    // Need both sides' team/manager names to render one merged row per
    // trade in history, instead of the two per-side Transaction rows.
    const tradeTeamIds = new Set<string>();
    relatedTrades.forEach((t) => {
      tradeTeamIds.add(t.proposerTeamId);
      tradeTeamIds.add(t.receiverTeamId);
    });
    const tradeFantasyTeams = await prisma.fantasyTeam.findMany({
      where: { id: { in: [...tradeTeamIds] } },
      include: { owner: { select: { displayName: true } } },
    });
    const tradeFantasyTeamById = new Map(tradeFantasyTeams.map((t) => [t.id, t]));

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
      proposerDropsTeams: trade.proposerDrops
        .map((id) => mleTeamMap.get(id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t)),
      receiverDropsTeams: trade.receiverDrops
        .map((id) => mleTeamMap.get(id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t)),
      status: trade.status,
      submitted: trade.createdAt,
      acceptedAt: trade.acceptedAt,
      vetoDeadline: trade.acceptedAt ? tradeVetoDeadline(trade.acceptedAt) : null,
    }));

    // Format non-trade transaction history (waiver/pickup/drop) directly.
    const nonTradeHistory = transactionHistory
      .filter((transaction) => transaction.type !== "trade")
      .map((transaction) => ({
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
      }));

    // Trade-type transactions are created in pairs (one per side) — dedupe
    // to a single merged row per trade showing both sides at once.
    const seenTradeIds = new Set<string>();
    const tradeHistory = transactionHistory
      .filter((transaction) => transaction.type === "trade" && transaction.tradeId)
      .filter((transaction) => {
        const tradeId = transaction.tradeId as string;
        if (seenTradeIds.has(tradeId)) return false;
        seenTradeIds.add(tradeId);
        return true;
      })
      .map((transaction) => {
        const trade = tradeMap.get(transaction.tradeId as string);
        const proposerTeam = trade ? tradeFantasyTeamById.get(trade.proposerTeamId) : undefined;
        const receiverTeam = trade ? tradeFantasyTeamById.get(trade.receiverTeamId) : undefined;

        return {
          id: transaction.id,
          type: "trade" as const,
          fantasyLeague: transaction.league.id,
          fantasyLeagueName: transaction.league.name,
          proposer: proposerTeam?.owner.displayName ?? "Unknown Manager",
          proposerTeam: proposerTeam?.displayName ?? "Unknown Team",
          receiver: receiverTeam?.owner.displayName ?? "Unknown Manager",
          receiverTeam: receiverTeam?.displayName ?? "Unknown Team",
          proposerGivesTeams: trade
            ? trade.proposerGives.map((id) => mleTeamMap.get(id)).filter((t): t is NonNullable<typeof t> => Boolean(t))
            : [],
          receiverGivesTeams: trade
            ? trade.receiverGives.map((id) => mleTeamMap.get(id)).filter((t): t is NonNullable<typeof t> => Boolean(t))
            : [],
          proposerDropsTeams: trade
            ? trade.proposerDrops.map((id) => mleTeamMap.get(id)).filter((t): t is NonNullable<typeof t> => Boolean(t))
            : [],
          receiverDropsTeams: trade
            ? trade.receiverDrops.map((id) => mleTeamMap.get(id)).filter((t): t is NonNullable<typeof t> => Boolean(t))
            : [],
          status: transaction.status,
          processed: transaction.processedAt,
          reason: transaction.reason,
        };
      });

    const formattedHistory = [...nonTradeHistory, ...tradeHistory].sort(
      (a, b) => new Date(b.processed).getTime() - new Date(a.processed).getTime()
    );

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
