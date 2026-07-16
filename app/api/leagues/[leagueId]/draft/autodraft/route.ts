import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/leagues/[leagueId]/draft/autodraft
 * Toggles the caller's own autodraft flag. Purely an informational status —
 * the pick timer always runs its full duration regardless of this flag; it
 * only affects the label shown next to the timer, and it's set to true
 * automatically by lib/draftAutopick.ts whenever a deadline lapses.
 * Body: { enabled: boolean }
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

    const { leagueId } = await params;
    const body = await req.json();
    const { enabled } = body;

    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }

    const team = await prisma.fantasyTeam.findFirst({
      where: { fantasyLeagueId: leagueId, ownerUserId: session.user.id },
      select: { id: true },
    });
    if (!team) {
      return NextResponse.json({ error: "You are not in this league" }, { status: 403 });
    }

    await prisma.fantasyTeam.update({
      where: { id: team.id },
      data: { autodraftEnabled: enabled },
    });

    return NextResponse.json({ success: true, autodraftEnabled: enabled });
  } catch (error) {
    console.error("Error updating autodraft flag:", error);
    return NextResponse.json({ error: "Failed to update autodraft flag" }, { status: 500 });
  }
}
