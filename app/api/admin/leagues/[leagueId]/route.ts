import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";
import { generateAndSaveRegularSeason } from "@/lib/scheduleGenerator";

// GET /api/admin/leagues/[leagueId] - Get detailed league info (admin only)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: {
        fantasyTeams: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
                discordId: true,
              },
            },
            roster: {
              select: {
                id: true,
                week: true,
              },
            },
          },
          orderBy: {
            draftPosition: "asc",
          },
        },
        draftPicks: {
          orderBy: {
            overallPick: "asc",
          },
          take: 10,
        },
        _count: {
          select: {
            fantasyTeams: true,
            draftPicks: true,
            matchups: true,
            trades: true,
            waivers: true,
          },
        },
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    return NextResponse.json({ league });
  } catch (error) {
    console.error("Error fetching league:", error);
    return NextResponse.json(
      { error: "Failed to fetch league" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/leagues/[leagueId] - Update league settings (admin only)
export async function PATCH(
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
    const { name, currentWeek, maxTeams, doubleWinEnabled, draftPickTimeSeconds, draftType, waiverSystem, faabBudget } = body;

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: { _count: { select: { fantasyTeams: true } } },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // League size, draft type, and waiver settings shape the draft order,
    // the schedule, and every team's FAAB balance, so they're only editable
    // until the draft is started or skipped.
    const changesSetup = [maxTeams, draftType, waiverSystem, faabBudget].some((v) => v !== undefined);
    if (changesSetup && league.draftStatus !== "not_started") {
      return NextResponse.json(
        { error: "League size, draft type, and waiver settings can only be changed before the draft starts" },
        { status: 400 }
      );
    }

    // Prepare update data
    const updateData: Prisma.FantasyLeagueUpdateInput = {};

    if (name !== undefined) {
      const trimmedName = typeof name === "string" ? name.trim() : "";
      if (!trimmedName || trimmedName.length > 50) {
        return NextResponse.json(
          { error: "League name must be 1–50 characters" },
          { status: 400 }
        );
      }
      updateData.name = trimmedName;
    }
    if (currentWeek !== undefined) updateData.currentWeek = parseInt(currentWeek);
    if (maxTeams !== undefined) {
      const parsedMaxTeams = parseInt(maxTeams);
      if (![8, 10, 12].includes(parsedMaxTeams)) {
        return NextResponse.json(
          { error: "maxTeams must be 8, 10, or 12" },
          { status: 400 }
        );
      }
      if (league._count.fantasyTeams > parsedMaxTeams) {
        return NextResponse.json(
          { error: `This league already has ${league._count.fantasyTeams} managers — remove some before making it ${parsedMaxTeams === 8 ? "an" : "a"} ${parsedMaxTeams}-team league` },
          { status: 400 }
        );
      }
      updateData.maxTeams = parsedMaxTeams;
    }

    if (draftType !== undefined) {
      if (!["snake", "linear"].includes(draftType)) {
        return NextResponse.json({ error: "draftType must be 'snake' or 'linear'" }, { status: 400 });
      }
      updateData.draftType = draftType;
    }

    if (waiverSystem !== undefined && !["faab", "rolling", "fixed"].includes(waiverSystem)) {
      return NextResponse.json({ error: "waiverSystem must be 'faab', 'rolling', or 'fixed'" }, { status: 400 });
    }
    const effectiveWaiverSystem: string = waiverSystem ?? league.waiverSystem;
    let effectiveFaabBudget: number | null = league.faabBudget;
    if (waiverSystem !== undefined || faabBudget !== undefined) {
      if (effectiveWaiverSystem === "faab") {
        const budget = faabBudget !== undefined ? Number(faabBudget) : league.faabBudget;
        if (budget == null || !Number.isInteger(budget) || budget < 1 || budget > 10000) {
          return NextResponse.json({ error: "FAAB budget must be a whole number from 1 to 10,000" }, { status: 400 });
        }
        effectiveFaabBudget = budget;
      } else {
        effectiveFaabBudget = null;
      }
      updateData.waiverSystem = effectiveWaiverSystem;
      updateData.faabBudget = effectiveFaabBudget;
    }

    if (doubleWinEnabled !== undefined) {
      if (league.draftStatus !== "not_started") {
        return NextResponse.json(
          { error: "doubleWinEnabled can only be changed before the draft starts" },
          { status: 400 }
        );
      }
      updateData.doubleWinEnabled = Boolean(doubleWinEnabled);
    }

    if (draftPickTimeSeconds !== undefined) {
      if (league.draftStatus === "completed") {
        return NextResponse.json(
          { error: "Can't change the pick timer after the draft has completed" },
          { status: 400 }
        );
      }
      const parsedPickTime = parseInt(draftPickTimeSeconds);
      if (!Number.isFinite(parsedPickTime) || parsedPickTime < 30) {
        return NextResponse.json(
          { error: "draftPickTimeSeconds must be at least 30" },
          { status: 400 }
        );
      }
      updateData.draftPickTimeSeconds = parsedPickTime;
    }

    const sizeChanged = updateData.maxTeams !== undefined && updateData.maxTeams !== league.maxTeams;
    const faabChanged =
      updateData.waiverSystem !== undefined &&
      (effectiveWaiverSystem !== league.waiverSystem || effectiveFaabBudget !== league.faabBudget);

    const updatedLeague = await prisma.$transaction(async (tx) => {
      const updated = await tx.fantasyLeague.update({
        where: { id: leagueId },
        data: updateData,
      });
      if (faabChanged) {
        // Nobody can have spent FAAB before the draft, so every team just
        // gets the full budget (or none outside FAAB) — the same value team
        // creation assigns.
        await tx.fantasyTeam.updateMany({
          where: { fantasyLeagueId: leagueId },
          data: { faabRemaining: effectiveWaiverSystem === "faab" ? effectiveFaabBudget : null },
        });
      }
      if (sizeChanged) {
        // A schedule generated when the league filled up was built for the
        // old size (12-team seasons are 7 weeks, 8/10-team seasons are 8).
        await tx.matchup.deleteMany({ where: { fantasyLeagueId: leagueId, isPlayoff: false } });
      }
      return updated;
    });

    // Same rule as adding a manager: once the league is exactly full, its
    // regular season gets generated (now for the new size).
    if (sizeChanged && league._count.fantasyTeams === updatedLeague.maxTeams) {
      try {
        await generateAndSaveRegularSeason(leagueId);
      } catch (scheduleError) {
        console.error("Error generating schedule after league size change:", scheduleError);
      }
    }

    const renamed = league.name !== updatedLeague.name;
    const otherFields = Object.keys(updateData).filter((field) => field !== "name");
    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "league.update",
      description: renamed
        ? `Renamed league "${league.name}" to "${updatedLeague.name}"${otherFields.length > 0 ? ` (also updated ${otherFields.join(", ")})` : ""}`
        : `Updated league "${updatedLeague.name}" (${Object.keys(updateData).join(", ")})`,
      targetType: "FantasyLeague",
      targetId: leagueId,
      metadata: updateData,
    });

    return NextResponse.json({ league: updatedLeague, success: true });
  } catch (error) {
    console.error("Error updating league:", error);
    return NextResponse.json(
      { error: "Failed to update league" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/leagues/[leagueId] - Delete league (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Delete all related data in correct order. None of FantasyLeague's
    // relations cascade on delete, so every table with a fantasyLeagueId FK
    // has to be cleared here — including ones that can have rows even for a
    // league with zero teams (WeekLockEvent fires off a lazy sweep that
    // touches every league regardless of team count; Transaction/
    // TeamWaiverPeriod can outlive a team that was added then removed).
    await prisma.$transaction([
      prisma.transaction.deleteMany({ where: { fantasyLeagueId: leagueId } }),
      prisma.weekLockEvent.deleteMany({ where: { fantasyLeagueId: leagueId } }),
      prisma.teamWaiverPeriod.deleteMany({ where: { fantasyLeagueId: leagueId } }),
      prisma.matchup.deleteMany({ where: { fantasyLeagueId: leagueId } }),
      prisma.waiverClaim.deleteMany({ where: { fantasyLeagueId: leagueId } }),
      prisma.trade.deleteMany({ where: { fantasyLeagueId: leagueId } }),
      prisma.rosterSlot.deleteMany({
        where: { fantasyTeam: { fantasyLeagueId: leagueId } },
      }),
      prisma.draftPick.deleteMany({ where: { fantasyLeagueId: leagueId } }),
      prisma.fantasyTeam.deleteMany({ where: { fantasyLeagueId: leagueId } }),
      prisma.fantasyLeague.delete({ where: { id: leagueId } }),
    ]);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "league.delete",
      description: `Deleted league "${league.name}" (season ${league.season})`,
      targetType: "FantasyLeague",
      targetId: leagueId,
    });

    return NextResponse.json({ success: true, message: "League deleted successfully" });
  } catch (error) {
    console.error("Error deleting league:", error);
    // Admin-only route — safe to surface the real error (e.g. a leftover
    // foreign-key reference this cleanup didn't account for) instead of a
    // generic message that hides what actually needs fixing.
    return NextResponse.json(
      {
        error: "Failed to delete league",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
