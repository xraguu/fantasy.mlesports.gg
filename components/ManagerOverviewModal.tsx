"use client";

import Image from "next/image";
import { useState, useEffect } from "react";

interface ManagerOverviewData {
  manager: string;
  team: string;
  league: string;
  wins: number;
  losses: number;
  rank: number | null;
  totalTeams: number;
  streak: string;
  totalPoints: number;
  avgPoints: number;
  roster: Array<{ id: string; name: string; leagueId: string; logoPath: string }>;
}

interface ManagerOverviewModalProps {
  leagueId: string;
  fantasyTeamId: string;
  onClose: () => void;
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.05)",
        borderRadius: "8px",
        padding: "0.85rem 1rem",
        textAlign: "center",
        flex: "1 1 120px",
      }}
    >
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text-main)" }}>{value}</div>
    </div>
  );
}

export default function ManagerOverviewModal({ leagueId, fantasyTeamId, onClose }: ManagerOverviewModalProps) {
  const [data, setData] = useState<ManagerOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/leagues/${leagueId}/teams/${fantasyTeamId}/overview`);
        if (!response.ok) {
          throw new Error("Failed to load manager overview");
        }
        setData(await response.json());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load manager overview");
      } finally {
        setLoading(false);
      }
    };

    fetchOverview();
  }, [leagueId, fantasyTeamId]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1500,
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "560px",
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          borderRadius: "12px",
          padding: "2rem",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
          <div>
            {loading ? (
              <div style={{ color: "var(--text-muted)" }}>Loading...</div>
            ) : error || !data ? (
              <div style={{ color: "#ef4444" }}>{error}</div>
            ) : (
              <>
                <h2 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--text-main)", margin: "0 0 0.25rem 0" }}>
                  {data.manager}
                </h2>
                <div style={{ fontSize: "1rem", color: "var(--accent)", fontWeight: 600 }}>
                  {data.team}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                  {data.league}
                </div>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.1)",
              border: "none",
              color: "#ffffff",
              fontSize: "1.3rem",
              cursor: "pointer",
              padding: "0.2rem 0.55rem",
              lineHeight: 1,
              borderRadius: "4px",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {!loading && !error && data && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "2rem" }}>
              <StatBox label="Record" value={`${data.wins}-${data.losses}`} />
              <StatBox label="Standing" value={data.rank ? `#${data.rank} of ${data.totalTeams}` : "—"} />
              <StatBox label="Streak" value={data.streak} />
              <StatBox label="Avg Fpts" value={data.avgPoints.toFixed(1)} />
              <StatBox label="Total Fpts" value={data.totalPoints.toFixed(1)} />
            </div>

            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.75rem" }}>
              Roster
            </h3>
            {data.roster.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No teams rostered yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {data.roster.map((mleTeam) => (
                  <div
                    key={mleTeam.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.6rem 0.85rem",
                      borderRadius: "6px",
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <Image src={mleTeam.logoPath} alt={mleTeam.name} width={28} height={28} style={{ borderRadius: "4px" }} />
                    <span style={{ fontWeight: 600, color: "var(--text-main)", fontSize: "0.95rem" }}>
                      {mleTeam.leagueId} {mleTeam.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
