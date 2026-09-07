"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import HeaderTooltip from "@/components/HeaderTooltip";

const GOLD = "#f2b632";

interface Standing {
  rank: number;
  fantasyTeamId: string;
  manager: string;
  team: string;
  wins: number;
  losses: number;
  points: number;
  pointsAgainst: number;
  isYou: boolean;
}

interface FinalStandingsResponse {
  error: string | null;
  standings: Standing[];
  league: { id: string; name: string; currentWeek: number; maxTeams: number } | null;
}

const MEDAL_THEME: Record<1 | 2 | 3, { color: string; label: string; height: string }> = {
  1: { color: GOLD, label: "1st", height: "13rem" },
  2: { color: "#c7cdd6", label: "2nd", height: "10.5rem" },
  3: { color: "#d0894f", label: "3rd", height: "8.5rem" },
};

function PodiumPillar({
  place,
  standing,
  onManagerClick,
}: {
  place: 1 | 2 | 3;
  standing: Standing;
  onManagerClick: (teamId: string) => void;
}) {
  const theme = MEDAL_THEME[place];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "clamp(9rem, 26vw, 13rem)",
      }}
    >
      <div
        style={{
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: theme.color,
          marginBottom: "0.4rem",
        }}
      >
        {theme.label}
      </div>
      <div
        onClick={!standing.isYou ? () => onManagerClick(standing.fantasyTeamId) : undefined}
        style={{
          fontSize: "clamp(0.95rem, 3vw, 1.15rem)",
          fontWeight: 700,
          color: "var(--text-main)",
          textAlign: "center",
          cursor: standing.isYou ? "default" : "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
          marginBottom: "0.15rem",
        }}
      >
        {standing.team}
      </div>
      <div
        style={{
          fontSize: "0.8rem",
          color: "var(--text-muted)",
          marginBottom: "0.9rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
        }}
      >
        {standing.manager}
        {standing.isYou && <span style={{ marginLeft: "0.4rem", color: GOLD }}>(You)</span>}
      </div>
      <div
        style={{
          width: "100%",
          height: theme.height,
          borderRadius: "10px 10px 0 0",
          background: `linear-gradient(180deg, ${theme.color}26 0%, ${theme.color}0d 100%)`,
          border: `1px solid ${theme.color}66`,
          borderBottom: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: "1rem",
        }}
      >
        <div style={{ fontSize: "clamp(2rem, 7vw, 2.75rem)", fontWeight: 800, color: theme.color }}>
          {place}
        </div>
        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
          {standing.points.toFixed(1)} pts
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          <span style={{ color: "#22c55e" }}>{standing.wins}</span>-<span style={{ color: "#ef4444" }}>{standing.losses}</span>
        </div>
      </div>
    </div>
  );
}

function Podium({ top3, onManagerClick }: { top3: Standing[]; onManagerClick: (teamId: string) => void }) {
  const [first, second, third] = top3;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: "1rem",
        flexWrap: "wrap",
        padding: "1rem 1rem 0",
        marginBottom: "2.5rem",
      }}
    >
      {second && <PodiumPillar place={2} standing={second} onManagerClick={onManagerClick} />}
      {first && <PodiumPillar place={1} standing={first} onManagerClick={onManagerClick} />}
      {third && <PodiumPillar place={3} standing={third} onManagerClick={onManagerClick} />}
    </div>
  );
}

export default function FinalStandingsPage() {
  const params = useParams();
  const router = useRouter();
  const leagueId = params.LeagueID as string;
  const [data, setData] = useState<FinalStandingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/leagues/${leagueId}/standings/final`);
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Failed to load final standings");
        setData(json);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load final standings");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [leagueId]);

  const handleManagerClick = (teamId: string) => {
    router.push(`/leagues/${leagueId}/opponents?teamId=${teamId}`);
  };

  const header = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
      <button
        onClick={() => router.push(`/leagues/${leagueId}/standings`)}
        style={{
          backgroundColor: "rgba(255,255,255,0.1)",
          color: "var(--text-main)",
          padding: "0.5rem 1rem",
          borderRadius: "0.5rem",
          fontWeight: 600,
          fontSize: "0.9rem",
          border: "1px solid rgba(255,255,255,0.2)",
          cursor: "pointer",
        }}
      >
        ← Back to Standings
      </button>
      <h1 className="page-heading" style={{ fontSize: "clamp(1.5rem, 6vw, 2.5rem)", color: GOLD, fontWeight: 700, margin: 0 }}>
        Final Results
      </h1>
    </div>
  );

  if (loading) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>Loading final results...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#ef4444", fontSize: "1.1rem" }}>Error: {error || "Could not load final results"}</div>
      </div>
    );
  }

  if (data.error) {
    return (
      <div>
        {header}
        <p style={{ color: "var(--text-muted)" }}>{data.error}</p>
      </div>
    );
  }

  const top3 = data.standings.filter((s) => s.rank <= 3).sort((a, b) => a.rank - b.rank);
  const rest = data.standings.filter((s) => s.rank > 3);

  return (
    <>
      {header}

      {top3.length === 3 && <Podium top3={top3} onManagerClick={handleManagerClick} />}

      <section className="card">
        <div style={{ marginTop: "1rem", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Rank</th>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Manager</th>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Team</th>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="W-L" full="Regular Season Win-Loss Record" /></th>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Points</th>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Against</th>
              </tr>
            </thead>
            <tbody>
              {rest.map((team) => (
                <tr
                  key={team.rank}
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    backgroundColor: team.isYou ? "rgba(242, 182, 50, 0.08)" : "transparent",
                    borderLeft: team.isYou ? "3px solid var(--accent)" : "3px solid transparent",
                  }}
                >
                  <td style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>{team.rank}</td>
                  <td style={{ padding: "0.75rem 0.5rem" }}>
                    <span
                      onClick={!team.isYou ? () => handleManagerClick(team.fantasyTeamId) : undefined}
                      onMouseEnter={!team.isYou ? (e) => (e.currentTarget.style.color = "var(--accent)") : undefined}
                      onMouseLeave={!team.isYou ? (e) => (e.currentTarget.style.color = "var(--text-main)") : undefined}
                      style={{ cursor: team.isYou ? "default" : "pointer", color: "var(--text-main)", transition: "color 0.2s" }}
                    >
                      {team.manager}
                    </span>
                    {team.isYou && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--accent)" }}>(You)</span>}
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", color: "var(--text-muted)" }}>
                    <span
                      onClick={!team.isYou ? () => handleManagerClick(team.fantasyTeamId) : undefined}
                      onMouseEnter={!team.isYou ? (e) => (e.currentTarget.style.color = "var(--accent)") : undefined}
                      onMouseLeave={!team.isYou ? (e) => (e.currentTarget.style.color = "var(--text-muted)") : undefined}
                      style={{ cursor: team.isYou ? "default" : "pointer", transition: "color 0.2s" }}
                    >
                      {team.team}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontWeight: 500 }}>
                    <span style={{ color: "#22c55e" }}>{team.wins}</span>-<span style={{ color: "#ef4444" }}>{team.losses}</span>
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontWeight: 600 }}>{team.points.toFixed(1)}</td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "right", color: "var(--text-muted)" }}>{team.pointsAgainst.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
