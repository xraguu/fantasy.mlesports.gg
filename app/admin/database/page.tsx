"use client";

import { useState, useEffect } from "react";
import { formatEasternDateTime } from "@/lib/timezone";

interface DatabaseStatus {
  status: string;
  currentSeason: number | null;
  stats: {
    lastRefresh: { at: string; ok: boolean; note: string | null } | null;
    weeklyStats: { weeks: number[]; rows: number };
    schedule: { scheduled: number; played: number } | null;
    historicalSeasons: number[];
    players: { total: number; onTeams: number; staff: number };
    manualOverrides: number;
  };
  activity: {
    leagues: { total: number; drafted: number; drafting: number };
    managers: { filled: number; slots: number };
    matchups: { scored: number; total: number };
    transactions: number;
    trades: { completed: number; pending: number };
    pendingWaiverClaims: number;
  };
  users: {
    total: number;
    newLast30Days: number;
    admins: number;
    suspended: number;
    notInActiveLeague: number;
  };
  database: {
    size: string;
    connections: { used: number; available: number };
    largestTables: { name: string; size: string }[];
    archived: { leagues: number; rows: number };
  };
}

const fmt = (n: number) => n.toLocaleString();

// [1, 2, 3, 5] -> "1–3, 5"
function formatRanges(numbers: number[]): string {
  const ranges: string[] = [];
  let start = numbers[0];
  for (let i = 1; i <= numbers.length; i++) {
    if (numbers[i] !== numbers[i - 1] + 1) {
      const end = numbers[i - 1];
      ranges.push(start === end ? `${start}` : `${start}–${end}`);
      start = numbers[i];
    }
  }
  return ranges.join(", ");
}

// "PlayerHistoricalStats" -> "Player Historical Stats", "MLEPlayer" -> "MLE Player"
const tableLabel = (name: string) =>
  name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: "clamp(1rem, 4vw, 2rem)", marginBottom: "1.5rem" }}>
      <h2
        style={{
          fontSize: "clamp(1.1rem, 4.5vw, 1.4rem)",
          fontWeight: 700,
          marginBottom: subtitle ? "0.25rem" : "1.25rem",
          color: "var(--accent)",
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>{subtitle}</p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: "1rem",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  detail,
  color = "var(--accent)",
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  color?: string;
  wide?: boolean;
}) {
  return (
    <div
      style={{
        padding: "1rem",
        background: "rgba(255,255,255,0.05)",
        borderRadius: "8px",
        border: "1px solid rgba(255,255,255,0.08)",
        gridColumn: wide ? "1 / -1" : undefined,
      }}
    >
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>{label}</div>
      <div style={{ fontSize: "clamp(1.05rem, 4vw, 1.35rem)", fontWeight: 700, color }}>{value}</div>
      {detail && (
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.35rem", lineHeight: 1.4 }}>
          {detail}
        </div>
      )}
    </div>
  );
}

const GOOD = "#22c55e";
const WARN = "#f59e0b";
const BAD = "#ef4444";

export default function DatabaseToolsPage() {
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/admin/database/status")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load database status");
        setDbStatus(await res.json());
      })
      .catch((err) => {
        console.error("Failed to load database status:", err);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading || !dbStatus) {
    return (
      <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
        {loading ? "Checking the database..." : failed ? "Couldn't reach the database." : null}
      </div>
    );
  }

  const { stats, activity, users, database } = dbStatus;
  const seasonLabel = dbStatus.currentSeason !== null ? `Season ${dbStatus.currentSeason}` : "Current Season";
  const connectionShare = database.connections.available > 0 ? database.connections.used / database.connections.available : 0;
  const lastRefresh = stats.lastRefresh;

  return (
    <div>
      <Section title="Database Status">
        <Tile
          label="Connection Status"
          value={
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: GOOD }} />
              Connected
            </span>
          }
          color="var(--text-main)"
        />
        <Tile label="Database Size" value={database.size} />
        <Tile
          label="Connections in Use"
          value={`${database.connections.used} of ${database.connections.available}`}
          color={connectionShare >= 0.85 ? BAD : connectionShare >= 0.6 ? WARN : GOOD}
          detail="Shared with other MLE services — when it runs out, pages fail to load."
        />
      </Section>

      <Section title={`${seasonLabel} Stats Data`} subtitle="Whether this season's MLE data is being imported.">
        <Tile
          wide
          label="Last Stats Refresh"
          value={lastRefresh ? formatEasternDateTime(lastRefresh.at) : "None recorded yet"}
          color={!lastRefresh ? "var(--text-muted)" : lastRefresh.ok ? GOOD : BAD}
          detail={
            lastRefresh
              ? `${lastRefresh.ok ? "Worked" : "Failed"}${lastRefresh.note ? ` — ${lastRefresh.note}` : ""} Runs automatically every 2 hours.`
              : "Runs automatically every 2 hours; the first run after this update records here."
          }
        />
        <Tile
          label="Weekly Team Stats"
          value={stats.weeklyStats.weeks.length > 0 ? `Week${stats.weeklyStats.weeks.length > 1 ? "s" : ""} ${formatRanges(stats.weeklyStats.weeks)}` : "None yet"}
          color={stats.weeklyStats.weeks.length > 0 ? "var(--accent)" : "var(--text-muted)"}
          detail={stats.weeklyStats.rows > 0 ? `${fmt(stats.weeklyStats.rows)} rows imported` : "Imports start once Week 1's matches begin"}
        />
        <Tile
          label="MLE Schedule"
          value={stats.schedule ? `${fmt(stats.schedule.scheduled)} matches` : "No week dates set"}
          color={stats.schedule && stats.schedule.scheduled > 0 ? "var(--accent)" : "var(--text-muted)"}
          detail={
            !stats.schedule
              ? "Set this season's week dates in Settings"
              : stats.schedule.scheduled > 0
                ? `${fmt(stats.schedule.played)} played so far`
                : "None imported for this season's dates yet — re-import the MLE Match Schedule on Manual Stats"
          }
        />
        <Tile
          label="Historical Stats"
          value={stats.historicalSeasons.length > 0 ? `Seasons ${formatRanges(stats.historicalSeasons)}` : "None"}
          detail="Past seasons' stats, used for the draft room's last-season numbers"
        />
        <Tile
          label="MLE Players"
          value={fmt(stats.players.total)}
          detail={`${fmt(stats.players.onTeams)} on MLE teams · ${fmt(stats.players.staff)} with staff roles`}
        />
        <Tile label="Manual Stat Overrides" value={fmt(stats.manualOverrides)} detail="Active this season" />
      </Section>

      <Section title={`${seasonLabel} Activity`} subtitle="Active (non-archived) leagues only.">
        <Tile
          label="Leagues"
          value={fmt(activity.leagues.total)}
          detail={`${fmt(activity.leagues.drafted)} drafted${activity.leagues.drafting > 0 ? ` · ${fmt(activity.leagues.drafting)} drafting now` : ""}`}
        />
        <Tile
          label="Managers"
          value={`${fmt(activity.managers.filled)} of ${fmt(activity.managers.slots)}`}
          detail="League slots filled"
        />
        <Tile
          label="Matchups Scored"
          value={`${fmt(activity.matchups.scored)} of ${fmt(activity.matchups.total)}`}
          detail="Every matchup is scored by the end of the season"
        />
        <Tile label="Transactions" value={fmt(activity.transactions)} detail="Pickups, drops, waiver claims, and trades" />
        <Tile
          label="Trades"
          value={`${fmt(activity.trades.completed)} completed`}
          detail={`${fmt(activity.trades.pending)} pending or waiting out the veto window`}
        />
        <Tile label="Pending Waiver Claims" value={fmt(activity.pendingWaiverClaims)} detail="Waiting for the next waiver run" />
      </Section>

      <Section title="Users">
        <Tile label="Total Users" value={fmt(users.total)} />
        <Tile label="New in the Last 30 Days" value={fmt(users.newLast30Days)} />
        <Tile label="Admins" value={fmt(users.admins)} />
        <Tile
          label="Suspended"
          value={fmt(users.suspended)}
          color={users.suspended > 0 ? WARN : "var(--accent)"}
        />
        <Tile label="Not in an Active League" value={fmt(users.notInActiveLeague)} detail="Signed up, but not in any league this season" />
      </Section>

      <Section title="Storage">
        <Tile
          label="Largest Tables"
          value={
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.25rem" }}>
              {database.largestTables.map((table) => (
                <div
                  key={table.name}
                  style={{ display: "flex", justifyContent: "space-between", gap: "1rem", fontSize: "0.9rem", fontWeight: 600 }}
                >
                  <span style={{ color: "var(--text-main)" }}>{tableLabel(table.name)}</span>
                  <span>{table.size}</span>
                </div>
              ))}
            </div>
          }
        />
        <Tile
          label="Archived (Past-Season) Data"
          value={`${fmt(database.archived.leagues)} league${database.archived.leagues === 1 ? "" : "s"}`}
          detail={`${fmt(database.archived.rows)} rows of teams, rosters, matchups, draft picks, transactions, trades, and waiver claims`}
        />
      </Section>

      {/* Backups note */}
      <div
        className="card"
        style={{
          padding: "1.5rem 2rem",
          background: "rgba(59, 130, 246, 0.08)",
          border: "1px solid rgba(59, 130, 246, 0.25)",
        }}
      >
        <p style={{ fontSize: "0.9rem", color: "var(--text-main)", lineHeight: 1.6 }}>
          Backups, restores, and database maintenance are managed at the hosting/infra
          level (DigitalOcean managed Postgres), not from this panel. There&apos;s no
          app-level backup/restore, optimize, cache, or data-reset tooling here — those
          controls previously shown on this page were non-functional placeholders and
          have been removed.
        </p>
      </div>
    </div>
  );
}
