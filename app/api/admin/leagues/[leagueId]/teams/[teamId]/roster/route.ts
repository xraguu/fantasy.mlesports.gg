import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateRosterSlotId } from "@/lib/id-generator";
import { logAdminActivity } from "@/lib/adminActivity";
import { cancelPendingTransactionsForMleTeam } from "@/lib/adminRosterActions";
import { clearWaiverPeriod } from "@/lib/waiverPeriods";

/**
 * GET /api/admin/leagues/[leagueId]/teams/[teamId]/roster?week=X
 * Full roster grid (filled + empty slots) for a team/week, plus every MLE
 * team not currently rostered by anyone else in the league that week —
 * backs the admin "Edit Roster" modal.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;

    const team = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
      include: {
        owner: { select: { displayName: true } },
        league: { select: { id: true, currentWeek: true, rosterConfig: true } },
      },
    });

    if (!team || team.fantasyLeagueId !== leagueId) {
      return NextResponse.json({ error: "Team not found in this league" }, { status: 404 });
    }

    const url = new URL(req.url);
    const week = parseInt(url.searchParams.get("week") || "") || team.league.currentWeek;

    const rosterConfig = team.league.rosterConfig as Record<string, number>;
    const expectedSlots: { position: string; slotIndex: number }[] = [];
    for (const [position, count] of Object.entries(rosterConfig)) {
      for (let i = 0; i < count; i++) expectedSlots.push({ position, slotIndex: i });
    }

    const teamSlots = await prisma.rosterSlot.findMany({
      where: { fantasyTeamId: teamId, week },
      include: { mleTeam: true },
    });
    const teamSlotMap = new Map(
      teamSlots.map((s) => [`${s.position}-${s.slotIndex}`, s])
    );

    const slots = expectedSlots.map(({ position, slotIndex }) => {
      const existing = teamSlotMap.get(`${position}-${slotIndex}`);
      return {
        position,
        slotIndex,
        isLocked: existing?.isLocked ?? false,
        mleTeam: existing?.mleTeam
          ? {
              id: existing.mleTeam.id,
              name: existing.mleTeam.name,
              leagueId: existing.mleTeam.leagueId,
              slug: existing.mleTeam.slug,
              logoPath: existing.mleTeam.logoPath,
            }
          : null,
      };
    });

    // Every MLE team rostered by ANY team in this league this week — used to
    // exclude already-taken teams from the "add" picker.
    const leagueRosteredSlots = await prisma.rosterSlot.findMany({
      where: { week, fantasyTeam: { fantasyLeagueId: leagueId } },
      select: { mleTeamId: true },
    });
    const rosteredIds = new Set(leagueRosteredSlots.map((s) => s.mleTeamId));

    const availableMleTeams = await prisma.mLETeam.findMany({
      where: { id: { notIn: [...rosteredIds] } },
      select: { id: true, name: true, leagueId: true, slug: true, logoPath: true },
      orderBy: [{ leagueId: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({
      team: {
        id: team.id,
        displayName: team.displayName,
        shortCode: team.shortCode,
        ownerDisplayName: team.owner.displayName,
      },
      week,
      slots,
      availableMleTeams,
    });
  } catch (error) {
    console.error("Error fetching admin roster view:", error);
    return NextResponse.json({ error: "Failed to fetch roster" }, { status: 500 });
  }
}

/**
 * POST /api/admin/leagues/[leagueId]/teams/[teamId]/roster
 * Body: { week: number, action: "add" | "drop", position: string, slotIndex: number, mleTeamId?: string }
 * Add or drop an MLE team from a specific roster slot, at any time (not
 * gated by lock state — this is an admin override, not a manager action).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;
    const body = await req.json();
    const { week, action, position, slotIndex, mleTeamId } = body;

    if (!week || !action || !position || slotIndex === undefined) {
      return NextResponse.json(
        { error: "Week, action, position, and slotIndex are required" },
        { status: 400 }
      );
    }
    if (action !== "add" && action !== "drop") {
      return NextResponse.json({ error: "Action must be 'add' or 'drop'" }, { status: 400 });
    }

    const team = await prisma.fantasyTeam.findUnique({ where: { id: teamId } });
    if (!team || team.fantasyLeagueId !== leagueId) {
      return NextResponse.json({ error: "Team not found in this league" }, { status: 404 });
    }

    const existingSlot = await prisma.rosterSlot.findFirst({
      where: { fantasyTeamId: teamId, week, position, slotIndex },
    });

    if (action === "drop") {
      if (!existingSlot || !existingSlot.mleTeamId) {
        return NextResponse.json({ error: "That slot is already empty" }, { status: 400 });
      }

      const droppedTeam = await prisma.mLETeam.findUnique({
        where: { id: existingSlot.mleTeamId },
        select: { name: true, leagueId: true },
      });

      await prisma.rosterSlot.delete({ where: { id: existingSlot.id } });
      await cancelPendingTransactionsForMleTeam(leagueId, existingSlot.mleTeamId);

      await logAdminActivity({
        adminUserId: session.user.id!,
        action: "roster.admin_drop",
        description: `Dropped ${droppedTeam ? `${droppedTeam.leagueId} ${droppedTeam.name}` : "a team"} from "${team.displayName}" (week ${week})`,
        targetType: "FantasyTeam",
        targetId: teamId,
      });

      return NextResponse.json({ success: true });
    }

    // action === "add"
    if (!mleTeamId) {
      return NextResponse.json({ error: "mleTeamId is required to add a team" }, { status: 400 });
    }
    if (existingSlot?.mleTeamId) {
      return NextResponse.json(
        { error: "That slot is already filled — drop the current team first" },
        { status: 400 }
      );
    }

    const mleTeam = await prisma.mLETeam.findUnique({ where: { id: mleTeamId } });
    if (!mleTeam) {
      return NextResponse.json({ error: "MLE team not found" }, { status: 404 });
    }

    const alreadyRostered = await prisma.rosterSlot.findFirst({
      where: { week, mleTeamId, fantasyTeam: { fantasyLeagueId: leagueId } },
    });
    if (alreadyRostered) {
      return NextResponse.json(
        { error: "That team is already rostered by another manager this week" },
        { status: 400 }
      );
    }

    if (existingSlot) {
      await prisma.rosterSlot.update({
        where: { id: existingSlot.id },
        data: { mleTeamId },
      });
    } else {
      await prisma.rosterSlot.create({
        data: {
          id: generateRosterSlotId(teamId, week, position, slotIndex),
          fantasyTeamId: teamId,
          mleTeamId,
          week,
          position,
          slotIndex,
          isLocked: false,
        },
      });
    }

    await cancelPendingTransactionsForMleTeam(leagueId, mleTeamId);
    // Admin add is an explicit override — clear any waiver clearance window
    // so the team doesn't stay flagged "on waivers" once it's rostered.
    await clearWaiverPeriod(leagueId, mleTeamId);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "roster.admin_add",
      description: `Added ${mleTeam.leagueId} ${mleTeam.name} to "${team.displayName}" (week ${week})`,
      targetType: "FantasyTeam",
      targetId: teamId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating admin roster:", error);
    return NextResponse.json({ error: "Failed to update roster" }, { status: 500 });
  }
}
