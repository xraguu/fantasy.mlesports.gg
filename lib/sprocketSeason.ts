/**
 * Sprocket's public dataset files are named by MLE's own season number
 * (e.g. `player_stats_s19.csv`), which is NOT the same number as
 * `FantasyLeague.season`/`SeasonSettings.season` (a fantasy-league label —
 * currently "2026" — chosen independently of MLE's own numbering). Fetching
 * a Sprocket CSV using the fantasy season number produces a URL that
 * doesn't exist (403), so every live Sprocket fetch has to go through this
 * instead. `SeasonSettings.draftStatsSeason` (e.g. "Season 19", already
 * admin-configurable in Settings) is the one place that already stores
 * MLE's real season number in the right format — extract it from there
 * rather than introducing a second, easy-to-desync setting.
 */
export function parseSprocketSeasonNumber(label: string | null | undefined): number | null {
  if (!label) return null;
  const match = label.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
