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

    // Trade rows reference the other side via tradePartnerTeamId — batch
    // resolve those to real team/manager names instead of a placeholder.
    const partnerTeamIds = [
      ...new Set(
        transactions
          .filter((t) => t.type === "trade" && t.tradePartnerTeamId)
          .map((t) => t.tradePartnerTeamId as string)
      ),
    ];
    const partnerTeams = await prisma.fantasyTeam.findMany({
      where: { id: { in: partnerTeamIds } },
      include: { owner: { select: { displayName: true } } },
    });
    const partnerTeamById = new Map(partnerTeams.map((t) => [t.id, t]));

    // Format transactions
    const formattedTransactions = transactions.map((transaction) => {
      if (transaction.type === "trade") {
        const partner = transaction.tradePartnerTeamId
          ? partnerTeamById.get(transaction.tradePartnerTeamId)
          : undefined;
        return {
          id: transaction.id,
          type: "trade",
          fromTeam: transaction.fantasyTeam.displayName,
          fromManager: transaction.fantasyTeam.owner.displayName,
          toTeam: partner?.displayName ?? "Unknown Team",
          toManager: partner?.owner.displayName ?? "Unknown Manager",
          givingTeams: transaction.dropTeamId ? [transaction.dropTeamId] : [],
          receivingTeams: transaction.addTeamId ? [transaction.addTeamId] : [],
          status: transaction.status === "approved" ? "Accepted" : "Denied",
          timestamp: transaction.processedAt,
        };
      } else {
        // Determine the specific type
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
          addTeamId: transaction.addTeamId,
          dropTeamId: transaction.dropTeamId,
          faabBid: transaction.faabBid,
          status: transaction.status === "approved" ? "Successful" :
                  transaction.status === "denied" ? "Failed - Lower Priority" :
                  transaction.status === "failed" ? "Failed" :
                  "Pending",
          timestamp: transaction.processedAt,
        };
      }
    });

    return NextResponse.json({ transactions: formattedTransactions });
  } catch (error) {
    console.error("Error fetching league transactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}
