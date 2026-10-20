import { parse } from "csv-parse/sync";
import { prisma } from "./prisma";
import { getWeekMatchRange } from "./weekMatchRange";

export const SPROCKET_BASE_URL =
  "https://sprocket-public-datasets.nyc3.cdn.digitaloceanspaces.com/datasets";

export const LEAGUE_NAME_TO_ID: Record<string, string> = {
  "Foundation League": "FL",
  "Academy League": "AL",
  "Champion League": "CL",
  "Master League": "ML",
  "Premier League": "PL",
};

// player_stats_sXX.csv and matches.csv use two different gamemode vocabularies
// for the same two modes — map both onto the "2s"/"3s" keys used everywhere else.
export const PLAYER_GAMEMODE_TO_KEY: Record<string, "2s" | "3s"> = {
  RL_DOUBLES: "2s",
  RL_STANDARD: "3s",
};
export const MATCH_GAMEMODE_TO_KEY: Record<string, "2s" | "3s"> = {
  Doubles: "2s",
  Standard: "3s",
};

// Players on the field per team in each mode
export const PLAYERS_PER_TEAM: Record<string, number> = { "2s": 2, "3s": 3 };

export interface SprocketMatch {
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

/** One player's stats for one game (round) — a row of player_stats_sXX.csv. */
export interface SprocketPlayerStat {
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
  // The whole team's figure for that game, repeated on every teammate's row
  goals_against: string;
  shots_against: string;
  demos_inflicted: string;
  demos_taken: string;
}

/** One MLE team's totals for a week in one game mode, before it's matched to a database team. */
export interface TeamWeekAggregate {
  teamName: string;
  leagueCode: string;
  gamemode: "2s" | "3s";
  goals: number;
  goalsAgainst: number;
  shots: number;
  shotsAgainst: number;
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
  // Matches counted from their result alone because they have no player
  // stats: a forfeit, or replays that haven't been uploaded yet
  resultOnlyMatches: string[];
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

const NOT_PLAYED = "Not Played / Data Unavailable";

/**
 * The matches in matches.csv (which covers every season) that belong to the
 * season a player_stats_sXX.csv file covers, leaving out unplayed ones. A
 * match belongs if it's in the same week group (match_group_id) as a match
 * that has player stats — not only matches with player stats themselves,
 * since a forfeit is in matches.csv with a result (usually 5-0) but has no
 * player stats at all.
 */
export function selectSeasonMatches(
  allMatches: SprocketMatch[],
  allPlayerStats: SprocketPlayerStat[]
): SprocketMatch[] {
  const statMatchIds = new Set(allPlayerStats.map((p) => p.match_id));
  const seasonGroupIds = new Set(
    allMatches.filter((m) => statMatchIds.has(m.match_id)).map((m) => m.match_group_id)
  );
  return allMatches.filter(
    (m) => m.winning_team !== NOT_PLAYED && seasonGroupIds.has(m.match_group_id) && matchTime(m) !== null
  );
}

/**
 * Adds a week's player stats up into team totals per game mode, then adds
 * each team's game wins and losses from its matches. Every team in one of
 * the week's matches gets totals — including a team with no player stats
 * (a forfeit), whose stats are all 0 apart from its game wins/losses.
 */
export function aggregateTeamWeekStats(
  weekMatches: SprocketMatch[],
  weekPlayerStats: SprocketPlayerStat[]
): TeamWeekAggregate[] {
  const teamAggMap = new Map<string, TeamWeekAggregate>();
  const getAgg = (leagueCode: string, teamName: string, gamemode: "2s" | "3s") => {
    const key = `${leagueCode}:${teamName}:${gamemode}`;
    let agg = teamAggMap.get(key);
    if (!agg) {
      agg = {
        teamName,
        leagueCode,
        gamemode,
        goals: 0,
        goalsAgainst: 0,
        shots: 0,
        shotsAgainst: 0,
        saves: 0,
        assists: 0,
        demosInflicted: 0,
        demosTaken: 0,
        gpiSum: 0,
        roundCount: 0,
        wins: 0,
        losses: 0,
      };
      teamAggMap.set(key, agg);
    }
    return agg;
  };

  // Each player row's goals/shots against is the whole team's figure for
  // that game, so it's counted once per team per game (round), not per player
  const countedRounds = new Set<string>();

  for (const stat of weekPlayerStats) {
    const leagueCode = LEAGUE_NAME_TO_ID[stat.skill_group];
    const gamemode = PLAYER_GAMEMODE_TO_KEY[stat.gamemode];
    if (!leagueCode || !gamemode) continue;

    const agg = getAgg(leagueCode, stat.team_name, gamemode);
    agg.goals += parseFloat(stat.goals) || 0;
    agg.shots += parseFloat(stat.shots) || 0;
    agg.saves += parseFloat(stat.saves) || 0;
    agg.assists += parseFloat(stat.assists) || 0;
    agg.demosInflicted += parseFloat(stat.demos_inflicted) || 0;
    agg.demosTaken += parseFloat(stat.demos_taken) || 0;
    agg.gpiSum += parseFloat(stat.gpi) || 0;
    agg.roundCount += 1;

    const roundKey = `${leagueCode}:${stat.team_name}:${gamemode}:${stat.round_id}`;
    if (!countedRounds.has(roundKey)) {
      countedRounds.add(roundKey);
      agg.goalsAgainst += parseFloat(stat.goals_against) || 0;
      agg.shotsAgainst += parseFloat(stat.shots_against) || 0;
    }
  }

  // Game wins/losses come from the match result (game-level, not series-level)
  for (const match of weekMatches) {
    const leagueCode = LEAGUE_NAME_TO_ID[match.league];
    const gamemode = MATCH_GAMEMODE_TO_KEY[match.game_mode];
    if (!leagueCode || !gamemode) continue;

    const homeWins = parseInt(match.home_wins) || 0;
    const awayWins = parseInt(match.away_wins) || 0;
    const home = getAgg(leagueCode, match.home, gamemode);
    const away = getAgg(leagueCode, match.away, gamemode);
    home.wins += homeWins;
    home.losses += awayWins;
    away.wins += awayWins;
    away.losses += homeWins;
  }

  return [...teamAggMap.values()];
}

/** One player's totals for a week in one game mode, before it's matched to a database player. */
export interface PlayerWeekAggregate {
  memberId: string;
  leagueCode: string;
  teamName: string;
  gamemode: "2s" | "3s";
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  gpiSum: number;
  roundCount: number;
}

/**
 * Adds a week's player stats up into per-player totals per game mode — the
 * player-level counterpart to aggregateTeamWeekStats above, from the exact
 * same rows. Win/loss isn't computed here: a player doesn't have a result
 * independent of their team's game outcome for that round, so callers
 * attribute each player's week record from their team's aggregate instead
 * (see aggregateTeamWeekStats's `wins`/`losses`, keyed the same way via
 * leagueCode/teamName/gamemode).
 */
export function aggregatePlayerWeekStats(
  weekPlayerStats: SprocketPlayerStat[]
): PlayerWeekAggregate[] {
  const playerAggMap = new Map<string, PlayerWeekAggregate>();
  const getAgg = (memberId: string, leagueCode: string, teamName: string, gamemode: "2s" | "3s") => {
    const key = `${memberId}:${gamemode}`;
    let agg = playerAggMap.get(key);
    if (!agg) {
      agg = {
        memberId,
        leagueCode,
        teamName,
        gamemode,
        goals: 0,
        shots: 0,
        saves: 0,
        assists: 0,
        demosInflicted: 0,
        demosTaken: 0,
        gpiSum: 0,
        roundCount: 0,
      };
      playerAggMap.set(key, agg);
    }
    return agg;
  };

  for (const stat of weekPlayerStats) {
    const leagueCode = LEAGUE_NAME_TO_ID[stat.skill_group];
    const gamemode = PLAYER_GAMEMODE_TO_KEY[stat.gamemode];
    if (!leagueCode || !gamemode || !stat.member_id) continue;

    const agg = getAgg(stat.member_id, leagueCode, stat.team_name, gamemode);
    agg.goals += parseFloat(stat.goals) || 0;
    agg.shots += parseFloat(stat.shots) || 0;
    agg.saves += parseFloat(stat.saves) || 0;
    agg.assists += parseFloat(stat.assists) || 0;
    agg.demosInflicted += parseFloat(stat.demos_inflicted) || 0;
    agg.demosTaken += parseFloat(stat.demos_taken) || 0;
    agg.gpiSum += parseFloat(stat.gpi) || 0;
    agg.roundCount += 1;
  }

  return [...playerAggMap.values()];
}

/** "PL Outlaws 0-5 Express (2s)", for import notes. */
function describeMatch(m: SprocketMatch): string {
  const league = LEAGUE_NAME_TO_ID[m.league] ?? m.league;
  const mode = MATCH_GAMEMODE_TO_KEY[m.game_mode] ?? m.game_mode;
  return `${league} ${m.home} ${m.home_wins}-${m.away_wins} ${m.away} (${mode})`;
}

type WeeklyStatsFields = {
  goals: number;
  goalsAgainst: number;
  shots: number;
  shotsAgainst: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  sprocketRating: number;
  wins: number;
  losses: number;
};

function statsFromAggregate(agg: TeamWeekAggregate): WeeklyStatsFields {
  return {
    goals: Math.round(agg.goals),
    goalsAgainst: Math.round(agg.goalsAgainst),
    shots: Math.round(agg.shots),
    shotsAgainst: Math.round(agg.shotsAgainst),
    saves: Math.round(agg.saves),
    assists: Math.round(agg.assists),
    demosInflicted: Math.round(agg.demosInflicted),
    demosTaken: Math.round(agg.demosTaken),
    // Sprocket Rating = the team's average GPI over its players' games (0 with no player stats)
    sprocketRating: agg.roundCount > 0 ? Math.round((agg.gpiSum / agg.roundCount) * 100) / 100 : 0,
    wins: agg.wins,
    losses: agg.losses,
  };
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

  // The fantasy season number IS the real MLE season number by policy (kept
  // in sync via Admin Settings' "Current Season") — no separate setting to
  // translate one to the other, so there's nothing else here that can drift
  // out of sync with it.
  const sprocketSeason = season;

  const weekDates = settings.weekDates as Array<{
    week: number;
    weekStart: string;
    matchStart: string;
    weekEnd: string;
  }>;
  const weekConfig = weekDates.find((w) => w.week === week);

  if (!weekConfig?.matchStart || !weekConfig?.weekEnd) {
    throw new Error(
      `No match date range configured for week ${week} in Season ${season} settings.`
    );
  }

  // Named distinctly from the schema's own `weekStart`/`weekEnd` fields —
  // this is the actual match-search range returned by getWeekMatchRange
  // (matchStart through next week's matchStart, or a fallback cushion),
  // not the calendar week boundaries themselves.
  const range = getWeekMatchRange(weekDates, week)!;
  const rangeStart = range.start;
  const rangeEnd = range.end;

  // 2. Fetch matches.csv and player stats up front — player stats are
  // season-specific, so they also tell us which matches (and week groups)
  // belong to this Sprocket season, which the chronological fallback below
  // needs too.
  const matchesCsv = await fetchCsvText(`${SPROCKET_BASE_URL}/matches.csv`);
  const allMatches = parse(matchesCsv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as SprocketMatch[];

  const playerStatsCsv = await fetchCsvText(
    `${SPROCKET_BASE_URL}/player_stats_s${sprocketSeason}.csv`
  );
  const allPlayerStats = parse(playerStatsCsv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as SprocketPlayerStat[];

  // Includes forfeits, which have a result but no player stats
  const seasonMatches = selectSeasonMatches(allMatches, allPlayerStats);

  let weekMatches = seasonMatches.filter((m) => {
    const matchDate = matchTime(m)!;
    return matchDate >= rangeStart && matchDate < rangeEnd;
  });

  const fallbackNotes: string[] = [];

  // Configured week dates are meant to line up with when the matches were
  // actually played, but testing/historical-replay setups regularly reuse a
  // past season's data under made-up calendar dates that don't overlap it
  // at all. Rather than hard-failing in that case, fall back to "the Nth
  // chronological cluster of this season's real matches" as a stand-in for
  // week N — clusters are match groups separated by >2-day gaps, which
  // reliably reproduces the season's actual week boundaries (verified
  // against Season 19: cleanly split into exactly 10 clusters matching its
  // 10 real weeks). This never triggers when the configured dates actually
  // overlap real matches, so normal production behavior is unaffected.
  if (weekMatches.length === 0) {
    const sorted = [...seasonMatches].sort(
      (a, b) => matchTime(a)!.getTime() - matchTime(b)!.getTime()
    );
    const clusters: SprocketMatch[][] = [];
    let current: SprocketMatch[] = [];
    for (const m of sorted) {
      if (current.length > 0) {
        const gapDays =
          (matchTime(m)!.getTime() - matchTime(current[current.length - 1])!.getTime()) /
          (1000 * 60 * 60 * 24);
        if (gapDays > 2) {
          clusters.push(current);
          current = [];
        }
      }
      current.push(m);
    }
    if (current.length > 0) clusters.push(current);

    const cluster = clusters[week - 1];
    if (cluster && cluster.length > 0) {
      weekMatches = cluster;
      const clusterStart = matchTime(cluster[0])!.toISOString().slice(0, 10);
      const clusterEnd = matchTime(cluster[cluster.length - 1])!.toISOString().slice(0, 10);
      fallbackNotes.push(
        `Week ${week}'s configured match dates (${weekConfig.matchStart} to ${weekConfig.weekEnd}) had no real matches — ` +
          `used chronological cluster ${week} of Season ${sprocketSeason} instead (${clusterStart} to ${clusterEnd}, ${cluster.length} matches).`
      );
    }
  }

  if (weekMatches.length === 0) {
    throw new Error(
      `No completed matches found for week ${week} (${weekConfig.matchStart} to ${weekConfig.weekEnd}), ` +
        `and no chronological fallback cluster ${week} exists for Season ${sprocketSeason} either. ` +
        `Check that week dates in Season Settings match when MLE actually plays.`
    );
  }

  errors.push(...fallbackNotes);

  const weekMatchIds = new Set(weekMatches.map((m) => m.match_id));
  const weekPlayerStats = allPlayerStats.filter((p) =>
    weekMatchIds.has(p.match_id)
  );

  // 4-5. Team totals per game mode, with game wins/losses — including teams
  // in a forfeit, which have no player stats
  const aggregates = aggregateTeamWeekStats(weekMatches, weekPlayerStats);
  const statMatchIds = new Set(weekPlayerStats.map((p) => p.match_id));
  const resultOnlyMatches = weekMatches.filter((m) => !statMatchIds.has(m.match_id)).map(describeMatch);

  // 6. Match each team to the database and save its week. A manual override
  // replaces the imported numbers, including for a team that isn't in this
  // week's Sprocket data at all.
  const mleTeams = await prisma.mLETeam.findMany({ select: { id: true, name: true, leagueId: true } });
  const teamByKey = new Map(mleTeams.map((t) => [`${t.leagueId}:${t.name}`, t]));
  const teamById = new Map(mleTeams.map((t) => [t.id, t]));
  const overrides = await prisma.manualStatsOverride.findMany({ where: { season, week } });
  const overrideByKey = new Map(overrides.map((o) => [`${o.teamId}:${o.gamemode}`, o]));

  const toSave: Array<{ team: (typeof mleTeams)[number]; gamemode: string; imported: WeeklyStatsFields | null }> = [];
  let skipped = 0;
  for (const agg of aggregates) {
    const team = teamByKey.get(`${agg.leagueCode}:${agg.teamName}`);
    if (!team) {
      errors.push(`DB miss: ${agg.leagueCode} ${agg.teamName}`);
      skipped++;
      continue;
    }
    toSave.push({ team, gamemode: agg.gamemode, imported: statsFromAggregate(agg) });
  }
  const covered = new Set(toSave.map((s) => `${s.team.id}:${s.gamemode}`));
  for (const o of overrides) {
    const team = teamById.get(o.teamId);
    if (team && !covered.has(`${o.teamId}:${o.gamemode}`)) {
      toSave.push({ team, gamemode: o.gamemode, imported: null });
    }
  }

  let imported = 0;
  let manualOverrides = 0;
  const importedTeams: ImportResult["teams"] = [];

  for (const { team, gamemode, imported: importedStats } of toSave) {
    const override = overrideByKey.get(`${team.id}:${gamemode}`);
    let statsToWrite: WeeklyStatsFields;
    if (override) {
      const [wins, losses] = override.gameRecord.split("-");
      statsToWrite = {
        goals: override.goals,
        goalsAgainst: override.goalsAgainst,
        shots: override.shots,
        shotsAgainst: override.shotsAgainst,
        saves: override.saves,
        assists: override.assists,
        demosInflicted: override.demosInflicted,
        demosTaken: override.demosTaken,
        sprocketRating: override.saveRate,
        wins: parseInt(wins) || 0,
        losses: parseInt(losses) || 0,
      };
      manualOverrides++;
    } else if (importedStats) {
      statsToWrite = importedStats;
    } else {
      continue;
    }

    // Keyed by season too, so this season's Week N never overwrites an
    // archived season's Week N
    await prisma.teamWeeklyStats.upsert({
      where: { teamId_season_week_gamemode: { teamId: team.id, season, week, gamemode } },
      update: statsToWrite,
      create: { teamId: team.id, season, week, gamemode, ...statsToWrite },
    });

    imported++;
    importedTeams.push({
      teamId: team.id,
      name: `${team.leagueId} ${team.name} (${gamemode})`,
      goals: statsToWrite.goals,
      wins: statsToWrite.wins,
      isManualOverride: !!override,
    });
  }

  // 7. Same week's player stats, aggregated per player and saved the same
  // way — lets the Team modal's roster table show real current-season
  // numbers instead of only ever showing last season's PlayerHistoricalStats.
  // Independent of manual team-level overrides above (those correct a
  // team's aggregate total; there's no equivalent per-player override, so
  // player rows always reflect the raw Sprocket data).
  const playerAggregates = aggregatePlayerWeekStats(weekPlayerStats);
  const teamRecordByKey = new Map(
    aggregates.map((agg) => [`${agg.leagueCode}:${agg.teamName}:${agg.gamemode}`, agg])
  );
  const mlePlayers = await prisma.mLEPlayer.findMany({
    where: { memberId: { not: null } },
    select: { id: true, memberId: true },
  });
  const playerIdByMemberId = new Map(mlePlayers.map((p) => [p.memberId!, p.id]));

  for (const agg of playerAggregates) {
    const playerId = playerIdByMemberId.get(agg.memberId);
    if (!playerId) continue;

    // A player's week record mirrors their team's — individual players
    // don't have a result independent of their team's game outcome.
    const teamRecord = teamRecordByKey.get(`${agg.leagueCode}:${agg.teamName}:${agg.gamemode}`);

    await prisma.playerWeeklyStats.upsert({
      where: { playerId_season_week_gamemode: { playerId, season, week, gamemode: agg.gamemode } },
      update: {
        goals: Math.round(agg.goals),
        shots: Math.round(agg.shots),
        saves: Math.round(agg.saves),
        assists: Math.round(agg.assists),
        demosInflicted: Math.round(agg.demosInflicted),
        demosTaken: Math.round(agg.demosTaken),
        sprocketRating: agg.roundCount > 0 ? Math.round((agg.gpiSum / agg.roundCount) * 100) / 100 : 0,
        wins: teamRecord?.wins ?? 0,
        losses: teamRecord?.losses ?? 0,
      },
      create: {
        playerId,
        season,
        week,
        gamemode: agg.gamemode,
        goals: Math.round(agg.goals),
        shots: Math.round(agg.shots),
        saves: Math.round(agg.saves),
        assists: Math.round(agg.assists),
        demosInflicted: Math.round(agg.demosInflicted),
        demosTaken: Math.round(agg.demosTaken),
        sprocketRating: agg.roundCount > 0 ? Math.round((agg.gpiSum / agg.roundCount) * 100) / 100 : 0,
        wins: teamRecord?.wins ?? 0,
        losses: teamRecord?.losses ?? 0,
      },
    });
  }

  return {
    imported,
    skipped,
    manualOverrides,
    matchesFound: weekMatches.length,
    errors,
    resultOnlyMatches,
    teams: importedTeams.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
