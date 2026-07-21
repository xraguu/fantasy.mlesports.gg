import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTradeCutoff } from "@/lib/tradeCutoff";
import { findLockedSlotForTeam, lockedTeamErrorMessage } from "@/lib/rosterLocks";
import { getRosterCapacity } from "@/lib/rosterSlotAssignment";
import { isWeekLocked } from "@/lib/autoLock";

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
      select: { draftStatus: true, currentWeek: true, rosterConfig: true, season: true },
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

    // Blocked for the same live window a manager's active lineup is locked
    // in (the current week's configured match-weekend dates) — a trade
    // shouldn't be able to be negotiated or locked in while that weekend's
    // real results are already playing out.
    if (league && (await isWeekLocked(league.season, league.currentWeek))) {
      return NextResponse.json(
        { error: "Trades can't be proposed during the match weekend — try again once this week's matches are over." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { proposerTeamId, receiverTeamId, proposerGives, receiverGives, proposerDrops = [] } = body;

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
    for (const mleTeamId of proposerDrops as string[]) {
      const lockedSlot = await findLockedSlotForTeam(proposerTeamId, currentWeek, mleTeamId);
      if (lockedSlot) {
        return NextResponse.json(
          { error: lockedTeamErrorMessage(lockedSlot.mleTeam) },
          { status: 400 }
        );
      }
    }

    // A team the proposer picked to drop (to make room) has to actually be
    // on their roster right now, and can't also be one they're giving away
    // in the trade itself — those are two different, mutually exclusive
    // outcomes for the same team.
    if ((proposerDrops as string[]).some((id) => (proposerGives as string[]).includes(id))) {
      return NextResponse.json(
        { error: "A team can't be both given away and dropped in the same trade" },
        { status: 400 }
      );
    }
    if ((proposerDrops as string[]).length > 0) {
      const proposerRosterTeamIds = new Set(
        (
          await prisma.rosterSlot.findMany({
            where: { fantasyTeamId: proposerTeamId, week: currentWeek },
            select: { mleTeamId: true },
          })
        ).map((s) => s.mleTeamId)
      );
      const notOnRoster = (proposerDrops as string[]).find((id) => !proposerRosterTeamIds.has(id));
      if (notOnRoster) {
        return NextResponse.json(
          { error: "One of the teams selected to drop isn't on your roster" },
          { status: 400 }
        );
      }
    }

    // Neither side can end up with more teams than their roster has slots
    // for. Checked here (not just left to execution time) so a proposal
    // that's invalid on arrival never sits around waiting to be accepted.
    // proposerDrops don't go to the receiver — they're just removed — so
    // they count against the proposer's post-trade total but not the
    // receiver's.
    const capacity = getRosterCapacity(league?.rosterConfig);
    const [proposerCount, receiverCount] = await Promise.all([
      prisma.rosterSlot.count({ where: { fantasyTeamId: proposerTeamId, week: currentWeek } }),
      prisma.rosterSlot.count({ where: { fantasyTeamId: receiverTeamId, week: currentWeek } }),
    ]);
    const proposerAfter =
      proposerCount - (proposerGives as string[]).length - (proposerDrops as string[]).length + (receiverGives as string[]).length;
    const receiverAfter = receiverCount - (receiverGives as string[]).length + (proposerGives as string[]).length;

    if (proposerAfter > capacity) {
      return NextResponse.json(
        { error: "This trade would leave your roster with more teams than it has slots for. Drop a team first, or offer up more in return." },
        { status: 400 }
      );
    }
    if (receiverAfter > capacity) {
      return NextResponse.json(
        { error: "This trade would leave the other manager's roster with more teams than it has slots for." },
        { status: 400 }
      );
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
        proposerDrops,
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
