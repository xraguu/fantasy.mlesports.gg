import { generateRosterSlotId } from "./id-generator";

export const TOTAL_WEEKS = 10;

/**
 * Overwrites every week from `fromWeek` through the end of the season with
 * the same final roster shape. Future weeks are never edited directly —
 * they're always just a live mirror of whatever the most recent real
 * change was (see the roster GET route's fallback to the current week for
 * any week that has no rows of its own yet) — so any mutation to a
 * not-yet-started week, whether a full lineup save or a single drop, has
 * to propagate the same way through every later week too, not just the
 * one week directly acted on. `fromWeek` itself must never be a frozen week
 * — callers must check isWeekFrozen (lib/autoLock.ts) first and reject
 * anything it flags. That's usually a week strictly after the league's real
 * current week, but not always: the current week itself stays unfrozen (and
 * so a valid `fromWeek`) until its own matchStart arrives, since isWeekFrozen
 * no longer treats "the current week" and "frozen" as synonymous the moment
 * the calendar week begins. Every row this creates is unconditionally
 * unlocked, which is correct either way — a not-yet-started future week is
 * never locked, and the current week during its pre-matchStart window isn't
 * locked yet either.
 */
export async function cascadeRosterForward(
  tx: any,
  fantasyTeamId: string,
  fromWeek: number,
  finalSlots: Array<{ position: string; slotIndex: number; mleTeamId: string }>
): Promise<void> {
  for (let week = fromWeek; week <= TOTAL_WEEKS; week++) {
    await tx.rosterSlot.deleteMany({ where: { fantasyTeamId, week } });
    if (finalSlots.length > 0) {
      await tx.rosterSlot.createMany({
        data: finalSlots.map((s) => ({
          id: generateRosterSlotId(fantasyTeamId, week, s.position, s.slotIndex),
          fantasyTeamId,
          mleTeamId: s.mleTeamId,
          week,
          position: s.position,
          slotIndex: s.slotIndex,
          isLocked: false,
        })),
      });
    }
  }
}
