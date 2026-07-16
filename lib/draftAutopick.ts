import { prisma } from "@/lib/prisma";
import { executeDraftPick } from "@/lib/draftPick";

/**
 * Enforces the draft pick timer. Runs lazily from GET /api/leagues/[leagueId]/draft
 * (the draft room polls that route every 3s while a draft is in progress) —
 * AND from a frequent in-process interval in instrumentation.ts, since the
 * lazy-only version stalled the whole draft whenever nobody had the draft
 * room open: the deadline would pass with zero requests hitting the API to
 * trigger the sweep, so picks just didn't advance until someone came back.
 * The interval keeps real wall-clock time actually moving the draft forward
 * regardless of who's watching; the page-view sweep keeps it snappy for
 * whoever currently is.
 *
 * If the current pick's deadline has passed, autopicks for that team: first
 * available team in their draftQueue (skipping anything already drafted),
 * else a random team from the remaining pool. Flips autodraftEnabled on for
 * that team as a status flag — this never happens early; the timer always
 * runs its full duration regardless of that flag's state.
 *
 * Pass a specific leagueId to sweep just that league (the page-view case);
 * omit it to sweep every league with a draft currently in progress (the
 * background interval case).
 */
export async function runDraftAutopickSweep(leagueId?: string): Promise<void> {
  if (leagueId === undefined) {
    const inProgress = await prisma.fantasyLeague.findMany({
      where: { draftStatus: "in_progress" },
      select: { id: true },
    });
    for (const league of inProgress) {
      await runDraftAutopickSweep(league.id);
    }
    return;
  }

  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    select: { draftStatus: true, draftPickDeadline: true },
  });
  if (!league || league.draftStatus !== "in_progress") return;
  if (!league.draftPickDeadline || new Date() < league.draftPickDeadline) return;

  const currentPick = await prisma.draftPick.findFirst({
    where: { fantasyLeagueId: leagueId, pickedAt: null },
    orderBy: { overallPick: "asc" },
  });
  if (!currentPick || !currentPick.fantasyTeamId) return;

  const team = await prisma.fantasyTeam.findUnique({
    where: { id: currentPick.fantasyTeamId },
    select: { id: true, draftQueue: true },
  });
  if (!team) return;

  const draftedTeamIds = new Set(
    (
      await prisma.draftPick.findMany({
        where: { fantasyLeagueId: leagueId, pickedAt: { not: null } },
        select: { mleTeamId: true },
      })
    ).map((p) => p.mleTeamId!)
  );

  let mleTeamId = team.draftQueue.find((id) => !draftedTeamIds.has(id));

  if (!mleTeamId) {
    const available = await prisma.mLETeam.findMany({
      where: { id: { notIn: [...draftedTeamIds] } },
      select: { id: true },
    });
    if (available.length === 0) return;
    mleTeamId = available[Math.floor(Math.random() * available.length)].id;
  }

  await prisma.fantasyTeam.update({
    where: { id: team.id },
    data: { autodraftEnabled: true },
  });

  await executeDraftPick(leagueId, currentPick.id, mleTeamId);
}
