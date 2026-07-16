import { prisma } from "@/lib/prisma";

/**
 * Finds the RosterSlot (if any) holding a given MLE team on a fantasy
 * team's roster for a week, when that slot is locked. Used to block manager
 * transactions (trades, waivers, FA pickups, drops) from touching a team
 * that's currently locked in — admin roster edits are exempt (see
 * lib/adminRosterActions.ts / the admin Edit Roster tool), since that's an
 * explicit override, not a manager-initiated transaction.
 */
export async function findLockedSlotForTeam(
  fantasyTeamId: string,
  week: number,
  mleTeamId: string
) {
  return prisma.rosterSlot.findFirst({
    where: { fantasyTeamId, week, mleTeamId, isLocked: true },
    include: { mleTeam: { select: { name: true, leagueId: true } } },
  });
}

export function lockedTeamErrorMessage(
  mleTeam: { name: string; leagueId: string } | null | undefined
): string {
  const label = mleTeam ? `${mleTeam.leagueId} ${mleTeam.name}` : "That team";
  return `${label} is locked and can't be part of a transaction until it unlocks`;
}
