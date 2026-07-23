import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runDraftAutopickSweep } from "@/lib/draftAutopick";
import { getTeamHistoricalStats, resolveDraftStatsSeason, HistoricalLens } from "@/lib/teamHistoricalStats";
import { generateDraftPickOrder } from "@/lib/draftPickOrder";
import type { RosterConfigShape } from "@/lib/rosterSlotAssignment";

/**
 * GET /api/leagues/[leagueId]/draft
 * Returns the current draft state including:
 * - All draft picks (completed and upcoming), with full MLE team info for
 *   picked ones
 * - Current pick information
 * - Draft settings (timer, status)
 * - All fantasy team rosters, draft queues, and autodraft flags
 * - Available MLE teams with real last-season stats (?mode=2s|3s|combined)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;
    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") as HistoricalLens) || "combined";

    try {
      await runDraftAutopickSweep(leagueId);
    } catch (error) {
      // Don't let a losing race (e.g. two picks for the same team resolved
      // concurrently, see lib/draftPick.ts) break the draft room's poll —
      // whichever pick actually won already committed; just log and
      // continue rendering the current state.
      console.error(`[draft-sweep] Sweep failed for league ${leagueId}:`, error);
    }

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: {
        fantasyTeams: {
          include: {
            owner: true,
            roster: {
              include: {
                mleTeam: true,
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
        },
      },
    });

    if (!league) {
      return NextResponse.json(
        { error: "Fantasy league not found" },
        { status: 404 }
      );
    }

    // Before the draft is initialized, no real DraftPick rows exist yet — the
    // draft room still shows the full recent-picks ticker and grid, just as
    // it will look once the draft is live, by previewing the pick order that
    // initialize-draft would create (same shared algorithm, nothing
    // persisted here).
    let picksSource = league.draftPicks;
    const isPreview = picksSource.length === 0 && league.fantasyTeams.length > 0;
    if (isPreview) {
      const rosterConfig = league.rosterConfig as RosterConfigShape;
      const numRounds =
        (rosterConfig?.["2s"] || 0) +
        (rosterConfig?.["3s"] || 0) +
        (rosterConfig?.flx || 0) +
        (rosterConfig?.be || 0);
      picksSource = generateDraftPickOrder(league.fantasyTeams, league.draftType, numRounds).map(
        (entry) => ({
          id: `preview-${entry.overallPick}`,
          fantasyLeagueId: league.id,
          round: entry.round,
          pickNumber: entry.pickNumber,
          overallPick: entry.overallPick,
          fantasyTeamId: entry.fantasyTeamId,
          mleTeamId: null,
          pickedAt: null,
        })
      );
    }

    // No pick is actually "on the clock" until the draft is really running —
    // in preview mode every slot renders as upcoming rather than falsely
    // highlighting pick #1 as current.
    const currentPick = isPreview ? undefined : picksSource.find((pick) => !pick.pickedAt);

    const draftedTeamIds = picksSource
      .filter((pick) => pick.mleTeamId)
      .map((pick) => pick.mleTeamId as string);

    // Every MLE team ID this response needs full details for: picked teams
    // (for the grid/recent-picks) and every team's own draft queue entries.
    const queueTeamIds = league.fantasyTeams.flatMap((t) => t.draftQueue);
    const allNeededIds = [...new Set([...draftedTeamIds, ...queueTeamIds])];
    const neededTeams = await prisma.mLETeam.findMany({
      where: { id: { in: allNeededIds } },
    });
    const teamById = new Map(neededTeams.map((t) => [t.id, t]));

    const toTeamSummary = (t: (typeof neededTeams)[number]) => ({
      id: t.id,
      name: t.name,
      leagueId: t.leagueId,
      slug: t.slug,
      logoPath: t.logoPath,
      primaryColor: t.primaryColor,
      secondaryColor: t.secondaryColor,
    });

    const availableTeams = await prisma.mLETeam.findMany({
      where: { id: { notIn: draftedTeamIds } },
      orderBy: { id: "asc" },
    });

    // Real last-season team stats, keyed off the admin's configured "Draft
    // Room 'Last Season' Stats" setting (falls back to the most recent
    // season on file so this isn't broken before an admin sets one).
    const statsSeason = await resolveDraftStatsSeason();
    const historicalStats = statsSeason
      ? await getTeamHistoricalStats(statsSeason, mode)
      : new Map();

    const draftState = {
      leagueId: league.id,
      leagueName: league.name,
      draftType: league.draftType,
      status: league.draftStatus || "not_started",
      currentPickNumber: currentPick?.overallPick || null,
      currentPickDeadline: league.draftPickDeadline || null,
      pickTimeSeconds: league.draftPickTimeSeconds || 90,
      statsSeason,

      picks: picksSource.map((pick) => ({
        id: pick.id,
        round: pick.round,
        pickNumber: pick.pickNumber,
        overallPick: pick.overallPick,
        fantasyTeamId: pick.fantasyTeamId,
        mleTeamId: pick.mleTeamId,
        mleTeam: pick.mleTeamId && teamById.has(pick.mleTeamId)
          ? toTeamSummary(teamById.get(pick.mleTeamId)!)
          : null,
        pickedAt: pick.pickedAt,
      })),

      fantasyTeams: league.fantasyTeams.map((team) => ({
        id: team.id,
        displayName: team.displayName,
        shortCode: team.shortCode,
        draftPosition: team.draftPosition,
        ownerUserId: team.ownerUserId,
        ownerDisplayName: team.owner.displayName,
        ownerDiscordId: team.owner.discordId,
        autodraftEnabled: team.autodraftEnabled,
        draftQueue: team.draftQueue
          .map((id) => teamById.get(id))
          .filter((t): t is NonNullable<typeof t> => !!t)
          .map(toTeamSummary),
        roster: team.roster.map((slot) => ({
          week: slot.week,
          position: slot.position,
          slotIndex: slot.slotIndex,
          mleTeamId: slot.mleTeamId,
          mleTeam: slot.mleTeam ? toTeamSummary(slot.mleTeam) : null,
        })),
      })),

      availableTeams: availableTeams.map((team) => {
        const stats = historicalStats.get(team.id);
        return {
          ...toTeamSummary(team),
          stats: stats
            ? {
                fpts: stats.fpts,
                avg: stats.avg,
                goals: stats.goals,
                goalsAgainst: stats.goalsAgainst,
                shots: stats.shots,
                saves: stats.saves,
                assists: stats.assists,
                demosInflicted: stats.demosInflicted,
                demosTaken: stats.demosTaken,
                gamesPlayed: stats.gamesPlayed,
                sprocketRating: stats.sprocketRating,
                gameRecord: stats.gameRecord,
                seriesRecord: stats.seriesRecord,
              }
            : null,
        };
      }),
    };

    return NextResponse.json(draftState);
  } catch (error) {
    console.error("[Draft API] Error fetching draft state:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch draft state",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
