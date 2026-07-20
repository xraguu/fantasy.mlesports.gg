"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import PlayerModal from "./PlayerModal";

interface PlayerWithStats {
  id: string;
  name: string;
  skillGroup: string | null;
}

interface DraftTeamModalProps {
  team: {
    leagueId: string;
    name: string;
    logoPath: string;
    primaryColor: string;
    secondaryColor: string;
    id: string;
  } | null;
  onClose: () => void;
}

interface TeamStaff {
  franchiseManager: { id: string; name: string } | null;
  generalManager: { id: string; name: string } | null;
  captain: { id: string; name: string } | null;
}

interface TeamHistoricalStats {
  fpts: number;
  goals: number;
  goalsAgainst: number;
  shots: number;
  assists: number;
  saves: number;
  demosInflicted: number;
  gameRecord: string;
  seriesRecord: string;
}

type StatsLens = "2s" | "3s" | "combined";

export default function DraftTeamModal({
  team,
  onClose,
}: DraftTeamModalProps) {
  const [staff, setStaff] = useState<TeamStaff>({
    franchiseManager: null,
    generalManager: null,
    captain: null,
  });
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [players, setPlayers] = useState<PlayerWithStats[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [statsLens, setStatsLens] = useState<StatsLens>("combined");
  const [historicalSeason, setHistoricalSeason] = useState<string | null>(null);
  const [historicalStats, setHistoricalStats] = useState<TeamHistoricalStats | null>(null);
  const [loadingHistoricalStats, setLoadingHistoricalStats] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Reset to the combined lens whenever a new team is opened, rather than
  // carrying over whatever lens was selected for the previously-viewed team.
  useEffect(() => {
    setStatsLens("combined");
  }, [team?.id]);

  // Fetch this team's last-completed-season stats when the team or the
  // selected 2s/3s/Both lens changes.
  useEffect(() => {
    const fetchHistoricalStats = async () => {
      if (!team) return;

      try {
        setLoadingHistoricalStats(true);
        const response = await fetch(
          `/api/mle-teams/${team.id}/historical-stats?mode=${statsLens}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch team historical stats");
        }
        const data = await response.json();
        setHistoricalSeason(data.season);
        setHistoricalStats(data.stats);
      } catch (error) {
        console.error("Error fetching team historical stats:", error);
        setHistoricalSeason(null);
        setHistoricalStats(null);
      } finally {
        setLoadingHistoricalStats(false);
      }
    };

    fetchHistoricalStats();
  }, [team?.id, statsLens]);

  // Fetch players when team changes
  useEffect(() => {
    const fetchPlayers = async () => {
      if (!team) return;

      try {
        setLoadingPlayers(true);
        const response = await fetch(`/api/teams/${team.id}/players`);

        if (!response.ok) {
          throw new Error("Failed to fetch players");
        }

        const data = await response.json();
        setPlayers(data.players || []);
      } catch (error) {
        console.error("Error fetching players:", error);
        setPlayers([]);
      } finally {
        setLoadingPlayers(false);
      }
    };

    fetchPlayers();
  }, [team?.id]);

  // Fetch staff when team changes
  useEffect(() => {
    const fetchStaff = async () => {
      if (!team) return;

      try {
        setLoadingStaff(true);
        console.log('Fetching staff for team:', team.id, team.name);
        const response = await fetch(`/api/teams/${team.id}/staff`);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Staff fetch failed:', response.status, errorText);
          throw new Error("Failed to fetch staff");
        }

        const data = await response.json();
        console.log('Staff data received:', data);
        setStaff(data.staff || {
          franchiseManager: null,
          generalManager: null,
          captain: null,
        });
      } catch (error) {
        console.error("Error fetching staff:", error);
        setStaff({
          franchiseManager: null,
          generalManager: null,
          captain: null,
        });
      } finally {
        setLoadingStaff(false);
      }
    };

    fetchStaff();
  }, [team?.id]);

  if (!team) return null;

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
        zIndex: 1000,
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-box modal-box-tight-padding"
        style={{
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
          className="modal-box-header"
          style={{
            alignItems: "flex-start",
            gap: "1rem",
            marginBottom: "2rem",
            paddingBottom: "1.5rem",
            borderBottom: "2px solid rgba(255,255,255,0.2)",
            position: "relative",
            zIndex: 1,
          }}
        >
          <Image
            src={team.logoPath}
            alt={`${team.name} logo`}
            width={80}
            height={80}
            style={{ borderRadius: "8px" }}
          />
          <div style={{ flex: 1 }}>
            <h2
              style={{
                fontSize: "clamp(1.2rem, 5vw, 1.8rem)",
                fontWeight: 700,
                color: "#ffffff",
                margin: "0 0 0.5rem 0",
                textShadow: "0 2px 4px rgba(0,0,0,0.3)",
              }}
            >
              {team.leagueId} {team.name}
            </h2>
            {/* Staff Information */}
            {loadingStaff ? (
              <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginTop: "0.75rem" }}>
                Loading staff...
              </div>
            ) : (staff.franchiseManager || staff.generalManager || staff.captain) ? (
              <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                {staff.franchiseManager && (
                  <div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "rgba(255,255,255,0.7)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      Franchise Manager
                    </div>
                    <div
                      style={{
                        fontSize: "0.95rem",
                        color: "#ffffff",
                        fontWeight: 600,
                      }}
                    >
                      {staff.franchiseManager.name}
                    </div>
                  </div>
                )}
                {staff.generalManager && (
                  <div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "rgba(255,255,255,0.7)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      General Manager
                    </div>
                    <div
                      style={{
                        fontSize: "0.95rem",
                        color: "#ffffff",
                        fontWeight: 600,
                      }}
                    >
                      {staff.generalManager.name}
                    </div>
                  </div>
                )}
                {staff.captain && (
                  <div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "rgba(255,255,255,0.7)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      Team Captain
                    </div>
                    <div
                      style={{
                        fontSize: "0.95rem",
                        color: "#ffffff",
                        fontWeight: 600,
                      }}
                    >
                      {staff.captain.name}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", marginTop: "0.75rem", fontStyle: "italic" }}>
                No staff information available
              </div>
            )}
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

        {/* Last-season stats */}
        <div style={{ position: "relative", zIndex: 1, marginBottom: "1.5rem" }}>
          {/* 2s / 3s / Both toggle */}
          <div
            style={{
              display: "inline-flex",
              background: "rgba(255,255,255,0.1)",
              borderRadius: "8px",
              padding: "0.25rem",
              marginBottom: "0.75rem",
              gap: "0.25rem",
            }}
          >
            {(
              [
                { value: "2s", label: "2s" },
                { value: "3s", label: "3s" },
                { value: "combined", label: "Both" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                onClick={() => setStatsLens(option.value)}
                style={{
                  border: "none",
                  borderRadius: "6px",
                  padding: "0.35rem 0.9rem",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  background:
                    statsLens === option.value
                      ? "rgba(255,255,255,0.9)"
                      : "transparent",
                  color: statsLens === option.value ? "#1a1a2e" : "#ffffff",
                  transition: "all 0.15s ease",
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          {loadingHistoricalStats ? (
            <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>
              Loading stats...
            </div>
          ) : !historicalStats ? (
            <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", fontStyle: "italic" }}>
              No {historicalSeason ?? "last-season"} stats available
            </div>
          ) : (
            <>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "rgba(255,255,255,0.6)",
                  marginBottom: "0.5rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {historicalSeason}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                {[
                  { label: "Fantasy Pts", value: historicalStats.fpts },
                  { label: "Goals", value: historicalStats.goals },
                  { label: "Goals Against", value: historicalStats.goalsAgainst },
                  { label: "Shots", value: historicalStats.shots },
                  { label: "Assists", value: historicalStats.assists },
                  { label: "Saves", value: historicalStats.saves },
                  { label: "Demos", value: historicalStats.demosInflicted },
                  { label: "Game Record", value: historicalStats.gameRecord },
                  { label: "Series Record", value: historicalStats.seriesRecord },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    style={{
                      background: "rgba(255,255,255,0.1)",
                      backdropFilter: "blur(4px)",
                      borderRadius: "8px",
                      padding: "0.5rem 0.85rem",
                      minWidth: "90px",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.7rem",
                        color: "rgba(255,255,255,0.7)",
                        marginBottom: "0.15rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.03em",
                      }}
                    >
                      {stat.label}
                    </div>
                    <div style={{ fontSize: "1rem", fontWeight: 700, color: "#ffffff" }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Roster - Horizontal Layout */}
        <div style={{ position: "relative", zIndex: 1 }}>
          <h3
            style={{
              fontSize: "1.1rem",
              fontWeight: 600,
              color: "#ffffff",
              marginBottom: "1rem",
              textShadow: "0 2px 4px rgba(0,0,0,0.3)",
            }}
          >
            Roster
          </h3>
          {loadingPlayers ? (
            <div
              style={{
                padding: "2rem",
                textAlign: "center",
                color: "rgba(255,255,255,0.7)",
              }}
            >
              Loading players...
            </div>
          ) : players.length === 0 ? (
            <div
              style={{
                padding: "2rem",
                textAlign: "center",
                color: "rgba(255,255,255,0.7)",
              }}
            >
              No players found
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "1rem",
                justifyContent: "center",
              }}
            >
              {players.map((player) => (
                <div
                  key={player.id}
                  onClick={() => setSelectedPlayer({ id: player.id, name: player.name })}
                  style={{
                    background: "rgba(255,255,255,0.15)",
                    backdropFilter: "blur(4px)",
                    borderRadius: "8px",
                    padding: "1rem 1.5rem",
                    minWidth: "150px",
                    textAlign: "center",
                    border: "1px solid rgba(255,255,255,0.2)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.25)";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.15)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <div
                    style={{
                      fontSize: "1rem",
                      fontWeight: 700,
                      color: "#ffffff",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {player.name}
                  </div>
                  {player.skillGroup && (
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "rgba(255,255,255,0.8)",
                      }}
                    >
                      {player.skillGroup}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Player Modal */}
        {selectedPlayer && (
          <PlayerModal
            player={selectedPlayer}
            team={team}
            onClose={() => setSelectedPlayer(null)}
          />
        )}
      </div>
    </div>
  );
}
