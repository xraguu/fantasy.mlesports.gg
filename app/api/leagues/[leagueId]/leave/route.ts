import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// DELETE /api/leagues/[leagueId]/leave - Leave a fantasy league
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;

    // Find the user's fantasy team in this league
    const fantasyTeam = await prisma.fantasyTeam.findFirst({
      where: {
        fantasyLeagueId: leagueId,
        ownerUserId: session.user.id,
      },
      include: {
        league: {
          select: {
            currentWeek: true,
          },
        },
        roster: true,
        proposedTrades: {
          where: {
            status: "pending",
          },
        },
        receivedTrades: {
          where: {
            status: "pending",
          },
        },
        waiverClaims: {
          where: {
            status: "pending",
          },
        },
      },
    });

    if (!fantasyTeam) {
      return NextResponse.json(
        { error: "You are not a member of this league" },
        { status: 404 }
      );
    }

    // Check if the league has started (currentWeek > 1)
    if (fantasyTeam.league.currentWeek > 1) {
      return NextResponse.json(
        { error: "Cannot leave a league that has already started" },
        { status: 400 }
      );
    }

    // Check if user has any pending trades
    const hasPendingTrades = fantasyTeam.proposedTrades.length > 0 || fantasyTeam.receivedTrades.length > 0;

    if (hasPendingTrades) {
      return NextResponse.json(
        { error: "Cannot leave league with pending trades. Cancel or resolve trades first." },
        { status: 400 }
      );
    }

    // Check if user has any pending waiver claims
    if (fantasyTeam.waiverClaims.length > 0) {
      return NextResponse.json(
        { error: "Cannot leave league with pending waiver claims. Cancel claims first." },
        { status: 400 }
      );
    }

    // Delete all roster slots for this team
    if (fantasyTeam.roster.length > 0) {
      await prisma.rosterSlot.deleteMany({
        where: {
          fantasyTeamId: fantasyTeam.id,
        },
      });
    }

    // Delete the fantasy team
    await prisma.fantasyTeam.delete({
      where: {
        id: fantasyTeam.id,
      },
    });

    // Update waiver priorities for remaining teams if using non-FAAB system
    await prisma.$executeRaw`
      UPDATE "FantasyTeam"
      SET "waiverPriority" = "waiverPriority" - 1
      WHERE "fantasyLeagueId" = ${leagueId}
        AND "waiverPriority" > ${fantasyTeam.waiverPriority || 0}
        AND "waiverPriority" IS NOT NULL
    `;

    return NextResponse.json({ message: "Successfully left the league" });
  } catch (error) {
    console.error("Error leaving league:", error);
    return NextResponse.json(
      { error: "Failed to leave league" },
      { status: 500 }
    );
  }
}
