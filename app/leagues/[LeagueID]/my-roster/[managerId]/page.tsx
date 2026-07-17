"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Image from "next/image";
import TeamModal from "@/components/TeamModal";
import { useAlert } from "@/components/AlertProvider";

// Types
interface StatBundle {
  record: string;
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demos: number;
  fpts: number;
  avg: number;
  last: number;
  score: number;
}

interface MLETeam {
  id: string;
  name: string;
  leagueId: string;
  slug: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
  weeklyStats: any | null;
  stats: { "2s": StatBundle; "3s": StatBundle };
}

interface WithinLeagueStanding {
  rank: number;
  totalTeams: number;
}

interface OpponentInfo {
  id: string;
  name: string;
  leagueId: string;
  slug: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
  record: { "2s": string; "3s": string };
  standing: { "2s": WithinLeagueStanding | null; "3s": WithinLeagueStanding | null };
}

interface RosterSlot {
  id: string;
  position: string;
  slotIndex: number;
  isLocked: boolean;
  fantasyPoints: number | null;
  defaultMode: "2s" | "3s";
  mleTeam: MLETeam | null;
  opponent: OpponentInfo | null;
  oprk: { "2s": number | null; "3s": number | null };
  fprk: { "2s": number | null; "3s": number | null };
}

// Color tier for how tough an opponent is, from the viewer's perspective —
// inverted from a normal standings color (lib/teamSeasonStats.ts's
// getStandingsColor, duplicated here since that file imports Prisma and
// can't be used from a client component): a well-ranked, dangerous opponent
// reads as bad news (red), a poorly-ranked, easy one reads as good news
// (green).
function getOpponentStandingsColor(rank: number, totalTeams: number): string {
  const percentile = rank / totalTeams;
  if (percentile <= 1 / 3) return "#ef4444";
  if (percentile <= 2 / 3) return "#9ca3af";
  return "#22c55e";
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

interface RosterData {
  fantasyTeam: {
    id: string;
    displayName: string;
    shortCode: string;
    ownerDisplayName: string;
    faabRemaining: number | null;
    waiverPriority: number | null;
    isOwner: boolean;
  };
  league: {
    id: string;
    currentWeek: number;
    waiverSystem: string;
    rosterConfig: {
      "2s": number;
      "3s": number;
      flx: number;
      be: number;
    };
  };
  week: number;
  rosterSlots: RosterSlot[];
  record?: {
    wins: number;
    losses: number;
  };
  rank?: number;
  totalTeams?: number;
  totalPoints?: number;
  avgPoints?: number;
  lastMatchup?: {
    id: string;
    week: number;
    myTeam: string;
    myScore: number;
    opponent: string;
    opponentScore: number;
  };
  currentMatchup?: {
    id: string;
    week: number;
    myTeam: string;
    myScore: number;
    opponent: string;
    opponentScore: number;
  };
}

// Helper function to get fantasy rank color (matching main page)
const getFantasyRankColor = (rank: number): string => {
  if (rank >= 1 && rank <= 12) return "#ef4444";
  if (rank >= 13 && rank <= 24) return "#9ca3af";
  if (rank >= 25 && rank <= 32) return "#22c55e";
  return "#9ca3af";
};

export default function MyRosterPage() {
  const showAlert = useAlert();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const leagueId = params.LeagueID as string;
  const teamId = params.managerId as string;

  // Landed here right after the draft finished (see the draft room's
  // completion redirect) — show the pop-up here instead of on the draft
  // page itself, so it isn't cut off by the navigation. Strips the query
  // param immediately so a refresh/back-nav doesn't re-show it.
  useEffect(() => {
    if (searchParams.get("draftComplete") !== "1") return;
    showAlert("The draft is complete! Here's your roster.", "success");
    router.replace(`/leagues/${leagueId}/my-roster/${teamId}`);
  }, [searchParams, showAlert, router, leagueId, teamId]);

  const [rosterData, setRosterData] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [activeTab, setActiveTab] = useState<
    "lineup" | "stats" | "waivers" | "trades"
  >("lineup");
  const [moveMode, setMoveMode] = useState(false);
  const [selectedTeamIndex, setSelectedTeamIndex] = useState<number | null>(
    null
  );
  const [gameMode, setGameMode] = useState<"2s" | "3s">("2s");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editableRoster, setEditableRoster] = useState<RosterSlot[]>([]);

  // Trades state
  const [trades, setTrades] = useState<any[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);

  // Waiver claims state (pending claims are private to the manager who
  // submitted them — the API scopes ?mine=true to the current session)
  const [waiverClaims, setWaiverClaims] = useState<any[]>([]);
  const [waiverClaimsLoading, setWaiverClaimsLoading] = useState(false);
  const [waiverPriorityData, setWaiverPriorityData] = useState<{
    waiverSystem: string;
    teams: Array<{ id: string; teamName: string; managerName: string; waiverPriority: number | null; faabRemaining: number | null }>;
  } | null>(null);
  const [waiverPriorityLoading, setWaiverPriorityLoading] = useState(false);

  // Track game modes for each slot
  const [slotModes, setSlotModes] = useState<("2s" | "3s")[]>([]);

  // Stats tab sorting state
  const [statsSortColumn, setStatsSortColumn] = useState<
    | "fprk"
    | "fpts"
    | "avg"
    | "last"
    | "goals"
    | "shots"
    | "saves"
    | "assists"
    | "demos"
  >("fprk");
  const [statsSortDirection, setStatsSortDirection] = useState<"asc" | "desc">(
    "asc"
  );

  // Drop modal state
  const [showDropModal, setShowDropModal] = useState(false);
  const [selectedDropSlot, setSelectedDropSlot] = useState<RosterSlot | null>(
    null
  );

  // Team rename state
  const [editingTeamName, setEditingTeamName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [shortCodeDraft, setShortCodeDraft] = useState("");
  const [savingTeamName, setSavingTeamName] = useState(false);

  // Team modal state
  const [showModal, setShowModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<MLETeam | null>(null);
  const [selectedTeamRosteredBy, setSelectedTeamRosteredBy] = useState<
    { rosterName: string; managerName: string } | undefined
  >(undefined);

  const startEditingTeamName = () => {
    if (!rosterData) return;
    setNameDraft(rosterData.fantasyTeam.displayName);
    setShortCodeDraft(rosterData.fantasyTeam.shortCode);
    setEditingTeamName(true);
  };

  const handleSaveTeamName = async () => {
    if (!rosterData) return;
    setSavingTeamName(true);
    try {
      const response = await fetch(
        `/api/leagues/${leagueId}/teams/${rosterData.fantasyTeam.id}/rename`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: nameDraft,
            shortCode: shortCodeDraft,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to update team");
      }

      const data = await response.json();
      setRosterData({
        ...rosterData,
        fantasyTeam: {
          ...rosterData.fantasyTeam,
          displayName: data.displayName,
          shortCode: data.shortCode,
        },
      });
      setEditingTeamName(false);
    } catch (err: any) {
      showAlert(err.message || "Failed to update team", "error");
    } finally {
      setSavingTeamName(false);
    }
  };

  // Generate full roster with empty slots
  const fullRoster = useMemo(() => {
    if (!rosterData) return [];

    const config = rosterData.league.rosterConfig;
    const existingSlots = rosterData.rosterSlots;
    const slots: RosterSlot[] = [];

    const createEmptySlot = (
      position: string,
      slotIndex: number
    ): RosterSlot => ({
      id: `empty-${position}-${slotIndex}`,
      position,
      slotIndex,
      isLocked: false,
      fantasyPoints: null,
      defaultMode: position === "3s" ? "3s" : "2s",
      mleTeam: null,
      opponent: null,
      oprk: { "2s": null, "3s": null },
      fprk: { "2s": null, "3s": null },
    });

    for (let i = 0; i < config["2s"]; i++) {
      const existing = existingSlots.find(
        (s) => s.position === "2s" && s.slotIndex === i
      );
      slots.push(existing || createEmptySlot("2s", i));
    }

    for (let i = 0; i < config["3s"]; i++) {
      const existing = existingSlots.find(
        (s) => s.position === "3s" && s.slotIndex === i
      );
      slots.push(existing || createEmptySlot("3s", i));
    }

    for (let i = 0; i < config.flx; i++) {
      const existing = existingSlots.find(
        (s) => s.position === "flx" && s.slotIndex === i
      );
      slots.push(existing || createEmptySlot("flx", i));
    }

    for (let i = 0; i < config.be; i++) {
      const existing = existingSlots.find(
        (s) => s.position === "be" && s.slotIndex === i
      );
      slots.push(existing || createEmptySlot("be", i));
    }

    return slots;
  }, [rosterData]);

  // "Whole lineup locked" = every slot that actually has a team assigned is
  // locked (empty placeholder slots have no real DB row / lock state, so
  // they don't count against this).
  const filledSlots = fullRoster.filter((s) => s.mleTeam);
  const isWholeLineupLocked = filledSlots.length > 0 && filledSlots.every((s) => s.isLocked);

  // A week that's already behind the league's real current week is settled
  // history — its roster stays locked (frozen, can't be edited) but the
  // urgent red/🔒 "locked" styling is reserved for the active week, so a
  // manager isn't shown alarm-red rows for a matchup that's long over.
  const isPastWeek = !!rosterData && currentWeek < rosterData.league.currentWeek;

  // Re-sync editable roster whenever fresh roster data loads (e.g. switching
  // weeks) — previously only re-synced when the slot COUNT changed, so
  // navigating between weeks with the same roster shape left this frozen on
  // whichever week loaded first. Also reset per-row mode overrides so each
  // row falls back to its own defaultMode instead of being pinned to "2s".
  useEffect(() => {
    if (fullRoster.length > 0) {
      setSlotModes([]);
      setEditableRoster([...fullRoster]);
      setHasUnsavedChanges(false);
    }
  }, [fullRoster]);

  // Fetch roster data
  useEffect(() => {
    const fetchRoster = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/leagues/${leagueId}/rosters/${teamId}?week=${currentWeek}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch roster");
        }

        const data = await response.json();
        setRosterData(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load roster");
      } finally {
        setLoading(false);
      }
    };

    fetchRoster();
  }, [leagueId, teamId, currentWeek]);

  // Initialize current week only on first load
  useEffect(() => {
    if (rosterData && currentWeek === 1 && rosterData.league.currentWeek !== 1) {
      setCurrentWeek(rosterData.league.currentWeek);
    }
  }, [rosterData?.league.currentWeek]);

  // Fetch trades when trades tab is active
  useEffect(() => {
    const fetchTrades = async () => {
      if (activeTab !== "trades" || !teamId || !leagueId) return;

      try {
        setTradesLoading(true);
        const response = await fetch(
          `/api/leagues/${leagueId}/trades?teamId=${teamId}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch trades");
        }

        const data = await response.json();
        setTrades(data.trades || []);
      } catch (error) {
        console.error("Error fetching trades:", error);
      } finally {
        setTradesLoading(false);
      }
    };

    fetchTrades();
  }, [activeTab, teamId, leagueId]);

  // Fetch this manager's own pending waiver claims when the waivers tab is active
  useEffect(() => {
    const fetchWaiverClaims = async () => {
      if (activeTab !== "waivers" || !leagueId || !rosterData?.fantasyTeam.isOwner) return;

      try {
        setWaiverClaimsLoading(true);
        const response = await fetch(`/api/leagues/${leagueId}/waivers?mine=true`);
        if (!response.ok) throw new Error("Failed to fetch waiver claims");
        const data = await response.json();
        setWaiverClaims(data.waiverClaims || []);
      } catch (error) {
        console.error("Error fetching waiver claims:", error);
      } finally {
        setWaiverClaimsLoading(false);
      }
    };

    fetchWaiverClaims();
  }, [activeTab, leagueId, rosterData?.fantasyTeam.isOwner]);

  // Fetch the league-wide waiver priority order (or FAAB budgets) when the waivers tab is active
  useEffect(() => {
    const fetchWaiverPriority = async () => {
      if (activeTab !== "waivers" || !leagueId) return;

      try {
        setWaiverPriorityLoading(true);
        const response = await fetch(`/api/leagues/${leagueId}/waiver-priority`);
        if (!response.ok) throw new Error("Failed to fetch waiver priority");
        setWaiverPriorityData(await response.json());
      } catch (error) {
        console.error("Error fetching waiver priority:", error);
      } finally {
        setWaiverPriorityLoading(false);
      }
    };

    fetchWaiverPriority();
  }, [activeTab, leagueId]);

  const handleScheduleClick = () => {
    router.push(`/leagues/${leagueId}/my-roster/${teamId}/schedule`);
  };

  const handleTransactionsClick = () => {
    router.push(`/leagues/${leagueId}/my-roster/${teamId}/transactions`);
  };

  const handleSaveRoster = async () => {
    if (!rosterData) return;

    try {
      setIsSaving(true);

      const response = await fetch(
        `/api/leagues/${leagueId}/roster/update`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fantasyTeamId: rosterData.fantasyTeam.id,
            week: currentWeek,
            roster: editableRoster,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save roster");
      }

      setHasUnsavedChanges(false);

      // Refetch roster to get updated data
      const rosterResponse = await fetch(
        `/api/leagues/${leagueId}/rosters/${teamId}?week=${currentWeek}`
      );
      if (rosterResponse.ok) {
        const updatedRoster = await rosterResponse.json();
        setRosterData(updatedRoster);
      }
    } catch (error) {
      console.error("Error saving roster:", error);
      showAlert(error instanceof Error ? error.message : "Failed to save lineup", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleMoveToggle = async () => {
    if (moveMode && hasUnsavedChanges) {
      // Save changes when exiting move mode
      await handleSaveRoster();
    }
    setMoveMode(!moveMode);
    setSelectedTeamIndex(null);
  };

  const handleTeamClick = (index: number) => {
    if (!moveMode) return;

    const slot = editableRoster[index];
    if (!slot.mleTeam) return; // Can't select empty slots
    if (slot.isLocked) return; // Can't select locked slots

    if (selectedTeamIndex === null) {
      setSelectedTeamIndex(index);
    } else if (selectedTeamIndex === index) {
      setSelectedTeamIndex(null);
    } else {
      // Swap the teams but keep slots static
      const newRoster = [...editableRoster];
      const team1Slot = newRoster[selectedTeamIndex].position;
      const team2Slot = newRoster[index].position;

      // Swap the entire team objects
      const temp = newRoster[selectedTeamIndex];
      newRoster[selectedTeamIndex] = newRoster[index];
      newRoster[index] = temp;

      // Restore the original slots
      newRoster[selectedTeamIndex] = {
        ...newRoster[selectedTeamIndex],
        position: team1Slot,
        slotIndex: newRoster[selectedTeamIndex].slotIndex,
      };
      newRoster[index] = {
        ...newRoster[index],
        position: team2Slot,
        slotIndex: newRoster[index].slotIndex,
      };

      setEditableRoster(newRoster);
      setSelectedTeamIndex(null);
      setHasUnsavedChanges(true);
    }
  };

  const getPrevWeek = (week: number) => Math.max(1, week - 1);
  const getNextWeek = (week: number) => week + 1;

  const handleStatsSort = (column: typeof statsSortColumn) => {
    if (statsSortColumn === column) {
      setStatsSortDirection(statsSortDirection === "asc" ? "desc" : "asc");
    } else {
      setStatsSortColumn(column);
      setStatsSortDirection("asc");
    }
  };

  // Sorted roster teams for stats tab
  const sortedRosterTeams = useMemo(() => {
    return fullRoster
      .filter((slot) => slot.mleTeam)
      .map((slot) => {
        const mleTeam = slot.mleTeam!;
        const stats = mleTeam.stats[gameMode];

        return {
          ...mleTeam,
          opponent: slot.opponent,
          displayStats: {
            score: stats.score || 0,
            fprk: slot.fprk[gameMode] ?? 0,
            fpts: stats.fpts || 0,
            avg: stats.avg || 0,
            last: stats.last || 0,
            goals: stats.goals || 0,
            shots: stats.shots || 0,
            saves: stats.saves || 0,
            assists: stats.assists || 0,
            demos: stats.demos || 0,
            teamRecord: stats.record || "-",
          },
        };
      })
      .sort((a, b) => {
        const aValue = a.displayStats[statsSortColumn] as number;
        const bValue = b.displayStats[statsSortColumn] as number;

        if (aValue === bValue) return 0;
        if (statsSortDirection === "asc") {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
  }, [fullRoster, statsSortColumn, statsSortDirection, gameMode]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "50vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>
          Loading roster...
        </div>
      </div>
    );
  }

  if (error || !rosterData) {
    return (
      <div
        style={{
          minHeight: "50vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ color: "#ef4444", fontSize: "1.1rem" }}>
          Error: {error || "Failed to load roster"}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Page Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <h1
          className="page-heading"
          style={{
            fontSize: "2.5rem",
            color: "var(--accent)",
            fontWeight: 700,
            margin: 0,
          }}
        >
          Roster
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <button
            onClick={handleScheduleClick}
            style={{
              backgroundColor: "var(--accent)",
              color: "#1a1a2e",
              padding: "0.5rem 1.5rem",
              borderRadius: "2rem",
              fontWeight: 700,
              fontSize: "1rem",
              border: "none",
              cursor: "pointer",
            }}
          >
            Schedule
          </button>
          <button
            onClick={handleTransactionsClick}
            style={{
              backgroundColor: "var(--accent)",
              color: "#1a1a2e",
              padding: "0.5rem 1.5rem",
              borderRadius: "2rem",
              fontWeight: 700,
              fontSize: "1rem",
              border: "none",
              cursor: "pointer",
            }}
          >
            Transactions
          </button>
        </div>
      </div>

      {/* Team Overview Card */}
      <section
        className="card"
        style={{ marginBottom: "1.5rem", padding: "1.5rem 2rem" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {/* Team Info */}
          <div>
            {editingTeamName ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.5rem",
                }}
              >
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={40}
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    background: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "6px",
                    color: "var(--text-main)",
                    padding: "0.25rem 0.5rem",
                    width: "260px",
                  }}
                />
                <input
                  type="text"
                  value={shortCodeDraft}
                  onChange={(e) =>
                    setShortCodeDraft(e.target.value.toUpperCase().slice(0, 3))
                  }
                  maxLength={3}
                  style={{
                    fontSize: "1rem",
                    fontWeight: 700,
                    background: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "6px",
                    color: "var(--text-main)",
                    padding: "0.25rem 0.5rem",
                    width: "60px",
                    textTransform: "uppercase",
                  }}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleSaveTeamName}
                  disabled={savingTeamName}
                  style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
                >
                  {savingTeamName ? "Saving..." : "Save"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setEditingTeamName(false)}
                  disabled={savingTeamName}
                  style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <h2
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  marginBottom: "0.5rem",
                  marginTop: 0,
                }}
              >
                {rosterData.fantasyTeam.displayName}{" "}
                <span
                  style={{
                    fontSize: "0.95rem",
                    color: "var(--text-muted)",
                    fontWeight: 600,
                  }}
                >
                  ({rosterData.fantasyTeam.shortCode})
                </span>{" "}
              {rosterData.fantasyTeam.isOwner && (
                <button
                  onClick={startEditingTeamName}
                  title="Rename team"
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    fontSize: "0.9rem",
                    marginLeft: "0.25rem",
                  }}
                >
                  ✏️
                </button>
              )}{" "}
              {rosterData.record && (
                <>
                  <span
                    style={{ color: "var(--accent)", marginLeft: "0.75rem" }}
                  >
                    {rosterData.record.wins}-{rosterData.record.losses}
                  </span>{" "}
                  {rosterData.rank && rosterData.totalTeams && (
                    <span
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "1.2rem",
                        marginLeft: "0.5rem",
                      }}
                    >
                      {rosterData.rank}
                      {rosterData.rank === 1
                        ? "st"
                        : rosterData.rank === 2
                        ? "nd"
                        : rosterData.rank === 3
                        ? "rd"
                        : "th"}
                    </span>
                  )}
                </>
              )}
              </h2>
            )}
            <div style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
              {rosterData.fantasyTeam.ownerDisplayName}
            </div>
            <div style={{ marginTop: "0.5rem", fontSize: "1rem" }}>
              <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                {rosterData.totalPoints ?? 0} Fantasy Points
              </span>
              <span
                style={{ color: "var(--text-muted)", marginLeft: "1.5rem" }}
              >
                {rosterData.avgPoints ?? 0} Avg Fantasy Points
              </span>
            </div>
            <div
              style={{
                marginTop: "0.75rem",
                fontSize: "0.95rem",
                color: "var(--text-muted)",
              }}
            >
              {rosterData.league.waiverSystem === "faab" ? (
                <>
                  FAAB:{" "}
                  <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                    ${rosterData.fantasyTeam.faabRemaining ?? 100}
                  </span>
                </>
              ) : (
                <>
                  Waiver Priority:{" "}
                  <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                    #{rosterData.fantasyTeam.waiverPriority ?? "-"}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Matchup Info */}
          <div style={{ display: "flex", gap: "2rem", alignItems: "center" }}>
            {/* Last Matchup */}
            {rosterData.lastMatchup && (
              <div
                onClick={() =>
                  router.push(
                    `/leagues/${leagueId}/scoreboard?week=${rosterData.lastMatchup!.week}&matchup=${rosterData.lastMatchup!.id}`
                  )
                }
                style={{
                  textAlign: "center",
                  cursor: "pointer",
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  transition: "all 0.2s",
                  backgroundColor: "transparent",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    "rgba(242, 182, 50, 0.1)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "0.85rem",
                    fontStyle: "italic",
                    marginBottom: "0.5rem",
                  }}
                >
                  Last Matchup
                </div>
                <div style={{ fontSize: "0.95rem", marginBottom: "0.25rem" }}>
                  <span style={{ color: "var(--text-main)" }}>{rosterData.lastMatchup.myTeam}</span>{" "}
                  <span
                    style={{
                      color: "var(--accent)",
                      fontWeight: 700,
                      marginLeft: "0.5rem",
                    }}
                  >
                    {rosterData.lastMatchup.myScore}
                  </span>
                </div>
                <div style={{ fontSize: "0.95rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>{rosterData.lastMatchup.opponent}</span>{" "}
                  <span
                    style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}
                  >
                    {rosterData.lastMatchup.opponentScore}
                  </span>
                </div>
              </div>
            )}

            {rosterData.lastMatchup && rosterData.currentMatchup && (
              <div
                style={{
                  width: "1px",
                  height: "60px",
                  backgroundColor: "rgba(255,255,255,0.1)",
                }}
              ></div>
            )}

            {/* Current Matchup */}
            {rosterData.currentMatchup && (
              <div
                onClick={() =>
                  router.push(
                    `/leagues/${leagueId}/scoreboard?week=${rosterData.currentMatchup!.week}&matchup=${rosterData.currentMatchup!.id}`
                  )
                }
                style={{
                  textAlign: "center",
                  cursor: "pointer",
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  transition: "all 0.2s",
                  backgroundColor: "transparent",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    "rgba(242, 182, 50, 0.1)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "0.85rem",
                    fontStyle: "italic",
                    marginBottom: "0.5rem",
                  }}
                >
                  Current Matchup
                </div>
                <div style={{ fontSize: "0.95rem", marginBottom: "0.25rem" }}>
                  <span style={{ color: "var(--text-main)" }}>{rosterData.currentMatchup.myTeam}</span>{" "}
                  <span
                    style={{
                      color: "var(--accent)",
                      fontWeight: 700,
                      marginLeft: "0.5rem",
                    }}
                  >
                    {rosterData.currentMatchup.myScore}
                  </span>
                </div>
                <div style={{ fontSize: "0.95rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>{rosterData.currentMatchup.opponent}</span>{" "}
                  <span
                    style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}
                  >
                    {rosterData.currentMatchup.opponentScore}
                  </span>
                </div>
              </div>
            )}

            {!rosterData.lastMatchup && !rosterData.currentMatchup && (
              <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", fontStyle: "italic" }}>
                No matchup data available
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <button
          onClick={() => setActiveTab("lineup")}
          className={
            activeTab === "lineup" ? "btn btn-primary" : "btn btn-ghost"
          }
          style={{ fontSize: "1rem" }}
        >
          Lineup
        </button>
        <button
          onClick={() => setActiveTab("stats")}
          className={
            activeTab === "stats" ? "btn btn-primary" : "btn btn-ghost"
          }
          style={{ fontSize: "1rem" }}
        >
          Stats
        </button>
        <button
          onClick={() => setActiveTab("waivers")}
          className={
            activeTab === "waivers" ? "btn btn-primary" : "btn btn-ghost"
          }
          style={{ fontSize: "1rem" }}
        >
          Waivers
        </button>
        <button
          onClick={() => setActiveTab("trades")}
          className={
            activeTab === "trades" ? "btn btn-primary" : "btn btn-ghost"
          }
          style={{ fontSize: "1rem" }}
        >
          Trades
        </button>
      </div>

      {/* Lineup Tab */}
      {activeTab === "lineup" && (
        <section className="card">
          {/* Week Navigation and Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "1rem 1.5rem",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <button
                onClick={() => setCurrentWeek((prev) => getPrevWeek(prev))}
                disabled={currentWeek === 1}
                style={{
                  background: "transparent",
                  border: "none",
                  color:
                    currentWeek === 1
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.7)",
                  cursor: currentWeek === 1 ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                }}
              >
                {currentWeek === 1 ? "◄" : `◄ Week ${getPrevWeek(currentWeek)}`}
              </button>

              <span
                style={{
                  color: "#d4af37",
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  padding: "0 1rem",
                }}
              >
                Week {currentWeek}
              </span>

              <button
                onClick={() => setCurrentWeek((prev) => getNextWeek(prev))}
                disabled={currentWeek === 10}
                style={{
                  background: "transparent",
                  border: "none",
                  color:
                    currentWeek === 10
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.7)",
                  cursor: currentWeek === 10 ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                }}
              >
                {currentWeek === 10 ? "►" : `Week ${getNextWeek(currentWeek)} ►`}
              </button>
            </div>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={() => router.push(`/leagues/${leagueId}/team-portal`)}
                className="btn btn-primary"
                style={{ fontSize: "0.9rem" }}
              >
                + Add
              </button>
              <button
                onClick={() => setShowDropModal(true)}
                className="btn btn-ghost"
                style={{ fontSize: "0.9rem" }}
              >
                - Drop
              </button>
              <button
                onClick={isWholeLineupLocked ? undefined : handleMoveToggle}
                disabled={isSaving || isWholeLineupLocked}
                className={moveMode ? "btn btn-primary" : "btn btn-ghost"}
                style={{
                  fontSize: "0.9rem",
                  border:
                    isWholeLineupLocked && !isPastWeek
                      ? "2px solid #ef4444"
                      : "2px solid var(--accent)",
                  background:
                    isWholeLineupLocked && !isPastWeek ? "rgba(239, 68, 68, 0.15)" : undefined,
                  color: isWholeLineupLocked && !isPastWeek ? "#ef4444" : undefined,
                  boxShadow:
                    isWholeLineupLocked
                      ? "none"
                      : moveMode
                      ? "0 0 12px rgba(242, 182, 50, 0.4)"
                      : "0 0 8px rgba(242, 182, 50, 0.3)",
                  opacity: isSaving ? 0.6 : 1,
                  cursor: isSaving || isWholeLineupLocked ? "not-allowed" : "pointer",
                }}
              >
                {isSaving
                  ? "Saving..."
                  : isWholeLineupLocked
                  ? isPastWeek
                    ? "Week Complete"
                    : "🔒 Lineup Locked"
                  : moveMode
                  ? "✓ Done Editing"
                  : "Edit Lineup"}
              </button>
            </div>
          </div>

          {/* Move Mode Instructions */}
          {moveMode && (
            <div
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "rgba(242, 182, 50, 0.1)",
                borderBottom: "1px solid rgba(242, 182, 50, 0.3)",
                color: "var(--accent)",
                fontSize: "0.9rem",
                fontWeight: 600,
                textAlign: "center",
              }}
            >
              {selectedTeamIndex === null
                ? "Click on a team to select it, then click on another team to swap positions"
                : "Click on another team to swap positions, or click the selected team to deselect"}
            </div>
          )}

          {/* Roster Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "0.75rem 0.5rem", width: "50px" }}></th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Slot
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Team
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Score
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Opp
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Oprk
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Fprk
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Fpts
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Avg
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Last
                  </th>
                </tr>
              </thead>
              <tbody>
                {(editableRoster.length > 0 ? editableRoster : fullRoster).map((slot, index) => {
                  const currentMode = slotModes[index] || slot.defaultMode;
                  const isEmpty = !slot.mleTeam;
                  const isBench = slot.position === "be";

                  return (
                    <tr
                      key={slot.id}
                      onClick={() => handleTeamClick(index)}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        backgroundColor:
                          selectedTeamIndex === index
                            ? "rgba(242, 182, 50, 0.2)"
                            : !isEmpty && slot.isLocked && !isPastWeek
                            ? "rgba(239, 68, 68, 0.08)"
                            : isBench
                            ? "rgba(255,255,255,0.02)"
                            : "transparent",
                        borderTop:
                          isBench &&
                          index ===
                            (editableRoster.length > 0 ? editableRoster : fullRoster).findIndex((s) => s.position === "be")
                            ? "2px solid rgba(255,255,255,0.15)"
                            : "none",
                        cursor: moveMode && !isEmpty && !slot.isLocked ? "pointer" : "default",
                        transition: "background-color 0.2s",
                        borderLeft:
                          selectedTeamIndex === index
                            ? "3px solid var(--accent)"
                            : !isEmpty && slot.isLocked && !isPastWeek
                            ? "3px solid rgba(239, 68, 68, 0.4)"
                            : "3px solid transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (
                          moveMode &&
                          selectedTeamIndex !== index &&
                          !isEmpty &&
                          !slot.isLocked
                        ) {
                          e.currentTarget.style.backgroundColor =
                            "rgba(242, 182, 50, 0.1)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (moveMode && selectedTeamIndex !== index) {
                          e.currentTarget.style.backgroundColor =
                            !isEmpty && slot.isLocked && !isPastWeek
                              ? "rgba(239, 68, 68, 0.08)"
                              : isBench
                              ? "rgba(255,255,255,0.02)"
                              : "transparent";
                        }
                      }}
                    >
                      <td
                        style={{
                          padding: "0.75rem 0.5rem",
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            justifyContent: "center",
                          }}
                        >
                          {!isEmpty && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newModes = [...slotModes];
                                  newModes[index] = currentMode === "2s" ? "3s" : "2s";
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
                                  transition: "all 0.2s ease",
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.background =
                                    "rgba(242, 182, 50, 0.2)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.background =
                                    "rgba(255,255,255,0.1)")
                                }
                              >
                                ⇄
                              </button>
                              <span
                                style={{
                                  fontSize: "0.7rem",
                                  fontWeight: 600,
                                  color: "var(--accent)",
                                }}
                              >
                                {currentMode}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          fontWeight: 700,
                          fontSize: "0.9rem",
                          color: isBench
                            ? "var(--text-muted)"
                            : "var(--accent)",
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                          {slot.position === "be" || slot.position === "flx" ? slot.position.toUpperCase() : slot.position}
                          {!isEmpty && slot.isLocked && !isPastWeek && (
                            <span title="Locked — cannot be edited" style={{ fontSize: "0.8rem" }}>
                              🔒
                            </span>
                          )}
                        </span>
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        {isEmpty ? (
                          <span
                            style={{
                              color: "var(--text-muted)",
                              fontSize: "0.95rem",
                              fontStyle: "italic",
                            }}
                          >
                            Empty
                          </span>
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                            }}
                          >
                            <Image
                              src={slot.mleTeam!.logoPath}
                              alt={slot.mleTeam!.name}
                              width={32}
                              height={32}
                              style={{ borderRadius: "4px" }}
                            />
                            <div>
                              <div
                                onClick={(e) => {
                                  if (!moveMode) {
                                    e.stopPropagation();
                                    setSelectedTeam(slot.mleTeam!);
                                    setSelectedTeamRosteredBy(
                                      rosterData
                                        ? {
                                            rosterName: rosterData.fantasyTeam.displayName,
                                            managerName: rosterData.fantasyTeam.ownerDisplayName,
                                          }
                                        : undefined
                                    );
                                    setShowModal(true);
                                  }
                                }}
                                style={{
                                  fontWeight: 600,
                                  fontSize: "1rem",
                                  cursor: moveMode ? "default" : "pointer",
                                  color: "var(--text-main)",
                                  transition: "color 0.2s",
                                }}
                                onMouseEnter={(e) => {
                                  if (!moveMode) {
                                    e.currentTarget.style.color =
                                      "var(--accent)";
                                  }
                                }}
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.color =
                                    "var(--text-main)")
                                }
                              >
                                {slot.mleTeam!.leagueId} {slot.mleTeam!.name}
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontWeight: 700,
                          fontSize: "1rem",
                          color: slot.mleTeam
                            ? "var(--accent)"
                            : "var(--text-muted)",
                        }}
                      >
                        {slot.mleTeam
                          ? slot.mleTeam.stats[currentMode].score.toFixed(1)
                          : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          fontSize: "0.9rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        {slot.opponent ? (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              // TeamModal fetches its own player/weekly-breakdown data
                              // by id/leagueId — the stat fields here are unused filler.
                              setSelectedTeam({
                                id: slot.opponent!.id,
                                name: slot.opponent!.name,
                                leagueId: slot.opponent!.leagueId,
                                slug: slot.opponent!.slug,
                                logoPath: slot.opponent!.logoPath,
                                primaryColor: slot.opponent!.primaryColor,
                                secondaryColor: slot.opponent!.secondaryColor,
                                weeklyStats: null,
                                stats: {
                                  "2s": { record: "0-0", goals: 0, shots: 0, saves: 0, assists: 0, demos: 0, fpts: 0, avg: 0, last: 0, score: 0 },
                                  "3s": { record: "0-0", goals: 0, shots: 0, saves: 0, assists: 0, demos: 0, fpts: 0, avg: 0, last: 0, score: 0 },
                                },
                              });
                              setSelectedTeamRosteredBy(undefined);
                              setShowModal(true);
                            }}
                            style={{ cursor: "pointer" }}
                            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                          >
                            {slot.opponent.name} {slot.opponent.record[currentMode]}
                            {slot.opponent.standing[currentMode] && (
                              <>
                                {" "}
                                <span
                                  style={{
                                    color: getOpponentStandingsColor(
                                      slot.opponent.standing[currentMode]!.rank,
                                      slot.opponent.standing[currentMode]!.totalTeams
                                    ),
                                    fontWeight: 600,
                                  }}
                                >
                                  ({ordinal(slot.opponent.standing[currentMode]!.rank)})
                                </span>
                              </>
                            )}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontSize: "0.9rem",
                        }}
                      >
                        {slot.oprk[currentMode] ?? "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontSize: "0.9rem",
                          fontWeight: 600,
                        }}
                      >
                        {slot.fprk[currentMode] ?? "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontWeight: 600,
                          fontSize: "0.95rem",
                        }}
                      >
                        {slot.mleTeam ? slot.mleTeam.stats[currentMode].fpts.toFixed(1) : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          color: "var(--text-muted)",
                          fontSize: "0.9rem",
                        }}
                      >
                        {slot.mleTeam ? slot.mleTeam.stats[currentMode].avg.toFixed(1) : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          color: "var(--text-muted)",
                          fontSize: "0.9rem",
                        }}
                      >
                        {slot.mleTeam ? slot.mleTeam.stats[currentMode].last.toFixed(1) : "-"}
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
          {/* Week Navigation and Game Mode Toggle */}
          <div
            style={{
              padding: "1rem 1.5rem",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <button
                onClick={() => setCurrentWeek((prev) => getPrevWeek(prev))}
                disabled={currentWeek === 1}
                style={{
                  background: "transparent",
                  border: "none",
                  color:
                    currentWeek === 1
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.7)",
                  cursor: currentWeek === 1 ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                }}
              >
                {currentWeek === 1 ? "◄" : `◄ Week ${getPrevWeek(currentWeek)}`}
              </button>

              <span
                style={{
                  color: "#d4af37",
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  padding: "0 1rem",
                }}
              >
                Week {currentWeek}
              </span>

              <button
                onClick={() => setCurrentWeek((prev) => getNextWeek(prev))}
                disabled={currentWeek === 10}
                style={{
                  background: "transparent",
                  border: "none",
                  color:
                    currentWeek === 10
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.7)",
                  cursor: currentWeek === 10 ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                }}
              >
                {currentWeek === 10 ? "►" : `Week ${getNextWeek(currentWeek)} ►`}
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                backgroundColor: "rgba(255,255,255,0.05)",
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
                    gameMode === "2s" ? "var(--accent)" : "transparent",
                  color: gameMode === "2s" ? "#1a1a2e" : "var(--text-main)",
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
                    gameMode === "3s" ? "var(--accent)" : "transparent",
                  color: gameMode === "3s" ? "#1a1a2e" : "var(--text-main)",
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
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Rank
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Team
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Score
                  </th>
                  <th
                    onClick={() => handleStatsSort("fprk")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Fprk{" "}
                    {statsSortColumn === "fprk" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("fpts")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Fpts{" "}
                    {statsSortColumn === "fpts" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("avg")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Avg{" "}
                    {statsSortColumn === "avg" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("last")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Last{" "}
                    {statsSortColumn === "last" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("goals")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Goals{" "}
                    {statsSortColumn === "goals" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("shots")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Shots{" "}
                    {statsSortColumn === "shots" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("saves")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Saves{" "}
                    {statsSortColumn === "saves" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("assists")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Assists{" "}
                    {statsSortColumn === "assists" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("demos")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Demos{" "}
                    {statsSortColumn === "demos" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Record
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRosterTeams.map((team, index) => (
                  <tr
                    key={team.id}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        fontWeight: 700,
                        fontSize: "0.9rem",
                        color: "var(--accent)",
                      }}
                    >
                      {index + 1}
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <Image
                          src={team.logoPath}
                          alt={team.name}
                          width={24}
                          height={24}
                          style={{ borderRadius: "4px" }}
                        />
                        <div>
                          <div
                            onClick={() => {
                              setSelectedTeam(team);
                              setSelectedTeamRosteredBy(
                                rosterData
                                  ? {
                                      rosterName: rosterData.fantasyTeam.displayName,
                                      managerName: rosterData.fantasyTeam.ownerDisplayName,
                                    }
                                  : undefined
                              );
                              setShowModal(true);
                            }}
                            style={{
                              fontWeight: 600,
                              fontSize: "0.95rem",
                              cursor: "pointer",
                              color: "var(--text-main)",
                              transition: "color 0.2s",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.color = "var(--accent)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.color = "var(--text-main)")
                            }
                          >
                            {team.leagueId} {team.name}
                          </div>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: "var(--text-muted)",
                              marginTop: "0.15rem",
                            }}
                          >
                            vs. {team.opponent?.name ?? "-"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "center",
                        fontWeight: 700,
                        fontSize: "1rem",
                        color: "var(--accent)",
                      }}
                    >
                      {team.displayStats.score > 0
                        ? team.displayStats.score.toFixed(1)
                        : "-"}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "center",
                        fontSize: "0.9rem",
                        fontWeight: 600,
                      }}
                    >
                      {team.displayStats.fprk}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontWeight: 600,
                        fontSize: "0.95rem",
                      }}
                    >
                      {team.displayStats.fpts.toFixed(1)}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        color: "var(--text-muted)",
                        fontSize: "0.9rem",
                      }}
                    >
                      {team.displayStats.avg.toFixed(1)}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        color: "var(--text-muted)",
                        fontSize: "0.9rem",
                      }}
                    >
                      {team.displayStats.last.toFixed(1)}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.9rem",
                      }}
                    >
                      {team.displayStats.goals}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.9rem",
                      }}
                    >
                      {team.displayStats.shots}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.9rem",
                      }}
                    >
                      {team.displayStats.saves}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.9rem",
                      }}
                    >
                      {team.displayStats.assists}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "right",
                        fontSize: "0.9rem",
                      }}
                    >
                      {team.displayStats.demos}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "center",
                        fontSize: "0.9rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      {team.displayStats.teamRecord}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Waivers Tab */}
      {activeTab === "waivers" && (
        <>
          <section className="card" style={{ marginBottom: "1.5rem" }}>
            <div style={{ padding: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent)", marginBottom: "1rem" }}>
                {waiverPriorityData?.waiverSystem === "faab" ? "FAAB Budget" : "Waiver Priority Order"}
              </h3>
              {waiverPriorityLoading || !waiverPriorityData ? (
                <div style={{ color: "var(--text-muted)" }}>Loading...</div>
              ) : waiverPriorityData.waiverSystem === "faab" ? (
                <div style={{ fontSize: "1.1rem", color: "var(--text-main)" }}>
                  Your remaining budget:{" "}
                  <span style={{ fontWeight: 700, color: "var(--accent)" }}>
                    ${waiverPriorityData.teams.find((t) => t.id === rosterData?.fantasyTeam.id)?.faabRemaining ?? 0}
                  </span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {waiverPriorityData.teams.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        padding: "0.6rem 0.9rem",
                        borderRadius: "6px",
                        background: t.id === rosterData?.fantasyTeam.id ? "rgba(242, 182, 50, 0.12)" : "rgba(255,255,255,0.03)",
                        border: t.id === rosterData?.fantasyTeam.id ? "1px solid rgba(242, 182, 50, 0.35)" : "1px solid transparent",
                      }}
                    >
                      <span style={{ width: "2rem", fontWeight: 700, color: "var(--accent)" }}>#{t.waiverPriority ?? "-"}</span>
                      <span style={{ fontWeight: 600, color: "var(--text-main)" }}>{t.teamName}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{t.managerName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="card">
          <div style={{ padding: "1.5rem", minHeight: "300px" }}>
            {!rosterData?.fantasyTeam.isOwner ? (
              <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "3rem" }}>
                Pending waiver claims are only visible to the manager who submitted them.
              </div>
            ) : waiverClaimsLoading ? (
              <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "3rem" }}>
                Loading waiver claims...
              </div>
            ) : waiverClaims.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "3rem" }}>
                No pending waiver claims
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {waiverClaims.map((claim) => (
                  <div
                    key={claim.id}
                    style={{
                      background: "rgba(15, 23, 42, 0.6)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "8px",
                      padding: "1.25rem 1.5rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "1.5rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
                      <span style={{ fontSize: "1.25rem", color: "#22c55e", fontWeight: 700 }}>+</span>
                      {claim.addTeam ? (
                        <>
                          <Image
                            src={claim.addTeam.logoPath}
                            alt={claim.addTeam.name}
                            width={32}
                            height={32}
                            style={{ borderRadius: "6px" }}
                          />
                          <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                            {claim.addTeam.leagueId} {claim.addTeam.name}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>Unknown team</span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
                      {claim.dropTeam ? (
                        <>
                          <span style={{ fontSize: "1.25rem", color: "#ef4444", fontWeight: 700 }}>−</span>
                          <Image
                            src={claim.dropTeam.logoPath}
                            alt={claim.dropTeam.name}
                            width={32}
                            height={32}
                            style={{ borderRadius: "6px" }}
                          />
                          <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                            {claim.dropTeam.leagueId} {claim.dropTeam.name}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                          No drop — filling an empty slot
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      Submitted {new Date(claim.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </section>
        </>
      )}

      {/* Trades Tab */}
      {activeTab === "trades" && (
        <section className="card">
          <div style={{ padding: "1.5rem", minHeight: "300px" }}>
            {tradesLoading ? (
              <div
                style={{
                  textAlign: "center",
                  color: "var(--text-muted)",
                  padding: "3rem",
                }}
              >
                Loading trades...
              </div>
            ) : trades.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  color: "var(--text-muted)",
                  padding: "3rem",
                }}
              >
                No trades found
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {trades.filter(trade => trade.status === "pending" || trade.status === "awaiting_veto").map((trade) => (
                  <div
                    key={trade.id}
                    style={{
                      background: "rgba(15, 23, 42, 0.6)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "8px",
                      padding: "1.5rem",
                    }}
                  >
                    {/* Trade Header */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "1rem",
                      }}
                    >
                      <div>
                        <span
                          style={{
                            fontSize: "0.9rem",
                            fontWeight: 600,
                            color:
                              trade.status === "pending"
                                ? "#fbbf24"
                                : trade.status === "awaiting_veto"
                                ? "#f59e0b"
                                : trade.status === "accepted"
                                ? "#22c55e"
                                : trade.status === "rejected"
                                ? "#ef4444"
                                : "var(--text-muted)",
                            textTransform: "uppercase",
                          }}
                        >
                          {trade.status === "awaiting_veto" ? "Awaiting Veto" : trade.status}
                        </span>
                        <span
                          style={{
                            marginLeft: "1rem",
                            fontSize: "0.85rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          {new Date(trade.createdAt).toLocaleString()}
                        </span>
                        {trade.status === "awaiting_veto" && trade.vetoDeadline && (
                          <span
                            style={{
                              marginLeft: "1rem",
                              fontSize: "0.85rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            Processes automatically at{" "}
                            {new Date(trade.vetoDeadline).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Trade Details */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto 1fr",
                        gap: "2rem",
                        alignItems: "center",
                      }}
                    >
                      {/* Proposer Side */}
                      <div>
                        <div
                          style={{
                            fontSize: "0.85rem",
                            color: "var(--text-muted)",
                            marginBottom: "0.5rem",
                          }}
                        >
                          {trade.isProposer ? "You give" : `${trade.proposer.managerName} gives`}
                        </div>
                        <div
                          style={{
                            fontSize: "1rem",
                            fontWeight: 600,
                            color: "var(--text-main)",
                            marginBottom: "0.5rem",
                          }}
                        >
                          {trade.proposer.teamName}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}
                        >
                          {trade.proposer.gives.map((team: any) => (
                            <div
                              key={team.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                padding: "0.5rem",
                                background: "rgba(255,255,255,0.05)",
                                borderRadius: "6px",
                              }}
                            >
                              <Image
                                src={team.logoPath}
                                alt={team.name}
                                width={32}
                                height={32}
                                style={{ borderRadius: "4px" }}
                              />
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTeam(team);
                                  setSelectedTeamRosteredBy({
                                    rosterName: trade.proposer.teamName,
                                    managerName: trade.proposer.managerName,
                                  });
                                  setShowModal(true);
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.color = "var(--accent)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.color = "var(--text-main)")
                                }
                                style={{
                                  fontSize: "0.9rem",
                                  color: "var(--text-main)",
                                  cursor: "pointer",
                                  transition: "color 0.2s",
                                }}
                              >
                                {team.name}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div
                        style={{
                          fontSize: "2rem",
                          color: "var(--accent)",
                          fontWeight: 700,
                        }}
                      >
                        ⇄
                      </div>

                      {/* Receiver Side */}
                      <div>
                        <div
                          style={{
                            fontSize: "0.85rem",
                            color: "var(--text-muted)",
                            marginBottom: "0.5rem",
                          }}
                        >
                          {trade.isProposer ? `${trade.receiver.managerName} gives` : "You give"}
                        </div>
                        <div
                          style={{
                            fontSize: "1rem",
                            fontWeight: 600,
                            color: "var(--text-main)",
                            marginBottom: "0.5rem",
                          }}
                        >
                          {trade.receiver.teamName}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}
                        >
                          {trade.receiver.gives.map((team: any) => (
                            <div
                              key={team.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                padding: "0.5rem",
                                background: "rgba(255,255,255,0.05)",
                                borderRadius: "6px",
                              }}
                            >
                              <Image
                                src={team.logoPath}
                                alt={team.name}
                                width={32}
                                height={32}
                                style={{ borderRadius: "4px" }}
                              />
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTeam(team);
                                  setSelectedTeamRosteredBy({
                                    rosterName: trade.receiver.teamName,
                                    managerName: trade.receiver.managerName,
                                  });
                                  setShowModal(true);
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.color = "var(--accent)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.color = "var(--text-main)")
                                }
                                style={{
                                  fontSize: "0.9rem",
                                  color: "var(--text-main)",
                                  cursor: "pointer",
                                  transition: "color 0.2s",
                                }}
                              >
                                {team.name}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons for Pending Trades */}
                    {trade.status === "pending" && !trade.isProposer && (
                      <div
                        style={{
                          display: "flex",
                          gap: "1rem",
                          marginTop: "1.5rem",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          onClick={async () => {
                            try {
                              const response = await fetch(
                                `/api/leagues/${leagueId}/trades/${trade.id}`,
                                {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "reject" }),
                                }
                              );

                              if (response.ok) {
                                // Refresh trades
                                const tradesResponse = await fetch(
                                  `/api/leagues/${leagueId}/trades?teamId=${teamId}`
                                );
                                if (tradesResponse.ok) {
                                  const data = await tradesResponse.json();
                                  setTrades(data.trades || []);
                                }
                              }
                            } catch (error) {
                              console.error("Error rejecting trade:", error);
                            }
                          }}
                          style={{
                            background: "rgba(239, 68, 68, 0.2)",
                            border: "1px solid #ef4444",
                            color: "#ef4444",
                            padding: "0.5rem 1.5rem",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "0.9rem",
                            fontWeight: 600,
                          }}
                        >
                          Reject
                        </button>
                        <button
                          onClick={async () => {
                            // Store the original trade ID to reject after counter offer
                            sessionStorage.setItem("counterTradeId", trade.id);
                            sessionStorage.setItem("counterTradeLeagueId", leagueId);
                            sessionStorage.setItem("counterTradeTeamId", teamId || "");

                            // Navigate to trade page with the proposer's team
                            window.location.href = `/leagues/${leagueId}/opponents/${trade.proposer.teamId}/trade`;
                          }}
                          style={{
                            background: "rgba(251, 191, 36, 0.2)",
                            border: "1px solid #fbbf24",
                            color: "#fbbf24",
                            padding: "0.5rem 1.5rem",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "0.9rem",
                            fontWeight: 600,
                          }}
                        >
                          Counter
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const response = await fetch(
                                `/api/leagues/${leagueId}/trades/${trade.id}`,
                                {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "accept" }),
                                }
                              );

                              if (response.ok) {
                                // Refresh trades
                                const tradesResponse = await fetch(
                                  `/api/leagues/${leagueId}/trades?teamId=${teamId}`
                                );
                                if (tradesResponse.ok) {
                                  const data = await tradesResponse.json();
                                  setTrades(data.trades || []);
                                }
                              }
                            } catch (error) {
                              console.error("Error accepting trade:", error);
                            }
                          }}
                          style={{
                            background: "rgba(34, 197, 94, 0.2)",
                            border: "1px solid #22c55e",
                            color: "#22c55e",
                            padding: "0.5rem 1.5rem",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "0.9rem",
                            fontWeight: 600,
                          }}
                        >
                          Accept
                        </button>
                      </div>
                    )}

                    {/* Cancel button for trades you sent out */}
                    {trade.status === "pending" && trade.isProposer && (
                      <div
                        style={{
                          display: "flex",
                          gap: "1rem",
                          marginTop: "1.5rem",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          onClick={async () => {
                            if (!confirm("Cancel this trade offer?")) return;
                            try {
                              const response = await fetch(
                                `/api/leagues/${leagueId}/trades/${trade.id}`,
                                { method: "DELETE" }
                              );

                              if (response.ok) {
                                const tradesResponse = await fetch(
                                  `/api/leagues/${leagueId}/trades?teamId=${teamId}`
                                );
                                if (tradesResponse.ok) {
                                  const data = await tradesResponse.json();
                                  setTrades(data.trades || []);
                                }
                              }
                            } catch (error) {
                              console.error("Error cancelling trade:", error);
                            }
                          }}
                          style={{
                            background: "rgba(239, 68, 68, 0.2)",
                            border: "1px solid #ef4444",
                            color: "#ef4444",
                            padding: "0.5rem 1.5rem",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "0.9rem",
                            fontWeight: 600,
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Drop Modal */}
      {showDropModal && (
        <div
          onClick={() => {
            setShowDropModal(false);
            setSelectedDropSlot(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 90,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(800px, 90vw)",
              background: "linear-gradient(135deg, #1a2332 0%, #0f1419 100%)",
              border: "2px solid rgba(242, 182, 50, 0.3)",
              borderRadius: "16px",
              padding: "0",
              boxShadow: "0 25px 50px rgba(0, 0, 0, 0.8)",
              position: "relative",
              maxHeight: "80vh",
              overflowY: "auto",
            }}
          >
            {/* Close button */}
            <button
              onClick={() => {
                setShowDropModal(false);
                setSelectedDropSlot(null);
              }}
              style={{
                position: "absolute",
                top: "1rem",
                right: "1rem",
                background: "rgba(255, 255, 255, 0.1)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "8px",
                width: "32px",
                height: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "var(--text-muted)",
                fontSize: "1.2rem",
                fontWeight: 700,
                zIndex: 10,
              }}
            >
              ×
            </button>

            {/* Header */}
            <div
              style={{
                padding: "2rem",
                borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <h2
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  margin: 0,
                }}
              >
                Drop a Team
              </h2>
              <p
                style={{
                  fontSize: "0.9rem",
                  color: "var(--text-muted)",
                  marginTop: "0.5rem",
                  marginBottom: 0,
                }}
              >
                Select a team from your roster to drop
              </p>
            </div>

            {/* Roster List */}
            <div style={{ padding: "1.5rem 2rem" }}>
              {fullRoster.filter((slot) => slot.mleTeam !== null).length ===
              0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "3rem",
                    color: "var(--text-muted)",
                  }}
                >
                  No teams to drop
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                  }}
                >
                  {fullRoster
                    .filter((slot) => slot.mleTeam !== null)
                    .map((slot) => (
                      <div
                        key={slot.id}
                        onClick={() =>
                          !slot.isLocked &&
                          setSelectedDropSlot(
                            selectedDropSlot?.id === slot.id ? null : slot
                          )
                        }
                        style={{
                          padding: "1rem",
                          background: slot.isLocked
                            ? "rgba(239, 68, 68, 0.06)"
                            : selectedDropSlot?.id === slot.id
                            ? "rgba(242, 182, 50, 0.1)"
                            : "rgba(255, 255, 255, 0.05)",
                          border: `2px solid ${
                            slot.isLocked
                              ? "rgba(239, 68, 68, 0.3)"
                              : selectedDropSlot?.id === slot.id
                              ? "var(--accent)"
                              : "rgba(255, 255, 255, 0.1)"
                          }`,
                          borderRadius: "8px",
                          cursor: slot.isLocked ? "not-allowed" : "pointer",
                          opacity: slot.isLocked ? 0.6 : 1,
                          transition: "all 0.2s ease",
                          display: "flex",
                          alignItems: "center",
                          gap: "1rem",
                        }}
                      >
                        <Image
                          src={slot.mleTeam!.logoPath}
                          alt={slot.mleTeam!.name}
                          width={48}
                          height={48}
                          style={{ borderRadius: "6px" }}
                        />
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: "1rem",
                              fontWeight: 700,
                              color: "var(--text-main)",
                            }}
                          >
                            {slot.mleTeam!.leagueId} {slot.mleTeam!.name}
                          </div>
                          <div
                            style={{
                              fontSize: "0.85rem",
                              color: "var(--text-muted)",
                              marginTop: "0.25rem",
                            }}
                          >
                            {slot.position === "be" || slot.position === "flx" ? slot.position.toUpperCase() : slot.position} ·{" "}
                            {slot.fantasyPoints?.toFixed(1) || 0} pts
                            {slot.isLocked && (
                              <span style={{ color: "#ef4444", marginLeft: "0.5rem" }}>
                                🔒 Locked — cannot be dropped
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            width: "24px",
                            height: "24px",
                            border: "2px solid var(--accent)",
                            borderRadius: "4px",
                            background:
                              selectedDropSlot?.id === slot.id
                                ? "var(--accent)"
                                : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color:
                              selectedDropSlot?.id === slot.id
                                ? "#1a1a2e"
                                : "transparent",
                            fontWeight: 700,
                            fontSize: "1rem",
                          }}
                        >
                          ✓
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div
              style={{
                padding: "1.5rem 2rem",
                borderTop: "1px solid rgba(255, 255, 255, 0.1)",
                display: "flex",
                gap: "1rem",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => {
                  setShowDropModal(false);
                  setSelectedDropSlot(null);
                }}
                className="btn btn-ghost"
                style={{ fontSize: "1rem" }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!selectedDropSlot || !rosterData) {
                    showAlert("Please select a team to drop", "warning");
                    return;
                  }

                  try {
                    const response = await fetch(
                      `/api/leagues/${leagueId}/rosters/${teamId}`,
                      {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          rosterSlotId: selectedDropSlot.id,
                        }),
                      }
                    );

                    if (response.ok) {
                      showAlert(
                        `${
                          selectedDropSlot.mleTeam!.name
                        } has been dropped from your roster`,
                        "success"
                      );
                      setShowDropModal(false);
                      setSelectedDropSlot(null);
                      // Refetch roster
                      const rosterResponse = await fetch(
                        `/api/leagues/${leagueId}/rosters/${teamId}?week=${currentWeek}`
                      );
                      if (rosterResponse.ok) {
                        const updatedRoster = await rosterResponse.json();
                        setRosterData(updatedRoster);
                      }
                    } else {
                      const error = await response.json();
                      showAlert(
                        `Failed to drop team: ${error.error || "Unknown error"}`,
                        "error"
                      );
                    }
                  } catch (error) {
                    console.error("Error dropping team:", error);
                    showAlert("Failed to drop team. Please try again.", "error");
                  }
                }}
                disabled={!selectedDropSlot}
                style={{
                  background: selectedDropSlot
                    ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
                    : "rgba(128, 128, 128, 0.3)",
                  color: selectedDropSlot
                    ? "white"
                    : "rgba(255, 255, 255, 0.5)",
                  fontWeight: 700,
                  padding: "0.75rem 2rem",
                  borderRadius: "8px",
                  border: "none",
                  cursor: selectedDropSlot ? "pointer" : "not-allowed",
                  fontSize: "1rem",
                  boxShadow: selectedDropSlot
                    ? "0 4px 12px rgba(239, 68, 68, 0.3)"
                    : "none",
                }}
              >
                Drop Team
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Team Modal */}
      {showModal && selectedTeam && (
        <TeamModal
          team={{
            ...selectedTeam,
            status: "rostered",
            rosteredBy: selectedTeamRosteredBy,
          }}
          onClose={() => {
            setShowModal(false);
            setSelectedTeam(null);
            setSelectedTeamRosteredBy(undefined);
          }}
          isDraftContext={false}
        />
      )}
    </>
  );
}
