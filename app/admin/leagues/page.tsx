"use client";

import { useState, useEffect, useCallback } from "react";
import { useAlert } from "@/components/AlertProvider";
import { setAdminViewingLeague } from "@/lib/adminLeagueView";

interface FantasyLeague {
  id: string;
  name: string;
  season: number;
  maxTeams: number;
  currentWeek: number;
  draftType: string;
  waiverSystem: string;
  _count: {
    fantasyTeams: number;
    draftPicks: number;
    matchups: number;
  };
  fantasyTeams: {
    owner: {
      displayName: string;
      discordId: string;
    };
  }[];
}

export default function ManageLeaguesPage() {
  const showAlert = useAlert();
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [leagues, setLeagues] = useState<FantasyLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentSeason, setCurrentSeason] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    season: new Date().getFullYear(),
    maxTeams: 12,
    draftType: "snake",
    waiverSystem: "rolling",
    faabBudget: 100,
    playoffTeams: 4,
  });

  const fetchLeagues = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/leagues");
      if (!response.ok) throw new Error("Failed to fetch leagues");
      const data = await response.json();
      setLeagues(data.leagues || []);
      if (data.currentSeason != null) {
        setCurrentSeason(data.currentSeason);
        setFormData((prev) => ({ ...prev, season: data.currentSeason }));
      }
    } catch (error) {
      console.error("Error fetching leagues:", error);
      showAlert("Failed to load leagues", "error");
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  // Fetch leagues on mount
  useEffect(() => {
    fetchLeagues();
  }, [fetchLeagues]);

  const handleCreateLeague = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch("/api/admin/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create league");
      }

      showAlert("League created successfully!", "success");
      setShowCreateModal(false);

      // Reset form
      setFormData({
        name: "",
        season: currentSeason ?? new Date().getFullYear(),
        maxTeams: 12,
        draftType: "snake",
        waiverSystem: "rolling",
        faabBudget: 100,
        playoffTeams: 4,
      });

      // Refresh leagues
      fetchLeagues();
    } catch (error) {
      console.error("Error creating league:", error);
      showAlert(error instanceof Error ? error.message : "Failed to create league", "error");
    }
  };

  const filteredLeagues = leagues.filter((league) =>
    league.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    league.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "400px",
        }}
      >
        <div style={{ fontSize: "1.2rem", color: "var(--text-muted)" }}>
          Loading leagues...
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Create League Modal */}
      {showCreateModal && (
        <>
          <div
            className="modal-backdrop"
            onClick={() => setShowCreateModal(false)}
          />
          <div
            className="modal"
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 1000,
              maxWidth: "500px",
              width: "90%",
            }}
          >
            <div className="card" style={{ padding: "clamp(1rem, 4vw, 2rem)" }}>
              <h2
                style={{
                  fontSize: "clamp(1.1rem, 4.5vw, 1.5rem)",
                  fontWeight: 700,
                  marginBottom: "1.5rem",
                  color: "var(--accent)",
                }}
              >
                Create New Fantasy League
              </h2>
              <form onSubmit={handleCreateLeague}>
                <div style={{ marginBottom: "1rem" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "0.5rem",
                      fontSize: "0.9rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    League Name
                  </label>
                  <input
                    type="text"
                    placeholder="2025 RL Fantasy Alpha"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "6px",
                      color: "var(--text-main)",
                      fontSize: "0.95rem",
                    }}
                    required
                  />
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "0.5rem",
                      fontSize: "0.9rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    Season
                  </label>
                  <input
                    type="number"
                    value={formData.season}
                    onChange={(e) =>
                      setFormData({ ...formData, season: parseInt(e.target.value) })
                    }
                    min={1}
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "6px",
                      color: "var(--text-main)",
                      fontSize: "0.95rem",
                    }}
                    required
                  />
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "0.5rem",
                      fontSize: "0.9rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    Number of Managers
                  </label>
                  <select
                    value={formData.maxTeams}
                    onChange={(e) =>
                      setFormData({ ...formData, maxTeams: parseInt(e.target.value) })
                    }
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "6px",
                      color: "var(--text-main)",
                      fontSize: "0.95rem",
                    }}
                    required
                  >
                    <option value={8}>8</option>
                    <option value={10}>10</option>
                    <option value={12}>12</option>
                  </select>
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "0.5rem",
                      fontSize: "0.9rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    Draft Type
                  </label>
                  <select
                    value={formData.draftType}
                    onChange={(e) =>
                      setFormData({ ...formData, draftType: e.target.value })
                    }
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "6px",
                      color: "var(--text-main)",
                      fontSize: "0.95rem",
                      cursor: "pointer",
                    }}
                  >
                    <option value="snake">Snake Draft</option>
                    <option value="linear">Linear Draft</option>
                  </select>
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "0.5rem",
                      fontSize: "0.9rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    Waiver System
                  </label>
                  <select
                    value={formData.waiverSystem}
                    onChange={(e) =>
                      setFormData({ ...formData, waiverSystem: e.target.value })
                    }
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "6px",
                      color: "var(--text-main)",
                      fontSize: "0.95rem",
                      cursor: "pointer",
                    }}
                  >
                    <option value="rolling">Rolling Waivers</option>
                    <option value="faab">FAAB (Free Agent Budget)</option>
                    <option value="fixed">Fixed Order</option>
                  </select>
                </div>
                {formData.waiverSystem === "faab" && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "0.5rem",
                        fontSize: "0.9rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      FAAB Budget
                    </label>
                    <input
                      type="number"
                      value={formData.faabBudget}
                      onChange={(e) =>
                        setFormData({ ...formData, faabBudget: parseInt(e.target.value) })
                      }
                      min={0}
                      style={{
                        width: "100%",
                        padding: "0.75rem",
                        background: "rgba(255,255,255,0.1)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        borderRadius: "6px",
                        color: "var(--text-main)",
                        fontSize: "0.95rem",
                      }}
                      required
                    />
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1.5rem" }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ flex: 1 }}
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                  >
                    Create League
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {/* Header Actions */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <input
          type="text"
          placeholder="Search leagues..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: "0.75rem 1rem",
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "6px",
            color: "var(--text-main)",
            fontSize: "0.95rem",
            width: "300px",
            maxWidth: "100%",
          }}
        />
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          + Create Fantasy League
        </button>
      </div>

      {/* Fantasy Leagues Table */}
      <div className="card" style={{ padding: "1.5rem" }}>
        <h2
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            marginBottom: "1.5rem",
            color: "var(--text-main)",
          }}
        >
          Fantasy Leagues
        </h2>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
              <th
                style={{
                  padding: "0.75rem 0.5rem",
                  textAlign: "left",
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                League Name
              </th>
              <th
                style={{
                  padding: "0.75rem 0.5rem",
                  textAlign: "center",
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                Teams
              </th>
              <th
                style={{
                  padding: "0.75rem 0.5rem",
                  textAlign: "center",
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                Status
              </th>
              <th
                style={{
                  padding: "0.75rem 0.5rem",
                  textAlign: "right",
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredLeagues.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: "3rem",
                    textAlign: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  {searchTerm
                    ? "No leagues found matching your search"
                    : "No leagues created yet. Click 'Create Fantasy League' to get started!"}
                </td>
              </tr>
            ) : (
              filteredLeagues.map((league) => (
                <tr
                  key={league.id}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <td style={{ padding: "0.75rem 0.5rem" }}>
                    <div>
                      <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                        {league.name}
                      </span>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                          marginTop: "0.25rem",
                        }}
                      >
                        {league.draftType === "snake" ? "Snake" : "Linear"} Draft •{" "}
                        {league.waiverSystem === "faab"
                          ? "FAAB"
                          : league.waiverSystem === "rolling"
                          ? "Rolling"
                          : "Fixed"}{" "}
                        Waivers
                      </div>
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "center",
                      fontWeight: 600,
                    }}
                  >
                    {league._count.fantasyTeams}/{league.maxTeams}
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                    <span
                      style={{
                        padding: "0.4rem 1rem",
                        borderRadius: "20px",
                        fontWeight: 600,
                        fontSize: "0.8rem",
                        background:
                          league._count.fantasyTeams >= league.maxTeams
                            ? "linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)"
                            : "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                        color: "white",
                      }}
                    >
                      {league._count.fantasyTeams >= league.maxTeams ? "Full" : "Open"}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "right",
                    }}
                  >
                    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "0.4rem 1rem", fontSize: "0.85rem" }}
                        onClick={() => {
                          setAdminViewingLeague(league.id);
                          window.location.href = `/leagues/${league.id}/scoreboard`;
                        }}
                        title="View this league's Scoreboard, Standings, and Managers pages as an admin"
                      >
                        View League
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "0.4rem 1rem", fontSize: "0.85rem" }}
                        onClick={() =>
                          (window.location.href = `/admin/leagues/${league.id}`)
                        }
                      >
                        Manage
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
