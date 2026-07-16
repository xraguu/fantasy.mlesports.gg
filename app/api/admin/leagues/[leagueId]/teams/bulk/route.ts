import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateFantasyTeamId } from "@/lib/id-generator";
import { logAdminActivity } from "@/lib/adminActivity";
import { generateAndSaveRegularSeason } from "@/lib/scheduleGenerator";

interface BulkTeamInput {
  userId: string;
  teamName: string;
  shortCode: string;
}

// POST /api/admin/leagues/[leagueId]/teams/bulk - Add multiple users to the league at once (admin only)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;
    const body = await request.json();
    const teams: BulkTeamInput[] = body.teams;

    if (!Array.isArray(teams) || teams.length === 0) {
      return NextResponse.json(
        { error: "teams must be a non-empty array" },
        { status: 400 }
      );
    }

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: { fantasyTeams: true },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Running state, updated as we validate each row so within-batch
    // duplicates/overflow are caught (not just against the original snapshot)
    let teamCount = league.fantasyTeams.length;
    const takenShortCodes = new Set(
      league.fantasyTeams.map((t) => t.shortCode.toLowerCase())
    );
    const takenUserIds = new Set(league.fantasyTeams.map((t) => t.ownerUserId));

    const createData: {
      id: string;
      fantasyLeagueId: string;
      ownerUserId: string;
      displayName: string;
      shortCode: string;
      draftPosition: number;
      faabRemaining: number | null;
      waiverPriority: number | null;
    }[] = [];

    for (let i = 0; i < teams.length; i++) {
      const { userId, teamName, shortCode } = teams[i];

      if (!userId || !teamName || !shortCode) {
        return NextResponse.json(
          { error: `Row ${i + 1}: userId, teamName, and shortCode are required` },
          { status: 400 }
        );
      }

      if (shortCode.length < 1 || shortCode.length > 3) {
        return NextResponse.json(
          { error: `Row ${i + 1}: short code must be 1-3 characters` },
          { status: 400 }
        );
      }

      if (teamCount >= league.maxTeams) {
        return NextResponse.json(
          { error: `League is full (max ${league.maxTeams} teams) — cannot add row ${i + 1}` },
          { status: 400 }
        );
      }

      if (takenUserIds.has(userId)) {
        return NextResponse.json(
          { error: `Row ${i + 1}: user is already a member of this league (or duplicated in this batch)` },
          { status: 400 }
        );
      }

      if (takenShortCodes.has(shortCode.toLowerCase())) {
        return NextResponse.json(
          { error: `Row ${i + 1}: short code "${shortCode}" is already taken in this league (or duplicated in this batch)` },
          { status: 400 }
        );
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) {
        return NextResponse.json(
          { error: `Row ${i + 1}: user not found` },
          { status: 404 }
        );
      }

      teamCount++;
      takenUserIds.add(userId);
      takenShortCodes.add(shortCode.toLowerCase());

      createData.push({
        id: generateFantasyTeamId(leagueId, userId),
        fantasyLeagueId: leagueId,
        ownerUserId: userId,
        displayName: teamName,
        shortCode: shortCode.toUpperCase(),
        draftPosition: teamCount,
        faabRemaining: league.waiverSystem === "faab" ? league.faabBudget : null,
        waiverPriority: league.waiverSystem !== "faab" ? teamCount : null,
      });
    }

    const created = await prisma.$transaction(
      createData.map((data) =>
        prisma.fantasyTeam.create({
          data,
          include: {
            owner: { select: { id: true, displayName: true, avatarUrl: true } },
          },
        })
      )
    );

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "team.bulk_add",
      description: `Bulk-added ${created.length} managers to league "${league.name}"`,
      targetType: "FantasyLeague",
      targetId: leagueId,
      metadata: { teamIds: created.map((t) => t.id) },
    });

    if (teamCount === league.maxTeams) {
      try {
        await generateAndSaveRegularSeason(leagueId);
      } catch (scheduleError) {
        console.error("Error auto-generating schedule after league filled:", scheduleError);
      }
    }

    return NextResponse.json({ fantasyTeams: created, success: true }, { status: 201 });
  } catch (error) {
    console.error("Error bulk adding users to league:", error);
    return NextResponse.json(
      { error: "Failed to bulk add users to league" },
      { status: 500 }
    );
  }
}
