import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTradeCutoff } from "@/lib/tradeCutoff";
import { findLockedSlotForTeam, lockedTeamErrorMessage } from "@/lib/rosterLocks";

/**
 * POST /api/leagues/[leagueId]/trades/propose
 * Propose a new trade
 * Body: { proposerTeamId: string, receiverTeamId: string, proposerGives: string[], receiverGives: string[] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { status: true },
    });
    if (user?.status === "suspended") {
      return NextResponse.json(
        { error: "Suspended users cannot propose trades" },
        { status: 403 }
      );
    }

    const { leagueId } = await params;

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: { draftStatus: true, currentWeek: true },
    });
    if (league?.draftStatus !== "completed") {
      return NextResponse.json(
        { error: "Trades are not allowed until the draft is complete" },
        { status: 403 }
      );
    }

    const tradeCutoff = await getTradeCutoff(leagueId);
    if (tradeCutoff && new Date() > tradeCutoff) {
      return NextResponse.json(
        { error: "The trade deadline has passed for this league" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { proposerTeamId, receiverTeamId, proposerGives, receiverGives } = body;

    // Validate required fields
    if (!proposerTeamId || !receiverTeamId || !proposerGives || !receiverGives) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Verify proposer team exists and user owns it
    const proposerTeam = await prisma.fantasyTeam.findUnique({
      where: { id: proposerTeamId },
      select: {
        id: true,
        fantasyLeagueId: true,
        ownerUserId: true,
      },
    });

    if (!proposerTeam) {
      return NextResponse.json(
        { error: "Proposer team not found" },
        { status: 404 }
      );
    }

    if (proposerTeam.ownerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "You don't own the proposer team" },
        { status: 403 }
      );
    }

    if (proposerTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Proposer team does not belong to this league" },
        { status: 400 }
      );
    }

    // Verify receiver team exists and is in same league
    const receiverTeam = await prisma.fantasyTeam.findUnique({
      where: { id: receiverTeamId },
      select: {
        id: true,
        fantasyLeagueId: true,
        ownerUserId: true,
      },
    });

    if (!receiverTeam) {
      return NextResponse.json(
        { error: "Receiver team not found" },
        { status: 404 }
      );
    }

    if (receiverTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Receiver team does not belong to this league" },
        { status: 400 }
      );
    }

    // Neither side can offer up a team that's currently locked in
    const currentWeek = league?.currentWeek ?? 1;

    for (const mleTeamId of proposerGives as string[]) {
      const lockedSlot = await findLockedSlotForTeam(proposerTeamId, currentWeek, mleTeamId);
      if (lockedSlot) {
        return NextResponse.json(
          { error: lockedTeamErrorMessage(lockedSlot.mleTeam) },
          { status: 400 }
        );
      }
    }
    for (const mleTeamId of receiverGives as string[]) {
      const lockedSlot = await findLockedSlotForTeam(receiverTeamId, currentWeek, mleTeamId);
      if (lockedSlot) {
        return NextResponse.json(
          { error: lockedTeamErrorMessage(lockedSlot.mleTeam) },
          { status: 400 }
        );
      }
    }

    // Create trade
    const trade = await prisma.trade.create({
      data: {
        fantasyLeagueId: leagueId,
        proposerTeamId,
        receiverTeamId,
        proposerUserId: session.user.id,
        receiverUserId: receiverTeam.ownerUserId,
        proposerGives,
        receiverGives,
        status: "pending",
      },
    });

    return NextResponse.json({
      success: true,
      trade,
    });
  } catch (error) {
    console.error("Error proposing trade:", error);
    return NextResponse.json(
      { error: "Failed to propose trade" },
      { status: 500 }
    );
  }
}
