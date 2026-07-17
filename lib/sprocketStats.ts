import { parse } from "csv-parse/sync";
import { prisma } from "./prisma";
import { parseSprocketSeasonNumber } from "./sprocketSeason";
import { getWeekMatchRange } from "./weekMatchRange";

export const SPROCKET_BASE_URL =
  "https://sprocket-public-datasets.nyc3.cdn.digitaloceanspaces.com/datasets";

const LEAGUE_NAME_TO_ID: Record<string, string> = {
  "Foundation League": "FL",
  "Academy League": "AL",
  "Champion League": "CL",
  "Master League": "ML",
  "Premier League": "PL",
};

// player_stats_sXX.csv and matches.csv use two different gamemode vocabularies
// for the same two modes — map both onto the "2s"/"3s" keys used everywhere else.
const PLAYER_GAMEMODE_TO_KEY: Record<string, "2s" | "3s"> = {
  RL_DOUBLES: "2s",
  RL_STANDARD: "3s",
};
const MATCH_GAMEMODE_TO_KEY: Record<string, "2s" | "3s"> = {
  Doubles: "2s",
  Standard: "3s",
};

interface SprocketMatch {
  match_id: string;
  match_group_id: string;
  scheduling_start_time: string;
  scheduled_time: string;
  home: string;
  away: string;
  league: string;
  game_mode: string;
  home_wins: string;
  away_wins: string;
  winning_team: string;
}

/**
 * `scheduled_time` is blank for a meaningful slice of real, completed
 * matches (their `scheduling_start_time`/`scheduling_end_time` are still
 * populated) — falling back to it instead of silently excluding the match
 * (`new Date("")` is an Invalid Date, which any range comparison drops).
 */
function matchTime(m: SprocketMatch): Date | null {
  const raw = m.scheduled_time || m.scheduling_start_time;
  if (!raw) return null;
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
}

interface SprocketPlayerStat {
  member_id: string;
  team_name: string;
  skill_group: string;
  gamemode: string;
  match_id: string;
  round_id: string;
  home_won: string;
  gpi: string;
  goals: string;
  saves: string;
  shots: string;
  assists: string;
  demos_inflicted: string;
  demos_taken: string;
}

interface TeamWeekAggregate {
  teamName: string;
  leagueCode: string;
  gamemode: "2s" | "3s";
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  gpiSum: number;
  roundCount: number;
  wins: number;
  losses: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  manualOverrides: number;
  matchesFound: number;
  errors: string[];
  teams: Array<{
    teamId: string;
    name: string;
    goals: number;
    wins: number;
    isManualOverride: boolean;
  }>;
}

export async function fetchCsvText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export async function importSprocketStatsForWeek(
  week: number,
  season: number
): Promise<ImportResult> {
  const errors: string[] = [];

  // 1. Get week date range from SeasonSettings
  const settings = await prisma.seasonSettings.findFirst({
    where: { season },
    orderBy: { season: "desc" },
  });

  if (!settings) {
    throw new Error(`No SeasonSettings found for season ${season}. Configure it at /admin/settings first.`);
  }

  const sprocketSeason = parseSprocketSeasonNumber(settings.draftStatsSeason);
  if (sprocketSeason === null) {
    throw new Error(
      `Season Settings' "Current Season" isn't configured — set it at /admin/settings first. It determines which MLE season's live Sprocket data to pull (e.g. "Season 19"), which is a different number than the fantasy season (${season}).`
    );
  }

  const weekDates = settings.weekDates as Array<{
    week: number;
    startDate: string;
    endDate: string;
  }>;
  const weekConfig = weekDates.find((w) => w.week === week);

  if (!weekConfig?.startDate || !weekConfig?.endDate) {
    throw new Error(
      `No date range configured for week ${week} in Season ${season} settings.`
    );
  }

  const range = getWeekMatchRange(weekDates, week)!;
  const weekStart = range.start;
  const weekEnd = range.end;

  // 2. Fetch matches.csv and find this week's matches
  const matchesCsv = await fetchCsvText(`${SPROCKET_BASE_URL}/matches.csv`);
  const allMatches = parse(matchesCsv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as SprocketMatch[];

  const weekMatches = allMatches.filter((m) => {
    if (m.winning_team === "Not Played / Data Unavailable") return false;
    const matchDate = matchTime(m);
    if (!matchDate) return false;
    return matchDate >= weekStart && matchDate < weekEnd;
  });

  if (weekMatches.length === 0) {
    throw new Error(
      `No completed matches found for week ${week} (${weekConfig.startDate} to ${weekConfig.endDate}). ` +
        `Check that week dates in Season Settings match when MLE actually plays.`
    );
  }

  const weekMatchIds = new Set(weekMatches.map((m) => m.match_id));

  // 3. Fetch player stats for this season
  const playerStatsCsv = await fetchCsvText(
    `${SPROCKET_BASE_URL}/player_stats_s${sprocketSeason}.csv`
  );
  const allPlayerStats = parse(playerStatsCsv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as SprocketPlayerStat[];

  const weekPlayerStats = allPlayerStats.filter((p) =>
    weekMatchIds.has(p.match_id)
  );

  // 4. Aggregate player-level stats up to team level, split by gamemode
  const teamAggMap = new Map<string, TeamWeekAggregate>();

  for (const stat of weekPlayerStats) {
    const leagueCode = LEAGUE_NAME_TO_ID[stat.skill_group];
    const gamemode = PLAYER_GAMEMODE_TO_KEY[stat.gamemode];
    if (!leagueCode || !gamemode) continue;

    const key = `${leagueCode}:${stat.team_name}:${gamemode}`;
    if (!teamAggMap.has(key)) {
      teamAggMap.set(key, {
        teamName: stat.team_name,
        leagueCode,
        gamemode,
        goals: 0,
        shots: 0,
        saves: 0,
        assists: 0,
        demosInflicted: 0,
        demosTaken: 0,
        gpiSum: 0,
        roundCount: 0,
        wins: 0,
        losses: 0,
      });
    }

    const agg = teamAggMap.get(key)!;
    agg.goals += parseFloat(stat.goals) || 0;
    agg.shots += parseFloat(stat.shots) || 0;
    agg.saves += parseFloat(stat.saves) || 0;
    agg.assists += parseFloat(stat.assists) || 0;
    agg.demosInflicted += parseFloat(stat.demos_inflicted) || 0;
    agg.demosTaken += parseFloat(stat.demos_taken) || 0;
    agg.gpiSum += parseFloat(stat.gpi) || 0;
    agg.roundCount += 1;
  }

  // 5. Add wins/losses from matches (game-level, not series-level), split by gamemode
  for (const match of weekMatches) {
    const leagueCode = LEAGUE_NAME_TO_ID[match.league];
    const gamemode = MATCH_GAMEMODE_TO_KEY[match.game_mode];
    if (!leagueCode || !gamemode) continue;

    const homeKey = `${leagueCode}:${match.home}:${gamemode}`;
    const awayKey = `${leagueCode}:${match.away}:${gamemode}`;
    const homeWins = parseInt(match.home_wins) || 0;
    const awayWins = parseInt(match.away_wins) || 0;

    if (teamAggMap.has(homeKey)) {
      teamAggMap.get(homeKey)!.wins += homeWins;
      teamAggMap.get(homeKey)!.losses += awayWins;
    }
    if (teamAggMap.has(awayKey)) {
      teamAggMap.get(awayKey)!.wins += awayWins;
      teamAggMap.get(awayKey)!.losses += homeWins;
    }
  }

  // 6. Resolve DB team IDs and upsert TeamWeeklyStats
  let imported = 0;
  let skipped = 0;
  let manualOverrides = 0;
  const importedTeams: ImportResult["teams"] = [];

  for (const [, agg] of teamAggMap.entries()) {
    const mleTeam = await prisma.mLETeam.findFirst({
      where: { name: agg.teamName, leagueId: agg.leagueCode },
    });

    if (!mleTeam) {
      errors.push(`DB miss: ${agg.leagueCode} ${agg.teamName}`);
      skipped++;
      continue;
    }

    // Check for manual override — it takes precedence
    const override = await prisma.manualStatsOverride.findUnique({
      where: { teamId_week_gamemode: { teamId: mleTeam.id, week, gamemode: agg.gamemode } },
    });

    let statsToWrite: {
      goals: number;
      shots: number;
      saves: number;
      assists: number;
      demosInflicted: number;
      demosTaken: number;
      sprocketRating: number;
      wins: number;
      losses: number;
    };
    let isManualOverride = false;

    if (override) {
      const parts = override.gameRecord.split("-");
      statsToWrite = {
        goals: override.goals,
        shots: override.shots,
        saves: override.saves,
        assists: override.assists,
        demosInflicted: override.demosInflicted,
        demosTaken: override.demosTaken,
        sprocketRating: override.saveRate,
        wins: parseInt(parts[0]) || 0,
        losses: parseInt(parts[1]) || 0,
      };
      isManualOverride = true;
      manualOverrides++;
    } else {
      const avgGpi =
        agg.roundCount > 0
          ? Math.round((agg.gpiSum / agg.roundCount) * 100) / 100
          : 0;
      statsToWrite = {
        goals: Math.round(agg.goals),
        shots: Math.round(agg.shots),
        saves: Math.round(agg.saves),
        assists: Math.round(agg.assists),
        demosInflicted: Math.round(agg.demosInflicted),
        demosTaken: Math.round(agg.demosTaken),
        sprocketRating: avgGpi,
        wins: agg.wins,
        losses: agg.losses,
      };
    }

    await prisma.teamWeeklyStats.upsert({
      where: { teamId_week_gamemode: { teamId: mleTeam.id, week, gamemode: agg.gamemode } },
      update: statsToWrite,
      create: { teamId: mleTeam.id, week, gamemode: agg.gamemode, ...statsToWrite },
    });

    imported++;
    importedTeams.push({
      teamId: mleTeam.id,
      name: `${agg.leagueCode} ${agg.teamName} (${agg.gamemode})`,
      goals: statsToWrite.goals,
      wins: statsToWrite.wins,
      isManualOverride,
    });
  }

  return {
    imported,
    skipped,
    manualOverrides,
    matchesFound: weekMatches.length,
    errors,
    teams: importedTeams.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
