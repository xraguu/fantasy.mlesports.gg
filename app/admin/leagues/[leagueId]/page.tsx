"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAlert } from "@/components/AlertProvider";

interface User {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

interface FantasyTeam {
  id: string;
  displayName: string;
  shortCode: string;
  draftPosition: number | null;
  faabRemaining: number | null;
  waiverPriority: number | null;
  owner: User;
  roster: { id: string; week: number }[];
}

interface League {
  id: string;
  name: string;
  season: number;
  maxTeams: number;
  currentWeek: number;
  draftType: string;
  waiverSystem: string;
  faabBudget: number | null;
  rosterConfig: Record<string, number>;
  draftStatus: string | null;
  draftPickDeadline: string | null;
  draftPickTimeSeconds: number | null;
  doubleWinEnabled: boolean;
  fantasyTeams: FantasyTeam[];
  draftPicks: unknown[];
  _count: {
    fantasyTeams: number;
    draftPicks: number;
    matchups: number;
    trades: number;
    waivers: number;
  };
}

interface BulkRow {
  userId: string;
}

interface RosterSlotView {
  position: string;
  slotIndex: number;
  isLocked: boolean;
  mleTeam: {
    id: string;
    name: string;
    leagueId: string;
    slug: string;
    logoPath: string;
  } | null;
}

interface AvailableMleTeam {
  id: string;
  name: string;
  leagueId: string;
  slug: string;
  logoPath: string;
}

interface EditRosterData {
  team: {
    id: string;
    displayName: string;
    shortCode: string;
    ownerDisplayName: string;
  };
  week: number;
  slots: RosterSlotView[];
  availableMleTeams: AvailableMleTeam[];
}

export default function AdminLeagueManagementPage() {
  const params = useParams();
  const router = useRouter();
  const showAlert = useAlert();
  const leagueId = params?.leagueId as string;

  const [league, setLeague] = useState<League | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([
    { userId: "" },
  ]);
  const [savingDoubleWin, setSavingDoubleWin] = useState(false);
  const [pickTimeSeconds, setPickTimeSeconds] = useState(90);
  const [savingPickTime, setSavingPickTime] = useState(false);

  const [editRosterTeam, setEditRosterTeam] = useState<FantasyTeam | null>(
    null,
  );
  const [editRosterData, setEditRosterData] = useState<EditRosterData | null>(
    null,
  );
  const [editRosterLoading, setEditRosterLoading] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<Record<string, string>>({});
  const [rosterActionKey, setRosterActionKey] = useState<string | null>(null);

  useEffect(() => {
    fetchLeague();
    fetchAllUsers();
  }, [leagueId]);

  const fetchLeague = async () => {
    try {
      const response = await fetch(`/api/admin/leagues/${leagueId}`);
      if (!response.ok) throw new Error("Failed to fetch league");
      const data = await response.json();
      setLeague(data.league);
      setPickTimeSeconds(data.league.draftPickTimeSeconds || 90);
    } catch (error) {
      console.error("Error fetching league:", error);
      showAlert("Failed to load league", "error");
    } finally {
      setLoading(false);
    }
  };

  const fetchAllUsers = async () => {
    try {
      const response = await fetch("/api/admin/users");
      if (!response.ok) throw new Error("Failed to fetch users");
      const data = await response.json();
      setAllUsers(data);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const handleAddUsers = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(
        `/api/admin/leagues/${leagueId}/teams/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teams: bulkRows }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add users");
      }

      showAlert(
        `${bulkRows.length} manager(s) added to league successfully!`,
        "success",
      );
      setShowAddUserModal(false);
      setBulkRows([{ userId: "" }]);
      fetchLeague();
    } catch (error) {
      console.error("Error adding users:", error);
      showAlert(error instanceof Error ? error.message : "Failed to add users", "error");
    }
  };

  const updateBulkRow = (
    index: number,
    field: keyof BulkRow,
    value: string,
  ) => {
    setBulkRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  };

  const addBulkRow = () => {
    setBulkRows((rows) => [
      ...rows,
      { userId: "" },
    ]);
  };

  const removeBulkRow = (index: number) => {
    setBulkRows((rows) => rows.filter((_, i) => i !== index));
  };

  const handleToggleDoubleWin = async () => {
    if (!league) return;
    const next = !league.doubleWinEnabled;
    setSavingDoubleWin(true);
    try {
      const response = await fetch(`/api/admin/leagues/${leagueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doubleWinEnabled: next }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update double-win setting");
      }

      setLeague({ ...league, doubleWinEnabled: next });
    } catch (error) {
      console.error("Error toggling double-win:", error);
      showAlert(
        error instanceof Error ? error.message : "Failed to update double-win setting",
        "error",
      );
    } finally {
      setSavingDoubleWin(false);
    }
  };

  const handleUpdatePickTime = async () => {
    if (!league) return;
    setSavingPickTime(true);
    try {
      const response = await fetch(`/api/admin/leagues/${leagueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftPickTimeSeconds: pickTimeSeconds }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update pick timer");
      }

      setLeague({ ...league, draftPickTimeSeconds: pickTimeSeconds });
      showAlert(
        league.draftStatus === "in_progress"
          ? "Pick timer updated — takes effect starting with the next pick."
          : "Pick timer updated.",
        "success",
      );
    } catch (error) {
      console.error("Error updating pick timer:", error);
      showAlert(error instanceof Error ? error.message : "Failed to update pick timer", "error");
    } finally {
      setSavingPickTime(false);
    }
  };

  const handleRemoveTeam = async (teamId: string, teamName: string) => {
    if (
      !confirm(
        `Are you sure you want to remove ${teamName} from the league? This will delete all their roster data, trades, and waiver claims.`,
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/leagues/${leagueId}/teams/${teamId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to remove team");
      }

      showAlert("Team removed successfully!", "success");
      fetchLeague();
    } catch (error) {
      console.error("Error removing team:", error);
      showAlert(error instanceof Error ? error.message : "Failed to remove team", "error");
    }
  };

  const moveTeamUp = (index: number) => {
    if (index === 0) return; // Already at the top

    const newTeams = [...league!.fantasyTeams];
    const temp = newTeams[index - 1];
    newTeams[index - 1] = newTeams[index];
    newTeams[index] = temp;

    // Update local state immediately for smooth UX
    setLeague({
      ...league!,
      fantasyTeams: newTeams,
    });

    // Update positions in backend
    updateTeamOrder(newTeams);
  };

  const moveTeamDown = (index: number) => {
    if (index === league!.fantasyTeams.length - 1) return; // Already at the bottom

    const newTeams = [...league!.fantasyTeams];
    const temp = newTeams[index + 1];
    newTeams[index + 1] = newTeams[index];
    newTeams[index] = temp;

    // Update local state immediately for smooth UX
    setLeague({
      ...league!,
      fantasyTeams: newTeams,
    });

    // Update positions in backend
    updateTeamOrder(newTeams);
  };

  const updateTeamOrder = async (orderedTeams: FantasyTeam[]) => {
    try {
      const teamOrders = orderedTeams.map((team, index) => ({
        teamId: team.id,
        draftPosition: index + 1,
      }));

      const response = await fetch(
        `/api/admin/leagues/${leagueId}/reorder-teams`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamOrders }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update draft order");
      }

      // Optionally refetch to ensure consistency
      fetchLeague();
    } catch (error) {
      console.error("Error updating draft order:", error);
      showAlert(error instanceof Error ? error.message : "Failed to update draft order", "error");
      // Revert on error
      fetchLeague();
    }
  };

  const handleInitializeDraft = async () => {
    if (
      !confirm(
        "This will create all draft picks AND START THE DRAFT. Make sure all teams have draft positions assigned and everyone is ready. Continue?",
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/leagues/${leagueId}/initialize-draft`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to initialize draft");
      }

      const data = await response.json();
      showAlert(data.message || "Draft started successfully!", "success");
      fetchLeague();
    } catch (error) {
      console.error("Error initializing draft:", error);
      showAlert(error instanceof Error ? error.message : "Failed to initialize draft", "error");
    }
  };

  const handleSkipDraft = async () => {
    if (
      !confirm(
        "Skip the in-app draft for this league? Use this if the league drafted outside the website. You'll build out rosters afterward with the Edit Roster tool.",
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/leagues/${leagueId}/skip-draft`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to skip draft");
      }

      const data = await response.json();
      showAlert(data.message || "Draft skipped.", "success");
      fetchLeague();
    } catch (error) {
      console.error("Error skipping draft:", error);
      showAlert(error instanceof Error ? error.message : "Failed to skip draft", "error");
    }
  };

  const handleRunWaivers = async () => {
    if (
      !confirm(
        "Process all pending waiver claims for this league right now? This normally happens automatically on the league's scheduled waiver day — use this if that didn't run for some reason.",
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/waivers/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to process waivers");
      }

      const data = await response.json();
      showAlert(
        data.processed === 0
          ? "No pending waiver claims to process."
          : `Processed ${data.processed} claim(s): ${data.approved} approved, ${data.denied} denied, ${data.cancelled} cancelled.`,
        "success",
      );
      fetchLeague();
    } catch (error) {
      console.error("Error running waivers:", error);
      showAlert(error instanceof Error ? error.message : "Failed to process waivers", "error");
    }
  };

  const handleDeleteLeague = async () => {
    if (
      !confirm(
        `Are you sure you want to DELETE the entire league "${league?.name}"? This action cannot be undone and will remove all teams, drafts, matchups, and data.`,
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/leagues/${leagueId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          error.details
            ? `${error.error}: ${error.details}`
            : error.error || "Failed to delete league",
        );
      }

      showAlert("League deleted successfully!", "success");
      router.push("/admin/leagues");
    } catch (error) {
      console.error("Error deleting league:", error);
      showAlert(error instanceof Error ? error.message : "Failed to delete league", "error");
    }
  };

  const openEditRoster = async (team: FantasyTeam) => {
    setEditRosterTeam(team);
    setEditRosterData(null);
    setPendingAdd({});
    setEditRosterLoading(true);
    try {
      const res = await fetch(
        `/api/admin/leagues/${leagueId}/teams/${team.id}/roster`,
      );
      if (!res.ok) throw new Error("Failed to load roster");
      setEditRosterData(await res.json());
    } catch (error) {
      showAlert(error instanceof Error ? error.message : "Failed to load roster", "error");
      setEditRosterTeam(null);
    } finally {
      setEditRosterLoading(false);
    }
  };

  const refreshEditRoster = async () => {
    if (!editRosterTeam) return;
    const res = await fetch(
      `/api/admin/leagues/${leagueId}/teams/${editRosterTeam.id}/roster`,
    );
    if (res.ok) setEditRosterData(await res.json());
  };

  const handleDropSlot = async (position: string, slotIndex: number) => {
    if (!editRosterTeam || !editRosterData) return;
    const key = `${position}-${slotIndex}`;
    if (!confirm("Drop this team from the roster?")) return;

    setRosterActionKey(key);
    try {
      const res = await fetch(
        `/api/admin/leagues/${leagueId}/teams/${editRosterTeam.id}/roster`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            week: editRosterData.week,
            action: "drop",
            position,
            slotIndex,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to drop team");
      await refreshEditRoster();
    } catch (error) {
      showAlert(error instanceof Error ? error.message : "Failed to drop team", "error");
    } finally {
      setRosterActionKey(null);
    }
  };

  // Saves every pending "add" selection across all empty slots in one go —
  // an admin filling several open spots shouldn't have to click Add once
  // per spot. Each selection still goes through as its own request (the API
  // only supports one slot per call), applied sequentially so an earlier
  // add can free up availability info before the next one submits, but
  // there's a single Save action and a single refresh/summary at the end.
  const handleSaveRosterChanges = async () => {
    if (!editRosterTeam || !editRosterData) return;
    const entries = Object.entries(pendingAdd).filter(([, mleTeamId]) => mleTeamId);
    if (entries.length === 0) return;

    setRosterActionKey("save-all");
    const failures: string[] = [];
    try {
      for (const [key, mleTeamId] of entries) {
        const [position, slotIndexStr] = key.split("-");
        const slotIndex = parseInt(slotIndexStr, 10);
        try {
          const res = await fetch(
            `/api/admin/leagues/${leagueId}/teams/${editRosterTeam.id}/roster`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                week: editRosterData.week,
                action: "add",
                position,
                slotIndex,
                mleTeamId,
              }),
            },
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to add team");
          setPendingAdd((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `Failed to add team to ${key}`);
        }
      }

      await refreshEditRoster();

      if (failures.length > 0) {
        showAlert(failures.join("; "), "error");
      } else {
        showAlert("Roster changes saved!", "success");
      }
    } finally {
      setRosterActionKey(null);
    }
  };

  // Filter out users who are already in the league
  const availableUsers = allUsers.filter(
    (user) => !league?.fantasyTeams.some((team) => team.owner.id === user.id),
  );

  const remainingSlots = league
    ? league.maxTeams - league._count.fantasyTeams
    : 0;

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
          Loading league...
        </div>
      </div>
    );
  }

  if (!league) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <h2>League not found</h2>
        <button
          className="btn btn-primary"
          onClick={() => router.push("/admin/leagues")}
          style={{ marginTop: "1rem" }}
        >
          Back to Leagues
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Add User Modal */}
      {showAddUserModal && (
        <>
          <div
            className="modal-backdrop"
            onClick={() => setShowAddUserModal(false)}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.7)",
              zIndex: 999,
            }}
          />
          <div
            className="modal"
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 1000,
              maxWidth: "960px",
              width: "95%",
              maxHeight: "85vh",
              overflowY: "auto",
              overflowX: "auto",
            }}
          >
            <div className="card" style={{ padding: "clamp(1rem, 4vw, 2rem)" }}>
              <h2
                style={{
                  fontSize: "clamp(1.1rem, 4.5vw, 1.5rem)",
                  fontWeight: 700,
                  marginBottom: "0.5rem",
                  color: "var(--accent)",
                }}
              >
                Add Managers to League
              </h2>
              <div
                style={{
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  marginBottom: "1.5rem",
                }}
              >
                {remainingSlots} slot{remainingSlots === 1 ? "" : "s"} remaining
              </div>
              <form onSubmit={handleAddUsers}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "1rem",
                  }}
                >
                  {bulkRows.map((row, index) => {
                    const usedElsewhere = bulkRows
                      .filter((_, i) => i !== index)
                      .map((r) => r.userId);
                    const rowAvailableUsers = availableUsers.filter(
                      (u) => !usedElsewhere.includes(u.id),
                    );
                    return (
                      <div
                        key={index}
                        className="admin-bulk-add-row-grid"
                        style={{
                          alignItems: "center",
                          padding: "0.75rem",
                          background: "rgba(255,255,255,0.03)",
                          borderRadius: "6px",
                        }}
                      >
                        <select
                          value={row.userId}
                          onChange={(e) =>
                            updateBulkRow(index, "userId", e.target.value)
                          }
                          style={{
                            padding: "0.6rem",
                            background: "rgba(255,255,255,0.1)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "6px",
                            color: "var(--text-main)",
                            fontSize: "0.9rem",
                            cursor: "pointer",
                          }}
                          required
                        >
                          <option value="">-- Select a user --</option>
                          {rowAvailableUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.displayName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeBulkRow(index)}
                          disabled={bulkRows.length === 1}
                          style={{
                            background: "transparent",
                            border: "none",
                            color:
                              bulkRows.length === 1
                                ? "var(--text-muted)"
                                : "#ef4444",
                            cursor:
                              bulkRows.length === 1 ? "not-allowed" : "pointer",
                            fontSize: "1.1rem",
                            padding: "0.25rem 0.5rem",
                          }}
                          title="Remove row"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={addBulkRow}
                  disabled={bulkRows.length >= remainingSlots}
                  style={{ marginTop: "1rem" }}
                >
                  + Add Row
                </button>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.75rem",
                    marginTop: "1.5rem",
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ flex: 1 }}
                    onClick={() => {
                      setShowAddUserModal(false);
                      setBulkRows([
                        { userId: "" },
                      ]);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                  >
                    Add{" "}
                    {bulkRows.length > 1
                      ? `${bulkRows.length} Managers`
                      : "Manager"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <button
          className="btn btn-ghost"
          onClick={() => router.push("/admin/leagues")}
          style={{ marginBottom: "1rem" }}
        >
          ← Back to Leagues
        </button>
        <h1
          style={{
            fontSize: "clamp(1.4rem, 6vw, 2rem)",
            fontWeight: 700,
            color: "var(--accent)",
            marginBottom: "0.5rem",
          }}
        >
          {league.name}
        </h1>
        <div style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
          Season {league.season} •{" "}
          {league.draftType === "snake" ? "Snake" : "Linear"} Draft •{" "}
          {league.waiverSystem === "faab" ? "FAAB" : league.waiverSystem}{" "}
          Waivers
        </div>
      </div>

      {/* Stats Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <div className="card" style={{ padding: "1.5rem" }}>
          <div
            style={{
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              marginBottom: "0.5rem",
            }}
          >
            Teams
          </div>
          <div
            style={{
              fontSize: "clamp(1.4rem, 6vw, 2rem)",
              fontWeight: 700,
              color: "var(--accent)",
            }}
          >
            {league._count.fantasyTeams}/{league.maxTeams}
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem" }}>
          <div
            style={{
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              marginBottom: "0.5rem",
            }}
          >
            Draft Status
          </div>
          <div
            style={{
              fontSize: "1.2rem",
              fontWeight: 700,
              color:
                league.draftStatus === "in_progress"
                  ? "#d4af37"
                  : league.draftStatus === "completed"
                    ? "#22c55e"
                    : "#9ca3af",
              textTransform: "capitalize",
            }}
          >
            {league.draftStatus?.replace("_", " ") || "Not Started"}
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem" }}>
          <div
            style={{
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              marginBottom: "0.5rem",
            }}
          >
            Current Week
          </div>
          <div
            style={{
              fontSize: "clamp(1.4rem, 6vw, 2rem)",
              fontWeight: 700,
              color: "#3b82f6",
            }}
          >
            {league.currentWeek}
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem" }}>
          <div
            style={{
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              marginBottom: "0.5rem",
            }}
          >
            Matchups
          </div>
          <div
            style={{
              fontSize: "clamp(1.4rem, 6vw, 2rem)",
              fontWeight: 700,
              color: "#ef4444",
            }}
          >
            {league._count.matchups}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "2rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {league.draftStatus !== "completed" && (
          <>
            <button
              className="btn btn-primary"
              onClick={() => setShowAddUserModal(true)}
              disabled={league._count.fantasyTeams >= league.maxTeams}
            >
              + Add Managers to League
            </button>
            <button
              className="btn"
              onClick={handleInitializeDraft}
              disabled={
                league._count.draftPicks > 0 ||
                league.draftStatus === "in_progress"
              }
              style={{
                background:
                  league.draftStatus === "in_progress" ||
                  league._count.draftPicks > 0
                    ? "#4b5563"
                    : "linear-gradient(135deg, #d4af37 0%, #f2b632 100%)",
                cursor:
                  league._count.draftPicks > 0 ||
                  league.draftStatus === "in_progress"
                    ? "not-allowed"
                    : "pointer",
                boxShadow:
                  league._count.draftPicks === 0 &&
                  league.draftStatus !== "in_progress"
                    ? "0 4px 12px rgba(242, 182, 50, 0.4)"
                    : "none",
              }}
            >
              {league.draftStatus === "in_progress"
                ? "Draft In Progress"
                : league._count.draftPicks > 0
                  ? "Draft Already Started"
                  : "Start Draft"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={handleSkipDraft}
              disabled={
                league._count.draftPicks > 0 ||
                league.draftStatus === "in_progress"
              }
              style={{
                cursor:
                  league._count.draftPicks > 0 ||
                  league.draftStatus === "in_progress"
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  league._count.draftPicks > 0 ||
                  league.draftStatus === "in_progress"
                    ? 0.5
                    : 1,
              }}
              title="Use this if the league drafted outside the website"
            >
              Skip Draft
            </button>
          </>
        )}
        {league.draftStatus === "completed" && (
          <button
            className="btn btn-ghost"
            onClick={handleRunWaivers}
            style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}
            title="Waivers normally process automatically on the league's scheduled waiver day — use this if that didn't run"
          >
            Run Waivers Now
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => router.push(`/leagues/${leagueId}/draft`)}
          style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}
        >
          View Draft Page
        </button>
        <button
          className="btn"
          onClick={handleDeleteLeague}
          style={{ background: "#ef4444", marginLeft: "auto" }}
        >
          Delete League
        </button>
      </div>

      {/* Double-Win Toggle */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "2rem" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 700,
                fontSize: "1rem",
                color: "var(--text-main)",
                marginBottom: "0.25rem",
              }}
            >
              Double-Win Scoring
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Each regular-season week, the top half of scoring managers get a
              bonus win and the bottom half get a bonus loss, on top of normal
              matchup results.{" "}
              {league.draftStatus !== "not_started" && (
                <span style={{ color: "#ef4444" }}>
                  Locked — cannot be changed after the draft has started.
                </span>
              )}
            </div>
          </div>
          <button
            className="btn"
            onClick={handleToggleDoubleWin}
            disabled={league.draftStatus !== "not_started" || savingDoubleWin}
            style={{
              background: league.doubleWinEnabled
                ? "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
                : "rgba(255,255,255,0.1)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.2)",
              cursor:
                league.draftStatus !== "not_started"
                  ? "not-allowed"
                  : "pointer",
              opacity: league.draftStatus !== "not_started" ? 0.6 : 1,
              minWidth: "100px",
            }}
          >
            {league.doubleWinEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>
      </div>

      {/* Draft Pick Timer */}
      {league.draftStatus !== "completed" && (
        <div
          className="card"
          style={{ padding: "1.5rem", marginBottom: "2rem" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "1rem",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "1rem",
                  color: "var(--text-main)",
                  marginBottom: "0.25rem",
                }}
              >
                Draft Pick Timer
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                How long each manager gets to make a pick before autodraft takes
                over.
                {league.draftStatus === "in_progress" &&
                  " Changing this while the draft is live only affects picks after the current one."}
              </div>
            </div>
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <select
                value={pickTimeSeconds}
                onChange={(e) => setPickTimeSeconds(parseInt(e.target.value))}
                disabled={savingPickTime}
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "6px",
                  color: "var(--text-main)",
                  fontSize: "0.9rem",
                }}
              >
                <option value={30}>30 seconds</option>
                <option value={45}>45 seconds</option>
                <option value={60}>60 seconds</option>
                <option value={90}>90 seconds</option>
                <option value={120}>2 minutes</option>
                <option value={180}>3 minutes</option>
                <option value={300}>5 minutes</option>
              </select>
              <button
                className="btn"
                onClick={handleUpdatePickTime}
                disabled={
                  savingPickTime ||
                  pickTimeSeconds === (league.draftPickTimeSeconds || 90)
                }
                style={{
                  opacity:
                    savingPickTime ||
                    pickTimeSeconds === (league.draftPickTimeSeconds || 90)
                      ? 0.5
                      : 1,
                  cursor:
                    savingPickTime ||
                    pickTimeSeconds === (league.draftPickTimeSeconds || 90)
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {savingPickTime ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Managers / Roster Management (post-draft) */}
      {league.draftStatus === "completed" ? (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              color: "var(--text-main)",
              margin: "0 0 1.5rem",
            }}
          >
            Managers
          </h2>

          {league.fantasyTeams.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "3rem",
                color: "var(--text-muted)",
              }}
            >
              No teams in this league.
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {league.fantasyTeams.map((team) => (
                <div
                  key={team.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                    padding: "1rem",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  {team.owner.avatarUrl && (
                    <img
                      src={team.owner.avatarUrl}
                      alt={team.owner.displayName}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                      }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "1rem",
                        color: "var(--text-main)",
                      }}
                    >
                      {team.displayName}{" "}
                      <span style={{ color: "var(--text-muted)" }}>
                        ({team.shortCode})
                      </span>
                    </div>
                    <div
                      style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}
                    >
                      {team.owner.displayName}
                    </div>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ padding: "0.5rem 1.25rem", fontSize: "0.9rem" }}
                    onClick={() => openEditRoster(team)}
                  >
                    Edit Roster
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: "1.5rem" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "1.5rem",
            }}
          >
            <h2
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--text-main)",
                margin: 0,
              }}
            >
              Draft Order
            </h2>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Use ↑↓ arrows to reorder teams
            </div>
          </div>

          {league.fantasyTeams.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "3rem",
                color: "var(--text-muted)",
              }}
            >
              No teams in this league yet. Click &quot;Add Managers to League&quot; to get
              started.
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {league.fantasyTeams.map((team, index) => (
                <div
                  key={team.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                    padding: "1rem",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    transition: "all 0.2s ease",
                  }}
                >
                  {/* Draft Position Badge */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: "48px",
                      height: "48px",
                      borderRadius: "8px",
                      background:
                        "linear-gradient(135deg, #d4af37 0%, #f2b632 100%)",
                      fontWeight: 700,
                      fontSize: "1.25rem",
                      color: "#ffffff",
                      boxShadow: "0 2px 8px rgba(212, 175, 55, 0.3)",
                    }}
                  >
                    {index + 1}
                  </div>

                  {/* Team Info */}
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        marginBottom: "0.25rem",
                      }}
                    >
                      {team.owner.avatarUrl && (
                        <img
                          src={team.owner.avatarUrl}
                          alt={team.owner.displayName}
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                          }}
                        />
                      )}
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "1rem",
                            color: "var(--text-main)",
                          }}
                        >
                          {team.displayName}
                        </div>
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          {team.owner.displayName} • {team.shortCode}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Reorder Controls */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.25rem",
                    }}
                  >
                    <button
                      onClick={() => moveTeamUp(index)}
                      disabled={index === 0}
                      style={{
                        background:
                          index === 0
                            ? "rgba(255,255,255,0.05)"
                            : "rgba(255,255,255,0.1)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        borderRadius: "4px",
                        color:
                          index === 0
                            ? "var(--text-muted)"
                            : "var(--text-main)",
                        cursor: index === 0 ? "not-allowed" : "pointer",
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.9rem",
                        fontWeight: 600,
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (index !== 0) {
                          e.currentTarget.style.background =
                            "rgba(255,255,255,0.2)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (index !== 0) {
                          e.currentTarget.style.background =
                            "rgba(255,255,255,0.1)";
                        }
                      }}
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveTeamDown(index)}
                      disabled={index === league.fantasyTeams.length - 1}
                      style={{
                        background:
                          index === league.fantasyTeams.length - 1
                            ? "rgba(255,255,255,0.05)"
                            : "rgba(255,255,255,0.1)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        borderRadius: "4px",
                        color:
                          index === league.fantasyTeams.length - 1
                            ? "var(--text-muted)"
                            : "var(--text-main)",
                        cursor:
                          index === league.fantasyTeams.length - 1
                            ? "not-allowed"
                            : "pointer",
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.9rem",
                        fontWeight: 600,
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (index !== league.fantasyTeams.length - 1) {
                          e.currentTarget.style.background =
                            "rgba(255,255,255,0.2)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (index !== league.fantasyTeams.length - 1) {
                          e.currentTarget.style.background =
                            "rgba(255,255,255,0.1)";
                        }
                      }}
                    >
                      ↓
                    </button>
                  </div>

                  {/* Remove Button */}
                  <button
                    className="btn btn-ghost"
                    style={{
                      padding: "0.5rem 1rem",
                      fontSize: "0.85rem",
                      background: "#ef4444",
                      border: "none",
                      borderRadius: "6px",
                      color: "#ffffff",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                    onClick={() => handleRemoveTeam(team.id, team.displayName)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edit Roster Modal */}
      {editRosterTeam && (
        <>
          <div
            className="modal-backdrop"
            onClick={() => setEditRosterTeam(null)}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.7)",
              zIndex: 999,
            }}
          />
          <div
            className="modal"
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 1000,
              maxWidth: "700px",
              width: "95%",
              maxHeight: "85vh",
              overflowY: "auto",
            }}
          >
            <div className="card" style={{ padding: "clamp(1rem, 4vw, 2rem)" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                  marginBottom: "1.5rem",
                }}
              >
                <div>
                  <h2
                    style={{
                      fontSize: "clamp(1.05rem, 4.2vw, 1.4rem)",
                      fontWeight: 700,
                      color: "var(--accent)",
                      marginBottom: "0.25rem",
                    }}
                  >
                    Edit Roster — {editRosterTeam.displayName}
                  </h2>
                  <div
                    style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}
                  >
                    {editRosterTeam.owner.displayName}
                    {editRosterData ? ` • Week ${editRosterData.week}` : ""}
                  </div>
                </div>
                <button
                  className="btn btn-ghost"
                  style={{ padding: "0.4rem 0.8rem" }}
                  onClick={() => setEditRosterTeam(null)}
                >
                  Close
                </button>
              </div>

              {editRosterLoading || !editRosterData ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "2rem",
                    color: "var(--text-muted)",
                  }}
                >
                  Loading roster...
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                  }}
                >
                  {editRosterData.slots.map((slot) => {
                    const key = `${slot.position}-${slot.slotIndex}`;
                    const isProcessing = rosterActionKey === key;

                    return (
                      <div
                        key={key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                          padding: "0.75rem",
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "6px",
                        }}
                      >
                        {slot.mleTeam ? (
                          <>
                            <div
                              style={{
                                flex: 1,
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                              }}
                            >
                              <img
                                src={slot.mleTeam.logoPath}
                                alt={slot.mleTeam.name}
                                style={{
                                  width: "24px",
                                  height: "24px",
                                  borderRadius: "4px",
                                }}
                              />
                              <span
                                style={{ fontWeight: 600, fontSize: "0.9rem" }}
                              >
                                {slot.mleTeam.leagueId} {slot.mleTeam.name}
                              </span>
                              {slot.isLocked && (
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    color: "var(--text-muted)",
                                  }}
                                  title="Locked"
                                >
                                  🔒
                                </span>
                              )}
                            </div>
                            <button
                              className="btn btn-ghost"
                              disabled={isProcessing}
                              style={{
                                padding: "0.4rem 0.9rem",
                                fontSize: "0.8rem",
                                background: "rgba(239, 68, 68, 0.15)",
                                color: "#ef4444",
                              }}
                              onClick={() =>
                                handleDropSlot(slot.position, slot.slotIndex)
                              }
                            >
                              {isProcessing ? "..." : "Drop"}
                            </button>
                          </>
                        ) : (
                          <select
                            value={pendingAdd[key] || ""}
                            onChange={(e) =>
                              setPendingAdd((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }))
                            }
                            disabled={rosterActionKey === "save-all"}
                            style={{
                              flex: 1,
                              padding: "0.5rem",
                              background: "rgba(255,255,255,0.1)",
                              border: "1px solid rgba(255,255,255,0.2)",
                              borderRadius: "6px",
                              color: "var(--text-main)",
                              fontSize: "0.85rem",
                            }}
                          >
                            <option value="">
                              -- Empty: select a team to add --
                            </option>
                            {editRosterData.availableMleTeams
                              .filter(
                                (t) =>
                                  t.id === pendingAdd[key] ||
                                  !Object.entries(pendingAdd).some(
                                    ([otherKey, mleTeamId]) =>
                                      otherKey !== key && mleTeamId === t.id,
                                  ),
                              )
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.leagueId} {t.name}
                                </option>
                              ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {editRosterData && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: "1rem",
                  }}
                >
                  <button
                    className="btn btn-primary"
                    disabled={
                      rosterActionKey === "save-all" ||
                      Object.values(pendingAdd).filter(Boolean).length === 0
                    }
                    style={{ padding: "0.6rem 1.5rem", fontWeight: 600 }}
                    onClick={handleSaveRosterChanges}
                  >
                    {rosterActionKey === "save-all"
                      ? "Saving..."
                      : "Save Changes"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
