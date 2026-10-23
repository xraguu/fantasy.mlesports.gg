/**
 * Rules for FAAB in trades, shared by the trade page and the trade routes so
 * they can't disagree. In a league on FAAB waivers, either side of a trade
 * can send whole FAAB dollars (up to its balance) along with, or instead of,
 * teams. Leagues on other waiver systems have no budget, so their trades
 * never include FAAB. No database code here, so the browser can use it too.
 */

/**
 * A FAAB amount from a form or request: whole dollars, 0 or more. Blank or
 * missing means 0. Returns null if the value isn't a valid amount.
 */
export function parseFaabAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isInteger(amount) && amount >= 0 ? amount : null;
}

/**
 * What's wrong with what a trade includes, or null if nothing is. Each side
 * has to give at least one team or some FAAB, at least one team has to
 * change hands (so it's never just FAAB for FAAB), and FAAB is only allowed
 * in FAAB leagues. Whether each side can afford its FAAB is checked
 * separately, since that needs the current balances.
 */
export function tradeContentsProblem(input: {
  isFaabLeague: boolean;
  proposerTeamCount: number;
  receiverTeamCount: number;
  proposerFaab: number;
  receiverFaab: number;
}): string | null {
  const { isFaabLeague, proposerTeamCount, receiverTeamCount, proposerFaab, receiverFaab } = input;
  if (!isFaabLeague && (proposerFaab > 0 || receiverFaab > 0)) {
    return "FAAB can only be traded in leagues that use FAAB waivers";
  }
  if (proposerTeamCount + receiverTeamCount === 0) {
    return "A trade has to include at least one team";
  }
  if ((proposerTeamCount === 0 && proposerFaab === 0) || (receiverTeamCount === 0 && receiverFaab === 0)) {
    return isFaabLeague
      ? "Each side of a trade has to give at least one team or some FAAB"
      : "Each side of a trade has to give at least one team";
  }
  return null;
}

/** "$15 FAAB" */
export function formatFaab(amount: number): string {
  return `$${amount} FAAB`;
}
