import { prisma } from "@/lib/prisma";
import { generateRosterSlotId } from "@/lib/id-generator";
import { initializeWaiverPriorityFromDraftOrder } from "@/lib/waiverPriority";

/**
 * Commits a single draft pick: marks the DraftPick as picked, adds the team
 * to the picking manager's roster (week 1 bench — the draft happens
 * pre-season, so week 1 is the first real roster), and advances the league
 * to the next pick's deadline (or completes the draft if none remain).
 *
 * Single source of truth for the mutation, used by both the manual pick
 * route and the autopick sweep (lib/draftAutopick.ts) — callers are
 * responsible for their own validation (turn/ownership/already-drafted)
 * before calling this.
 */
export async function executeDraftPick(
  leagueId: string,
  draftPickId: string,
  mleTeamId: string
): Promise<{ draftCompleted: boolean }> {
  const pick = await prisma.draftPick.findUnique({ where: { id: draftPickId } });
  if (!pick || pick.pickedAt || !pick.fantasyTeamId) {
    throw new Error("Pick is not available to be made");
  }

  await prisma.draftPick.update({
    where: { id: draftPickId },
    data: { mleTeamId, pickedAt: new Date() },
  });

  const existingBenchSlots = await prisma.rosterSlot.findMany({
    where: { fantasyTeamId: pick.fantasyTeamId, week: 1, position: "be" },
  });
  const nextBenchIndex = existingBenchSlots.length;

  await prisma.rosterSlot.create({
    data: {
      id: generateRosterSlotId(pick.fantasyTeamId, 1, "be", nextBenchIndex),
      fantasyTeamId: pick.fantasyTeamId,
      mleTeamId,
      week: 1,
      position: "be",
      slotIndex: nextBenchIndex,
      isLocked: false,
    },
  });

  const nextPick = await prisma.draftPick.findFirst({
    where: { fantasyLeagueId: leagueId, pickedAt: null },
    orderBy: { overallPick: "asc" },
  });

  if (nextPick) {
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: { draftPickTimeSeconds: true },
    });
    const nextDeadline = new Date(Date.now() + (league?.draftPickTimeSeconds ?? 90) * 1000);
    await prisma.fantasyLeague.update({
      where: { id: leagueId },
      data: { draftPickDeadline: nextDeadline },
    });
    return { draftCompleted: false };
  }

  await prisma.fantasyLeague.update({
    where: { id: leagueId },
    data: { draftStatus: "completed", draftPickDeadline: null },
  });
  await initializeWaiverPriorityFromDraftOrder(leagueId);
  return { draftCompleted: true };
}
