"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

type ScheduleGame = {
  week: number;
  result: string | null;
  myScore: number | null;
  oppScore: number | null;
  opponent: string;
  oppRecord: string;
  oppPlace: string;
  manager: string;
  opponentTeamId: string;
  isPlayoff: boolean;
};

type FantasyTeamData = {
  id: string;
  displayName: string;
  manager: string;
  isYou: boolean;
};

export default function SchedulePage() {
  const params = useParams();
  const router = useRouter();
  const leagueId = params.LeagueID as string;

  const [teams, setTeams] = useState<FantasyTeamData[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleGame[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all teams in the league
  useEffect(() => {
    async function fetchTeams() {
      try {
        const response = await fetch(`/api/leagues/${leagueId}/standings`);
        if (!response.ok) throw new Error("Failed to fetch teams");

        const data = await response.json();
        const teamsData = data.standings.map((standing: any) => ({
          id: standing.fantasyTeamId,
          displayName: standing.team,
          manager: standing.manager,
          isYou: standing.isYou,
        }));

        setTeams(teamsData);
        if (teamsData.length > 0 && !activeTeamId) {
          const own = teamsData.find((t: FantasyTeamData) => t.isYou);
          setActiveTeamId(own ? own.id : teamsData[0].id);
        }
      } catch (err) {
        console.error("Error fetching teams:", err);
        setError("Failed to load teams");
      }
    }

    fetchTeams();
  }, [leagueId]);

  // Fetch schedule for selected team
  useEffect(() => {
    if (!activeTeamId) return;

    async function fetchSchedule() {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/leagues/${leagueId}/schedule?teamId=${activeTeamId}`
        );
        if (!response.ok) throw new Error("Failed to fetch schedule");

        const data = await response.json();
        setSchedule(data.schedule);
      } catch (err) {
        console.error("Error fetching schedule:", err);
        setError("Failed to load schedule");
      } finally {
        setLoading(false);
      }
    }

    fetchSchedule();
  }, [leagueId, activeTeamId]);

  const selectedTeam = teams.find((t) => t.id === activeTeamId);

  const handleManagerClick = (managerName: string) => {
    router.push(
      `/leagues/${leagueId}/opponents?manager=${encodeURIComponent(managerName)}`
    );
  };

  if (error) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 className="page-heading" style={{ fontSize: "clamp(1.5rem, 6vw, 2.5rem)", color: "var(--accent)", fontWeight: 700 }}>
          Schedule
        </h1>
        <p style={{ color: "var(--text-muted)", marginTop: "1rem" }}>{error}</p>
      </div>
    );
  }

  return (
    <>
      {/* Page Header with Dropdown */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <h1
          className="page-heading"
          style={{
            fontSize: "clamp(1.5rem, 6vw, 2.5rem)",
            color: "var(--accent)",
            fontWeight: 700,
            margin: 0,
          }}
        >
          Schedule
        </h1>

        {/* Manager Dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{
              background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#ffffff",
              padding: "0.75rem 1.5rem",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "1rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              minWidth: "250px",
              justifyContent: "space-between",
            }}
          >
            <span>
              {selectedTeam
                ? `${selectedTeam.displayName} - ${selectedTeam.manager}`
                : "Select Team"}
            </span>
            <span>{dropdownOpen ? "▲" : "▼"}</span>
          </button>

          {dropdownOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: "0.5rem",
                background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                borderRadius: "8px",
                padding: "0.5rem 0",
                minWidth: "280px",
                maxHeight: "400px",
                overflowY: "auto",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                zIndex: 1000,
              }}
            >
              {teams.map((team) => (
                <button
                  key={team.id}
                  onClick={() => {
                    setActiveTeamId(team.id);
                    setDropdownOpen(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "0.75rem 1rem",
                    background:
                      team.id === activeTeamId
                        ? "rgba(255,255,255,0.1)"
                        : "transparent",
                    border: "none",
                    color: "#ffffff",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "background 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                  }}
                  onMouseLeave={(e) => {
                    if (team.id !== activeTeamId) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                    {team.displayName}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    {team.manager}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Schedule Table */}
      <section className="card">
        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <p style={{ color: "var(--text-muted)" }}>Loading schedule...</p>
          </div>
        ) : schedule.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <p style={{ color: "var(--text-muted)" }}>
              No schedule available yet
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <th
                    style={{
                      padding: "1rem 1.5rem",
                      textAlign: "left",
                      fontSize: "1rem",
                      color: "var(--text-main)",
                      fontWeight: 700,
                      width: "10%",
                    }}
                  >
                    Week
                  </th>
                  <th
                    style={{
                      padding: "1rem 1.5rem",
                      textAlign: "center",
                      fontSize: "1rem",
                      color: "var(--text-main)",
                      fontWeight: 700,
                      width: "25%",
                    }}
                  >
                    Score
                  </th>
                  <th
                    style={{
                      padding: "1rem 1.5rem",
                      textAlign: "left",
                      fontSize: "1rem",
                      color: "var(--text-main)",
                      fontWeight: 700,
                      width: "40%",
                    }}
                  >
                    Opponent
                  </th>
                  <th
                    style={{
                      padding: "1rem 1.5rem",
                      textAlign: "left",
                      fontSize: "1rem",
                      color: "var(--text-main)",
                      fontWeight: 700,
                      width: "25%",
                    }}
                  >
                    Manager
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((game: ScheduleGame, index: number) => (
                  <tr
                    key={index}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    {/* Week */}
                    <td
                      style={{
                        padding: "1.25rem 1.5rem",
                        fontSize: "1rem",
                        color: "var(--text-muted)",
                        fontWeight: 500,
                      }}
                    >
                      Week {game.week}
                    </td>

                    {/* Score */}
                    <td
                      style={{
                        padding: "1.25rem 1.5rem",
                        textAlign: "center",
                      }}
                    >
                      {game.result ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "0.75rem",
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: "1.1rem",
                              color:
                                game.result === "W"
                                  ? "#4ade80"
                                  : game.result === "L"
                                  ? "#ef4444"
                                  : "#facc15",
                            }}
                          >
                            {game.result}
                          </span>
                          <span
                            style={{
                              fontSize: "1rem",
                              fontWeight: 600,
                              color: "var(--text-main)",
                            }}
                          >
                            {game.myScore?.toFixed(1)} -{" "}
                            {game.oppScore?.toFixed(1)}
                          </span>
                        </div>
                      ) : (
                        <span
                          style={{
                            color: "var(--text-muted)",
                            fontSize: "0.9rem",
                          }}
                        >
                          -
                        </span>
                      )}
                    </td>

                    {/* Opponent */}
                    <td
                      style={{
                        padding: "1.25rem 1.5rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "1rem",
                            color: "var(--text-main)",
                            fontWeight: 500,
                          }}
                        >
                          vs. {game.opponent}
                        </span>
                        {game.oppRecord !== "0-0" && (
                          <>
                            <span
                              style={{
                                fontSize: "0.9rem",
                                color: "var(--text-muted)",
                              }}
                            >
                              {game.oppRecord}
                            </span>
                            <span
                              style={{
                                fontSize: "0.9rem",
                                color: "var(--text-muted)",
                              }}
                            >
                              {game.oppPlace}
                            </span>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Manager */}
                    <td
                      style={{
                        padding: "1.25rem 1.5rem",
                        fontSize: "1rem",
                        color: "var(--text-main)",
                        fontWeight: 500,
                      }}
                    >
                      <span
                        onClick={() => handleManagerClick(game.manager)}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.color = "var(--accent)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.color = "var(--text-main)")
                        }
                        style={{
                          cursor: "pointer",
                          transition: "color 0.2s",
                        }}
                      >
                        {game.manager}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
