import { prisma } from "@/lib/prisma";
import { generateRosterSlotId } from "@/lib/id-generator";
import { initializeWaiverPriorityFromDraftOrder } from "@/lib/waiverPriority";

/**
 * The order draft picks fill a roster in — starters before bench ("top of
 * the roster" down), driven by the league's own configured slot counts
 * rather than a hardcoded shape.
 */
function buildOrderedPositions(rosterConfig: any): string[] {
  return [
    ...Array(rosterConfig?.["2s"] || 0).fill("2s"),
    ...Array(rosterConfig?.["3s"] || 0).fill("3s"),
    ...Array(rosterConfig?.flx || 0).fill("flx"),
    ...Array(rosterConfig?.be || 0).fill("be"),
  ];
}

/**
 * Commits a single draft pick: marks the DraftPick as picked, adds the team
 * to the picking manager's week-1 roster (the draft happens pre-season, so
 * week 1 is the first real roster) — filling 2s/3s/flx slots before bench,
 * in the league's configured order, not straight to bench regardless of
 * shape — and advances the league to the next pick's deadline (or completes
 * the draft if none remain).
 *
 * Single source of truth for the mutation, used by both the manual pick
 * route and the autopick sweep (lib/draftAutopick.ts) — callers are
 * responsible for their own validation (turn/ownership/already-drafted)
 * before calling this.
 *
 * The whole thing runs as one transaction, and the very first write is an
 * atomic conditional claim (`updateMany` gated on `pickedAt: null`) rather
 * than a separate read-then-write — the autopick sweep runs off both a
 * page-view trigger and a background interval, which can legitimately fire
 * within moments of each other once a deadline lapses. Without an atomic
 * claim, two concurrent calls for the same pick can both pass a plain
 * findUnique-then-update check before either commits, both compute the same
 * "next empty slot" from a roster snapshot that's already stale, and one of
 * them silently loses its roster slot to a unique-constraint collision —
 * confirmed live: exactly this happened once in 64 picks during a real
 * draft test, leaving a drafted team marked "picked" with no roster slot.
 */
export async function executeDraftPick(
  leagueId: string,
  draftPickId: string,
  mleTeamId: string
): Promise<{ draftCompleted: boolean }> {
  const draftCompleted = await prisma.$transaction(async (tx) => {
    const claim = await tx.draftPick.updateMany({
      where: { id: draftPickId, pickedAt: null },
      data: { mleTeamId, pickedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new Error("Pick is not available to be made");
    }

    const pick = await tx.draftPick.findUniqueOrThrow({ where: { id: draftPickId } });
    if (!pick.fantasyTeamId) {
      throw new Error("Pick is not available to be made");
    }

    const league = await tx.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: { rosterConfig: true, draftPickTimeSeconds: true },
    });
    const orderedPositions = buildOrderedPositions(league?.rosterConfig);

    const existingSlots = await tx.rosterSlot.findMany({
      where: { fantasyTeamId: pick.fantasyTeamId, week: 1 },
    });
    // Every prior pick for this team filled exactly one slot in order, so the
    // count of slots filled so far is this pick's index into that order —
    // falls back to bench if a team somehow has more picks than configured
    // roster slots.
    const position = orderedPositions[existingSlots.length] ?? "be";
    const slotIndex = existingSlots.filter((s) => s.position === position).length;

    await tx.rosterSlot.create({
      data: {
        id: generateRosterSlotId(pick.fantasyTeamId, 1, position, slotIndex),
        fantasyTeamId: pick.fantasyTeamId,
        mleTeamId,
        week: 1,
        position,
        slotIndex,
        isLocked: false,
      },
    });

    // Also clear this team out of every manager's draft queue (including
    // the picker's own) — it's no longer available to be auto-picked from a
    // stale queue entry.
    await tx.$executeRaw`UPDATE "FantasyTeam" SET "draftQueue" = array_remove("draftQueue", ${mleTeamId}) WHERE "fantasyLeagueId" = ${leagueId}`;

    const nextPick = await tx.draftPick.findFirst({
      where: { fantasyLeagueId: leagueId, pickedAt: null },
      orderBy: { overallPick: "asc" },
    });

    if (nextPick) {
      const nextDeadline = new Date(Date.now() + (league?.draftPickTimeSeconds ?? 90) * 1000);
      await tx.fantasyLeague.update({
        where: { id: leagueId },
        data: { draftPickDeadline: nextDeadline },
      });
      return false;
    }

    await tx.fantasyLeague.update({
      where: { id: leagueId },
      data: { draftStatus: "completed", draftPickDeadline: null },
    });
    return true;
  });

  if (draftCompleted) {
    await initializeWaiverPriorityFromDraftOrder(leagueId);
  }
  return { draftCompleted };
}
