import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/leagues/[leagueId]/rosters/[teamId]/pending-transactions
 * Currently-outstanding actions for a team that haven't resolved into a
 * Transaction row yet (see /rosters/[teamId]/transactions for the resolved
 * history log): a pending waiver claim, or a trade still awaiting a
 * response or sitting in its post-accept veto window. Those two live in
 * WaiverClaim/Trade directly, not Transaction, since a Transaction row is
 * only ever written once one of these actually resolves.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;

    const fantasyTeam = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
      select: { id: true, fantasyLeagueId: true },
    });
    if (!fantasyTeam) {
      return NextResponse.json({ error: "Fantasy team not found" }, { status: 404 });
    }
    if (fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json({ error: "Team does not belong to this league" }, { status: 400 });
    }

    const [pendingClaims, pendingTrades] = await Promise.all([
      prisma.waiverClaim.findMany({
        where: { fantasyTeamId: teamId, status: "pending" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.trade.findMany({
        where: {
          OR: [{ proposerTeamId: teamId }, { receiverTeamId: teamId }],
          status: { in: ["pending", "awaiting_veto"] },
        },
        include: {
          proposerTeam: { include: { owner: { select: { displayName: true } } } },
          receiverTeam: { include: { owner: { select: { displayName: true } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const mleTeamIds = new Set<string>();
    pendingClaims.forEach((c) => {
      mleTeamIds.add(c.addTeamId);
      if (c.dropTeamId) mleTeamIds.add(c.dropTeamId);
    });
    pendingTrades.forEach((t) => {
      t.proposerGives.forEach((id) => mleTeamIds.add(id));
      t.receiverGives.forEach((id) => mleTeamIds.add(id));
      t.proposerDrops.forEach((id) => mleTeamIds.add(id));
    });

    const mleTeams = await prisma.mLETeam.findMany({
      where: { id: { in: [...mleTeamIds] } },
      select: { id: true, name: true, leagueId: true, slug: true, logoPath: true },
    });
    const mleTeamMap = new Map(mleTeams.map((t) => [t.id, t]));
    const resolveTeams = (ids: string[]) =>
      ids.map((id) => mleTeamMap.get(id)).filter((t): t is NonNullable<typeof t> => Boolean(t));

    const formattedClaims = pendingClaims.map((claim) => ({
      id: claim.id,
      type: "waiver" as const,
      addTeam: mleTeamMap.get(claim.addTeamId) ?? null,
      dropTeam: claim.dropTeamId ? mleTeamMap.get(claim.dropTeamId) ?? null : null,
      faabBid: claim.faabBid,
      status: "Pending",
      timestamp: claim.createdAt,
    }));

    const formattedTrades = pendingTrades.map((trade) => ({
      id: trade.id,
      type: "trade" as const,
      proposerTeam: trade.proposerTeam.displayName,
      proposerManager: trade.proposerTeam.owner.displayName,
      receiverTeam: trade.receiverTeam.displayName,
      receiverManager: trade.receiverTeam.owner.displayName,
      proposerGivesTeams: resolveTeams(trade.proposerGives),
      receiverGivesTeams: resolveTeams(trade.receiverGives),
      proposerDropsTeams: resolveTeams(trade.proposerDrops),
      status: trade.status === "awaiting_veto" ? "Awaiting veto window" : "Awaiting response",
      timestamp: trade.createdAt,
    }));

    const transactions = [...formattedClaims, ...formattedTrades].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json({ transactions });
  } catch (error) {
    console.error("Error fetching pending transactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch pending transactions" },
      { status: 500 }
    );
  }
}
