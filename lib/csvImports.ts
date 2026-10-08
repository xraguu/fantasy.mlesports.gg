import { Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { prisma } from "./prisma";
import {
  SPROCKET_BASE_URL,
  fetchCsvText,
  importSprocketStatsForWeek,
  LEAGUE_NAME_TO_ID,
  PLAYER_GAMEMODE_TO_KEY,
  MATCH_GAMEMODE_TO_KEY,
} from "./sprocketStats";
import { getCurrentSeasonWeek } from "./currentWeek";

/**
 * On-demand re-imports of Sprocket's public CSV datasets (Admin → Manual
 * Stats). Each import fetches the live file from Sprocket's CDN and writes
 * only rows that actually differ from what's already stored, in batches —
 * the old one-row-at-a-time scripts (scripts/import-csv-data.ts,
 * prisma/seed-players.ts) are far too slow to run from a button against a
 * remote database. Field-level semantics deliberately match what those
 * scripts already stored, so a refresh never rewrites unchanged rows just
 * because they were formatted differently.
 */

export type CsvImportKey = "players" | "schedule" | "historical" | "weekly";

const RUN_ORDER: CsvImportKey[] = ["players", "schedule", "historical", "weekly"];

export interface CsvImportFile {
  name: string;
  available: boolean;
  lastModified: string | null;
}

export interface CsvImportSource {
  key: CsvImportKey;
  label: string;
  description: string;
  files: CsvImportFile[];
  available: boolean;
}

export interface CsvImportResult {
  key: CsvImportKey;
  label: string;
  stats: Array<{ label: string; value: number }>;
  notes: string[];
  error?: string;
}

const SOURCE_INFO: Record<CsvImportKey, { label: string; description: string }> = {
  players: {
    label: "Players & Franchise Staff",
    description:
      "Player names, salaries, leagues, team assignments, roster slots, and franchise staff positions (FM, GM, AGM, Captain).",
  },
  schedule: {
    label: "MLE Match Schedule",
    description:
      "Every MLE match and its fixture, used for each team's opponent, schedule, and match details. Needed for a new season's opponents to show up.",
  },
  historical: {
    label: "Historical Stats",
    description:
      "Past-season player stats (player cards) and team stats/records (the draft room's last-season numbers).",
  },
  weekly: {
    label: "Live Weekly Stats",
    description:
      "The current week's live team stats — same import the 2-hour timer runs. Doesn't recalculate fantasy scores.",
  },
};

/** Primary file first, then the supporting files that import also reads. */
function filesFor(key: CsvImportKey, season: number | null): string[] {
  switch (key) {
    case "players":
      return ["players.csv"];
    case "schedule":
      return ["matches.csv", "fixtures.csv", "match_groups.csv"];
    case "historical":
      return ["historicalAggregatedPlayerStats.csv", "matches.csv", "match_groups.csv"];
    case "weekly":
      return [`player_stats_s${season ?? "?"}.csv`, "matches.csv"];
  }
}

async function checkFile(name: string): Promise<CsvImportFile> {
  try {
    const res = await fetch(`${SPROCKET_BASE_URL}/${name}`, { method: "HEAD", cache: "no-store" });
    return { name, available: res.ok, lastModified: res.ok ? res.headers.get("last-modified") : null };
  } catch {
    return { name, available: false, lastModified: null };
  }
}

export async function getCsvImportSources(): Promise<CsvImportSource[]> {
  const current = await getCurrentSeasonWeek();
  const fileNames = RUN_ORDER.map((key) => filesFor(key, current?.season ?? null));
  const unique = [...new Set(fileNames.flat())];
  const checked = new Map((await Promise.all(unique.map(checkFile))).map((f) => [f.name, f]));

  return RUN_ORDER.map((key, i) => {
    const files = fileNames[i].map((name) => checked.get(name)!);
    return {
      key,
      ...SOURCE_INFO[key],
      files,
      available: (key !== "weekly" || current !== null) && files.every((f) => f.available),
    };
  });
}

type CsvRow = Record<string, string>;

// Every column each import reads. Checked before anything is written: if
// Sprocket ever renames a column or serves an empty/broken file, every row
// would otherwise read that field as blank and e.g. wipe all staff positions
// or team assignments in one click.
const REQUIRED_COLUMNS: Record<string, string[]> = {
  "players.csv": ["member_id", "name", "salary", "skill_group", "franchise", "Franchise Staff Position", "slot"],
  "fixtures.csv": ["fixture_id", "match_group_id"],
  "match_groups.csv": ["match_group_id", "start", "parent_group_title"],
  "matches.csv": ["match_id", "fixture_id", "match_group_id", "scheduling_start_time", "home", "away", "league", "game_mode", "home_wins", "away_wins", "winning_team"],
  "historicalAggregatedPlayerStats.csv": [
    "member_id", "gamemode", "skill_group", "team_name", "season", "games_played", "sprocket_rating", "avg_score",
    "total_goals", "total_saves", "total_shots", "total_assists", "total_goals_against", "total_shots_against",
    "total_demos_inflicted", "total_demos_taken",
  ],
};

function parseAndValidate(name: string, text: string): CsvRow[] {
  let header: string[] = [];
  const rows = parse(text, {
    columns: (cols: string[]) => (header = cols.map((c) => c.trim())),
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];
  if (rows.length === 0) throw new Error(`${name} is empty on Sprocket — nothing was imported.`);
  const missing = (REQUIRED_COLUMNS[name] ?? []).filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new Error(`${name} is missing expected column(s): ${missing.join(", ")} — nothing was imported. Sprocket may have changed the file's format.`);
  }
  return rows;
}

/** Per-run cache so a file several imports need (matches.csv) is only downloaded once. */
function createCsvCache() {
  const cache = new Map<string, Promise<CsvRow[]>>();
  return (name: string) => {
    if (!cache.has(name)) {
      cache.set(name, fetchCsvText(`${SPROCKET_BASE_URL}/${name}`).then((text) => parseAndValidate(name, text)));
    }
    return cache.get(name)!;
  };
}

type ColumnType = "text" | "integer" | "double precision";
type UpdateRow = { id: string } & Record<string, string | number | null>;

/**
 * One UPDATE ... FROM (VALUES ...) statement per chunk instead of one round
 * trip per row. Table/column names are fixed constants from this file, never
 * user input; every value is a bound parameter.
 */
async function bulkUpdateById(
  table: string,
  columns: Record<string, ColumnType>,
  rows: UpdateRow[]
): Promise<void> {
  const names = Object.keys(columns);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = Prisma.join(
      chunk.map(
        (row) =>
          Prisma.sql`(${Prisma.join([
            Prisma.sql`${row.id}::text`,
            ...names.map((n) => Prisma.sql`${row[n]}::${Prisma.raw(columns[n])}`),
          ])})`
      )
    );
    const setClause = Prisma.raw(names.map((n) => `"${n}" = v."${n}"`).join(", "));
    const columnList = Prisma.raw(['"id"', ...names.map((n) => `"${n}"`)].join(", "));
    await prisma.$executeRaw`UPDATE ${Prisma.raw(`"${table}"`)} AS t SET ${setClause} FROM (VALUES ${values}) AS v(${columnList}) WHERE t."id" = v."id"`;
  }
}

async function createManyChunked<T>(rows: T[], create: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += 1000) {
    await create(rows.slice(i, i + 1000));
  }
}

/** `${leagueCode}:${franchise name}` → MLETeam.id, the same lookup every importer uses. */
async function loadTeamLookup() {
  const teams = await prisma.mLETeam.findMany({ select: { id: true, leagueId: true, name: true } });
  return {
    teamIdByKey: new Map(teams.map((t) => [`${t.leagueId}:${t.name}`, t.id])),
    franchiseNames: new Set(teams.map((t) => t.name)),
  };
}

// Prisma's model API reads Float columns back rounded to ~16 significant
// digits, so a freshly computed value (e.g. a 7/3 per-game average) never
// exactly equals its own stored copy — without a tolerance every re-run
// "updates" thousands of unchanged historical rows.
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return (a ?? null) === (b ?? null);
}

function differs(a: Record<string, unknown>, b: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((f) => !sameValue(a[f], b[f]));
}

function pick(row: Record<string, unknown>, fields: string[]): Record<string, string | number | null> {
  return Object.fromEntries(fields.map((f) => [f, row[f] as string | number | null]));
}

// ---------------------------------------------------------------------------
// players.csv
// ---------------------------------------------------------------------------

const PLAYER_COLUMNS = {
  name: "text",
  salary: "double precision",
  memberId: "text",
  skillGroup: "text",
  teamId: "text",
  franchise: "text",
  staffPosition: "text",
  rosterSlot: "text",
} as const satisfies Record<string, ColumnType>;

type PlayerFields = { [K in keyof typeof PLAYER_COLUMNS]: K extends "salary" ? number | null : K extends "name" ? string : string | null };

function mapRosterSlot(slot: string | undefined): string | null {
  const match = slot?.match(/^PLAYER([A-H])$/);
  return match ? match[1] : null;
}

async function importPlayers(getCsv: ReturnType<typeof createCsvCache>): Promise<Omit<CsvImportResult, "key" | "label">> {
  const rows = await getCsv("players.csv");
  const { teamIdByKey, franchiseNames } = await loadTeamLookup();

  const desired = new Map<string, PlayerFields>();
  let skipped = 0;
  for (const row of rows) {
    const id = row.member_id;
    if (!id || !row.name) {
      skipped++;
      continue;
    }
    const leagueCode = LEAGUE_NAME_TO_ID[row.skill_group] ?? null;
    const teamId = (leagueCode && teamIdByKey.get(`${leagueCode}:${row.franchise}`)) || null;
    const rawPosition = row["Franchise Staff Position"];
    const staffPosition = rawPosition && rawPosition !== "NA" && rawPosition !== "NONE" ? rawPosition : null;
    // franchise mirrors the rostered team's name (never a raw "FP"/"Pend"),
    // except for staff whose own playing league has no team under their
    // franchise — they still belong to it, and the staff panel finds FMs/GMs/
    // AGMs by franchise, so dropping it would hide them from their own team.
    const franchise = teamId
      ? row.franchise
      : staffPosition && franchiseNames.has(row.franchise)
        ? row.franchise
        : null;
    const salary = parseFloat(row.salary);

    desired.set(id, {
      name: row.name,
      salary: Number.isFinite(salary) ? salary : null,
      memberId: id,
      skillGroup: leagueCode,
      teamId,
      franchise,
      staffPosition,
      rosterSlot: mapRosterSlot(row.slot),
    });
  }

  const existing = await prisma.mLEPlayer.findMany({
    select: { id: true, name: true, salary: true, memberId: true, skillGroup: true, teamId: true, franchise: true, staffPosition: true, rosterSlot: true },
  });
  const existingById = new Map(existing.map((p) => [p.id, p]));
  const fields = Object.keys(PLAYER_COLUMNS) as (keyof PlayerFields)[];

  const creates: Array<{ id: string } & PlayerFields> = [];
  const updates: UpdateRow[] = [];
  let staffChanged = 0;
  for (const [id, row] of desired) {
    const current = existingById.get(id);
    if (!current) {
      creates.push({ id, ...row });
    } else if (differs(current, row, fields)) {
      updates.push({ id, ...row });
      if ((current.staffPosition ?? null) !== row.staffPosition) staffChanged++;
    }
  }

  await createManyChunked(creates, (chunk) => prisma.mLEPlayer.createMany({ data: chunk, skipDuplicates: true }));
  await bulkUpdateById("MLEPlayer", PLAYER_COLUMNS, updates);

  return {
    stats: [
      { label: "New Players", value: creates.length },
      { label: "Updated", value: updates.length },
      { label: "Staff Changes", value: staffChanged },
      { label: "Unchanged", value: desired.size - creates.length - updates.length },
    ],
    notes: skipped > 0 ? [`${skipped} row(s) skipped — missing member id or name.`] : [],
  };
}

// ---------------------------------------------------------------------------
// matches.csv (+ fixtures.csv, match_groups.csv)
// ---------------------------------------------------------------------------

// Match.week isn't read anywhere (every reader matches by scheduledDate) —
// kept on the same formula the original import used so existing rows don't
// all look changed.
function legacyMatchWeek(date: Date): number {
  const seasonStart = new Date("2025-01-01");
  const daysDiff = Math.floor((date.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
  return Math.min(Math.max(Math.floor(daysDiff / 7) + 1, 1), 10);
}

async function runInParallelChunks<T>(items: T[], fn: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    await Promise.all(items.slice(i, i + 25).map(fn));
  }
}

async function importSchedule(getCsv: ReturnType<typeof createCsvCache>): Promise<Omit<CsvImportResult, "key" | "label">> {
  const [fixtureRows, groupRows, matchRows] = await Promise.all([
    getCsv("fixtures.csv"),
    getCsv("match_groups.csv"),
    getCsv("matches.csv"),
  ]);

  // Fixtures first — every Match row references one.
  const groupStart = new Map(groupRows.map((g) => [g.match_group_id, new Date(g.start)]));
  const desiredFixtures = new Map<string, Date>();
  for (const f of fixtureRows) {
    const date = groupStart.get(f.match_group_id);
    if (date && !isNaN(date.getTime())) desiredFixtures.set(f.fixture_id, date);
  }
  const existingFixtures = new Map(
    (await prisma.fixture.findMany({ select: { id: true, date: true } })).map((f) => [f.id, f.date])
  );
  const fixtureCreates = [...desiredFixtures]
    .filter(([id]) => !existingFixtures.has(id))
    .map(([id, date]) => ({ id, date }));
  const fixtureUpdates = [...desiredFixtures].filter(
    ([id, date]) => existingFixtures.has(id) && existingFixtures.get(id)!.getTime() !== date.getTime()
  );
  await createManyChunked(fixtureCreates, (chunk) => prisma.fixture.createMany({ data: chunk, skipDuplicates: true }));
  await runInParallelChunks(fixtureUpdates, ([id, date]) => prisma.fixture.update({ where: { id }, data: { date } }));
  const knownFixtureIds = new Set([...existingFixtures.keys(), ...fixtureCreates.map((f) => f.id)]);

  const { teamIdByKey } = await loadTeamLookup();
  type MatchFields = {
    fixtureId: string;
    roundId: string;
    matchGroupId: string;
    homeTeamId: string;
    awayTeamId: string;
    scheduledDate: Date;
    week: number;
    completed: boolean;
  };
  const desired = new Map<string, MatchFields>();
  let unresolved = 0;
  let undated = 0;
  for (const m of matchRows) {
    const leagueCode = LEAGUE_NAME_TO_ID[m.league];
    const homeTeamId = leagueCode ? teamIdByKey.get(`${leagueCode}:${m.home}`) : undefined;
    const awayTeamId = leagueCode ? teamIdByKey.get(`${leagueCode}:${m.away}`) : undefined;
    if (!homeTeamId || !awayTeamId || !knownFixtureIds.has(m.fixture_id)) {
      unresolved++;
      continue;
    }
    // Same scheduledDate the original import stored (the scheduling window's
    // start, shared by every match in a match group) — the chronological
    // week-cluster fallback in lib/weekMatchRange.ts depends on it.
    const scheduledDate = new Date(m.scheduling_start_time);
    if (isNaN(scheduledDate.getTime())) {
      undated++;
      continue;
    }
    desired.set(m.match_id, {
      fixtureId: m.fixture_id,
      roundId: "round_placeholder",
      matchGroupId: m.match_group_id,
      homeTeamId,
      awayTeamId,
      scheduledDate,
      week: legacyMatchWeek(scheduledDate),
      completed: m.winning_team !== "",
    });
  }

  const existing = new Map(
    (await prisma.match.findMany({
      select: { id: true, fixtureId: true, roundId: true, matchGroupId: true, homeTeamId: true, awayTeamId: true, scheduledDate: true, week: true, completed: true },
    })).map((m) => [m.id, m])
  );
  const creates: Array<{ id: string } & MatchFields> = [];
  const updates: Array<{ id: string } & MatchFields> = [];
  for (const [id, row] of desired) {
    const current = existing.get(id);
    if (!current) {
      creates.push({ id, ...row });
    } else if (
      current.scheduledDate.getTime() !== row.scheduledDate.getTime() ||
      differs(current, { ...row, scheduledDate: current.scheduledDate }, ["fixtureId", "roundId", "matchGroupId", "homeTeamId", "awayTeamId", "week", "completed"])
    ) {
      updates.push({ id, ...row });
    }
  }
  await createManyChunked(creates, (chunk) => prisma.match.createMany({ data: chunk, skipDuplicates: true }));
  await runInParallelChunks(updates, ({ id, ...data }) => prisma.match.update({ where: { id }, data }));

  const notes: string[] = [];
  if (unresolved > 0) notes.push(`${unresolved} match row(s) skipped — league/team not found (e.g. a franchise with no team in that league).`);
  if (undated > 0) notes.push(`${undated} match row(s) skipped — no scheduling date.`);
  return {
    stats: [
      { label: "New Matches", value: creates.length },
      { label: "Updated Matches", value: updates.length },
      { label: "New Fixtures", value: fixtureCreates.length },
      { label: "Unchanged", value: desired.size - creates.length - updates.length },
    ],
    notes,
  };
}

// ---------------------------------------------------------------------------
// historicalAggregatedPlayerStats.csv (+ matches.csv, match_groups.csv)
// ---------------------------------------------------------------------------

const PLAYER_HISTORY_COLUMNS = {
  skillGroup: "text",
  totalGoals: "integer",
  totalShots: "integer",
  totalSaves: "integer",
  totalAssists: "integer",
  totalGoalsAgainst: "integer",
  totalShotsAgainst: "integer",
  totalDemosInflicted: "integer",
  totalDemosTaken: "integer",
  sprocketRating: "double precision",
  gamesPlayed: "integer",
  avgScore: "double precision",
  goalsPerGame: "double precision",
  assistsPerGame: "double precision",
  savesPerGame: "double precision",
  shotsPerGame: "double precision",
  avgGoalsAgainst: "double precision",
  avgShotsAgainst: "double precision",
  avgDemosInflicted: "double precision",
  avgDemosTaken: "double precision",
} as const satisfies Record<string, ColumnType>;

const TEAM_HISTORY_COLUMNS = {
  gamesPlayed: "integer",
  goals: "integer",
  goalsAgainst: "integer",
  shots: "integer",
  shotsAgainst: "integer",
  saves: "integer",
  assists: "integer",
  demosInflicted: "integer",
  demosTaken: "integer",
  sprocketRating: "double precision",
  seriesWins: "integer",
  seriesLosses: "integer",
  gameWins: "integer",
  gameLosses: "integer",
} as const satisfies Record<string, ColumnType>;

const int = (v: string | undefined) => parseInt(v ?? "") || 0;
const float = (v: string | undefined) => parseFloat(v ?? "") || 0;

async function importHistorical(getCsv: ReturnType<typeof createCsvCache>): Promise<Omit<CsvImportResult, "key" | "label">> {
  const [rows, matchRows, groupRows] = await Promise.all([
    getCsv("historicalAggregatedPlayerStats.csv"),
    getCsv("matches.csv"),
    getCsv("match_groups.csv"),
  ]);

  // --- Player-level rows: one per (player, season, gamemode). A player
  // traded mid-season has a row per team; the later row wins, same as the
  // original sequential-upsert import.
  const knownPlayerIds = new Set((await prisma.mLEPlayer.findMany({ select: { id: true } })).map((p) => p.id));
  type PlayerHistory = { playerId: string; season: string; gamemode: string } & Record<keyof typeof PLAYER_HISTORY_COLUMNS, string | number>;
  const desiredPlayers = new Map<string, PlayerHistory>();
  let unknownPlayers = 0;
  for (const s of rows) {
    if (!knownPlayerIds.has(s.member_id)) {
      unknownPlayers++;
      continue;
    }
    const gamesPlayed = int(s.games_played);
    const per = (total: number) => (gamesPlayed > 0 ? total / gamesPlayed : 0);
    const totalGoals = int(s.total_goals);
    const totalShots = int(s.total_shots);
    const totalSaves = int(s.total_saves);
    const totalAssists = int(s.total_assists);
    const totalGoalsAgainst = int(s.total_goals_against);
    const totalShotsAgainst = int(s.total_shots_against);
    const totalDemosInflicted = int(s.total_demos_inflicted);
    const totalDemosTaken = int(s.total_demos_taken);
    const gamemode = s.gamemode || "3s";
    desiredPlayers.set(`${s.member_id}|${s.season}|${gamemode}`, {
      playerId: s.member_id,
      season: s.season,
      gamemode,
      skillGroup: LEAGUE_NAME_TO_ID[s.skill_group] || s.skill_group || "",
      totalGoals,
      totalShots,
      totalSaves,
      totalAssists,
      totalGoalsAgainst,
      totalShotsAgainst,
      totalDemosInflicted,
      totalDemosTaken,
      sprocketRating: float(s.sprocket_rating),
      gamesPlayed,
      avgScore: float(s.avg_score),
      goalsPerGame: per(totalGoals),
      assistsPerGame: per(totalAssists),
      savesPerGame: per(totalSaves),
      shotsPerGame: per(totalShots),
      avgGoalsAgainst: per(totalGoalsAgainst),
      avgShotsAgainst: per(totalShotsAgainst),
      avgDemosInflicted: per(totalDemosInflicted),
      avgDemosTaken: per(totalDemosTaken),
    });
  }

  const playerHistoryFields = Object.keys(PLAYER_HISTORY_COLUMNS);
  const existingPlayers = new Map(
    (await prisma.playerHistoricalStats.findMany()).map((r) => [`${r.playerId}|${r.season}|${r.gamemode}`, r])
  );
  const playerCreates: PlayerHistory[] = [];
  const playerUpdates: UpdateRow[] = [];
  for (const [key, row] of desiredPlayers) {
    const current = existingPlayers.get(key);
    if (!current) playerCreates.push(row);
    else if (differs(current, row, playerHistoryFields)) {
      playerUpdates.push({ id: current.id, ...pick(row, playerHistoryFields) });
    }
  }
  await createManyChunked(playerCreates, (chunk) =>
    prisma.playerHistoricalStats.createMany({ data: chunk as Prisma.PlayerHistoricalStatsCreateManyInput[], skipDuplicates: true })
  );
  await bulkUpdateById("PlayerHistoricalStats", PLAYER_HISTORY_COLUMNS, playerUpdates);

  // --- Team-level rows: player rows rolled up per (team, season, gamemode),
  // plus real series/game records from matches.csv grouped into seasons via
  // match_groups.csv.
  const { teamIdByKey } = await loadTeamLookup();
  const seasonByGroup = new Map(groupRows.map((g) => [g.match_group_id, g.parent_group_title]));
  type Record4 = { seriesWins: number; seriesLosses: number; gameWins: number; gameLosses: number };
  const records = new Map<string, Record4>();
  const bump = (key: string, won: boolean, gamesWon: number, gamesLost: number) => {
    const r = records.get(key) ?? { seriesWins: 0, seriesLosses: 0, gameWins: 0, gameLosses: 0 };
    if (won) r.seriesWins++;
    else r.seriesLosses++;
    r.gameWins += gamesWon;
    r.gameLosses += gamesLost;
    records.set(key, r);
  };
  for (const m of matchRows) {
    const leagueCode = LEAGUE_NAME_TO_ID[m.league];
    const gamemode = MATCH_GAMEMODE_TO_KEY[m.game_mode];
    const season = seasonByGroup.get(m.match_group_id);
    if (!leagueCode || !gamemode || !season) continue;
    const homeWins = int(m.home_wins);
    const awayWins = int(m.away_wins);
    if (homeWins === awayWins) continue;
    const homeTeamId = teamIdByKey.get(`${leagueCode}:${m.home}`);
    const awayTeamId = teamIdByKey.get(`${leagueCode}:${m.away}`);
    if (homeTeamId) bump(`${homeTeamId}|${season}|${gamemode}`, homeWins > awayWins, homeWins, awayWins);
    if (awayTeamId) bump(`${awayTeamId}|${season}|${gamemode}`, awayWins > homeWins, awayWins, homeWins);
  }

  type TeamAgg = { teamId: string; season: string; gamemode: string } & Record<Exclude<keyof typeof TEAM_HISTORY_COLUMNS, "sprocketRating" | keyof Record4>, number> & { ratingWeighted: number };
  const aggs = new Map<string, TeamAgg>();
  const emptyAgg = (teamId: string, season: string, gamemode: string): TeamAgg => ({
    teamId, season, gamemode,
    gamesPlayed: 0, goals: 0, goalsAgainst: 0, shots: 0, shotsAgainst: 0, saves: 0, assists: 0, demosInflicted: 0, demosTaken: 0,
    ratingWeighted: 0,
  });
  let unmatchedTeamRows = 0;
  for (const r of rows) {
    const leagueCode = LEAGUE_NAME_TO_ID[r.skill_group];
    const gamemode = PLAYER_GAMEMODE_TO_KEY[r.gamemode];
    if (!leagueCode || !gamemode) continue;
    const teamId = teamIdByKey.get(`${leagueCode}:${r.team_name}`);
    if (!teamId) {
      unmatchedTeamRows++;
      continue;
    }
    const key = `${teamId}|${r.season}|${gamemode}`;
    const agg = aggs.get(key) ?? emptyAgg(teamId, r.season, gamemode);
    const games = int(r.games_played);
    agg.gamesPlayed += games;
    agg.goals += int(r.total_goals);
    agg.goalsAgainst += int(r.total_goals_against);
    agg.shots += int(r.total_shots);
    agg.shotsAgainst += int(r.total_shots_against);
    agg.saves += int(r.total_saves);
    agg.assists += int(r.total_assists);
    agg.demosInflicted += int(r.total_demos_inflicted);
    agg.demosTaken += int(r.total_demos_taken);
    agg.ratingWeighted += float(r.sprocket_rating) * games;
    aggs.set(key, agg);
  }
  for (const key of records.keys()) {
    if (!aggs.has(key)) {
      const [teamId, season, gamemode] = key.split("|");
      aggs.set(key, emptyAgg(teamId, season, gamemode));
    }
  }

  const teamHistoryFields = Object.keys(TEAM_HISTORY_COLUMNS);
  const existingTeams = new Map(
    (await prisma.teamHistoricalStats.findMany()).map((r) => [`${r.teamId}|${r.season}|${r.gamemode}`, r])
  );
  const teamCreates: Prisma.TeamHistoricalStatsCreateManyInput[] = [];
  const teamUpdates: UpdateRow[] = [];
  for (const [key, agg] of aggs) {
    const { ratingWeighted, teamId, season, gamemode, ...totals } = agg;
    const fields = {
      ...totals,
      sprocketRating: agg.gamesPlayed > 0 ? ratingWeighted / agg.gamesPlayed : 0,
      ...(records.get(key) ?? { seriesWins: 0, seriesLosses: 0, gameWins: 0, gameLosses: 0 }),
    };
    const current = existingTeams.get(key);
    if (!current) teamCreates.push({ teamId, season, gamemode, ...fields });
    else if (differs(current, fields, teamHistoryFields)) teamUpdates.push({ id: current.id, ...fields });
  }
  await createManyChunked(teamCreates, (chunk) => prisma.teamHistoricalStats.createMany({ data: chunk, skipDuplicates: true }));
  await bulkUpdateById("TeamHistoricalStats", TEAM_HISTORY_COLUMNS, teamUpdates);

  const notes: string[] = [];
  if (unknownPlayers > 0) notes.push(`${unknownPlayers} player stat row(s) skipped — player not imported yet (re-import Players first).`);
  if (unmatchedTeamRows > 0) notes.push(`${unmatchedTeamRows} player row(s) not counted toward team totals — team not found.`);
  return {
    stats: [
      { label: "New Player Rows", value: playerCreates.length },
      { label: "Updated Player Rows", value: playerUpdates.length },
      { label: "New Team Rows", value: teamCreates.length },
      { label: "Updated Team Rows", value: teamUpdates.length },
    ],
    notes,
  };
}

// ---------------------------------------------------------------------------
// player_stats_sXX.csv — the existing live weekly import
// ---------------------------------------------------------------------------

async function importWeekly(): Promise<Omit<CsvImportResult, "key" | "label">> {
  const current = await getCurrentSeasonWeek();
  if (!current) {
    throw new Error("Could not determine the current season/week — configure week dates in Settings first.");
  }
  const result = await importSprocketStatsForWeek(current.week, current.season);
  return {
    stats: [
      { label: "Matches Found", value: result.matchesFound },
      { label: "Teams Imported", value: result.imported },
      { label: "Manual Overrides", value: result.manualOverrides },
      { label: "Skipped", value: result.skipped },
    ],
    notes: [`Season ${current.season}, week ${current.week}.`, ...result.errors],
  };
}

/**
 * Runs the selected imports in dependency order (players before historical
 * stats, which reference them), each isolated so one failure doesn't stop
 * the rest.
 */
export async function runCsvImports(keys: CsvImportKey[]): Promise<CsvImportResult[]> {
  const getCsv = createCsvCache();
  const results: CsvImportResult[] = [];
  for (const key of RUN_ORDER.filter((k) => keys.includes(k))) {
    const label = SOURCE_INFO[key].label;
    try {
      const outcome =
        key === "players"
          ? await importPlayers(getCsv)
          : key === "schedule"
            ? await importSchedule(getCsv)
            : key === "historical"
              ? await importHistorical(getCsv)
              : await importWeekly();
      results.push({ key, label, ...outcome });
    } catch (error) {
      console.error(`CSV import "${key}" failed:`, error);
      results.push({ key, label, stats: [], notes: [], error: error instanceof Error ? error.message : "Import failed" });
    }
  }
  return results;
}

export function isCsvImportKey(value: unknown): value is CsvImportKey {
  return typeof value === "string" && (RUN_ORDER as string[]).includes(value);
}
