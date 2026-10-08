"use client";

import { useState, useEffect } from "react";

interface PastLeague {
  leagueId: string;
  leagueName: string;
  season: number;
  totalTeams: number;
  teamName: string;
  wins: number;
  losses: number;
  finalPlace: number | null;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const PLACE_COLORS: Record<number, string> = {
  1: "#f2b632",
  2: "#c7cdd6",
  3: "#d0894f",
};

export default function PastLeaguesModal({ onClose }: { onClose: () => void }) {
  const [leagues, setLeagues] = useState<PastLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPastLeagues = async () => {
      try {
        const response = await fetch("/api/leagues/past");
        if (!response.ok) throw new Error("Failed to load past leagues");
        const data = await response.json();
        setLeagues(data.leagues || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load past leagues");
      } finally {
        setLoading(false);
      }
    };

    fetchPastLeagues();
  }, []);

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
        className="modal-box modal-box-tight-padding"
        style={{
          maxWidth: "640px",
          maxHeight: "85vh",
          overflowY: "auto",
          borderRadius: "12px",
          padding: "2rem",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
        }}
      >
        <div className="modal-box-header" style={{ justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "clamp(1.2rem, 5vw, 1.6rem)", fontWeight: 700, color: "var(--accent)", margin: 0 }}>
            Past Leagues
          </h2>
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

        {loading ? (
          <div style={{ color: "var(--text-muted)" }}>Loading...</div>
        ) : error ? (
          <div style={{ color: "#ef4444" }}>{error}</div>
        ) : leagues.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>No past leagues yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {leagues.map((league) => (
              <div
                key={league.leagueId}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem 1.25rem",
                  padding: "1rem 1.1rem",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text-main)" }}>
                    {league.leagueName}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                    {league.teamName} · Season {league.season}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "1.5rem", flexShrink: 0 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.2rem" }}>
                      Record
                    </div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
                      <span style={{ color: "#22c55e" }}>{league.wins}</span>-<span style={{ color: "#ef4444" }}>{league.losses}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.2rem" }}>
                      Final Place
                    </div>
                    {league.finalPlace !== null ? (
                      <div style={{ fontSize: "1.05rem", fontWeight: 700, color: PLACE_COLORS[league.finalPlace] ?? "var(--text-main)" }}>
                        {ordinal(league.finalPlace)}
                        <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)" }}> of {league.totalTeams}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text-muted)" }}>—</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
