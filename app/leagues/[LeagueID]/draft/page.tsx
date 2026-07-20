"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import DraftTeamModal from "@/components/DraftTeamModal";
import { useAlert } from "@/components/AlertProvider";

// Types
interface TeamStats {
  fpts: number;
  avg: number;
  goals: number;
  goalsAgainst: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  gamesPlayed: number;
  sprocketRating: number;
  gameRecord: string;
  seriesRecord: string;
}

interface MLETeam {
  id: string;
  name: string;
  leagueId: string;
  slug: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
  stats?: TeamStats | null;
}

interface DraftPick {
  id: string;
  round: number;
  pickNumber: number;
  overallPick: number;
  fantasyTeamId: string | null;
  mleTeamId: string | null;
  mleTeam: MLETeam | null;
  pickedAt: string | null;
}

interface FantasyTeam {
  id: string;
  displayName: string;
  shortCode: string;
  draftPosition: number | null;
  ownerUserId: string;
  ownerDisplayName: string;
  ownerDiscordId: string;
  autodraftEnabled: boolean;
  draftQueue: MLETeam[];
  roster: Array<{
    week: number;
    position: string;
    slotIndex: number;
    mleTeamId: string;
    mleTeam: MLETeam | null;
  }>;
}

interface DraftState {
  leagueId: string;
  leagueName: string;
  draftType: string;
  status: "not_started" | "in_progress" | "paused" | "completed";
  currentPickNumber: number | null;
  currentPickDeadline: string | null;
  pickTimeSeconds: number;
  statsSeason: string | null;
  picks: DraftPick[];
  fantasyTeams: FantasyTeam[];
  availableTeams: MLETeam[];
}

const LEAGUE_FILTER_TO_CODE: Record<string, string> = {
  Foundation: "FL",
  Academy: "AL",
  Champion: "CL",
  Master: "ML",
  Premier: "PL",
};

const MODE_FILTER_TO_API: Record<string, string> = {
  Both: "combined",
  "2s": "2s",
  "3s": "3s",
};

export default function DraftPage() {
  const showAlert = useAlert();
  const router = useRouter();
  const params = useParams();
  const leagueId = params.LeagueID as string;

  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedManager, setSelectedManager] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<MLETeam | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"rosters" | "teams" | "queue">("rosters");
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  const [leagueFilter, setLeagueFilter] = useState<"All" | "Foundation" | "Academy" | "Champion" | "Master" | "Premier">("All");
  const [modeFilter, setModeFilter] = useState<"Both" | "2s" | "3s">("Both");
  const [leagueFilterOpen, setLeagueFilterOpen] = useState(false);
  const [modeFilterOpen, setModeFilterOpen] = useState(false);
  const [teamSearchTerm, setTeamSearchTerm] = useState("");

  // Fetch current user session
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch("/api/auth/session");
        if (response.ok) {
          const session = await response.json();
          setCurrentUserId(session?.user?.id || null);
        }
      } catch (error) {
        console.error("Error fetching session:", error);
      } finally {
        setSessionLoaded(true);
      }
    };
    fetchSession();
  }, []);

  // Fetch draft state
  const fetchDraftState = useCallback(async () => {
    try {
      const response = await fetch(`/api/leagues/${leagueId}/draft?mode=${MODE_FILTER_TO_API[modeFilter]}`);
      if (!response.ok) {
        throw new Error("Failed to fetch draft state");
      }
      const data = await response.json();
      setDraftState(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load draft");
    } finally {
      setLoading(false);
    }
  }, [leagueId, modeFilter]);

  // Initial fetch + refetch whenever the mode filter changes
  useEffect(() => {
    fetchDraftState();
  }, [fetchDraftState]);

  // Detect the draft finishing live (not just landing on an already-completed
  // one) and send the viewer to their roster — the pop-up itself fires there
  // instead of here, so navigating away doesn't cut it off mid-display.
  const prevDraftStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draftState) return;
    const prevStatus = prevDraftStatusRef.current;
    prevDraftStatusRef.current = draftState.status;
    if (prevStatus && prevStatus !== "completed" && draftState.status === "completed") {
      const myTeam = draftState.fantasyTeams.find((t) => t.ownerUserId === currentUserId);
      router.push(
        myTeam
          ? `/leagues/${leagueId}/my-roster/${myTeam.id}?draftComplete=1`
          : `/leagues/${leagueId}`
      );
    }
  }, [draftState, currentUserId, leagueId, router]);

  // Default the Rosters tab's manager selector to the viewer's own team,
  // once we know both who they are and which teams exist — falls back to
  // the first team if the viewer doesn't own one in this league (e.g. an
  // admin just spectating).
  useEffect(() => {
    if (selectedManager || !sessionLoaded || !draftState || draftState.fantasyTeams.length === 0) return;
    const myTeam = draftState.fantasyTeams.find((t) => t.ownerUserId === currentUserId);
    setSelectedManager((myTeam ?? draftState.fantasyTeams[0]).displayName);
  }, [selectedManager, sessionLoaded, draftState, currentUserId]);

  // Polling for updates (every 3 seconds when draft is active) — this is
  // also what drives the server-side autopick sweep (lib/draftAutopick.ts),
  // since that runs lazily off this same GET request.
  useEffect(() => {
    if (!draftState || draftState.status !== "in_progress") return;

    const interval = setInterval(fetchDraftState, 3000);
    return () => clearInterval(interval);
  }, [draftState, fetchDraftState]);

  // Timer countdown (display only — the server enforces the actual deadline
  // and autopicks on the next poll if it lapses)
  useEffect(() => {
    if (!draftState?.currentPickDeadline) {
      setTimeRemaining(0);
      return;
    }

    const updateTimer = () => {
      const deadline = new Date(draftState.currentPickDeadline!).getTime();
      const now = Date.now();
      setTimeRemaining(Math.max(0, Math.floor((deadline - now) / 1000)));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [draftState]);

  const currentTeam = draftState?.fantasyTeams.find((t) => t.displayName === selectedManager);
  const currentRoster = currentTeam?.roster || [];
  const currentUserTeam = draftState?.fantasyTeams.find((t) => t.ownerUserId === currentUserId);
  const currentPick = draftState?.picks.find((pick) => pick.overallPick === draftState.currentPickNumber);
  const isMyTurn = !!(currentUserTeam && currentPick && currentPick.fantasyTeamId === currentUserTeam.id);
  const currentPickTeam = currentPick ? draftState?.fantasyTeams.find((t) => t.id === currentPick.fantasyTeamId) : null;
  const myDraftQueue = currentUserTeam?.draftQueue ?? [];
  const myAutodraftEnabled = currentUserTeam?.autodraftEnabled ?? false;

  const toggleAutodraft = async () => {
    try {
      await fetch(`/api/leagues/${leagueId}/draft/autodraft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !myAutodraftEnabled }),
      });
      await fetchDraftState();
    } catch (error) {
      console.error("Error toggling autodraft:", error);
    }
  };

  const saveQueue = async (newQueue: MLETeam[]) => {
    try {
      await fetch(`/api/leagues/${leagueId}/draft/queue`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mleTeamIds: newQueue.map((t) => t.id) }),
      });
      await fetchDraftState();
    } catch (error) {
      console.error("Error saving draft queue:", error);
    }
  };

  const handlePickTeam = async (team: MLETeam) => {
    if (!isMyTurn || !currentUserTeam) {
      showAlert("It's not your turn to pick!", "warning");
      return;
    }

    try {
      const response = await fetch(`/api/leagues/${leagueId}/draft/pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mleTeamId: team.id }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to make pick");
      }

      await fetchDraftState();
    } catch (error) {
      showAlert(error instanceof Error ? error.message : "Failed to make pick", "error");
    }
  };

  const handleAddToQueue = (team: MLETeam) => {
    if (myDraftQueue.some((t) => t.id === team.id)) return;
    saveQueue([...myDraftQueue, team]);
  };

  const handleRemoveFromQueue = (idx: number) => {
    saveQueue(myDraftQueue.filter((_, i) => i !== idx));
  };

  const handleMoveQueueUp = (idx: number) => {
    if (idx === 0) return;
    const newQueue = [...myDraftQueue];
    [newQueue[idx - 1], newQueue[idx]] = [newQueue[idx], newQueue[idx - 1]];
    saveQueue(newQueue);
  };

  const handleMoveQueueDown = (idx: number) => {
    if (idx === myDraftQueue.length - 1) return;
    const newQueue = [...myDraftQueue];
    [newQueue[idx], newQueue[idx + 1]] = [newQueue[idx + 1], newQueue[idx]];
    saveQueue(newQueue);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", padding: "2rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-main)", fontSize: "1.2rem" }}>Loading draft...</div>
      </div>
    );
  }

  if (error || !draftState) {
    return (
      <div style={{ minHeight: "100vh", padding: "2rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#ef4444", fontSize: "1.2rem" }}>Error: {error || "Draft not found"}</div>
      </div>
    );
  }

  const getPickStatus = (pick: DraftPick): "picked" | "current" | "upcoming" => {
    if (pick.pickedAt) return "picked";
    if (pick.overallPick === draftState.currentPickNumber) return "current";
    return "upcoming";
  };

  const isMinePick = (pick: DraftPick) => !!(currentUserTeam && pick.fantasyTeamId === currentUserTeam.id);

  const getFantasyTeamById = (teamId: string): FantasyTeam | undefined =>
    draftState.fantasyTeams.find((t) => t.id === teamId);

  // Recent picks: a window of 5 centered on the current pick (2 before, 2
  // after), shifting near either edge of the draft so it still shows 5
  // where possible.
  const currentPickIndex = draftState.picks.findIndex((p) => p.overallPick === draftState.currentPickNumber);
  let recentPicksWindow: DraftPick[];
  if (draftState.status === "not_started") {
    // Nothing has happened yet — show the start of the order rather than
    // the end (there's no "current pick" to center on).
    recentPicksWindow = draftState.picks.slice(0, 5);
  } else if (currentPickIndex === -1) {
    recentPicksWindow = draftState.picks.slice(-5);
  } else {
    let start = currentPickIndex - 2;
    let end = currentPickIndex + 3;
    if (start < 0) {
      end += -start;
      start = 0;
    }
    if (end > draftState.picks.length) {
      start -= end - draftState.picks.length;
      end = draftState.picks.length;
      start = Math.max(0, start);
    }
    recentPicksWindow = draftState.picks.slice(start, end);
  }

  const rounds = [...new Set(draftState.picks.map((p) => p.round))];

  const filteredAvailableTeams = draftState.availableTeams
    .filter((team) => leagueFilter === "All" || team.leagueId === LEAGUE_FILTER_TO_CODE[leagueFilter])
    .filter((team) => !teamSearchTerm.trim() || team.name.toLowerCase().includes(teamSearchTerm.trim().toLowerCase()))
    .sort((a, b) => (b.stats?.fpts ?? 0) - (a.stats?.fpts ?? 0));

  return (
    <div>
      {/* Team Stats Modal */}
      <DraftTeamModal
        team={showModal && selectedTeam ? selectedTeam : null}
        onClose={() => setShowModal(false)}
      />

      <div style={{ minHeight: "100vh", padding: "clamp(1rem, 4vw, 2rem) clamp(0.5rem, 3vw, 1rem)" }}>
        {/* Header with Timer and Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
          <div>
            <h1 style={{ fontSize: "clamp(1.5rem, 6vw, 2.5rem)", fontWeight: 700, color: "var(--accent)", margin: 0 }}>
              Draft Room
            </h1>
            <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
              {draftState.leagueName} • {draftState.draftType === "snake" ? "Snake" : "Linear"} Draft •{" "}
              <span style={{ textTransform: "capitalize" }}>{draftState.status.replace("_", " ")}</span>
            </div>
            {draftState.status === "in_progress" && currentPickTeam && (
              <div
                style={{
                  marginTop: "0.75rem",
                  padding: "0.75rem 1.25rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  flexWrap: "wrap",
                  background: isMyTurn
                    ? "linear-gradient(135deg, #d4af37 0%, #f2b632 100%)"
                    : "rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  border: isMyTurn ? "2px solid #f2b632" : "1px solid rgba(255,255,255,0.2)",
                  fontWeight: 600,
                  fontSize: "0.95rem",
                  color: isMyTurn ? "#1a1a2e" : "var(--text-main)",
                  boxShadow: isMyTurn ? "0 4px 12px rgba(242, 182, 50, 0.4)" : "none",
                }}
              >
                <span>
                  {isMyTurn ? (
                    <>It&apos;s your pick! ({currentPickTeam.displayName})</>
                  ) : (
                    <>On the clock: {currentPickTeam.displayName} ({currentPickTeam.ownerDisplayName})</>
                  )}
                </span>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-start" }}>
            {/* Timer */}
            {draftState.status === "in_progress" && (
              <div
                style={{
                  background: timeRemaining <= 10
                    ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
                    : "linear-gradient(135deg, #4ade80 0%, #22c55e 100%)",
                  padding: "0.75rem 2rem",
                  borderRadius: "25px",
                  fontWeight: 700,
                  fontSize: "1.1rem",
                  color: "#ffffff",
                  boxShadow: "0 4px 10px rgba(74, 222, 128, 0.3)",
                }}
              >
                {formatTime(timeRemaining)}
              </div>
            )}

            {/* Autodraft Button */}
            {draftState.status === "in_progress" && currentUserTeam && (
              <button
                onClick={toggleAutodraft}
                style={{
                  background: myAutodraftEnabled
                    ? "linear-gradient(135deg, #d4af37 0%, #f2b632 100%)"
                    : "rgba(255,255,255,0.1)",
                  border: `2px solid ${myAutodraftEnabled ? "#f2b632" : "var(--accent)"}`,
                  padding: "0.75rem 1.5rem",
                  borderRadius: "25px",
                  fontWeight: 600,
                  fontSize: "0.95rem",
                  color: myAutodraftEnabled ? "#1a1a2e" : "var(--accent)",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  boxShadow: myAutodraftEnabled
                    ? "0 4px 12px rgba(242, 182, 50, 0.4)"
                    : "0 2px 8px rgba(242, 182, 50, 0.2)",
                }}
              >
                Autodraft {myAutodraftEnabled ? "ON" : "OFF"}
              </button>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="draft-layout">
          {/* Left Side - Draft Picks */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Recent Picks */}
            <div
              style={{
                background: "linear-gradient(135deg, rgba(50, 50, 60, 0.6) 0%, rgba(40, 40, 50, 0.6) 100%)",
                borderRadius: "12px",
                padding: "1rem",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-main)" }}>
                Recent Picks
              </h3>
              <div style={{ display: "flex", gap: "0.75rem", overflowX: "auto", paddingBottom: "0.5rem" }}>
                {recentPicksWindow.map((pick) => {
                  const status = getPickStatus(pick);
                  const fantasyTeam = pick.fantasyTeamId ? getFantasyTeamById(pick.fantasyTeamId) : null;
                  const mine = isMinePick(pick);

                  return (
                    <div
                      key={pick.id}
                      style={{
                        minWidth: "160px",
                        background: mine ? "rgba(242, 182, 50, 0.15)" : "rgba(255,255,255,0.03)",
                        borderRadius: "8px",
                        padding: "0.75rem",
                        border: `2px solid ${
                          status === "current" ? "#4ade80" : mine ? "#f2b632" : status === "picked" ? "var(--accent)" : "rgba(255,255,255,0.15)"
                        }`,
                      }}
                    >
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                        Pick {pick.round}.{pick.pickNumber} ({pick.overallPick})
                      </div>
                      {pick.mleTeam ? (
                        <>
                          <div
                            onClick={() => {
                              setSelectedTeam(pick.mleTeam);
                              setShowModal(true);
                            }}
                            style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "0.2rem", cursor: "pointer" }}
                          >
                            {pick.mleTeam.leagueId} {pick.mleTeam.name}
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                            {fantasyTeam?.displayName}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: "0.85rem", fontWeight: 600, color: status === "current" ? "#4ade80" : "var(--accent)" }}>
                          {status === "current" ? "On the Clock" : "Upcoming"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Draft Grid */}
            <div
              style={{
                background: "linear-gradient(135deg, rgba(50, 50, 60, 0.6) 0%, rgba(40, 40, 50, 0.6) 100%)",
                borderRadius: "12px",
                padding: "1rem",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <div className="draft-board-scroll">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: "fit-content" }}>
                {/* Round Headers */}
                <div style={{ display: "flex", gap: "0.25rem", paddingBottom: "0.5rem" }}>
                  <div style={{ width: "150px", flexShrink: 0 }}></div>
                  {rounds.map((round) => (
                    <div
                      key={round}
                      style={{
                        flex: 1,
                        minWidth: "60px",
                        maxWidth: "80px",
                        padding: "0.5rem",
                        background: "rgba(255,255,255,0.08)",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        color: "var(--text-main)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      R{round}
                    </div>
                  ))}
                </div>

                {/* Team Rows */}
                {draftState.fantasyTeams.map((fantasyTeam) => {
                  const autodraftLive = fantasyTeam.autodraftEnabled && draftState.status === "in_progress";
                  return (
                  <div key={fantasyTeam.id} style={{ display: "flex", gap: "0.25rem" }}>
                    <div
                      style={{
                        width: "150px",
                        flexShrink: 0,
                        padding: "0.5rem",
                        background: fantasyTeam.id === currentUserTeam?.id
                          ? "rgba(242, 182, 50, 0.15)"
                          : autodraftLive
                          ? "rgba(249, 115, 22, 0.12)"
                          : "rgba(255,255,255,0.08)",
                        borderRadius: "6px",
                        border: autodraftLive ? "1px solid rgba(249, 115, 22, 0.55)" : "1px solid transparent",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        color: fantasyTeam.displayName === selectedManager ? "var(--accent)" : "var(--text-main)",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {fantasyTeam.displayName}
                        {autodraftLive && (
                          <span style={{ marginLeft: "0.4rem", fontSize: "0.65rem", color: "#f97316" }}>AUTO</span>
                        )}
                      </span>
                    </div>

                    {rounds.map((round) => {
                      const pick = draftState.picks.find(
                        (p) => p.round === round && p.fantasyTeamId === fantasyTeam.id
                      );
                      const status = pick ? getPickStatus(pick) : "upcoming";
                      const mine = pick ? isMinePick(pick) : false;

                      return (
                        <div
                          key={round}
                          onClick={
                            pick?.mleTeam
                              ? () => {
                                  setSelectedTeam(pick.mleTeam);
                                  setShowModal(true);
                                }
                              : undefined
                          }
                          style={{
                            flex: 1,
                            minWidth: "60px",
                            maxWidth: "80px",
                            padding: "0.5rem 0.25rem",
                            background: mine ? "rgba(242, 182, 50, 0.15)" : "rgba(255,255,255,0.03)",
                            borderRadius: "6px",
                            border: `2px solid ${
                              status === "current" ? "#4ade80" : mine ? "#f2b632" : status === "picked" ? "var(--accent)" : "rgba(255,255,255,0.1)"
                            }`,
                            minHeight: "50px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textAlign: "center",
                            fontSize: "0.65rem",
                            fontWeight: 600,
                            color: "var(--text-main)",
                            overflow: "hidden",
                            cursor: pick?.mleTeam ? "pointer" : "default",
                          }}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                            {pick?.mleTeam ? `${pick.mleTeam.leagueId} ${pick.mleTeam.name}` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  );
                })}
              </div>
              </div>
            </div>
          </div>

          {/* Right Side - Roster/Teams/Queue Panel */}
          <div
            className="draft-side-panel"
            style={{
              background: "radial-gradient(circle at top left, #1d3258, #020617)",
              borderRadius: "12px",
              padding: "1rem",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {/* Tabs */}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
              {(["rosters", "teams", "queue"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRightPanelTab(tab)}
                  style={{
                    flex: 1,
                    padding: "0.5rem 0.75rem",
                    background:
                      rightPanelTab === tab
                        ? "linear-gradient(135deg, #d4af37 0%, #f2b632 100%)"
                        : "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "6px",
                    color: rightPanelTab === tab ? "#1a1a2e" : "#ffffff",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    textTransform: "capitalize",
                  }}
                >
                  {tab === "teams" ? "Available Teams" : tab} {tab === "queue" && `(${myDraftQueue.length})`}
                </button>
              ))}
            </div>

            {/* Manager Dropdown */}
            {rightPanelTab === "rosters" && (
              <div style={{ position: "relative", marginBottom: "1rem" }}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    color: "#ffffff",
                    padding: "0.75rem 1rem",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontSize: "1rem",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{selectedManager}</span>
                  <span>{dropdownOpen ? "▲" : "▼"}</span>
                </button>

                {dropdownOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      marginTop: "0.5rem",
                      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                      borderRadius: "8px",
                      padding: "0.5rem 0",
                      border: "1px solid rgba(255,255,255,0.1)",
                      boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                      zIndex: 1000,
                    }}
                  >
                    {draftState.fantasyTeams.map((team) => (
                      <button
                        key={team.id}
                        onClick={() => {
                          setSelectedManager(team.displayName);
                          setDropdownOpen(false);
                        }}
                        style={{
                          width: "100%",
                          padding: "0.75rem 1rem",
                          background: team.displayName === selectedManager ? "rgba(255,255,255,0.1)" : "transparent",
                          border: "none",
                          color: "#ffffff",
                          textAlign: "left",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        {team.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Roster Tab Content */}
            {rightPanelTab === "rosters" && (
              <div>
                <div style={{
                  background: "rgba(15, 23, 42, 0.6)",
                  borderRadius: "8px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "60px 1fr 80px",
                    padding: "0.75rem 1rem",
                    background: "rgba(255,255,255,0.05)",
                    borderBottom: "1px solid rgba(255,255,255,0.1)",
                  }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)" }}>Slot</div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)" }}>Team</div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)", textAlign: "right" }}>Pick</div>
                  </div>

                  {(() => {
                    const rosterConfig = { "2s": 2, "3s": 2, flx: 1, be: 3 };
                    const allSlots: Array<{ position: string; slotIndex: number }> = [];
                    for (let i = 0; i < rosterConfig["2s"]; i++) allSlots.push({ position: "2s", slotIndex: i });
                    for (let i = 0; i < rosterConfig["3s"]; i++) allSlots.push({ position: "3s", slotIndex: i });
                    for (let i = 0; i < rosterConfig.flx; i++) allSlots.push({ position: "flx", slotIndex: i });
                    for (let i = 0; i < rosterConfig.be; i++) allSlots.push({ position: "be", slotIndex: i });

                    return allSlots.map((slotDef, idx) => {
                      const rosterEntry = currentRoster.find(
                        (r) => r.position === slotDef.position && r.slotIndex === slotDef.slotIndex
                      );
                      const draftPick = rosterEntry?.mleTeamId
                        ? draftState.picks.find((p) => p.mleTeamId === rosterEntry.mleTeamId && p.fantasyTeamId === currentTeam?.id)
                        : null;

                      return (
                        <div
                          key={`${slotDef.position}-${slotDef.slotIndex}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "60px 1fr 80px",
                            padding: "0.75rem 1rem",
                            borderBottom: idx < allSlots.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                            alignItems: "center",
                          }}
                        >
                          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)" }}>
                            {slotDef.position === "flx" || slotDef.position === "be" ? slotDef.position.toUpperCase() : slotDef.position}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            {rosterEntry?.mleTeam ? (
                              <>
                                <Image
                                  src={rosterEntry.mleTeam.logoPath}
                                  alt={rosterEntry.mleTeam.name}
                                  width={24}
                                  height={24}
                                  onClick={() => {
                                    setSelectedTeam(rosterEntry.mleTeam);
                                    setShowModal(true);
                                  }}
                                  style={{ borderRadius: "4px", cursor: "pointer" }}
                                />
                                <span
                                  onClick={() => {
                                    setSelectedTeam(rosterEntry.mleTeam);
                                    setShowModal(true);
                                  }}
                                  style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)", cursor: "pointer" }}
                                >
                                  {rosterEntry.mleTeam.leagueId} {rosterEntry.mleTeam.name}
                                </span>
                              </>
                            ) : (
                              <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>-</span>
                            )}
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "right" }}>
                            {draftPick ? `${draftPick.round}.${draftPick.pickNumber} (${draftPick.overallPick})` : "-"}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {/* Teams Tab */}
            {rightPanelTab === "teams" && (
              <div>
                {draftState.statsSeason && (
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                    Stats shown: {draftState.statsSeason}
                  </div>
                )}

                {/* Search */}
                <input
                  type="text"
                  value={teamSearchTerm}
                  onChange={(e) => setTeamSearchTerm(e.target.value)}
                  placeholder="Search teams..."
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    color: "var(--text-main)",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    marginBottom: "0.75rem",
                  }}
                />

                {/* Filters */}
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <button
                      onClick={() => setLeagueFilterOpen(!leagueFilterOpen)}
                      style={{
                        width: "100%",
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        color: "var(--text-main)",
                        padding: "0.5rem 0.75rem",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{leagueFilter}</span>
                      <span>{leagueFilterOpen ? "▲" : "▼"}</span>
                    </button>
                    {leagueFilterOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          marginTop: "0.25rem",
                          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                          borderRadius: "6px",
                          padding: "0.25rem 0",
                          border: "1px solid rgba(255,255,255,0.1)",
                          boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                          zIndex: 1000,
                        }}
                      >
                        {(["All", "Foundation", "Academy", "Champion", "Master", "Premier"] as const).map((filter) => (
                          <button
                            key={filter}
                            onClick={() => {
                              setLeagueFilter(filter);
                              setLeagueFilterOpen(false);
                            }}
                            style={{
                              width: "100%",
                              padding: "0.5rem 0.75rem",
                              background: filter === leagueFilter ? "rgba(255,255,255,0.1)" : "transparent",
                              border: "none",
                              color: "var(--text-main)",
                              textAlign: "left",
                              cursor: "pointer",
                              fontWeight: 600,
                              fontSize: "0.85rem",
                            }}
                          >
                            {filter}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ position: "relative", flex: 1 }}>
                    <button
                      onClick={() => setModeFilterOpen(!modeFilterOpen)}
                      style={{
                        width: "100%",
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        color: "var(--text-main)",
                        padding: "0.5rem 0.75rem",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{modeFilter}</span>
                      <span>{modeFilterOpen ? "▲" : "▼"}</span>
                    </button>
                    {modeFilterOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          marginTop: "0.25rem",
                          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                          borderRadius: "6px",
                          padding: "0.25rem 0",
                          border: "1px solid rgba(255,255,255,0.1)",
                          boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                          zIndex: 1000,
                        }}
                      >
                        {(["Both", "2s", "3s"] as const).map((filter) => (
                          <button
                            key={filter}
                            onClick={() => {
                              setModeFilter(filter);
                              setModeFilterOpen(false);
                            }}
                            style={{
                              width: "100%",
                              padding: "0.5rem 0.75rem",
                              background: filter === modeFilter ? "rgba(255,255,255,0.1)" : "transparent",
                              border: "none",
                              color: "var(--text-main)",
                              textAlign: "left",
                              cursor: "pointer",
                              fontWeight: 600,
                              fontSize: "0.85rem",
                            }}
                          >
                            {filter}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {filteredAvailableTeams.map((team) => {
                    const queued = myDraftQueue.some((t) => t.id === team.id);
                    return (
                      <div
                        key={team.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.75rem",
                          background: "rgba(255,255,255,0.05)",
                          borderRadius: "6px",
                        }}
                      >
                        <Image
                          src={team.logoPath}
                          alt={team.name}
                          width={28}
                          height={28}
                          onClick={() => {
                            setSelectedTeam(team);
                            setShowModal(true);
                          }}
                          style={{ cursor: "pointer", borderRadius: "4px" }}
                        />
                        <div
                          onClick={() => {
                            setSelectedTeam(team);
                            setShowModal(true);
                          }}
                          style={{ flex: 1, cursor: "pointer" }}
                        >
                          <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>
                            {team.leagueId} {team.name}
                          </div>
                          {team.stats ? (
                            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                              {team.stats.fpts} fpts · {team.stats.gameRecord}
                            </div>
                          ) : (
                            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>No last-season stats</div>
                          )}
                        </div>
                        {isMyTurn ? (
                          <button
                            onClick={() => handlePickTeam(team)}
                            style={{
                              padding: "0.4rem 0.75rem",
                              background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                              border: "none",
                              borderRadius: "6px",
                              color: "#ffffff",
                              fontWeight: 600,
                              fontSize: "0.8rem",
                              cursor: "pointer",
                              boxShadow: "0 2px 6px rgba(34, 197, 94, 0.3)",
                            }}
                          >
                            Pick
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAddToQueue(team)}
                            disabled={queued}
                            style={{
                              padding: "0.4rem 0.75rem",
                              background: queued ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #d4af37 0%, #f2b632 100%)",
                              border: "none",
                              borderRadius: "6px",
                              color: queued ? "var(--text-muted)" : "#1a1a2e",
                              fontWeight: 600,
                              fontSize: "0.8rem",
                              cursor: queued ? "default" : "pointer",
                              boxShadow: queued ? "none" : "0 2px 6px rgba(212, 175, 55, 0.3)",
                            }}
                          >
                            {queued ? "Queued" : "Queue"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {filteredAvailableTeams.length === 0 && (
                    <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                      No teams match this filter.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Queue Tab */}
            {rightPanelTab === "queue" && (
              <div>
                {myDraftQueue.length === 0 ? (
                  <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--text-muted)" }}>
                    <p style={{ marginBottom: "0.5rem", fontWeight: 600 }}>No teams in queue</p>
                    <p style={{ fontSize: "0.85rem" }}>Click &quot;Queue&quot; on teams to add them to your draft queue</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {myDraftQueue.map((team, idx) => (
                      <div
                        key={team.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                          padding: "0.75rem",
                          background: "rgba(255,255,255,0.05)",
                          borderRadius: "6px",
                          border: "1px solid rgba(255,255,255,0.1)",
                        }}
                      >
                        <div style={{
                          width: "24px",
                          height: "24px",
                          borderRadius: "50%",
                          background: "var(--accent)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color: "#000",
                          flexShrink: 0,
                        }}>
                          {idx + 1}
                        </div>
                        <Image
                          src={team.logoPath}
                          alt={team.name}
                          width={24}
                          height={24}
                          style={{ borderRadius: "4px", cursor: "pointer" }}
                          onClick={() => {
                            setSelectedTeam(team);
                            setShowModal(true);
                          }}
                        />
                        <span
                          onClick={() => {
                            setSelectedTeam(team);
                            setShowModal(true);
                          }}
                          style={{ flex: 1, fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)", cursor: "pointer" }}
                        >
                          {team.leagueId} {team.name}
                        </span>

                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                          <button
                            onClick={() => handleMoveQueueUp(idx)}
                            disabled={idx === 0}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: idx === 0 ? "rgba(255,255,255,0.2)" : "var(--text-muted)",
                              cursor: idx === 0 ? "not-allowed" : "pointer",
                              fontSize: "0.8rem",
                              padding: "0",
                              lineHeight: 1,
                            }}
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => handleMoveQueueDown(idx)}
                            disabled={idx === myDraftQueue.length - 1}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: idx === myDraftQueue.length - 1 ? "rgba(255,255,255,0.2)" : "var(--text-muted)",
                              cursor: idx === myDraftQueue.length - 1 ? "not-allowed" : "pointer",
                              fontSize: "0.8rem",
                              padding: "0",
                              lineHeight: 1,
                            }}
                          >
                            ▼
                          </button>
                        </div>

                        <button
                          onClick={() => handleRemoveFromQueue(idx)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--text-muted)",
                            cursor: "pointer",
                            fontSize: "1.2rem",
                            padding: "0.25rem",
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
