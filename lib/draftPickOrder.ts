export interface DraftOrderTeam {
  id: string;
  draftPosition: number | null;
}

export interface DraftPickOrderEntry {
  round: number;
  pickNumber: number;
  overallPick: number;
  fantasyTeamId: string;
}

/**
 * The pick order for every round of a draft, given each team's draft
 * position — snake drafts reverse the order on even rounds, linear drafts
 * keep the same order every round. Teams without an assigned draftPosition
 * yet sort last (stable by id) so this never throws before positions are
 * set; the real order isn't final until every team has one.
 *
 * Shared by the admin "Initialize & Start Draft" action (which persists this
 * as real DraftPick rows) and the draft room's pre-draft preview (which
 * shows the same shape without persisting anything), so the two can never
 * drift apart.
 */
export function generateDraftPickOrder(
  teams: DraftOrderTeam[],
  draftType: string,
  numRounds: number
): DraftPickOrderEntry[] {
  const orderedTeams = [...teams].sort((a, b) => {
    const posA = a.draftPosition ?? Infinity;
    const posB = b.draftPosition ?? Infinity;
    if (posA !== posB) return posA - posB;
    return a.id.localeCompare(b.id);
  });

  const entries: DraftPickOrderEntry[] = [];
  let overallPick = 1;

  for (let round = 1; round <= numRounds; round++) {
    const pickOrder =
      draftType === "snake" && round % 2 === 0 ? [...orderedTeams].reverse() : orderedTeams;

    for (let i = 0; i < pickOrder.length; i++) {
      entries.push({
        round,
        pickNumber: i + 1,
        overallPick,
        fantasyTeamId: pickOrder[i].id,
      });
      overallPick++;
    }
  }

  return entries;
}
