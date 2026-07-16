import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * PUT /api/leagues/[leagueId]/draft/queue
 * Replaces the caller's own draft queue (ordered list of MLE team IDs,
 * index 0 = top priority) for this league. Consumed by lib/draftAutopick.ts
 * when a pick's timer expires.
 * Body: { mleTeamIds: string[] }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;
    const body = await req.json();
    const { mleTeamIds } = body;

    if (!Array.isArray(mleTeamIds) || !mleTeamIds.every((id) => typeof id === "string")) {
      return NextResponse.json({ error: "mleTeamIds must be an array of strings" }, { status: 400 });
    }

    const team = await prisma.fantasyTeam.findFirst({
      where: { fantasyLeagueId: leagueId, ownerUserId: session.user.id },
      select: { id: true },
    });
    if (!team) {
      return NextResponse.json({ error: "You are not in this league" }, { status: 403 });
    }

    const updated = await prisma.fantasyTeam.update({
      where: { id: team.id },
      data: { draftQueue: mleTeamIds },
      select: { draftQueue: true },
    });

    return NextResponse.json({ success: true, draftQueue: updated.draftQueue });
  } catch (error) {
    console.error("Error updating draft queue:", error);
    return NextResponse.json({ error: "Failed to update draft queue" }, { status: 500 });
  }
}
