import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWaiverTeamIdsForLeague } from "@/lib/waiverPeriods";
import { runWaiverProcessingSweep } from "@/lib/waiverProcessing";

/**
 * GET /api/leagues/[leagueId]/waivers
 * Get pending waiver claims for a league.
 * Query params: ?mine=true restricts results to the current session's own
 * claims (used by the My Roster "Waivers" tab — pending claims are private
 * to the manager who submitted them). Without it, returns every pending
 * claim in the league (used to compute "on waivers" team status elsewhere).
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
    await runWaiverProcessingSweep(leagueId);

    const url = new URL(req.url);
    const mineOnly = url.searchParams.get("mine") === "true";

    const waiverClaims = await prisma.waiverClaim.findMany({
      where: {
        fantasyLeagueId: leagueId,
        status: "pending",
        ...(mineOnly ? { userId: session.user.id } : {}),
      },
      orderBy: {
        priority: "asc",
      },
    });

    if (!mineOnly) {
      // Teams still sitting in the post-drop waiver clearance window (see
      // TeamWaiverPeriod) also show as "on waivers" even without a pending
      // claim against them yet — merged in for the team-portal status column.
      const waiverPeriodTeamIds = [...(await getWaiverTeamIdsForLeague(leagueId))];
      return NextResponse.json({ waiverClaims, waiverPeriodTeamIds });
    }

    // "Mine" mode is used by the My Roster Waivers tab, which needs
    // display-ready team info rather than bare IDs.
    const mleTeamIds = new Set<string>();
    waiverClaims.forEach((c) => {
      mleTeamIds.add(c.addTeamId);
      if (c.dropTeamId) mleTeamIds.add(c.dropTeamId);
    });
    const mleTeams = await prisma.mLETeam.findMany({
      where: { id: { in: [...mleTeamIds] } },
      select: { id: true, name: true, leagueId: true, slug: true, logoPath: true },
    });
    const mleTeamMap = new Map(mleTeams.map((t) => [t.id, t]));

    const enrichedClaims = waiverClaims.map((c) => ({
      ...c,
      addTeam: mleTeamMap.get(c.addTeamId) ?? null,
      dropTeam: c.dropTeamId ? mleTeamMap.get(c.dropTeamId) ?? null : null,
    }));

    return NextResponse.json({ waiverClaims: enrichedClaims });
  } catch (error) {
    console.error("Error fetching waiver claims:", error);
    return NextResponse.json(
      { error: "Failed to fetch waiver claims" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/leagues/[leagueId]/waivers
 * Submit a new waiver claim
 * Body: { fantasyTeamId: string, addTeamId: string, dropTeamId?: string, faabBid?: number }
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
        { error: "Suspended users cannot submit waiver claims" },
        { status: 403 }
      );
    }

    const { leagueId } = await params;
    const body = await req.json();
    const { fantasyTeamId, addTeamId, dropTeamId, faabBid } = body;

    // Validate required fields
    if (!fantasyTeamId || !addTeamId) {
      return NextResponse.json(
        { error: "Missing required fields: fantasyTeamId, addTeamId" },
        { status: 400 }
      );
    }

    // Verify the fantasy team exists and user owns it
    const fantasyTeam = await prisma.fantasyTeam.findUnique({
      where: { id: fantasyTeamId },
      select: {
        id: true,
        fantasyLeagueId: true,
        ownerUserId: true,
        waiverPriority: true,
        faabRemaining: true,
        league: { select: { currentWeek: true, draftStatus: true, waiverSystem: true } },
      },
    });

    if (!fantasyTeam) {
      return NextResponse.json(
        { error: "Fantasy team not found" },
        { status: 404 }
      );
    }

    if (fantasyTeam.ownerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "You don't own this team" },
        { status: 403 }
      );
    }

    if (fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Team does not belong to this league" },
        { status: 400 }
      );
    }

    if (fantasyTeam.league.draftStatus !== "completed") {
      return NextResponse.json(
        { error: "Waiver claims are not allowed until the draft is complete" },
        { status: 403 }
      );
    }

    if (fantasyTeam.league.waiverSystem === "faab") {
      const bid = Number(faabBid);
      if (!Number.isFinite(bid) || bid < 0 || !Number.isInteger(bid)) {
        return NextResponse.json(
          { error: "A whole-dollar FAAB bid is required for this league" },
          { status: 400 }
        );
      }
      if (bid > (fantasyTeam.faabRemaining ?? 0)) {
        return NextResponse.json(
          { error: `Bid exceeds your remaining FAAB budget ($${fantasyTeam.faabRemaining ?? 0})` },
          { status: 400 }
        );
      }
    }

    // A team can't have two pending claims on the same MLE team at once —
    // pick a different drop target/bid by cancelling the existing claim
    // first (My Roster → Waivers tab) rather than stacking a second one
    // that would just compete against itself once claims process.
    const existingClaim = await prisma.waiverClaim.findFirst({
      where: { fantasyTeamId, addTeamId, status: "pending" },
    });
    if (existingClaim) {
      return NextResponse.json(
        { error: "You already have a pending claim for this team — cancel it first if you want to change it" },
        { status: 400 }
      );
    }

    // Note: unlike trades/direct drops, a waiver claim can be submitted even
    // if dropTeamId is currently in a locked slot — managers can queue
    // claims up over the weekend while games are locking in, ready to run
    // the moment the new week starts. The lock is only enforced when the
    // claim is actually processed (see app/api/admin/waivers/process).
    // Create waiver claim
    const waiverClaim = await prisma.waiverClaim.create({
      data: {
        fantasyLeagueId: leagueId,
        fantasyTeamId,
        userId: session.user.id,
        addTeamId,
        dropTeamId: dropTeamId || null,
        faabBid: fantasyTeam.league.waiverSystem === "faab" ? Number(faabBid) : null,
        priority: fantasyTeam.waiverPriority || 999,
        status: "pending",
      },
    });

    return NextResponse.json({
      success: true,
      waiverClaim,
    });
  } catch (error) {
    console.error("Error creating waiver claim:", error);
    return NextResponse.json(
      { error: "Failed to create waiver claim" },
      { status: 500 }
    );
  }
}
