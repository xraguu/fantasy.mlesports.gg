"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import Image from "next/image";

interface TopTeam {
  id: string;
  name: string;
  leagueId: string;
  slug: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
}

interface Standing {
  rank: number;
  fantasyTeamId: string;
  manager: string;
  team: string;
  wins: number;
  losses: number;
  points: number;
  avgPoints: number;
  topTeam: TopTeam | null;
  topTeamFpts: number;
  pointsFor: number;
  pointsAgainst: number;
  streak: string;
  isYou: boolean;
}

export default function StandingsPage() {
  const params = useParams();
  const router = useRouter();
  const leagueId = params.LeagueID as string;
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch standings data
  useEffect(() => {
    const fetchStandings = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/leagues/${leagueId}/standings`);

        if (!response.ok) {
          throw new Error("Failed to fetch standings");
        }

        const data = await response.json();
        setStandings(data.standings || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load standings");
      } finally {
        setLoading(false);
      }
    };

    if (leagueId) {
      fetchStandings();
    }
  }, [leagueId]);

  const handleManagerClick = (teamId: string) => {
    router.push(`/leagues/${leagueId}/opponents?teamId=${teamId}`);
  };

  const handlePlayoffsClick = () => {
    router.push(`/leagues/${leagueId}/standings/playoffs`);
  };

  // Loading state
  if (loading) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>Loading standings...</div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#ef4444", fontSize: "1.1rem" }}>
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
        <h1 className="page-heading" style={{ fontSize: "clamp(1.5rem, 6vw, 2.5rem)", color: "var(--accent)", fontWeight: 700, margin: 0 }}>Standings</h1>
        <button
          onClick={handlePlayoffsClick}
          style={{
            backgroundColor: "var(--accent)",
            color: "#1a1a2e",
            padding: "0.5rem 1.5rem",
            borderRadius: "2rem",
            fontWeight: 700,
            fontSize: "1rem",
            border: "none",
            cursor: "pointer"
          }}
        >
          Playoffs
        </button>
      </div>

      <section className="card">
        <div style={{ marginTop: "1rem", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Rank</th>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Manager</th>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Team</th>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>W-L</th>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Points</th>
                <th style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((team) => (
                <React.Fragment key={team.rank}>
                  <tr
                    style={{
                      borderBottom: team.rank === 4 ? "2px dotted var(--accent)" : "1px solid rgba(255,255,255,0.05)",
                      backgroundColor: team.isYou ? "rgba(242, 182, 50, 0.08)" : "transparent",
                      borderLeft: team.isYou ? "3px solid var(--accent)" : "3px solid transparent",
                      cursor: "pointer"
                    }}
                    onClick={() => setExpandedRow(expandedRow === team.rank ? null : team.rank)}
                  >
                    <td style={{ padding: "0.75rem 0.5rem", fontWeight: 600, color: team.rank <= 4 ? "var(--accent)" : "inherit" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{
                          fontSize: "0.85rem",
                          transition: "transform 0.2s",
                          transform: expandedRow === team.rank ? "rotate(90deg)" : "rotate(0deg)",
                          display: "inline-block"
                        }}>
                          ▶
                        </span>
                        {team.rank}
                      </div>
                    </td>
                  <td style={{ padding: "0.75rem 0.5rem" }}>
                    <span
                      onClick={!team.isYou ? () => handleManagerClick(team.fantasyTeamId) : undefined}
                      onMouseEnter={!team.isYou ? (e) => e.currentTarget.style.color = "var(--accent)" : undefined}
                      onMouseLeave={!team.isYou ? (e) => e.currentTarget.style.color = "var(--text-main)" : undefined}
                      style={{
                        cursor: team.isYou ? "default" : "pointer",
                        color: "var(--text-main)",
                        transition: "color 0.2s"
                      }}
                    >
                      {team.manager}
                    </span>
                    {team.isYou && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--accent)" }}>(You)</span>}
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", color: "var(--text-muted)" }}>
                    <span
                      onClick={!team.isYou ? () => handleManagerClick(team.fantasyTeamId) : undefined}
                      onMouseEnter={!team.isYou ? (e) => e.currentTarget.style.color = "var(--accent)" : undefined}
                      onMouseLeave={!team.isYou ? (e) => e.currentTarget.style.color = "var(--text-muted)" : undefined}
                      style={{
                        cursor: team.isYou ? "default" : "pointer",
                        transition: "color 0.2s"
                      }}
                    >
                      {team.team}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontWeight: 500 }}>
                    <span style={{ color: "#22c55e" }}>{team.wins}</span>-<span style={{ color: "#ef4444" }}>{team.losses}</span>
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontWeight: 600 }}>
                    {team.points.toFixed(1)}
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "right", color: "var(--text-muted)" }}>
                    {team.avgPoints.toFixed(1)}
                  </td>
                </tr>

                {/* Expanded Details Row */}
                {expandedRow === team.rank && (
                  <tr style={{ backgroundColor: team.isYou ? "rgba(242, 182, 50, 0.05)" : "rgba(255,255,255,0.02)" }}>
                    <td colSpan={6} style={{ padding: "1.5rem" }}>
                      <div className="standings-row-detail-grid" style={{ gap: "2rem" }}>
                        {/* Left Side - Top Performing Team */}
                        <div>
                          <h4 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "1rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Top Performing Team
                          </h4>
                          {team.topTeam ? (
                            <div style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "1rem",
                              padding: "1rem",
                              background: "rgba(255,255,255,0.05)",
                              borderRadius: "8px",
                              border: "1px solid rgba(255,255,255,0.1)"
                            }}>
                              <Image
                                src={team.topTeam.logoPath}
                                alt={team.topTeam.name}
                                width={48}
                                height={48}
                                style={{ borderRadius: "6px" }}
                              />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "0.25rem" }}>
                                  {team.topTeam.leagueId} {team.topTeam.name}
                                </div>
                                <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
                                  {team.topTeamFpts.toFixed(1)} Total Points
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div style={{
                              padding: "1rem",
                              background: "rgba(255,255,255,0.05)",
                              borderRadius: "8px",
                              border: "1px solid rgba(255,255,255,0.1)",
                              textAlign: "center",
                              color: "var(--text-muted)",
                              fontStyle: "italic"
                            }}>
                              No teams rostered yet
                            </div>
                          )}
                        </div>

                        {/* Right Side - Additional Stats */}
                        <div>
                          <h4 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "1rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Manager Stats
                          </h4>
                          <div className="standings-row-detail-grid" style={{ gap: "1rem" }}>
                            <div style={{
                              padding: "1rem",
                              background: "rgba(255,255,255,0.05)",
                              borderRadius: "8px",
                              border: "1px solid rgba(255,255,255,0.1)"
                            }}>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Points For</div>
                              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)" }}>{team.pointsFor.toFixed(1)}</div>
                            </div>
                            <div style={{
                              padding: "1rem",
                              background: "rgba(255,255,255,0.05)",
                              borderRadius: "8px",
                              border: "1px solid rgba(255,255,255,0.1)"
                            }}>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Points Against</div>
                              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)" }}>{team.pointsAgainst.toFixed(1)}</div>
                            </div>
                            <div style={{
                              padding: "1rem",
                              background: "rgba(255,255,255,0.05)",
                              borderRadius: "8px",
                              border: "1px solid rgba(255,255,255,0.1)"
                            }}>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Avg Points</div>
                              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)" }}>{team.avgPoints.toFixed(1)}</div>
                            </div>
                            <div style={{
                              padding: "1rem",
                              background: "rgba(255,255,255,0.05)",
                              borderRadius: "8px",
                              border: "1px solid rgba(255,255,255,0.1)"
                            }}>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Streak</div>
                              <div style={{
                                fontSize: "1.25rem",
                                fontWeight: 700,
                                color: team.streak.startsWith("W") ? "#22c55e" : "#ef4444"
                              }}>
                                {team.streak}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
