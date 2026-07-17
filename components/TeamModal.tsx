"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import PlayerModal from "./PlayerModal";
import MLEMatchDetailsModal, { MLEMatchDetailsData } from "./MLEMatchDetailsModal";

interface PlayerWithStats {
  id: string;
  name: string;
  skillGroup: string | null;
  doublesStats: {
    totalGoals: number;
    totalShots: number;
    totalSaves: number;
    totalAssists: number;
    totalDemosInflicted: number;
    gamesPlayed: number;
  } | null;
  standardStats: {
    totalGoals: number;
    totalShots: number;
    totalSaves: number;
    totalAssists: number;
    totalDemosInflicted: number;
    gamesPlayed: number;
  } | null;
}

interface TeamModalProps {
  team: {
    leagueId: string;
    name: string;
    logoPath: string;
    primaryColor: string;
    secondaryColor: string;
    id: string;
    fpts?: number;
    avg?: number;
    last?: number;
    rank?: number;
    record?: string;
    status?: string;
    rosteredBy?: {
      rosterName: string;
      managerName: string;
    };
  } | null;
  onClose: () => void;
  isDraftContext?: boolean;
}

interface TeamStaff {
  franchiseManager: { id: string; name: string } | null;
  generalManager: { id: string; name: string } | null;
  assistantGeneralManagers: { id: string; name: string }[];
  captains: { id: string; name: string }[];
}

interface TeamOverview {
  week: number;
  record2s: string;
  record3s: string;
  mleStanding2s: { rank: number; totalTeams: number } | null;
  mleStanding3s: { rank: number; totalTeams: number } | null;
  fantasyRank2s: number | null;
  fantasyRank3s: number | null;
  fantasyRankTotalTeams: number;
}

export default function TeamModal({
  team,
  onClose,
  isDraftContext = false,
}: TeamModalProps) {
  const [gameMode, setGameMode] = useState<"2s" | "3s">("2s");
  const [playerSortColumn, setPlayerSortColumn] = useState<string>("goals");
  const [playerSortDirection, setPlayerSortDirection] = useState<
    "asc" | "desc"
  >("desc");
  const [staff, setStaff] = useState<TeamStaff>({
    franchiseManager: null,
    generalManager: null,
    assistantGeneralManagers: [],
    captains: [],
  });
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [weeklyStats, setWeeklyStats] = useState<
    Array<{
      week: number;
      gamemode: "2s" | "3s";
      opponent: string;
      fpts: number;
      sprocketRating: number;
      goals: number;
      saves: number;
      shots: number;
      assists: number;
      goalsAgainst: number | null;
      shotsAgainst: number | null;
      demosInflicted: number;
      demosTaken: number;
      matchResult: string;
    }>
  >([]);
  const [loadingWeeklyStats, setLoadingWeeklyStats] = useState(true);
  const [weeklySortColumn, setWeeklySortColumn] = useState<string>("week");
  const [weeklySortDirection, setWeeklySortDirection] = useState<
    "asc" | "desc"
  >("asc");
  const [selectedPlayer, setSelectedPlayer] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [players, setPlayers] = useState<PlayerWithStats[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [matchData, setMatchData] = useState<
    MLEMatchDetailsData | { match: null; message?: string } | null
  >(null);
  const [loadingMatchup, setLoadingMatchup] = useState(false);

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
        const response = await fetch(`/api/teams/${team.id}/staff`);

        if (!response.ok) {
          throw new Error("Failed to fetch staff");
        }

        const data = await response.json();
        setStaff(data.staff || {
          franchiseManager: null,
          generalManager: null,
          assistantGeneralManagers: [],
          captains: [],
        });
      } catch (error) {
        console.error("Error fetching staff:", error);
        setStaff({
          franchiseManager: null,
          generalManager: null,
          assistantGeneralManagers: [],
          captains: [],
        });
      } finally {
        setLoadingStaff(false);
      }
    };

    fetchStaff();
  }, [team?.id]);

  // Fetch the real, always-consistent 2s/3s records + MLE standing + fantasy
  // rank when the team changes — independent of whatever record/rank the
  // opening page happened to pass in for whichever mode it was sorted by.
  useEffect(() => {
    const fetchOverview = async () => {
      if (!team) return;

      try {
        setLoadingOverview(true);
        const response = await fetch(`/api/mle-teams/${team.id}/overview`);

        if (!response.ok) {
          throw new Error("Failed to fetch team overview");
        }

        const data = await response.json();
        setOverview(data);
      } catch (error) {
        console.error("Error fetching team overview:", error);
        setOverview(null);
      } finally {
        setLoadingOverview(false);
      }
    };

    fetchOverview();
  }, [team?.id]);

  // Fetch weekly breakdown when team changes
  useEffect(() => {
    const fetchWeeklyStats = async () => {
      if (!team) return;

      try {
        setLoadingWeeklyStats(true);
        const response = await fetch(
          `/api/leagues/${team.leagueId}/mle-teams/${team.id}/weekly-breakdown`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch weekly breakdown");
        }

        const data = await response.json();
        setWeeklyStats(data.weeks || []);
      } catch (error) {
        console.error("Error fetching weekly breakdown:", error);
        setWeeklyStats([]);
      } finally {
        setLoadingWeeklyStats(false);
      }
    };

    fetchWeeklyStats();
  }, [team?.id, team?.leagueId]);

  // Fetch the real MLE-vs-MLE match details when a week is selected
  useEffect(() => {
    if (!selectedWeek || !team) return;

    const fetchMatchData = async () => {
      try {
        setLoadingMatchup(true);
        const response = await fetch(
          `/api/leagues/${team.leagueId}/mle-teams/${team.id}/match-details?week=${selectedWeek}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch match details");
        }

        const data = await response.json();
        setMatchData(data);
      } catch (error) {
        console.error("Error fetching match details:", error);
        setMatchData(null);
      } finally {
        setLoadingMatchup(false);
      }
    };

    fetchMatchData();
  }, [selectedWeek, team?.id, team?.leagueId]);

  if (!team) return null;

  const handlePlayerSort = (column: string) => {
    if (playerSortColumn === column) {
      setPlayerSortDirection(playerSortDirection === "asc" ? "desc" : "asc");
    } else {
      setPlayerSortColumn(column);
      setPlayerSortDirection("desc");
    }
  };

  const handleWeeklySort = (column: string) => {
    if (weeklySortColumn === column) {
      setWeeklySortDirection(weeklySortDirection === "asc" ? "desc" : "asc");
    } else {
      setWeeklySortColumn(column);
      setWeeklySortDirection(column === "week" ? "asc" : "desc");
    }
  };

  const handleWeekClick = (week: number) => {
    setSelectedWeek(week);
  };

  const handleCloseMatchupModal = () => {
    setSelectedWeek(null);
    setMatchData(null);
  };

  const sortedPlayers = [...players].sort((a, b) => {
    const stats = gameMode === "2s" ? "doublesStats" : "standardStats";
    const aStats = a[stats];
    const bStats = b[stats];

    if (!aStats && !bStats) return 0;
    if (!aStats) return 1;
    if (!bStats) return -1;

    let aVal: number = 0;
    let bVal: number = 0;

    switch (playerSortColumn) {
      case "goals":
        aVal = aStats.totalGoals;
        bVal = bStats.totalGoals;
        break;
      case "shots":
        aVal = aStats.totalShots;
        bVal = bStats.totalShots;
        break;
      case "saves":
        aVal = aStats.totalSaves;
        bVal = bStats.totalSaves;
        break;
      case "assists":
        aVal = aStats.totalAssists;
        bVal = bStats.totalAssists;
        break;
      case "demos":
        aVal = aStats.totalDemosInflicted;
        bVal = bStats.totalDemosInflicted;
        break;
      default:
        return 0;
    }

    return playerSortDirection === "asc" ? aVal - bVal : bVal - aVal;
  });

  const sortedWeeklyStats = weeklyStats
    .filter((w) => w.gamemode === gameMode)
    .sort((a, b) => {
      const aVal = a[weeklySortColumn as keyof (typeof weeklyStats)[0]];
      const bVal = b[weeklySortColumn as keyof (typeof weeklyStats)[0]];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return weeklySortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });

  const PlayerSortIcon = ({ column }: { column: string }) => {
    if (playerSortColumn !== column) return null;
    return (
      <span style={{ marginLeft: "0.25rem", fontSize: "0.7rem" }}>
        {playerSortDirection === "asc" ? "▲" : "▼"}
      </span>
    );
  };

  const WeeklySortIcon = ({ column }: { column: string }) => {
    if (weeklySortColumn !== column) return null;
    return (
      <span style={{ marginLeft: "0.25rem", fontSize: "0.7rem" }}>
        {weeklySortDirection === "asc" ? "▲" : "▼"}
      </span>
    );
  };

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
        boxSizing: "border-box",
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
            {!isDraftContext && (
              <div className="team-modal-stats-grid" style={{ marginBottom: "0.75rem" }}>
                {loadingOverview ? (
                  <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)" }}>
                    Loading standings...
                  </div>
                ) : overview ? (
                  <>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.7)", marginBottom: "0.25rem" }}>
                        2s Record
                      </div>
                      <div style={{ fontSize: "0.95rem", color: "#ffffff", fontWeight: 600 }}>
                        {overview.record2s}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.7)", marginBottom: "0.25rem" }}>
                        3s Record
                      </div>
                      <div style={{ fontSize: "0.95rem", color: "#ffffff", fontWeight: 600 }}>
                        {overview.record3s}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.7)", marginBottom: "0.25rem" }}>
                        2s MLE Standing
                      </div>
                      <div style={{ fontSize: "0.95rem", color: "#ffffff", fontWeight: 600 }}>
                        {overview.mleStanding2s
                          ? `#${overview.mleStanding2s.rank} of ${overview.mleStanding2s.totalTeams}`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.7)", marginBottom: "0.25rem" }}>
                        3s MLE Standing
                      </div>
                      <div style={{ fontSize: "0.95rem", color: "#ffffff", fontWeight: 600 }}>
                        {overview.mleStanding3s
                          ? `#${overview.mleStanding3s.rank} of ${overview.mleStanding3s.totalTeams}`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.7)", marginBottom: "0.25rem" }}>
                        2s Fantasy Rank
                      </div>
                      <div style={{ fontSize: "0.95rem", color: "#ffffff", fontWeight: 600 }}>
                        {overview.fantasyRank2s
                          ? `#${overview.fantasyRank2s} of ${overview.fantasyRankTotalTeams}`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.7)", marginBottom: "0.25rem" }}>
                        3s Fantasy Rank
                      </div>
                      <div style={{ fontSize: "0.95rem", color: "#ffffff", fontWeight: 600 }}>
                        {overview.fantasyRank3s
                          ? `#${overview.fantasyRank3s} of ${overview.fantasyRankTotalTeams}`
                          : "—"}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            )}
            {/* Staff Information - Always show if available */}
            {!loadingStaff && (staff.franchiseManager || staff.generalManager || staff.assistantGeneralManagers.length > 0 || staff.captains.length > 0) && (
              <div className="team-modal-staff-grid" style={{ marginTop: "0.75rem" }}>
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
                {staff.assistantGeneralManagers.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "rgba(255,255,255,0.7)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      {staff.assistantGeneralManagers.length > 1 ? "Assistant General Managers" : "Assistant General Manager"}
                    </div>
                    <div
                      style={{
                        fontSize: "0.95rem",
                        color: "#ffffff",
                        fontWeight: 600,
                      }}
                    >
                      {staff.assistantGeneralManagers.map((agm) => agm.name).join(", ")}
                    </div>
                  </div>
                )}
                {staff.captains.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "rgba(255,255,255,0.7)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      {staff.captains.length > 1 ? "Team Captains" : "Team Captain"}
                    </div>
                    <div
                      style={{
                        fontSize: "0.95rem",
                        color: "#ffffff",
                        fontWeight: 600,
                      }}
                    >
                      {staff.captains.map((c) => c.name).join(", ")}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!isDraftContext && (team.status || team.rosteredBy) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginTop: "1.5rem",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    padding: "0.35rem 0.75rem",
                    borderRadius: "4px",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    backgroundColor: "rgba(255, 255, 255, 0.2)",
                    color: "#ffffff",
                    backdropFilter: "blur(4px)",
                  }}
                >
                  {team.rosteredBy
                    ? "Rostered"
                    : team.status === "free-agent"
                    ? "Free Agent"
                    : "On Waivers"}
                </span>
                {team.rosteredBy && (
                  <span
                    style={{
                      fontSize: "0.9rem",
                      color: "rgba(255, 255, 255, 0.9)",
                      fontWeight: 600,
                    }}
                  >
                    | {team.rosteredBy.rosterName} (
                    {team.rosteredBy.managerName})
                  </span>
                )}
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

        {/* Players Table */}
        <div style={{ position: "relative", zIndex: 1, marginBottom: "2rem" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem",
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
              Roster
            </h3>
            {/* Game Mode Toggle */}
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
                onClick={() => setGameMode("2s")}
                style={{
                  padding: "0.4rem 1rem",
                  borderRadius: "4px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor:
                    gameMode === "2s" ? "rgba(255,255,255,0.9)" : "transparent",
                  color: gameMode === "2s" ? team.primaryColor : "#ffffff",
                  transition: "all 0.2s ease",
                }}
              >
                2s
              </button>
              <button
                onClick={() => setGameMode("3s")}
                style={{
                  padding: "0.4rem 1rem",
                  borderRadius: "4px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor:
                    gameMode === "3s" ? "rgba(255,255,255,0.9)" : "transparent",
                  color: gameMode === "3s" ? team.primaryColor : "#ffffff",
                  transition: "all 0.2s ease",
                }}
              >
                3s
              </button>
            </div>
          </div>
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
                    Player
                  </th>
                  <th
                    onClick={() => handlePlayerSort("goals")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "rgba(255,255,255,0.9)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Goals
                    <PlayerSortIcon column="goals" />
                  </th>
                  <th
                    onClick={() => handlePlayerSort("shots")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "rgba(255,255,255,0.9)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Shots
                    <PlayerSortIcon column="shots" />
                  </th>
                  <th
                    onClick={() => handlePlayerSort("saves")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "rgba(255,255,255,0.9)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Saves
                    <PlayerSortIcon column="saves" />
                  </th>
                  <th
                    onClick={() => handlePlayerSort("assists")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "rgba(255,255,255,0.9)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Assists
                    <PlayerSortIcon column="assists" />
                  </th>
                  <th
                    onClick={() => handlePlayerSort("demos")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "rgba(255,255,255,0.9)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Demos
                    <PlayerSortIcon column="demos" />
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
                    Usages
                  </th>
                </tr>
              </thead>
              <tbody>
                {loadingPlayers ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        padding: "2rem",
                        textAlign: "center",
                        color: "rgba(255,255,255,0.7)",
                      }}
                    >
                      Loading players...
                    </td>
                  </tr>
                ) : sortedPlayers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        padding: "2rem",
                        textAlign: "center",
                        color: "rgba(255,255,255,0.7)",
                      }}
                    >
                      No players found
                    </td>
                  </tr>
                ) : (
                  sortedPlayers.map((player) => {
                    const stats =
                      gameMode === "2s"
                        ? player.doublesStats
                        : player.standardStats;

                    return (
                      <tr
                        key={player.id}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.1)",
                        }}
                      >
                        <td
                          onClick={() =>
                            setSelectedPlayer({
                              id: player.id,
                              name: player.name,
                            })
                          }
                          style={{
                            padding: "0.75rem 1rem",
                            fontWeight: 600,
                            color: "#ffffff",
                            cursor: "pointer",
                            transition: "color 0.2s",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.color =
                              "rgba(255,255,255,0.7)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.color = "#ffffff")
                          }
                        >
                          {player.name}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            textAlign: "right",
                            fontSize: "0.9rem",
                            color: "rgba(255,255,255,0.95)",
                          }}
                        >
                          {stats?.totalGoals || 0}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            textAlign: "right",
                            fontSize: "0.9rem",
                            color: "rgba(255,255,255,0.95)",
                          }}
                        >
                          {stats?.totalShots || 0}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            textAlign: "right",
                            fontSize: "0.9rem",
                            color: "rgba(255,255,255,0.95)",
                          }}
                        >
                          {stats?.totalSaves || 0}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            textAlign: "right",
                            fontSize: "0.9rem",
                            color: "rgba(255,255,255,0.95)",
                          }}
                        >
                          {stats?.totalAssists || 0}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            textAlign: "right",
                            fontSize: "0.9rem",
                            color: "rgba(255,255,255,0.95)",
                          }}
                        >
                          {stats?.totalDemosInflicted || 0}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            textAlign: "center",
                            fontSize: "0.9rem",
                            color: "rgba(255,255,255,0.8)",
                          }}
                        >
                          {stats?.gamesPlayed || 0}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Weekly Stats Table - Only show in non-draft context */}
        {!isDraftContext && (
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
              Weekly Breakdown
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{ borderBottom: "2px solid rgba(255,255,255,0.2)" }}
                  >
                    <th
                      onClick={() => handleWeeklySort("week")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "left",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Week
                      <WeeklySortIcon column="week" />
                    </th>
                    <th
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "left",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Opponent
                    </th>
                    <th
                      onClick={() => handleWeeklySort("fpts")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Fpts
                      <WeeklySortIcon column="fpts" />
                    </th>
                    <th
                      onClick={() => handleWeeklySort("sprocketRating")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Sprocket Rating
                      <WeeklySortIcon column="sprocketRating" />
                    </th>
                    <th
                      onClick={() => handleWeeklySort("goals")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Goals
                      <WeeklySortIcon column="goals" />
                    </th>
                    <th
                      onClick={() => handleWeeklySort("saves")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Saves
                      <WeeklySortIcon column="saves" />
                    </th>
                    <th
                      onClick={() => handleWeeklySort("shots")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Shots
                      <WeeklySortIcon column="shots" />
                    </th>
                    <th
                      onClick={() => handleWeeklySort("assists")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Assists
                      <WeeklySortIcon column="assists" />
                    </th>
                    <th
                      onClick={() => handleWeeklySort("goalsAgainst")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Goals Against
                      <WeeklySortIcon column="goalsAgainst" />
                    </th>
                    <th
                      onClick={() => handleWeeklySort("shotsAgainst")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Shots Against
                      <WeeklySortIcon column="shotsAgainst" />
                    </th>
                    <th
                      onClick={() => handleWeeklySort("demosInflicted")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Demos Inflicted
                      <WeeklySortIcon column="demosInflicted" />
                    </th>
                    <th
                      onClick={() => handleWeeklySort("demosTaken")}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      Demos Taken
                      <WeeklySortIcon column="demosTaken" />
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
                      Match Result
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loadingWeeklyStats ? (
                    <tr>
                      <td
                        colSpan={12}
                        style={{
                          padding: "2rem",
                          textAlign: "center",
                          color: "rgba(255,255,255,0.7)",
                        }}
                      >
                        Loading weekly breakdown...
                      </td>
                    </tr>
                  ) : sortedWeeklyStats.length === 0 ? (
                    <tr>
                      <td
                        colSpan={12}
                        style={{
                          padding: "2rem",
                          textAlign: "center",
                          color: "rgba(255,255,255,0.7)",
                        }}
                      >
                        No weekly stats available yet
                      </td>
                    </tr>
                  ) : (
                    sortedWeeklyStats.map((week) => (
                    <tr
                      key={week.week}
                      onClick={() => handleWeekClick(week.week)}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.1)",
                        cursor: "pointer",
                        transition: "background 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          "rgba(255,255,255,0.05)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          fontWeight: 600,
                          color: "#ffffff",
                        }}
                      >
                        {week.week}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.opponent}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontWeight: 600,
                          fontSize: "0.9rem",
                          color: "#ffffff",
                        }}
                      >
                        {week.fpts}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.sprocketRating}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.goals}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.saves}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.shots}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.assists}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.goalsAgainst ?? "—"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.shotsAgainst ?? "—"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.demosInflicted}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.demosTaken}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontSize: "0.9rem",
                          fontWeight: 600,
                          color: "rgba(255,255,255,0.95)",
                        }}
                      >
                        {week.matchResult}
                      </td>
                    </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Player Modal */}
        {selectedPlayer && (
          <PlayerModal
            player={selectedPlayer}
            team={team}
            onClose={() => setSelectedPlayer(null)}
          />
        )}

        {/* MLE Match Details Modal */}
        {selectedWeek && (
          <MLEMatchDetailsModal
            matchData={matchData}
            onClose={handleCloseMatchupModal}
            isLoading={loadingMatchup}
          />
        )}
      </div>
    </div>
  );
}
