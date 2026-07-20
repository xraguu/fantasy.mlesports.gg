import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { processExpiredTradeVetoWindows, tradeVetoDeadline } from "@/lib/tradeExecution";

/**
 * GET /api/leagues/[leagueId]/trades
 * Get all trades involving the current user's team
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

    // Auto-process any trades whose 12-hour veto window has closed since
    // the last time anyone loaded this page.
    await processExpiredTradeVetoWindows();

    const { leagueId } = await params;
    const url = new URL(req.url);
    const teamId = url.searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json(
        { error: "teamId query parameter is required" },
        { status: 400 }
      );
    }

    // Verify the fantasy team exists and user has access
    const fantasyTeam = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        fantasyLeagueId: true,
        ownerUserId: true,
        displayName: true,
        owner: {
          select: {
            displayName: true,
          },
        },
      },
    });

    if (!fantasyTeam) {
      return NextResponse.json(
        { error: "Fantasy team not found" },
        { status: 404 }
      );
    }

    if (fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Team does not belong to this league" },
        { status: 400 }
      );
    }

    // Get all trades where this team is either proposer or receiver
    const trades = await prisma.trade.findMany({
      where: {
        fantasyLeagueId: leagueId,
        OR: [
          { proposerTeamId: teamId },
          { receiverTeamId: teamId },
        ],
      },
      include: {
        proposerTeam: {
          include: {
            owner: {
              select: {
                displayName: true,
              },
            },
          },
        },
        receiverTeam: {
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
        createdAt: "desc",
      },
    });

    // Format trades with team information
    const formattedTrades = await Promise.all(
      trades.map(async (trade) => {
        // Get MLE team details for proposer gives
        const proposerGivesTeams = await prisma.mLETeam.findMany({
          where: {
            id: {
              in: trade.proposerGives as string[],
            },
          },
          select: {
            id: true,
            name: true,
            leagueId: true,
            logoPath: true,
          },
        });

        // Get MLE team details for receiver gives
        const receiverGivesTeams = await prisma.mLETeam.findMany({
          where: {
            id: {
              in: trade.receiverGives as string[],
            },
          },
          select: {
            id: true,
            name: true,
            leagueId: true,
            logoPath: true,
          },
        });

        // Teams the proposer is dropping (not giving to the receiver) to
        // make room for this trade.
        const proposerDropsTeams = await prisma.mLETeam.findMany({
          where: {
            id: {
              in: trade.proposerDrops as string[],
            },
          },
          select: {
            id: true,
            name: true,
            leagueId: true,
            logoPath: true,
          },
        });

        const isProposer = trade.proposerTeamId === teamId;

        return {
          id: trade.id,
          status: trade.status,
          createdAt: trade.createdAt,
          acceptedAt: trade.acceptedAt,
          vetoDeadline: trade.acceptedAt ? tradeVetoDeadline(trade.acceptedAt) : null,
          isProposer,
          proposer: {
            teamId: trade.proposerTeamId,
            teamName: trade.proposerTeam.displayName,
            managerName: trade.proposerTeam.owner.displayName,
            gives: proposerGivesTeams.map((team) => ({
              id: team.id,
              name: `${team.leagueId} ${team.name}`,
              logoPath: team.logoPath,
            })),
            drops: proposerDropsTeams.map((team) => ({
              id: team.id,
              name: `${team.leagueId} ${team.name}`,
              logoPath: team.logoPath,
            })),
          },
          receiver: {
            teamId: trade.receiverTeamId,
            teamName: trade.receiverTeam.displayName,
            managerName: trade.receiverTeam.owner.displayName,
            gives: receiverGivesTeams.map((team) => ({
              id: team.id,
              name: `${team.leagueId} ${team.name}`,
              logoPath: team.logoPath,
            })),
          },
        };
      })
    );

    return NextResponse.json({ trades: formattedTrades });
  } catch (error) {
    console.error("Error fetching trades:", error);
    return NextResponse.json(
      { error: "Failed to fetch trades" },
      { status: 500 }
    );
  }
}
