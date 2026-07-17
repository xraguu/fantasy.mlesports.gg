import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/leagues/[leagueId]/teams/[teamId]/rename
 * Let a manager rename their own team / change its short code.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;
    const body = await req.json();
    const { displayName, shortCode } = body;

    if (!displayName && !shortCode) {
      return NextResponse.json(
        { error: "displayName or shortCode is required" },
        { status: 400 }
      );
    }

    const team = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
    });

    if (!team || team.fantasyLeagueId !== leagueId) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    if (team.ownerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "You can only rename your own team" },
        { status: 403 }
      );
    }

    const updateData: { displayName?: string; shortCode?: string } = {};

    if (displayName) {
      const trimmed = displayName.trim();
      if (trimmed.length === 0 || trimmed.length > 40) {
        return NextResponse.json(
          { error: "Team name must be 1-40 characters" },
          { status: 400 }
        );
      }

      const nameTaken = await prisma.fantasyTeam.findFirst({
        where: {
          fantasyLeagueId: leagueId,
          id: { not: teamId },
          displayName: { equals: trimmed, mode: "insensitive" },
        },
      });

      if (nameTaken) {
        return NextResponse.json(
          { error: "Team name is already taken in this league" },
          { status: 400 }
        );
      }

      updateData.displayName = trimmed;
    }

    if (shortCode) {
      if (shortCode.length < 1 || shortCode.length > 3) {
        return NextResponse.json(
          { error: "Short code must be 1-3 characters" },
          { status: 400 }
        );
      }

      const shortCodeTaken = await prisma.fantasyTeam.findFirst({
        where: {
          fantasyLeagueId: leagueId,
          id: { not: teamId },
          shortCode: { equals: shortCode, mode: "insensitive" },
        },
      });

      if (shortCodeTaken) {
        return NextResponse.json(
          { error: "Short code is already taken in this league" },
          { status: 400 }
        );
      }

      updateData.shortCode = shortCode.toUpperCase();
    }

    const updatedTeam = await prisma.fantasyTeam.update({
      where: { id: teamId },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      displayName: updatedTeam.displayName,
      shortCode: updatedTeam.shortCode,
    });
  } catch (error) {
    console.error("Error renaming team:", error);
    return NextResponse.json(
      { error: "Failed to rename team" },
      { status: 500 }
    );
  }
}
