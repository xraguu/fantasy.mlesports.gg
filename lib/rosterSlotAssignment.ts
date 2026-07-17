import { generateRosterSlotId } from "./id-generator";

/**
 * Puts `mleTeamId` onto a fantasy team's roster for a week — the shared
 * logic behind every roster mutation that isn't the draft itself (waiver
 * claims, trades). If `dropTeamId` names a team currently in one of that
 * week's slots, the incoming team takes its EXACT slot (position + index)
 * via an in-place update, not a delete-then-append-to-bench — a manager
 * swapping in a replacement expects it in the same lineup spot, not bumped
 * to the bench. With no drop team (or the drop team wasn't actually
 * rostered that week), finds the first genuinely empty slot in the league's
 * configured order (2s, 3s, flx, be) — never blindly appends past a
 * position's configured count, which used to silently create roster rows
 * My Roster could never render (it only ever iterates 0..config[position]-1
 * per position).
 */
export async function assignTeamToRosterSlot(
  tx: any,
  params: {
    fantasyTeamId: string;
    week: number;
    mleTeamId: string;
    dropTeamId?: string | null;
    rosterConfig: any;
  }
): Promise<void> {
  const { fantasyTeamId, week, mleTeamId, dropTeamId, rosterConfig } = params;

  if (dropTeamId) {
    const slotToReplace = await tx.rosterSlot.findFirst({
      where: { fantasyTeamId, week, mleTeamId: dropTeamId },
    });
    if (slotToReplace) {
      await tx.rosterSlot.update({
        where: { id: slotToReplace.id },
        data: { mleTeamId },
      });
      return;
    }
    // Drop team wasn't actually on this week's roster (edge case, e.g. it
    // was already removed by something else) — fall through to the
    // empty-slot search below instead of silently no-oping the add.
  }

  const orderedPositions = [
    ...Array(rosterConfig?.["2s"] || 0).fill("2s"),
    ...Array(rosterConfig?.["3s"] || 0).fill("3s"),
    ...Array(rosterConfig?.flx || 0).fill("flx"),
    ...Array(rosterConfig?.be || 0).fill("be"),
  ];

  const existingSlots = await tx.rosterSlot.findMany({
    where: { fantasyTeamId, week },
  });
  const filled = new Set(existingSlots.map((s: any) => `${s.position}-${s.slotIndex}`));

  const perPositionIndex = new Map<string, number>();
  for (const position of orderedPositions) {
    const idx = perPositionIndex.get(position) ?? 0;
    perPositionIndex.set(position, idx + 1);
    if (!filled.has(`${position}-${idx}`)) {
      await tx.rosterSlot.create({
        data: {
          id: generateRosterSlotId(fantasyTeamId, week, position, idx),
          fantasyTeamId,
          mleTeamId,
          week,
          position,
          slotIndex: idx,
          isLocked: false,
        },
      });
      return;
    }
  }

  // Roster is fully saturated per its configured shape (shouldn't happen if
  // capacity is enforced before this is called) — defensive fallback: an
  // extra bench slot rather than silently dropping the pickup.
  const bench = existingSlots.filter((s: any) => s.position === "be").length;
  await tx.rosterSlot.create({
    data: {
      id: generateRosterSlotId(fantasyTeamId, week, "be", bench),
      fantasyTeamId,
      mleTeamId,
      week,
      position: "be",
      slotIndex: bench,
      isLocked: false,
    },
  });
}
