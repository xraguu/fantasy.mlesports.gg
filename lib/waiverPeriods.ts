import { prisma } from "@/lib/prisma";

/**
 * Tracks MLE teams that are in the post-drop waiver clearance window (see
 * TeamWaiverPeriod in schema.prisma). A team enters this state when a
 * manager drops it — it shows as "on waivers" to other managers rather than
 * a free agent, and can only be acquired via a pending waiver claim. If
 * nobody claims it by the next waiver processing run, it's released back to
 * free agency.
 *
 * Admin roster edits are exempt (same override precedent as lib/rosterLocks.ts)
 * since those are explicit admin actions, not manager-initiated drops. Trades
 * are also exempt — the team moves directly to the other roster and is never
 * unrostered.
 */

export async function markTeamDroppedForWaivers(
  fantasyLeagueId: string,
  mleTeamId: string
): Promise<void> {
  await prisma.teamWaiverPeriod.upsert({
    where: { fantasyLeagueId_mleTeamId: { fantasyLeagueId, mleTeamId } },
    update: { droppedAt: new Date() },
    create: { fantasyLeagueId, mleTeamId },
  });
}

export async function clearWaiverPeriod(
  fantasyLeagueId: string,
  mleTeamId: string
): Promise<void> {
  await prisma.teamWaiverPeriod.deleteMany({
    where: { fantasyLeagueId, mleTeamId },
  });
}

/** Releases every team still in the waiver clearance window back to free agency for a league. */
export async function releaseWaiverPeriodsForLeague(
  fantasyLeagueId: string
): Promise<void> {
  await prisma.teamWaiverPeriod.deleteMany({ where: { fantasyLeagueId } });
}

export async function isTeamOnWaivers(
  fantasyLeagueId: string,
  mleTeamId: string
): Promise<boolean> {
  const period = await prisma.teamWaiverPeriod.findUnique({
    where: { fantasyLeagueId_mleTeamId: { fantasyLeagueId, mleTeamId } },
  });
  return period !== null;
}

/** Returns the set of MLE team IDs currently in the waiver clearance window for a league. */
export async function getWaiverTeamIdsForLeague(
  fantasyLeagueId: string
): Promise<Set<string>> {
  const periods = await prisma.teamWaiverPeriod.findMany({
    where: { fantasyLeagueId },
    select: { mleTeamId: true },
  });
  return new Set(periods.map((p) => p.mleTeamId));
}
