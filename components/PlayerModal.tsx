"use client";

import { useState, useEffect } from "react";

interface PlayerHistoricalStats {
  id: string;
  season: string;
  skillGroup: string;
  gamesPlayed: number;
  sprocketRating: number;
  totalGoals: number;
  totalGoalsAgainst: number;
  totalShots: number;
  totalShotsAgainst: number;
  totalSaves: number;
  totalAssists: number;
  totalDemosInflicted: number;
  totalDemosTaken: number;
  gamemode: string;
}

interface PlayerModalProps {
  player: {
    id: string;
    name: string;
  } | null;
  team: {
    leagueId: string;
    name: string;
    logoPath: string;
    primaryColor: string;
    secondaryColor: string;
  };
  onClose: () => void;
}

export default function PlayerModal({
  player,
  team,
  onClose,
}: PlayerModalProps) {
  const [gameMode, setGameMode] = useState<"RL_DOUBLES" | "RL_STANDARD">("RL_DOUBLES");
  const [stats, setStats] = useState<PlayerHistoricalStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlayerStats = async () => {
      if (!player) return;

      try {
        setLoading(true);
        const response = await fetch(`/api/players/${player.id}/stats`);

        if (!response.ok) {
          throw new Error("Failed to fetch player stats");
        }

        const data = await response.json();
        setStats(data.stats || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stats");
      } finally {
        setLoading(false);
      }
    };

    fetchPlayerStats();
  }, [player]);

  if (!player) return null;

  // Filter stats by game mode
  const filteredStats = stats.filter((stat) => stat.gamemode === gameMode);

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
        zIndex: 1001,
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-box modal-box-tight-padding"
        style={{
          maxWidth: "1100px",
          position: "relative",
          borderRadius: "12px",
          padding: "2rem",
          background: `linear-gradient(135deg, ${team.primaryColor} 0%, ${team.secondaryColor} 100%)`,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Background Logo */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "400px",
            height: "400px",
            backgroundImage: `url(${team.logoPath})`,
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            opacity: 0.1,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

        {/* Modal Header */}
        <div
          style={{
            paddingBottom: "1.5rem",
            borderBottom: "2px solid rgba(255,255,255,0.2)",
            position: "relative",
            zIndex: 1,
            marginBottom: "2rem",
          }}
        >
          <div
            className="modal-box-header"
            style={{
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "1rem",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: "clamp(1.2rem, 5vw, 1.8rem)",
                  fontWeight: 700,
                  color: "#ffffff",
                  margin: "0 0 0.5rem 0",
                  textShadow: "0 2px 4px rgba(0,0,0,0.3)",
                }}
              >
                {player.name}
              </h2>
              <div
                style={{
                  fontSize: "1rem",
                  color: "rgba(255,255,255,0.7)",
                }}
              >
                {team.leagueId} {team.name}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                flexShrink: 0,
                background: "rgba(255, 255, 255, 0.2)",
                border: "none",
                color: "#ffffff",
                fontSize: "1.5rem",
                cursor: "pointer",
                padding: "0.25rem 0.5rem",
                lineHeight: 1,
                borderRadius: "4px",
                backdropFilter: "blur(4px)",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Game Mode Toggle */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
            position: "relative",
            zIndex: 1,
          }}
        >
          <h3
            style={{
              fontSize: "1.1rem",
              fontWeight: 600,
              color: "#ffffff",
              margin: 0,
              textShadow: "0 2px 4px rgba(0,0,0,0.3)",
            }}
          >
            Career Statistics
          </h3>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              backgroundColor: "rgba(255,255,255,0.15)",
              borderRadius: "6px",
              padding: "0.25rem",
            }}
          >
            <button
              onClick={() => setGameMode("RL_DOUBLES")}
              style={{
                padding: "0.4rem 1rem",
                borderRadius: "4px",
                fontSize: "0.9rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                backgroundColor:
                  gameMode === "RL_DOUBLES"
                    ? "rgba(255,255,255,0.9)"
                    : "transparent",
                color:
                  gameMode === "RL_DOUBLES" ? team.primaryColor : "#ffffff",
                transition: "all 0.2s ease",
              }}
            >
              2s
            </button>
            <button
              onClick={() => setGameMode("RL_STANDARD")}
              style={{
                padding: "0.4rem 1rem",
                borderRadius: "4px",
                fontSize: "0.9rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                backgroundColor:
                  gameMode === "RL_STANDARD"
                    ? "rgba(255,255,255,0.9)"
                    : "transparent",
                color:
                  gameMode === "RL_STANDARD" ? team.primaryColor : "#ffffff",
                transition: "all 0.2s ease",
              }}
            >
              3s
            </button>
          </div>
        </div>

        {/* Stats Table */}
        <div style={{ position: "relative", zIndex: 1 }}>
          {loading ? (
            <div
              style={{
                textAlign: "center",
                padding: "3rem",
                color: "rgba(255,255,255,0.8)",
              }}
            >
              Loading stats...
            </div>
          ) : error ? (
            <div
              style={{
                textAlign: "center",
                padding: "3rem",
                color: "rgba(255,255,255,0.8)",
              }}
            >
              {error}
            </div>
          ) : filteredStats.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "3rem",
                color: "rgba(255,255,255,0.8)",
              }}
            >
              No stats available for {gameMode === "RL_DOUBLES" ? "2s" : "3s"}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.2)" }}>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "left",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Season
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "center",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      League
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      GP
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      SR
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Goals
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Goals Against
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Shots
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Shots Against
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Saves
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Assists
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Demos Inflicted
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Demos Taken
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStats.map((stat) => (
                    <tr
                      key={stat.id}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          fontWeight: 600,
                          color: "#ffffff",
                        }}
                      >
                        {stat.season}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.skillGroup}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.gamesPlayed}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.sprocketRating.toFixed(0)}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.totalGoals}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.totalGoalsAgainst}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.totalShots}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.totalShotsAgainst}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.totalSaves}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.totalAssists}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.totalDemosInflicted}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {stat.totalDemosTaken}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
