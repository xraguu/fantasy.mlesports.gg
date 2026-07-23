import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateRosterSlotId } from "@/lib/id-generator";
import type { RosterConfigShape } from "@/lib/rosterSlotAssignment";

/**
 * POST /api/leagues/[leagueId]/draft/admin
 * Admin actions for draft control
 * Body: {
 *   action: "start" | "pause" | "resume" | "force_pick"
 *   pickTimeSeconds?: number (for start action)
 *   fantasyTeamId?: string (for force_pick)
 *   mleTeamId?: string (for force_pick)
 * }
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
    const { action, pickTimeSeconds, fantasyTeamId, mleTeamId } = body;

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user || user.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: Admin access required" },
        { status: 403 }
      );
    }

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: {
        draftPicks: {
          orderBy: {
            overallPick: "asc",
          },
        },
        fantasyTeams: {
          orderBy: {
            draftPosition: "asc",
          },
        },
      },
    });

    if (!league) {
      return NextResponse.json(
        { error: "Fantasy league not found" },
        { status: 404 }
      );
    }

    switch (action) {
      case "start": {
        const draftStatus = league.draftStatus || "not_started";
        if (draftStatus === "in_progress" || draftStatus === "completed") {
          return NextResponse.json(
            { error: "Draft has already started or is completed" },
            { status: 400 }
          );
        }

        // Generate draft picks if they don't exist
        const existingPicks = league.draftPicks.length;
        if (existingPicks === 0) {
          // Generate draft order based on draftType
          const totalTeams = league.fantasyTeams.length;
          const rosterConfig = league.rosterConfig as RosterConfigShape;
          const totalSlots =
            (rosterConfig?.["2s"] || 0) +
            (rosterConfig?.["3s"] || 0) +
            (rosterConfig?.flx || 0) +
            (rosterConfig?.be || 0);

          const picks = [];
          for (let round = 1; round <= totalSlots; round++) {
            for (let pick = 1; pick <= totalTeams; pick++) {
              // Snake draft logic
              const isSnake = league.draftType === "snake";
              const isReverseRound = isSnake && round % 2 === 0;
              const teamIndex = isReverseRound
                ? totalTeams - pick
                : pick - 1;

              picks.push({
                fantasyLeagueId: leagueId,
                round,
                pickNumber: pick,
                overallPick: (round - 1) * totalTeams + pick,
                fantasyTeamId: league.fantasyTeams[teamIndex]?.id || null,
              });
            }
          }

          await prisma.draftPick.createMany({
            data: picks,
          });
        }

        // Set first pick deadline
        const timePerPick = pickTimeSeconds || 90;
        const firstDeadline = new Date(Date.now() + timePerPick * 1000);

        await prisma.fantasyLeague.update({
          where: { id: leagueId },
          data: {
            draftStatus: "in_progress",
            draftPickTimeSeconds: timePerPick,
            draftPickDeadline: firstDeadline,
          },
        });

        return NextResponse.json({
          success: true,
          message: "Draft started",
          pickTimeSeconds: timePerPick,
          firstDeadline,
        });
      }

      case "pause": {
        const draftStatus = league.draftStatus;
        if (draftStatus !== "in_progress") {
          return NextResponse.json(
            { error: "Draft is not in progress" },
            { status: 400 }
          );
        }

        await prisma.fantasyLeague.update({
          where: { id: leagueId },
          data: {
            draftStatus: "paused",
          },
        });

        return NextResponse.json({
          success: true,
          message: "Draft paused",
        });
      }

      case "resume": {
        const draftStatus = league.draftStatus;
        if (draftStatus !== "paused") {
          return NextResponse.json(
            { error: "Draft is not paused" },
            { status: 400 }
          );
        }

        // Reset deadline for current pick
        const pickTimeSeconds = league.draftPickTimeSeconds || 90;
        const newDeadline = new Date(Date.now() + pickTimeSeconds * 1000);

        await prisma.fantasyLeague.update({
          where: { id: leagueId },
          data: {
            draftStatus: "in_progress",
            draftPickDeadline: newDeadline,
          },
        });

        return NextResponse.json({
          success: true,
          message: "Draft resumed",
          newDeadline,
        });
      }

      case "force_pick": {
        if (!fantasyTeamId || !mleTeamId) {
          return NextResponse.json(
            { error: "fantasyTeamId and mleTeamId are required" },
            { status: 400 }
          );
        }

        // Find the team's next unpicked pick
        const nextPick = league.draftPicks.find(
          (pick) => pick.fantasyTeamId === fantasyTeamId && !pick.pickedAt
        );

        if (!nextPick) {
          return NextResponse.json(
            { error: "No unpicked picks for this team" },
            { status: 400 }
          );
        }

        // Verify MLE team exists and isn't picked
        const mleTeam = await prisma.mLETeam.findUnique({
          where: { id: mleTeamId },
        });

        if (!mleTeam) {
          return NextResponse.json(
            { error: "MLE team not found" },
            { status: 404 }
          );
        }

        const alreadyPicked = league.draftPicks.some(
          (pick) => pick.mleTeamId === mleTeamId && pick.pickedAt
        );

        if (alreadyPicked) {
          return NextResponse.json(
            { error: "This team has already been drafted" },
            { status: 400 }
          );
        }

        // Execute the pick
        const updatedPick = await prisma.draftPick.update({
          where: { id: nextPick.id },
          data: {
            mleTeamId,
            pickedAt: new Date(),
          },
        });

        // Add to roster
        const rosterConfig = league.rosterConfig as RosterConfigShape;
        const benchSlots = rosterConfig?.be || 3;

        const existingRosterSlots = await prisma.rosterSlot.findMany({
          where: {
            fantasyTeamId,
            week: 1,
            position: "be",
          },
        });

        const nextBenchIndex = existingRosterSlots.length;

        if (nextBenchIndex < benchSlots) {
          const rosterSlotId = generateRosterSlotId(
            fantasyTeamId,
            1,
            "be",
            nextBenchIndex
          );
          await prisma.rosterSlot.create({
            data: {
              id: rosterSlotId,
              fantasyTeamId,
              mleTeamId,
              week: 1,
              position: "be",
              slotIndex: nextBenchIndex,
              isLocked: false,
            },
          });
        }

        return NextResponse.json({
          success: true,
          message: "Pick forced successfully",
          pick: {
            id: updatedPick.id,
            round: updatedPick.round,
            pickNumber: updatedPick.pickNumber,
            overallPick: updatedPick.overallPick,
            mleTeamId: updatedPick.mleTeamId,
            pickedAt: updatedPick.pickedAt,
          },
        });
      }

      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error in draft admin action:", error);
    return NextResponse.json(
      { error: "Failed to execute admin action" },
      { status: 500 }
    );
  }
}
