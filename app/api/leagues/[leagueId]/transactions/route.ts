import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/leagues/[leagueId]/transactions
 * Get all transaction history for a fantasy league
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;

    // Verify the league exists and user has access
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        name: true,
      },
    });

    if (!league) {
      return NextResponse.json(
        { error: "Fantasy league not found" },
        { status: 404 }
      );
    }

    // Get all transactions for this league by joining through fantasy teams
    const transactions = await prisma.transaction.findMany({
      where: {
        fantasyTeam: {
          fantasyLeagueId: leagueId,
        },
      },
      include: {
        fantasyTeam: {
          include: {
            owner: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: {
        processedAt: "desc",
      },
    });

    // Trade-type transactions are created in pairs (one per side) — pull the
    // source Trade rows so we can render one row per trade with both sides'
    // full gives/drops, instead of the partial per-side view stored on
    // Transaction itself.
    const tradeIds = [
      ...new Set(
        transactions
          .filter((t) => t.type === "trade" && t.tradeId)
          .map((t) => t.tradeId as string)
      ),
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

    // Batch-resolve every real MLE team referenced below so the frontend can
    // render real names/logos instead of bare IDs.
    const mleTeamIds = new Set<string>();
    transactions.forEach((t) => {
      if (t.addTeamId) mleTeamIds.add(t.addTeamId);
      if (t.dropTeamId) mleTeamIds.add(t.dropTeamId);
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
    const resolveTeams = (ids: string[]) =>
      ids
        .map((id) => mleTeamMap.get(id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t));

    // Format non-trade transactions (waiver/pickup/drop) directly.
    const nonTradeTransactions = transactions
      .filter((transaction) => transaction.type !== "trade")
      .map((transaction) => {
        let specificType = "pickup";
        if (transaction.type === "waiver") {
          specificType = "waiver";
        } else if (transaction.type === "drop" && !transaction.addTeamId) {
          specificType = "drop";
        } else if (transaction.type === "pickup" || transaction.addTeamId) {
          specificType = "pickup";
        }

        return {
          id: transaction.id,
          type: specificType,
          teamName: transaction.fantasyTeam.displayName,
          username: transaction.fantasyTeam.owner.displayName,
          addTeam: transaction.addTeamId ? mleTeamMap.get(transaction.addTeamId) ?? null : null,
          dropTeam: transaction.dropTeamId ? mleTeamMap.get(transaction.dropTeamId) ?? null : null,
          faabBid: transaction.faabBid,
          status: transaction.status === "approved" ? "Successful" :
                  transaction.status === "denied" ? "Failed - Lower Priority" :
                  transaction.status === "failed" ? "Failed" :
                  "Pending",
          timestamp: transaction.processedAt,
        };
      });

    // Format trade transactions — one row per trade (dedupe the two
    // per-side Transaction rows created at execution time).
    const seenTradeIds = new Set<string>();
    const tradeTransactions = transactions
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
          proposerTeam: proposerTeam?.displayName ?? "Unknown Team",
          proposerManager: proposerTeam?.owner.displayName ?? "Unknown Manager",
          receiverTeam: receiverTeam?.displayName ?? "Unknown Team",
          receiverManager: receiverTeam?.owner.displayName ?? "Unknown Manager",
          proposerGivesTeams: trade ? resolveTeams(trade.proposerGives) : [],
          receiverGivesTeams: trade ? resolveTeams(trade.receiverGives) : [],
          proposerDropsTeams: trade ? resolveTeams(trade.proposerDrops) : [],
          receiverDropsTeams: trade ? resolveTeams(trade.receiverDrops) : [],
          status: transaction.status === "approved" ? "Accepted" : "Denied",
          timestamp: transaction.processedAt,
        };
      });

    const formattedTransactions = [...nonTradeTransactions, ...tradeTransactions].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json({ transactions: formattedTransactions });
  } catch (error) {
    console.error("Error fetching league transactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}
