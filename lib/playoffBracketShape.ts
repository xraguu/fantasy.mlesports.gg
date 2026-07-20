export interface PlayoffRoundShape {
  roundNumber: number;
  moneyMatches: number;
  moneyByes: number;
  /** One label per money match slot, in the same order the real generator creates them (see lib/scheduleGenerator.ts). Undefined entries fall back to a generic "Round N" label. */
  moneyMatchLabels?: string[];
  consolationMatches: number;
  consolationMatchLabels?: string[];
}

/**
 * The static shape of the playoff bracket for a given league size — how many
 * money-bracket matches/byes and consolation-bracket matches exist in each
 * round, independent of who's actually in them, plus placement labels for
 * the rounds that decide a specific final standing (championship / 3rd
 * place / 5th place / etc). Mirrors exactly what lib/scheduleGenerator.ts
 * generates round by round (top-4/top-6/consolation waterfall/ladder,
 * including each round's real match ORDER, which the labels below rely on),
 * just without any DB access, so it's safe to import from client components
 * to render the full bracket skeleton — including rounds that haven't been
 * generated yet — before any results exist.
 */
export function getPlayoffBracketShape(maxTeams: number): PlayoffRoundShape[] {
  if (maxTeams === 8) {
    return [
      { roundNumber: 1, moneyMatches: 2, moneyByes: 0, consolationMatches: 2 },
      {
        roundNumber: 2,
        moneyMatches: 2,
        moneyByes: 0,
        moneyMatchLabels: ["Championship", "3rd Place Game"],
        consolationMatches: 2,
        consolationMatchLabels: ["5th Place Game", "7th Place Game"],
      },
    ];
  }
  if (maxTeams === 10) {
    return [
      { roundNumber: 1, moneyMatches: 2, moneyByes: 0, consolationMatches: 3 },
      {
        roundNumber: 2,
        moneyMatches: 2,
        moneyByes: 0,
        moneyMatchLabels: ["Championship", "3rd Place Game"],
        consolationMatches: 3,
        consolationMatchLabels: ["5th Place Game", "7th Place Game", "9th Place Game"],
      },
    ];
  }
  if (maxTeams === 12) {
    return [
      { roundNumber: 1, moneyMatches: 2, moneyByes: 2, consolationMatches: 3 },
      { roundNumber: 2, moneyMatches: 2, moneyByes: 0, consolationMatches: 3 },
      {
        roundNumber: 3,
        moneyMatches: 3,
        moneyByes: 0,
        moneyMatchLabels: ["Championship", "3rd Place Game", "5th Place Game"],
        consolationMatches: 3,
        consolationMatchLabels: ["7th Place Game", "9th Place Game", "11th Place Game"],
      },
    ];
  }
  return [];
}
