import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";
import { processPendingWaiverClaims } from "@/lib/waiverProcessing";

/**
 * POST /api/admin/waivers/process
 * Process pending waiver claims (admin only)
 * Body: { claimIds?: string[], leagueId?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { claimIds, leagueId } = body;

    const result = await processPendingWaiverClaims({ claimIds, leagueId });

    if (result.processed === 0) {
      return NextResponse.json({
        message: "No pending waiver claims to process",
        processed: 0,
        approved: 0,
        denied: 0,
        cancelled: 0,
      });
    }

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "waivers.process",
      description: `Processed ${result.processed} waiver claim(s) (${result.approved} approved, ${result.denied} denied, ${result.cancelled} cancelled)`,
    });

    return NextResponse.json({
      message: `Processed ${result.processed} waiver claims`,
      ...result,
    });
  } catch (error) {
    console.error("Error processing waivers:", error);
    return NextResponse.json(
      { error: "Failed to process waivers" },
      { status: 500 }
    );
  }
}
