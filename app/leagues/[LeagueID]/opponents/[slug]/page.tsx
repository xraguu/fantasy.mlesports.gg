"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import HeaderTooltip from "@/components/HeaderTooltip";

// Mock opponent roster data
const mockOpponentRoster = {
  managerName: "rival_player",
  teamName: "Thunder Strikers",
  record: { wins: 3, losses: 0, place: "1st" },
  totalPoints: 612,
  avgPoints: 204,
  currentWeek: 3,
  lastMatchup: {
    myTeam: "Thunder Strikers",
    myScore: 198,
    opponent: "Ice Warriors",
    opponentScore: 165
  },
  currentMatchup: {
    myTeam: "Thunder Strikers",
    myScore: 205,
    opponent: "Fantastic Ballers",
    opponentScore: 169
  },
  teams: [
    // 2v2 Slots
    { slot: "2s", name: "Comets AL", opponent: "Bulls CL", twos: { score: 52.0, oprk: 1, fprk: 1, fpts: 455.0, avg: 56.9, last: 55.0, goals: 152, shots: 920, saves: 245, assists: 105, demos: 72, teamRecord: "9-1" }, threes: { score: 50.0, oprk: 2, fprk: 2, fpts: 440.0, avg: 55.0, last: 53.0, goals: 148, shots: 900, saves: 240, assists: 102, demos: 70, teamRecord: "8-2" } },
    { slot: "2s", name: "Dodgers AL", opponent: "Ducks AL", twos: { score: 51.0, oprk: 2, fprk: 2, fpts: 442.0, avg: 55.3, last: 53.5, goals: 148, shots: 905, saves: 238, assists: 101, demos: 69, teamRecord: "8-2" }, threes: { score: 49.0, oprk: 3, fprk: 3, fpts: 428.0, avg: 53.5, last: 51.5, goals: 144, shots: 885, saves: 233, assists: 98, demos: 67, teamRecord: "7-3" } },
    // 3v3 Slots
    { slot: "3s", name: "Ducks AL", opponent: "Dodgers AL", twos: { score: 48.5, oprk: 3, fprk: 3, fpts: 410.0, avg: 51.3, last: 50.0, goals: 138, shots: 865, saves: 225, assists: 93, demos: 63, teamRecord: "7-3" }, threes: { score: 50.5, oprk: 1, fprk: 3, fpts: 425.0, avg: 53.1, last: 52.0, goals: 142, shots: 885, saves: 230, assists: 96, demos: 65, teamRecord: "7-3" } },
    { slot: "3s", name: "Bulls CL", opponent: "Comets AL", twos: { score: 47.5, oprk: 4, fprk: 4, fpts: 398.0, avg: 49.8, last: 48.5, goals: 134, shots: 845, saves: 220, assists: 89, demos: 60, teamRecord: "6-4" }, threes: { score: 49.5, oprk: 3, fprk: 4, fpts: 412.0, avg: 51.5, last: 50.5, goals: 138, shots: 865, saves: 225, assists: 92, demos: 62, teamRecord: "7-3" } },
    // Flex Slot
    { slot: "FLX", name: "Ravens ML", opponent: "Hawks DL", twos: { score: 48.0, oprk: 4, fprk: 5, fpts: 398.0, avg: 49.8, last: 49.0, goals: 132, shots: 845, saves: 218, assists: 88, demos: 58, teamRecord: "6-4" }, threes: { score: 46.0, oprk: 5, fprk: 5, fpts: 384.0, avg: 48.0, last: 47.0, goals: 128, shots: 825, saves: 213, assists: 85, demos: 56, teamRecord: "6-4" } },
    // Bench
    { slot: "BE", name: "Hawks DL", opponent: "Ravens ML", twos: { score: 0, oprk: 5, fprk: 6, fpts: 385.0, avg: 48.1, last: 47.5, goals: 128, shots: 825, saves: 212, assists: 85, demos: 55, teamRecord: "6-4" }, threes: { score: 0, oprk: 6, fprk: 6, fpts: 371.0, avg: 46.4, last: 45.5, goals: 124, shots: 805, saves: 207, assists: 82, demos: 53, teamRecord: "5-5" } },
    { slot: "BE", name: "Eagles ML", opponent: "Sharks CL", twos: { score: 0, oprk: 6, fprk: 7, fpts: 372.0, avg: 46.5, last: 46.0, goals: 124, shots: 805, saves: 205, assists: 82, demos: 52, teamRecord: "5-5" }, threes: { score: 0, oprk: 7, fprk: 7, fpts: 358.0, avg: 44.8, last: 44.0, goals: 120, shots: 785, saves: 200, assists: 79, demos: 50, teamRecord: "5-5" } },
    { slot: "BE", name: "Sharks CL", opponent: "Eagles ML", twos: { score: 0, oprk: 7, fprk: 8, fpts: 358.0, avg: 44.8, last: 44.0, goals: 118, shots: 785, saves: 198, assists: 78, demos: 49, teamRecord: "5-5" }, threes: { score: 0, oprk: 8, fprk: 8, fpts: 344.0, avg: 43.0, last: 42.0, goals: 114, shots: 765, saves: 193, assists: 75, demos: 47, teamRecord: "4-6" } },
  ]
};

export default function OpponentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const roster = mockOpponentRoster;
  const [currentWeek, setCurrentWeek] = useState(roster.currentWeek);
  const [activeTab, setActiveTab] = useState<"lineup" | "stats">("lineup");
  const [gameMode, setGameMode] = useState<"2s" | "3s">("2s");
  // Initialize modes for all 8 slots based on their slot type
  // FLX slot (index 4) defaults to whichever mode has higher score
  const flexTeam = roster.teams[4];
  const flexDefaultMode = flexTeam.twos.score > flexTeam.threes.score ? "2s" : "3s";
  const [slotModes, setSlotModes] = useState<("2s" | "3s")[]>(["2s", "2s", "3s", "3s", flexDefaultMode, "2s", "2s", "2s"]);

  return (
    <>
      {/* Page Header */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
        <h1 className="page-heading" style={{ fontSize: "clamp(1.5rem, 6vw, 2.5rem)", color: "var(--accent)", fontWeight: 700, margin: 0 }}>Opponent Roster</h1>
      </div>

      {/* Team Overview Card */}
      <section className="card" style={{
        marginBottom: "1.5rem",
        padding: "1.5rem 2rem"
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem", justifyContent: "space-between", alignItems: "center" }}>
          {/* Team Info */}
          <div>
            <h2 style={{ fontSize: "clamp(1.15rem, 4.5vw, 1.5rem)", fontWeight: 700, color: "var(--text-main)", marginBottom: "0.5rem", marginTop: 0 }}>
              {roster.teamName}{" "}
              <span style={{ color: "var(--accent)", marginLeft: "0.75rem" }}>
                {roster.record.wins}-{roster.record.losses}
              </span>{" "}
              <span style={{ color: "var(--text-muted)", fontSize: "1.2rem", marginLeft: "0.5rem" }}>
                {roster.record.place}
              </span>
            </h2>
            <div style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>{roster.managerName}</div>
            <div style={{ marginTop: "0.5rem", fontSize: "1rem" }}>
              <span style={{ fontWeight: 600, color: "var(--text-main)" }}>{roster.totalPoints} Fantasy Points</span>
              <span style={{ color: "var(--text-muted)", marginLeft: "1.5rem" }}>{roster.avgPoints} Avg Fantasy Points</span>
            </div>
          </div>

          {/* Matchup Info */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "center" }}>
            {/* Last Matchup */}
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic", marginBottom: "0.5rem" }}>
                Last Matchup
              </div>
              <div style={{ fontSize: "0.95rem", marginBottom: "0.25rem" }}>
                <span style={{ color: "var(--text-main)" }}>{roster.lastMatchup.myTeam}</span>{" "}
                <span style={{ color: "var(--accent)", fontWeight: 700, marginLeft: "0.5rem" }}>
                  {roster.lastMatchup.myScore}
                </span>
              </div>
              <div style={{ fontSize: "0.95rem" }}>
                <span style={{ color: "var(--text-muted)" }}>{roster.lastMatchup.opponent}</span>{" "}
                <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                  {roster.lastMatchup.opponentScore}
                </span>
              </div>
            </div>

            <div style={{ width: "1px", height: "60px", backgroundColor: "rgba(255,255,255,0.1)" }}></div>

            {/* Current Matchup */}
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic", marginBottom: "0.5rem" }}>
                Current Matchup
              </div>
              <div style={{ fontSize: "0.95rem", marginBottom: "0.25rem" }}>
                <span style={{ color: "var(--text-main)" }}>{roster.currentMatchup.myTeam}</span>{" "}
                <span style={{ color: "var(--accent)", fontWeight: 700, marginLeft: "0.5rem" }}>
                  {roster.currentMatchup.myScore}
                </span>
              </div>
              <div style={{ fontSize: "0.95rem" }}>
                <span style={{ color: "var(--text-muted)" }}>{roster.currentMatchup.opponent}</span>{" "}
                <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                  {roster.currentMatchup.opponentScore}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <button
          onClick={() => setActiveTab("lineup")}
          className={activeTab === "lineup" ? "btn btn-primary" : "btn btn-ghost"}
          style={{ fontSize: "1rem" }}
        >
          Lineup
        </button>
        <button
          onClick={() => setActiveTab("stats")}
          className={activeTab === "stats" ? "btn btn-primary" : "btn btn-ghost"}
          style={{ fontSize: "1rem" }}
        >
          Stats
        </button>
      </div>

      {/* Lineup Tab */}
      {activeTab === "lineup" && (
        <section className="card">
          {/* Week Navigation */}
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
            padding: "1rem 1.5rem",
            borderBottom: "1px solid rgba(255,255,255,0.1)"
          }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem" }}>
              <button
                onClick={() => setCurrentWeek(prev => Math.max(1, prev - 1))}
                className="btn btn-ghost"
                style={{ padding: "0.4rem 0.8rem", fontSize: "0.9rem" }}
              >
                ◄ Week {currentWeek - 1}
              </button>
              <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent)" }}>
                Week {currentWeek}
              </span>
              <button
                onClick={() => setCurrentWeek(prev => prev + 1)}
                className="btn btn-ghost"
                style={{ padding: "0.4rem 0.8rem", fontSize: "0.9rem" }}
              >
                Week {currentWeek + 1} ►
              </button>
            </div>
          </div>

          {/* Roster Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "0.75rem 0.5rem", width: "50px" }}></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Slot</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Team</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Score</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Opp" full="Opponent" /></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Oprk" full="Opponent Rank" /></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Fprk" full="Fantasy Points Rank" /></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Fpts" full="Fantasy Points" /></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Avg" full="Average Fantasy Points" /></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Last" full="Last Week's Fantasy Points" /></th>
                </tr>
              </thead>
              <tbody>
                {roster.teams.map((team, index) => {
                  const currentMode = slotModes[index];
                  const stats = currentMode === "2s" ? team.twos : team.threes;

                  return (
                  <tr
                    key={index}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      backgroundColor: team.slot === "BE" ? "rgba(255,255,255,0.02)" : "transparent",
                      borderTop: team.slot === "BE" && index === 5 ? "2px solid rgba(255,255,255,0.15)" : "none"
                    }}
                  >
                    <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", justifyContent: "center" }}>
                        <button
                          onClick={() => {
                            const newModes = [...slotModes];
                            newModes[index] = slotModes[index] === "2s" ? "3s" : "2s";
                            setSlotModes(newModes);
                          }}
                          style={{
                            background: "rgba(255,255,255,0.1)",
                            border: "none",
                            borderRadius: "4px",
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color: "var(--accent)",
                            cursor: "pointer",
                            transition: "all 0.2s ease"
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "rgba(242, 182, 50, 0.2)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                        >
                          ⇄
                        </button>
                        <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--accent)" }}>
                          {currentMode}
                        </span>
                      </div>
                    </td>
                    <td style={{
                      padding: "0.75rem 1rem",
                      fontWeight: 700,
                      fontSize: "0.9rem",
                      color: team.slot === "BE" ? "var(--text-muted)" : "var(--accent)"
                    }}>
                      {team.slot}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontWeight: 600, fontSize: "0.95rem" }}>
                      {team.name || "-"}
                    </td>
                    <td style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontWeight: 700,
                      fontSize: "1rem",
                      color: stats.score > 0 ? "var(--accent)" : "var(--text-muted)"
                    }}>
                      {stats.score > 0 ? stats.score.toFixed(1) : "-"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                      {team.opponent || "-"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.9rem" }}>
                      {stats.oprk || "-"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.9rem", fontWeight: 600 }}>
                      {stats.fprk || "-"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600, fontSize: "0.95rem" }}>
                      {stats.fpts ? stats.fpts.toFixed(1) : "-"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "right", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                      {stats.avg ? stats.avg.toFixed(1) : "-"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "right", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                      {stats.last ? stats.last.toFixed(1) : "-"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Stats Tab */}
      {activeTab === "stats" && (
        <section className="card">
          {/* Week Navigation and Mode Toggle */}
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
            padding: "1rem 1.5rem",
            borderBottom: "1px solid rgba(255,255,255,0.1)"
          }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem" }}>
              <button
                onClick={() => setCurrentWeek(prev => Math.max(1, prev - 1))}
                className="btn btn-ghost"
                style={{ padding: "0.4rem 0.8rem", fontSize: "0.9rem" }}
              >
                ◄ Week {currentWeek - 1}
              </button>
              <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent)" }}>
                Week {currentWeek}
              </span>
              <button
                onClick={() => setCurrentWeek(prev => prev + 1)}
                className="btn btn-ghost"
                style={{ padding: "0.4rem 0.8rem", fontSize: "0.9rem" }}
              >
                Week {currentWeek + 1} ►
              </button>
            </div>
            {/* Game Mode Toggle */}
            <div style={{ display: "flex", gap: "0.5rem", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: "6px", padding: "0.25rem" }}>
              <button
                onClick={() => setGameMode("2s")}
                style={{
                  padding: "0.4rem 1rem",
                  borderRadius: "4px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: gameMode === "2s" ? "var(--accent)" : "transparent",
                  color: gameMode === "2s" ? "#1a1a2e" : "var(--text-main)",
                  transition: "all 0.2s ease"
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
                  backgroundColor: gameMode === "3s" ? "var(--accent)" : "transparent",
                  color: gameMode === "3s" ? "#1a1a2e" : "var(--text-main)",
                  transition: "all 0.2s ease"
                }}
              >
                3s
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Rank</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Team</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Score</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Fprk" full="Fantasy Points Rank" /></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Fpts" full="Fantasy Points" /></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Avg" full="Average Fantasy Points" /></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Last" full="Last Week's Fantasy Points" /></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Goals</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Shots</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Saves</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Assists</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Demos" full="Demolitions" /></th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Record</th>
                </tr>
              </thead>
              <tbody>
                {roster.teams
                  .map(team => {
                    // Use the global gameMode toggle for stats tab
                    const stats = gameMode === "2s" ? team.twos : team.threes;

                    return {
                      ...team,
                      displayStats: stats
                    };
                  })
                  .sort((a, b) => a.displayStats.fprk - b.displayStats.fprk)
                  .map((team, index) => (
                    <tr
                      key={index}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.05)"
                      }}
                    >
                      <td style={{ padding: "0.75rem 1rem", fontWeight: 700, fontSize: "0.9rem", color: "var(--accent)" }}>
                        {index + 1}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", fontWeight: 600, fontSize: "0.95rem" }}>
                        {team.name}
                      </td>
                      <td style={{
                        padding: "0.75rem 1rem",
                        textAlign: "center",
                        fontWeight: 700,
                        fontSize: "1rem",
                        color: "var(--accent)"
                      }}>
                        {team.displayStats.score > 0 ? team.displayStats.score.toFixed(1) : "-"}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.9rem", fontWeight: 600 }}>
                        {team.displayStats.fprk}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600, fontSize: "0.95rem" }}>
                        {team.displayStats.fpts.toFixed(1)}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", textAlign: "right", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                        {team.displayStats.avg.toFixed(1)}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", textAlign: "right", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                        {team.displayStats.last.toFixed(1)}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.9rem" }}>
                        {team.displayStats.goals}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.9rem" }}>
                        {team.displayStats.shots}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.9rem" }}>
                        {team.displayStats.saves}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.9rem" }}>
                        {team.displayStats.assists}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.9rem" }}>
                        {team.displayStats.demos}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                        {team.displayStats.teamRecord}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
