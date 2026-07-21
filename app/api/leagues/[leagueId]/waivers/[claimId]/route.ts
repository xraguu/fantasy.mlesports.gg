import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { fetchPendingClaims, cancelClaim } from "@/lib/waiverProcessing";

/**
 * DELETE /api/leagues/[leagueId]/waivers/[claimId]
 * Cancel a pending waiver claim — only the manager who submitted it, and
 * only while it's still pending. There's no manager-facing way to EDIT a
 * claim (change the bid, drop team, etc.) — cancel this one and submit a
 * new one instead.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; claimId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, claimId } = await params;

    const claim = await prisma.waiverClaim.findUnique({
      where: { id: claimId },
      select: { id: true, fantasyLeagueId: true, userId: true, status: true },
    });

    if (!claim) {
      return NextResponse.json({ error: "Waiver claim not found" }, { status: 404 });
    }
    if (claim.fantasyLeagueId !== leagueId) {
      return NextResponse.json({ error: "Claim does not belong to this league" }, { status: 400 });
    }
    if (claim.userId !== session.user.id) {
      return NextResponse.json({ error: "You can only cancel your own waiver claims" }, { status: 403 });
    }
    if (claim.status !== "pending") {
      return NextResponse.json({ error: `Claim is already ${claim.status}` }, { status: 400 });
    }

    // Reuse the exact same disposal path the automatic processing sweep
    // uses (atomic conditional update as the first write, so a claim that
    // gets processed in the same instant a manager clicks cancel can't be
    // cancelled out from under a just-executed pickup).
    const [fullClaim] = await fetchPendingClaims({ claimIds: [claimId] });
    if (!fullClaim) {
      return NextResponse.json(
        { error: "This claim was just processed and can no longer be cancelled" },
        { status: 409 }
      );
    }

    const cancelled = await cancelClaim(fullClaim, "Cancelled by manager");
    if (!cancelled) {
      return NextResponse.json(
        { error: "This claim was just processed and can no longer be cancelled" },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error cancelling waiver claim:", error);
    return NextResponse.json(
      { error: "Failed to cancel waiver claim" },
      { status: 500 }
    );
  }
}
