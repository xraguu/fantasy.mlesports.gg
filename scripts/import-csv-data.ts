/**
 * CSV Import Script for MLE Fantasy Platform
 *
 * This script imports data from MLE CSV files into the database.
 * Run with: npm run import:csv
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

// CSV file paths (relative to project root)
const CSV_DIR = path.join(process.cwd(), "data", "csv");

// Real MLETeam ids are `{leagueCode}{Franchise}` (e.g. "plBulls"), one row per
// (league, franchise) combination that actually competes in that league. Several
// source CSVs only give the league's full name, so map it to the code used in the DB.
const LEAGUE_NAME_TO_ID: Record<string, string> = {
  "Foundation League": "FL",
  "Academy League": "AL",
  "Champion League": "CL",
  "Master League": "ML",
  "Premier League": "PL",
};

// Loads existing MLETeam rows once and looks them up by (league code, franchise name).
// Never creates teams — league/team master data is seeded separately and is not
// reliably derivable from these CSVs (teams.csv has no league column).
async function loadTeamLookup(): Promise<Map<string, string>> {
  const teams = await prisma.mLETeam.findMany({ select: { id: true, leagueId: true, name: true } });
  const lookup = new Map<string, string>();
  for (const t of teams) {
    lookup.set(`${t.leagueId}:${t.name}`, t.id);
  }
  return lookup;
}

// CSV row interfaces - only including fields we actually use
interface TeamRow {
  Conference: string;
  "Super Division": string;
  Division: string;
  Franchise: string;
  Code: string;
  "Primary Color": string;
  "Secondary Color": string;
  "Photo URL": string;
}

interface PlayerRow {
  member_id: string;
  skill_group: string;
  franchise: string;
  "Franchise Staff Position": string;
  slot: string;
  name: string; // Also needed for display
}

interface FixtureRow {
  fixture_id: string;
  match_group_id: string;
  home: string;
  away: string;
}

interface MatchRow {
  match_id: string;
  fixture_id: string;
  match_group_id: string;
  home: string;
  away: string;
  league: string;
  game_mode: string;
  home_wins: string;
  away_wins: string;
  winning_team: string;
  scheduling_start_time: string; // For date calculation
}

interface MatchGroupRow {
  match_group_id: string;
  start: string;
  match_group_title: string;
  parent_group_title: string;
}

interface RoleUsageRow {
  doubles_uses: string;
  standard_uses: string;
  total_uses: string;
  season_number: string;
  team_name: string;
  league: string;
  role: string;
  gamemode: string;
}

interface PlayerStatsRow {
  member_id: string;
  team_name: string;
  skill_group: string;
  gamemode: string;
  match_id: string;
  round_id: string;
  gpi: string;
  goals: string;
  saves: string;
  shots: string;
  assists: string;
  goals_against: string;
  shots_against: string;
  demos_inflicted: string;
  demos_taken: string;
}

interface HistoricalStatsRow {
  name: string;
  member_id: string;
  gamemode: string;
  skill_group: string;
  team_name: string;
  season: string;
  games_played: string;
  sprocket_rating: string;
  avg_score: string;
  total_goals: string;
  total_saves: string;
  total_shots: string;
  total_assists: string;
  total_goals_against: string;
  total_shots_against: string;
  total_demos_inflicted: string;
  total_demos_taken: string;
}

// historicalAggregatedPlayerStats.csv uses the same RL_DOUBLES/RL_STANDARD
// vocabulary as player_stats_sXX.csv — map both onto the "2s"/"3s" keys used
// everywhere else (see lib/sprocketStats.ts for the live-import equivalent).
const PLAYER_GAMEMODE_TO_KEY: Record<string, "2s" | "3s"> = {
  RL_DOUBLES: "2s",
  RL_STANDARD: "3s",
};

// matches.csv/match_groups.csv use a third vocabulary ("Doubles"/"Standard")
// for the same two modes — same mapping as lib/sprocketStats.ts's
// MATCH_GAMEMODE_TO_KEY, duplicated locally per this file's existing pattern.
const MATCH_GAMEMODE_TO_KEY: Record<string, "2s" | "3s"> = {
  Doubles: "2s",
  Standard: "3s",
};

function readCSV<T>(filename: string): T[] {
  const filepath = path.join(CSV_DIR, filename);

  if (!fs.existsSync(filepath)) {
    console.warn(`⚠️  CSV file not found: ${filename}`);
    return [];
  }

  const fileContent = fs.readFileSync(filepath, "utf-8");
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return records as T[];
}

async function importLeaguesAndTeams() {
  console.log("\n📊 Checking Leagues and Teams...");

  const teams = readCSV<TeamRow>("teams.csv");

  if (teams.length === 0) {
    console.warn("⚠️  No teams data found");
    return;
  }

  // teams.csv's "Conference" column (e.g. "Blue"/"Orange") is an internal
  // organizational grouping, NOT the real league (AL/PL/ML/CL/FL) — this file
  // has no column that identifies a team's actual league. Real MLELeague/MLETeam
  // master data is seeded separately (id scheme: MLETeam.id = `{leagueCode}{Franchise}`,
  // one row per league a franchise competes in). Writing from this file's
  // Conference/Code columns previously created bogus League/Team rows and
  // corrupted MLEPlayer.teamId links — see git history around 2026-07-13.
  // This step is intentionally read-only now; it just reports what's in the CSV.
  const franchises = new Set(teams.map((t) => t.Franchise));
  console.log(
    `ℹ️  teams.csv lists ${franchises.size} franchises across ${teams.length} rows — skipping league/team writes (no league column in this file; see comment above). Existing MLELeague/MLETeam data is left untouched.`
  );
}

async function importPlayers() {
  console.log("\n👥 Importing Players...");

  const players = readCSV<PlayerRow>("players.csv");

  if (players.length === 0) {
    console.warn("⚠️  No players data found");
    return;
  }

  // Resolve each player's real MLETeam.id via (league, franchise name) — "FA"/"FP"/"Pend"
  // and any other unmatched franchise values (free agents, unsigned players) get null.
  const teamLookup = await loadTeamLookup();

  let count = 0;
  let unmatched = 0;
  for (const player of players) {
    const playerId = player.member_id; // Use member_id as player ID
    const leagueCode = LEAGUE_NAME_TO_ID[player.skill_group];
    const teamId = leagueCode ? teamLookup.get(`${leagueCode}:${player.franchise}`) || null : null;
    if (!teamId && player.franchise) unmatched++;

    // franchise always mirrors teamId's resolved team name — never trust the raw
    // CSV value on its own, since values like "FP"/"Pend" or a stale team name
    // would otherwise drift out of sync with teamId (see franchise data audit).
    const franchise = teamId ? player.franchise : null;

    await prisma.mLEPlayer.upsert({
      where: { id: playerId },
      update: {
        name: player.name,
        teamId,
        franchise,
      },
      create: {
        id: playerId,
        name: player.name,
        teamId,
        franchise,
      },
    });
    count++;
  }

  console.log(`✅ Imported ${count} players (${unmatched} without a matching team, e.g. free agents)`);
}

async function importFixtures() {
  console.log("\n📅 Importing Fixtures...");

  const fixtures = readCSV<FixtureRow>("fixtures.csv");

  if (fixtures.length === 0) {
    console.warn("⚠️  No fixtures data found");
    return;
  }

  const matchGroups = readCSV<MatchGroupRow>("match_groups.csv");
  const groupStart = new Map<string, Date>();
  for (const g of matchGroups) {
    groupStart.set(g.match_group_id, new Date(g.start));
  }

  let count = 0;
  let skipped = 0;
  for (const fixture of fixtures) {
    const date = groupStart.get(fixture.match_group_id);
    if (!date) {
      skipped++;
      continue; // no match_groups.csv row to source a real date from
    }

    await prisma.fixture.upsert({
      where: { id: fixture.fixture_id },
      update: { date },
      create: { id: fixture.fixture_id, date },
    });
    count++;
  }

  console.log(`✅ Imported ${count} fixtures (${skipped} skipped — no match_groups.csv date found)`);
}

async function importMatches() {
  console.log("\n⚽ Importing Matches...");

  const matches = readCSV<MatchRow>("matches.csv");

  if (matches.length === 0) {
    console.warn("⚠️  No matches data found");
    return;
  }

  // Helper function to calculate fantasy week from date
  const calculateWeek = (date: Date): number => {
    // TODO: This should be calculated based on season settings weekDates
    const seasonStart = new Date("2025-01-01");
    const daysDiff = Math.floor((date.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
    const week = Math.floor(daysDiff / 7) + 1;
    return Math.min(Math.max(week, 1), 10);
  };

  // matches.csv gives the league's full name (e.g. "Master League") plus home/away
  // franchise names — resolve both to the real MLETeam.id via the same lookup as players.
  const teamLookup = await loadTeamLookup();

  let count = 0;
  let skipped = 0;
  for (const match of matches) {
    const leagueCode = LEAGUE_NAME_TO_ID[match.league];
    const homeTeamId = leagueCode ? teamLookup.get(`${leagueCode}:${match.home}`) : undefined;
    const awayTeamId = leagueCode ? teamLookup.get(`${leagueCode}:${match.away}`) : undefined;

    if (!homeTeamId || !awayTeamId) {
      skipped++;
      continue; // can't resolve one or both teams (e.g. league name changed, bye week)
    }

    const scheduledDate = new Date(match.scheduling_start_time);
    const week = calculateWeek(scheduledDate);

    await prisma.match.upsert({
      where: { id: match.match_id },
      update: {
        fixtureId: match.fixture_id,
        roundId: "round_placeholder", // Rounds will be imported separately
        matchGroupId: match.match_group_id,
        homeTeamId,
        awayTeamId,
        scheduledDate,
        week,
        completed: match.winning_team !== "",
      },
      create: {
        id: match.match_id,
        fixtureId: match.fixture_id,
        roundId: "round_placeholder",
        matchGroupId: match.match_group_id,
        homeTeamId,
        awayTeamId,
        scheduledDate,
        week,
        completed: match.winning_team !== "",
      },
    });
    count++;
  }

  console.log(`✅ Imported ${count} matches (${skipped} skipped — couldn't resolve league/team)`);
}

async function importRoleUsages() {
  console.log("\n🎯 Importing Role Usages...");

  const roleUsages = readCSV<RoleUsageRow>("role_usages.csv");

  if (roleUsages.length === 0) {
    console.warn("⚠️  No role usages data found");
    return;
  }

  // TODO: Map team_name to actual player IDs — requires a lookup table or
  // additional data, so this import is a no-op for now.
  console.log(`⚠️  Role usage import requires player ID mapping (skipped for now)`);
}

async function importPlayerStats() {
  console.log("\n📈 Importing Player Match Stats...");

  const playerStats = readCSV<PlayerStatsRow>("player_stats_s19.csv");

  if (playerStats.length === 0) {
    console.warn("⚠️  No player stats data found");
    return;
  }

  let count = 0;
  let skipped = 0;

  for (const stat of playerStats) {
    try {
      await prisma.playerMatchStats.upsert({
        where: {
          playerId_matchId: {
            playerId: stat.member_id,
            matchId: stat.match_id,
          },
        },
        update: {
          goals: parseInt(stat.goals) || 0,
          shots: parseInt(stat.shots) || 0,
          saves: parseInt(stat.saves) || 0,
          assists: parseInt(stat.assists) || 0,
          demosInflicted: parseInt(stat.demos_inflicted) || 0,
          demosTaken: parseInt(stat.demos_taken) || 0,
          sprocketRating: parseFloat(stat.gpi) || 0, // Using GPI as Sprocket Rating
        },
        create: {
          playerId: stat.member_id,
          matchId: stat.match_id,
          goals: parseInt(stat.goals) || 0,
          shots: parseInt(stat.shots) || 0,
          saves: parseInt(stat.saves) || 0,
          assists: parseInt(stat.assists) || 0,
          demosInflicted: parseInt(stat.demos_inflicted) || 0,
          demosTaken: parseInt(stat.demos_taken) || 0,
          sprocketRating: parseFloat(stat.gpi) || 0,
        },
      });
      count++;
    } catch {
      skipped++;
      if (skipped < 10) {
        console.warn(`⚠️  Skipped stat for player ${stat.member_id} in match ${stat.match_id}`);
      }
    }
  }

  console.log(`✅ Imported ${count} player match stats (${skipped} skipped)`);
}

async function importHistoricalStats() {
  console.log("\n📊 Importing Historical Player Stats...");

  const historicalStats = readCSV<HistoricalStatsRow>("historicalAggregatedPlayerStats.csv");

  if (historicalStats.length === 0) {
    console.warn("⚠️  No historical stats data found");
    return;
  }

  let count = 0;
  let skipped = 0;

  for (const stat of historicalStats) {
    try {
      const gamesPlayed = parseInt(stat.games_played) || 0;
      const totalGoals = parseInt(stat.total_goals) || 0;
      const totalShots = parseInt(stat.total_shots) || 0;
      const totalSaves = parseInt(stat.total_saves) || 0;
      const totalAssists = parseInt(stat.total_assists) || 0;
      const totalGoalsAgainst = parseInt(stat.total_goals_against) || 0;
      const totalShotsAgainst = parseInt(stat.total_shots_against) || 0;
      const totalDemosInflicted = parseInt(stat.total_demos_inflicted) || 0;
      const totalDemosTaken = parseInt(stat.total_demos_taken) || 0;
      const avgScore = parseFloat(stat.avg_score) || 0;
      // skill_group is the league's full name (e.g. "Master League") — map
      // to the short code used everywhere else, falling back to the raw
      // value for anything unrecognized rather than silently mislabeling it.
      const skillGroup = LEAGUE_NAME_TO_ID[stat.skill_group] || stat.skill_group || "";

      const perGameFields = {
        skillGroup,
        totalGoals,
        totalShots,
        totalSaves,
        totalAssists,
        totalGoalsAgainst,
        totalShotsAgainst,
        totalDemosInflicted,
        totalDemosTaken,
        sprocketRating: parseFloat(stat.sprocket_rating) || 0,
        gamesPlayed,
        avgScore,
        goalsPerGame: gamesPlayed > 0 ? totalGoals / gamesPlayed : 0,
        assistsPerGame: gamesPlayed > 0 ? totalAssists / gamesPlayed : 0,
        savesPerGame: gamesPlayed > 0 ? totalSaves / gamesPlayed : 0,
        shotsPerGame: gamesPlayed > 0 ? totalShots / gamesPlayed : 0,
        avgGoalsAgainst: gamesPlayed > 0 ? totalGoalsAgainst / gamesPlayed : 0,
        avgShotsAgainst: gamesPlayed > 0 ? totalShotsAgainst / gamesPlayed : 0,
        avgDemosInflicted: gamesPlayed > 0 ? totalDemosInflicted / gamesPlayed : 0,
        avgDemosTaken: gamesPlayed > 0 ? totalDemosTaken / gamesPlayed : 0,
      };

      await prisma.playerHistoricalStats.upsert({
        where: {
          playerId_season_gamemode: {
            playerId: stat.member_id,
            season: stat.season,
            gamemode: stat.gamemode || "3s",
          }
        },
        update: perGameFields,
        create: {
          // id omitted — schema defaults to @default(cuid()). The old code
          // hardcoded id: stat.member_id, which collided across every season
          // a player has a row for (only the first insert per player ever
          // succeeded; every later season silently failed and was skipped).
          playerId: stat.member_id,
          season: stat.season,
          gamemode: stat.gamemode || "3s",
          ...perGameFields,
        },
      });
      count++;
    } catch {
      skipped++;
      if (skipped < 10) {
        console.warn(`⚠️  Skipped historical stats for player ${stat.member_id}`);
      }
    }
  }

  console.log(`✅ Imported ${count} historical player stats (${skipped} skipped)`);
}

// matches.csv is the full cumulative match archive (Season 12 onward, not
// just the current season — unlike player_stats_sXX.csv/rounds_sXX.csv,
// which are re-fetched per season and don't stick around). Cross-referenced
// with match_groups.csv (match_group_id -> season label, e.g. "Season 18")
// to build two real records per team/season/gamemode: the series record (one
// row in matches.csv = one series, decided by home_wins vs away_wins — this
// is the "series" the draft room's average-per-series stat divides by) and
// the game record (the individual game wins/losses within those series —
// home_wins/away_wins themselves, e.g. a series won 3-2 is 3 game wins and 2
// game losses, not just 1 series win).
interface TeamRecord {
  seriesWins: number;
  seriesLosses: number;
  gameWins: number;
  gameLosses: number;
}

async function computeSeriesRecords(
  teamLookup: Map<string, string>
): Promise<Map<string, TeamRecord>> {
  const matches = readCSV<MatchRow>("matches.csv");
  const matchGroups = readCSV<MatchGroupRow>("match_groups.csv");

  const seasonByGroup = new Map<string, string>();
  for (const g of matchGroups) {
    seasonByGroup.set(g.match_group_id, g.parent_group_title);
  }

  const records = new Map<string, TeamRecord>();
  const bump = (key: string, won: boolean, gamesWon: number, gamesLost: number) => {
    if (!records.has(key)) {
      records.set(key, { seriesWins: 0, seriesLosses: 0, gameWins: 0, gameLosses: 0 });
    }
    const r = records.get(key)!;
    if (won) r.seriesWins++;
    else r.seriesLosses++;
    r.gameWins += gamesWon;
    r.gameLosses += gamesLost;
  };

  for (const match of matches) {
    const leagueCode = LEAGUE_NAME_TO_ID[match.league];
    const gamemode = MATCH_GAMEMODE_TO_KEY[match.game_mode];
    const season = seasonByGroup.get(match.match_group_id);
    if (!leagueCode || !gamemode || !season) continue;

    const homeWins = parseInt(match.home_wins) || 0;
    const awayWins = parseInt(match.away_wins) || 0;
    if (homeWins === awayWins) continue; // not played / no decisive result

    const homeTeamId = teamLookup.get(`${leagueCode}:${match.home}`);
    const awayTeamId = teamLookup.get(`${leagueCode}:${match.away}`);

    if (homeTeamId) {
      bump(`${homeTeamId}:${season}:${gamemode}`, homeWins > awayWins, homeWins, awayWins);
    }
    if (awayTeamId) {
      bump(`${awayTeamId}:${season}:${gamemode}`, awayWins > homeWins, awayWins, homeWins);
    }
  }

  return records;
}

// Rolls historicalAggregatedPlayerStats.csv up from per-player rows to
// per-team, per-season, per-gamemode totals. This is the source for "last
// season" team stats (e.g. the draft room's Available Teams tab) — separate
// from PlayerHistoricalStats (player-level) and TeamWeeklyStats (current
// in-progress season only, gets wiped on season transition).
async function importTeamHistoricalStats() {
  console.log("\n📊 Importing Team Historical Stats...");

  const rows = readCSV<HistoricalStatsRow>("historicalAggregatedPlayerStats.csv");
  if (rows.length === 0) {
    console.warn("⚠️  No historical stats data found");
    return;
  }

  const teamLookup = await loadTeamLookup();

  interface TeamSeasonAgg {
    teamId: string;
    season: string;
    gamemode: "2s" | "3s";
    gamesPlayed: number;
    goals: number;
    goalsAgainst: number;
    shots: number;
    shotsAgainst: number;
    saves: number;
    assists: number;
    demosInflicted: number;
    demosTaken: number;
    sprocketRatingWeighted: number; // sum(rating * gamesPlayed), divided at the end
  }

  const emptyAgg = (teamId: string, season: string, gamemode: "2s" | "3s"): TeamSeasonAgg => ({
    teamId,
    season,
    gamemode,
    gamesPlayed: 0,
    goals: 0,
    goalsAgainst: 0,
    shots: 0,
    shotsAgainst: 0,
    saves: 0,
    assists: 0,
    demosInflicted: 0,
    demosTaken: 0,
    sprocketRatingWeighted: 0,
  });

  const seriesRecords = await computeSeriesRecords(teamLookup);

  const aggMap = new Map<string, TeamSeasonAgg>();
  let unmatchedTeams = 0;

  for (const row of rows) {
    const leagueCode = LEAGUE_NAME_TO_ID[row.skill_group];
    const gamemode = PLAYER_GAMEMODE_TO_KEY[row.gamemode];
    if (!leagueCode || !gamemode) continue;

    const teamId = teamLookup.get(`${leagueCode}:${row.team_name}`);
    if (!teamId) {
      unmatchedTeams++;
      continue;
    }

    const gamesPlayed = parseInt(row.games_played) || 0;
    const key = `${teamId}:${row.season}:${gamemode}`;
    if (!aggMap.has(key)) {
      aggMap.set(key, emptyAgg(teamId, row.season, gamemode));
    }

    const agg = aggMap.get(key)!;
    agg.gamesPlayed += gamesPlayed;
    agg.goals += parseInt(row.total_goals) || 0;
    agg.goalsAgainst += parseInt(row.total_goals_against) || 0;
    agg.shots += parseInt(row.total_shots) || 0;
    agg.shotsAgainst += parseInt(row.total_shots_against) || 0;
    agg.saves += parseInt(row.total_saves) || 0;
    agg.assists += parseInt(row.total_assists) || 0;
    agg.demosInflicted += parseInt(row.total_demos_inflicted) || 0;
    agg.demosTaken += parseInt(row.total_demos_taken) || 0;
    agg.sprocketRatingWeighted += (parseFloat(row.sprocket_rating) || 0) * gamesPlayed;
  }

  // A team could have match/series results without matching player-stat
  // rows for that exact key (edge case) — make sure those still get a row.
  for (const key of seriesRecords.keys()) {
    if (aggMap.has(key)) continue;
    const [teamId, season, gamemode] = key.split(":") as [string, string, "2s" | "3s"];
    aggMap.set(key, emptyAgg(teamId, season, gamemode));
  }

  let count = 0;
  for (const [key, agg] of aggMap.entries()) {
    const sprocketRating = agg.gamesPlayed > 0 ? agg.sprocketRatingWeighted / agg.gamesPlayed : 0;
    const record = seriesRecords.get(key) ?? { seriesWins: 0, seriesLosses: 0, gameWins: 0, gameLosses: 0 };

    const sharedFields = {
      gamesPlayed: agg.gamesPlayed,
      goals: agg.goals,
      goalsAgainst: agg.goalsAgainst,
      shots: agg.shots,
      shotsAgainst: agg.shotsAgainst,
      saves: agg.saves,
      assists: agg.assists,
      demosInflicted: agg.demosInflicted,
      demosTaken: agg.demosTaken,
      sprocketRating,
      ...record,
    };

    await prisma.teamHistoricalStats.upsert({
      where: {
        teamId_season_gamemode: {
          teamId: agg.teamId,
          season: agg.season,
          gamemode: agg.gamemode,
        },
      },
      update: sharedFields,
      create: {
        teamId: agg.teamId,
        season: agg.season,
        gamemode: agg.gamemode,
        ...sharedFields,
      },
    });
    count++;
  }

  console.log(`✅ Imported ${count} team historical stat rows (${unmatchedTeams} player rows skipped — team not found)`);
}

async function main() {
  console.log("🚀 Starting CSV Import...");
  console.log(`📁 Looking for CSV files in: ${CSV_DIR}\n`);

  try {
    // Import in dependency order
    await importLeaguesAndTeams();
    await importPlayers();
    await importFixtures();
    await importMatches();
    await importRoleUsages();
    await importPlayerStats();
    await importHistoricalStats();
    await importTeamHistoricalStats();

    console.log("\n✅ CSV Import completed successfully!");
  } catch (error) {
    console.error("\n❌ Error during import:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the import
main()
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
