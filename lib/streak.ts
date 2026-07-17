/**
 * Current win/loss streak (e.g. "W3", "L2") from a team's own chronological
 * game results — looks back at most the last 5 games. Shared by every page
 * that shows a streak so they can't drift from each other.
 */
export function computeStreak(results: Array<{ week: number; result: "W" | "L" | null }>): string {
  const sorted = [...results].sort((a, b) => a.week - b.week);
  const gameResults = sorted
    .filter((r): r is { week: number; result: "W" | "L" } => r.result !== null)
    .map((r) => r.result);

  const recentGames = gameResults.slice(-5);
  let streak = 0;
  const streakType = recentGames[recentGames.length - 1] || "L";

  for (let i = recentGames.length - 1; i >= 0; i--) {
    if (recentGames[i] === streakType) {
      streak++;
    } else {
      break;
    }
  }

  return `${streakType}${streak}`;
}
