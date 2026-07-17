"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { LEAGUE_COLORS } from "@/lib/teams";
import TeamModal from "@/components/TeamModal";

// Helper function to get fantasy rank color
const getFantasyRankColor = (rank: number): string => {
  if (rank >= 1 && rank <= 12) return "#ef4444"; // red
  if (rank >= 13 && rank <= 24) return "#9ca3af"; // gray
  if (rank >= 25 && rank <= 32) return "#22c55e"; // green
  return "#9ca3af"; // default gray
};

type MLETeam = {
  id: string;
  name: string;
  leagueId: string;
  slug: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
};

type RosterSlot = {
  id: string;
  position: string;
  slotIndex: number;
  fantasyPoints: number;
  isLocked: boolean;
  mleTeam: MLETeam | null;
};

type TeamData = {
  id: string;
  teamName: string;
  managerName: string;
  managerId: string;
  record: string;
  standing: string;
  score: number;
  roster: RosterSlot[];
};

type Matchup = {
  id: string;
  week: number;
  team1: TeamData;
  team2: TeamData;
};

export default function ScoreboardPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const leagueId = params.LeagueID as string;
  const { data: session } = useSession();

  // Whether the initial week came from an explicit ?week= deep link — if so,
  // that choice is respected and never overridden by the current-week sync
  // below.
  const hasWeekParam = useRef(searchParams.get("week") !== null);

  const [currentWeek, setCurrentWeek] = useState(() => {
    const weekParam = searchParams.get("week");
    if (weekParam) {
      const weekNum = parseInt(weekParam);
      if (!isNaN(weekNum) && weekNum >= 1 && weekNum <= 10) {
        return weekNum;
      }
    }
    return 1;
  });

  const [matchups, setMatchups] = useState<Matchup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper functions for week navigation (weeks 1-10)
  const getNextWeek = (week: number) => {
    if (week >= 10) return 10;
    return week + 1;
  };

  const getPrevWeek = (week: number) => {
    if (week <= 1) return 1;
    return week - 1;
  };

  const [selectedMatchup, setSelectedMatchup] = useState<string | null>(() => {
    const matchupParam = searchParams.get("matchup");
    return matchupParam || null;
  });

  const [showModal, setShowModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<MLETeam | null>(null);
  const [selectedTeamRosteredBy, setSelectedTeamRosteredBy] = useState<
    { rosterName: string; managerName: string } | undefined
  >(undefined);
  const [moveMode, setMoveMode] = useState(false);
  const [selectedTeamIndex, setSelectedTeamIndex] = useState<number | null>(
    null
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Fetch matchups for current week
  useEffect(() => {
    async function fetchMatchups() {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/leagues/${leagueId}/scoreboard?week=${currentWeek}`
        );
        if (!response.ok) throw new Error("Failed to fetch matchups");

        const data = await response.json();
        setMatchups(data.matchups);
        setError(null);

        // Snap to the league's real current week on first load only, and
        // only when the URL didn't explicitly request a week.
        if (
          !hasWeekParam.current &&
          currentWeek === 1 &&
          data.league?.currentWeek &&
          data.league.currentWeek !== 1
        ) {
          setCurrentWeek(data.league.currentWeek);
        }
      } catch (err) {
        console.error("Error fetching matchups:", err);
        setError("Failed to load matchups");
      } finally {
        setLoading(false);
      }
    }

    fetchMatchups();
  }, [leagueId, currentWeek]);

  const selectedMatch = matchups.find((m) => m.id === selectedMatchup);

  // Type for roster team - this matches the slot structure from API
  type RosterTeam = RosterSlot;

  // Keep rosters in their original positions - team1 on left, team2 on right
  const [team1Roster, setTeam1Roster] = useState<RosterTeam[]>([]);
  const [team2Roster, setTeam2Roster] = useState<RosterTeam[]>([]);

  // Update rosters when selectedMatch changes
  useEffect(() => {
    if (selectedMatch) {
      setTeam1Roster([...selectedMatch.team1.roster]);
      setTeam2Roster([...selectedMatch.team2.roster]);
    } else {
      setTeam1Roster([]);
      setTeam2Roster([]);
    }
    // Reset unsaved changes when switching matchups
    setHasUnsavedChanges(false);
    setSaveMessage(null);
  }, [selectedMatch?.id]); // Only re-run when the match ID changes

  const handleManagerClick = (teamId: string) => {
    router.push(`/leagues/${leagueId}/opponents?teamId=${teamId}`);
  };

  const handleMoveToggle = async () => {
    if (moveMode && hasUnsavedChanges) {
      // Save changes when exiting move mode
      await handleSaveRoster();
    }
    setMoveMode(!moveMode);
    setSelectedTeamIndex(null);
  };

  const handleTeamClick = (index: number, isTeam1Side: boolean) => {
    if (!moveMode) return;
    if (!selectedMatch || !session?.user?.id) return;

    // Check if user can edit this side
    const isUserTeam1 = session.user.id === selectedMatch.team1.managerId;
    const canEdit = (isTeam1Side && isUserTeam1) || (!isTeam1Side && !isUserTeam1);
    if (!canEdit) return;

    // Get the correct roster
    const currentRoster = isTeam1Side ? team1Roster : team2Roster;
    const setRoster = isTeam1Side ? setTeam1Roster : setTeam2Roster;

    const slot = currentRoster[index];
    if (!slot.mleTeam) return; // Can't select empty slots

    if (selectedTeamIndex === null) {
      // First click - select the team
      setSelectedTeamIndex(index);
    } else if (selectedTeamIndex === index) {
      // Clicking the same team - deselect
      setSelectedTeamIndex(null);
    } else {
      // Second click - swap the teams but keep slots static
      const newRoster = [...currentRoster];
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
      };
      newRoster[index] = { ...newRoster[index], position: team2Slot };

      setRoster(newRoster);
      setSelectedTeamIndex(null);
      setHasUnsavedChanges(true);
      setSaveMessage(null); // Clear any previous save messages
    }
  };

  const openTeamModal = (
    team: MLETeam | null,
    rosteredBy?: { rosterName: string; managerName: string }
  ) => {
    if (!team) return;
    setSelectedTeam(team);
    setSelectedTeamRosteredBy(rosteredBy);
    setShowModal(true);
  };

  const handleSaveRoster = async () => {
    if (!selectedMatch || !session?.user?.id) return;

    // Determine which team is the user's
    const isUserTeam1 = session.user.id === selectedMatch.team1.managerId;
    const userFantasyTeamId = isUserTeam1
      ? selectedMatch.team1.id
      : selectedMatch.team2.id;
    const userRoster = isUserTeam1 ? team1Roster : team2Roster;

    try {
      setIsSaving(true);
      setSaveMessage(null);

      const response = await fetch(
        `/api/leagues/${leagueId}/roster/update`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fantasyTeamId: userFantasyTeamId,
            week: currentWeek,
            roster: userRoster,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save roster");
      }

      setSaveMessage({ type: "success", text: "Lineup saved successfully!" });
      setHasUnsavedChanges(false);

      // Clear success message after 3 seconds
      setTimeout(() => {
        setSaveMessage(null);
      }, 3000);
    } catch (error) {
      console.error("Error saving roster:", error);
      setSaveMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to save lineup",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getTopPerformers = (roster: RosterSlot[]) => {
    return roster
      .filter((p) => p.mleTeam && p.fantasyPoints > 0)
      .sort((a, b) => b.fantasyPoints - a.fantasyPoints)
      .slice(0, 2);
  };

  const getToPlayCount = (roster: RosterSlot[]) => {
    return roster.filter((p) => !p.isLocked || p.fantasyPoints === 0).length;
  };

  const getTeamColor = (
    team1Score: number,
    team2Score: number,
    isTeam1: boolean
  ) => {
    if (team1Score === team2Score) return "#ffffff"; // Tie - white
    if (isTeam1) {
      return team1Score > team2Score ? "#d4af37" : "#808080"; // Gold if winning, gray if losing
    } else {
      return team2Score > team1Score ? "#d4af37" : "#808080"; // Gold if winning, gray if losing
    }
  };

  if (selectedMatch) {
    // Matchup Detail View
    const toPlay1 = getToPlayCount(team1Roster);
    const toPlay2 = getToPlayCount(team2Roster);
    const total1 = team1Roster.length;
    const total2 = team2Roster.length;

    // Check if current user is in this matchup
    const currentUserId = session?.user?.id;
    const isUserTeam1 = currentUserId === selectedMatch.team1.managerId;
    const isUserTeam2 = currentUserId === selectedMatch.team2.managerId;
    const isUserInMatchup = isUserTeam1 || isUserTeam2;

    return (
      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Team Stats Modal */}
        <TeamModal
          team={
            showModal && selectedTeam
              ? {
                  ...selectedTeam,
                  status: "rostered",
                  rosteredBy: selectedTeamRosteredBy,
                }
              : null
          }
          onClose={() => setShowModal(false)}
        />

        <div style={{ marginBottom: "2rem" }}>
          <button
            onClick={() => setSelectedMatchup(null)}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#ffffff",
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.9rem",
              marginBottom: "1rem",
            }}
          >
            ← Back to Scoreboard
          </button>
          <h1 className="page-heading" style={{ color: "#d4af37" }}>
            Matchup
          </h1>
        </div>

        <section
          style={{
            background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
            borderRadius: "12px",
            padding: "2rem",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {/* Team Headers */}
          <div
            className="matchup-hero-grid"
            style={{
              alignItems: "start",
              marginBottom: "2rem",
              paddingBottom: "2rem",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {/* Team 1 (Left) */}
            <div>
              <h2
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: getTeamColor(selectedMatch.team1.score, selectedMatch.team2.score, true),
                  marginBottom: "0.25rem",
                  cursor: isUserTeam1 ? "default" : "pointer",
                  transition: "color 0.2s",
                }}
                onClick={!isUserTeam1 ? () => handleManagerClick(selectedMatch.team1.id) : undefined}
                onMouseEnter={!isUserTeam1 ? (e) =>
                  (e.currentTarget.style.color = "var(--accent)") : undefined
                }
                onMouseLeave={!isUserTeam1 ? (e) =>
                  (e.currentTarget.style.color = getTeamColor(
                    selectedMatch.team1.score,
                    selectedMatch.team2.score,
                    true
                  )) : undefined
                }
              >
                {selectedMatch.team1.teamName}
                {isUserTeam1 && (
                  <span
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--accent)",
                      marginLeft: "0.5rem",
                      fontWeight: 500,
                    }}
                  >
                    (You)
                  </span>
                )}
              </h2>
              <p
                style={{
                  color: "rgba(255,255,255,0.6)",
                  fontSize: "0.9rem",
                  margin: 0,
                  cursor: isUserTeam1 ? "default" : "pointer",
                  transition: "color 0.2s",
                }}
                onClick={!isUserTeam1 ? () => handleManagerClick(selectedMatch.team1.id) : undefined}
                onMouseEnter={!isUserTeam1 ? (e) =>
                  (e.currentTarget.style.color = "var(--accent)") : undefined
                }
                onMouseLeave={!isUserTeam1 ? (e) =>
                  (e.currentTarget.style.color = "rgba(255,255,255,0.6)") : undefined
                }
              >
                {selectedMatch.team1.managerName}
              </p>
              <p
                style={{
                  color: "rgba(255,255,255,0.5)",
                  fontSize: "0.85rem",
                  margin: 0,
                }}
              >
                {selectedMatch.team1.record} {selectedMatch.team1.standing}
              </p>

              {/* Progress Bar */}
              <div style={{ marginTop: "1rem" }}>
                <div
                  style={{
                    height: "30px",
                    background: "rgba(255,255,255,0.1)",
                    borderRadius: "15px",
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      width: `${((total1 - toPlay1) / total1) * 100}%`,
                      height: "100%",
                      background:
                        "linear-gradient(90deg, #4CAF50 0%, #45a049 100%)",
                      transition: "width 0.3s ease",
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      color: "#ffffff",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                  >
                    To Play: {toPlay1}
                  </span>
                </div>
              </div>
            </div>

            {/* Scores with VS */}
            <div
              style={{
                display: "flex",
                gap: "1.5rem",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontSize: "clamp(2.2rem, 10vw, 4rem)",
                  fontWeight: 700,
                  color: getTeamColor(
                    selectedMatch.team1.score,
                    selectedMatch.team2.score,
                    true
                  ),
                }}
              >
                {selectedMatch.team1.score}
              </span>
              <span
                style={{
                  fontSize: "1.2rem",
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.6)",
                  marginTop: "0.5rem",
                }}
              >
                vs.
              </span>
              <span
                style={{
                  fontSize: "clamp(2.2rem, 10vw, 4rem)",
                  fontWeight: 700,
                  color: getTeamColor(
                    selectedMatch.team1.score,
                    selectedMatch.team2.score,
                    false
                  ),
                }}
              >
                {selectedMatch.team2.score}
              </span>
            </div>

            {/* Team 2 (Right) */}
            <div style={{ textAlign: "right" }}>
              <h2
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: getTeamColor(
                    selectedMatch.team1.score,
                    selectedMatch.team2.score,
                    false
                  ),
                  marginBottom: "0.25rem",
                  cursor: isUserTeam2 ? "default" : "pointer",
                  transition: "color 0.2s",
                }}
                onClick={!isUserTeam2 ? () =>
                  handleManagerClick(selectedMatch.team2.id) : undefined
                }
                onMouseEnter={!isUserTeam2 ? (e) =>
                  (e.currentTarget.style.color = "var(--accent)") : undefined
                }
                onMouseLeave={!isUserTeam2 ? (e) =>
                  (e.currentTarget.style.color = getTeamColor(
                    selectedMatch.team1.score,
                    selectedMatch.team2.score,
                    false
                  )) : undefined
                }
              >
                {selectedMatch.team2.teamName}
                {isUserTeam2 && (
                  <span
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--accent)",
                      marginLeft: "0.5rem",
                      fontWeight: 500,
                    }}
                  >
                    (You)
                  </span>
                )}
              </h2>
              <p
                style={{
                  color: "rgba(255,255,255,0.6)",
                  fontSize: "0.9rem",
                  margin: 0,
                  cursor: isUserTeam2 ? "default" : "pointer",
                  transition: "color 0.2s",
                }}
                onClick={!isUserTeam2 ? () =>
                  handleManagerClick(selectedMatch.team2.id) : undefined
                }
                onMouseEnter={!isUserTeam2 ? (e) =>
                  (e.currentTarget.style.color = "var(--accent)") : undefined
                }
                onMouseLeave={!isUserTeam2 ? (e) =>
                  (e.currentTarget.style.color = "rgba(255,255,255,0.6)") : undefined
                }
              >
                {selectedMatch.team2.managerName}
              </p>
              <p
                style={{
                  color: "rgba(255,255,255,0.5)",
                  fontSize: "0.85rem",
                  margin: 0,
                }}
              >
                {selectedMatch.team2.record} {selectedMatch.team2.standing}
              </p>

              {/* Progress Bar */}
              <div style={{ marginTop: "1rem" }}>
                <div
                  style={{
                    height: "30px",
                    background: "rgba(255,255,255,0.1)",
                    borderRadius: "15px",
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      width: `${((total2 - toPlay2) / total2) * 100}%`,
                      height: "100%",
                      background:
                        "linear-gradient(90deg, #4CAF50 0%, #45a049 100%)",
                      transition: "width 0.3s ease",
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      color: "#ffffff",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                  >
                    To Play: {toPlay2}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Edit Lineup Button - Only show if user is in this matchup */}
          {isUserInMatchup && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "1rem",
                marginTop: "1.5rem",
                marginBottom: "1rem",
              }}
            >
              <button
                onClick={handleMoveToggle}
                disabled={isSaving}
                className={moveMode ? "btn btn-primary" : "btn btn-ghost"}
                style={{
                  fontSize: "0.9rem",
                  border: "2px solid var(--accent)",
                  boxShadow: moveMode
                    ? "0 0 12px rgba(242, 182, 50, 0.4)"
                    : "0 0 8px rgba(242, 182, 50, 0.3)",
                  opacity: isSaving ? 0.6 : 1,
                  cursor: isSaving ? "not-allowed" : "pointer",
                }}
              >
                {isSaving
                  ? "Saving..."
                  : moveMode
                  ? "✓ Done Editing"
                  : "Edit My Lineup"}
              </button>

              {/* Save Message */}
              {saveMessage && (
                <div
                  style={{
                    padding: "0.75rem 1.5rem",
                    backgroundColor:
                      saveMessage.type === "success"
                        ? "rgba(76, 175, 80, 0.2)"
                        : "rgba(239, 68, 68, 0.2)",
                    border: `1px solid ${
                      saveMessage.type === "success"
                        ? "rgba(76, 175, 80, 0.4)"
                        : "rgba(239, 68, 68, 0.4)"
                    }`,
                    borderRadius: "8px",
                    color:
                      saveMessage.type === "success" ? "#4CAF50" : "#ef4444",
                    fontSize: "0.9rem",
                    fontWeight: 600,
                  }}
                >
                  {saveMessage.text}
                </div>
              )}
            </div>
          )}

          {/* Move Mode Instructions */}
          {moveMode && (
            <div
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "rgba(242, 182, 50, 0.1)",
                border: "1px solid rgba(242, 182, 50, 0.3)",
                borderRadius: "8px",
                color: "var(--accent)",
                fontSize: "0.9rem",
                fontWeight: 600,
                textAlign: "center",
                marginBottom: "1rem",
              }}
            >
              {selectedTeamIndex === null
                ? "Click on a team in your roster to select it, then click on another team to swap positions"
                : "Click on another team to swap positions, or click the selected team to deselect"}
            </div>
          )}

          {/* Roster Breakdown */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {team1Roster.map((slot1, idx) => {
              const slot2 = team2Roster[idx];
              const isSelected = selectedTeamIndex === idx;
              const baseBackground =
                idx % 2 === 0 ? "rgba(255,255,255,0.05)" : "transparent";

              // Determine if each side is clickable
              const canEditTeam1 = isUserTeam1 && moveMode;
              const canEditTeam2 = isUserTeam2 && moveMode;

              return (
                <div
                  key={idx}
                  className="matchup-row-grid"
                  style={{
                    alignItems: "center",
                    padding: "0.75rem 1rem",
                    background: baseBackground,
                    borderRadius: "6px",
                  }}
                >
                  {/* Team 1 Player - Clickable if user owns team1 */}
                  <div
                    onClick={() => canEditTeam1 && handleTeamClick(idx, true)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      cursor: canEditTeam1 && slot1.mleTeam ? "pointer" : "default",
                      padding: "0.5rem",
                      borderRadius: "6px",
                      background: isSelected && canEditTeam1
                        ? "rgba(242, 182, 50, 0.2)"
                        : "transparent",
                      borderLeft: isSelected && canEditTeam1
                        ? "3px solid var(--accent)"
                        : "3px solid transparent",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      if (canEditTeam1 && !isSelected && slot1.mleTeam) {
                        e.currentTarget.style.background =
                          "rgba(242, 182, 50, 0.1)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (canEditTeam1 && !isSelected) {
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    {slot1.mleTeam ? (
                      <>
                        <Image
                          src={slot1.mleTeam.logoPath}
                          alt={slot1.mleTeam.name}
                          width={30}
                          height={30}
                          style={{ borderRadius: "4px" }}
                        />
                        <div style={{ flex: 1 }}>
                          <div
                            onClick={(e) => {
                              if (!canEditTeam1) {
                                e.stopPropagation();
                                openTeamModal(
                                  slot1.mleTeam,
                                  selectedMatch
                                    ? {
                                        rosterName: selectedMatch.team1.teamName,
                                        managerName: selectedMatch.team1.managerName,
                                      }
                                    : undefined
                                );
                              }
                            }}
                            style={{
                              color: "#ffffff",
                              fontSize: "0.95rem",
                              fontWeight: 500,
                              cursor: canEditTeam1 ? "default" : "pointer",
                              transition: "color 0.2s",
                            }}
                            onMouseEnter={(e) => {
                              if (!canEditTeam1) {
                                e.currentTarget.style.color = "var(--accent)";
                              }
                            }}
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.color = "#ffffff")
                            }
                          >
                            {slot1.mleTeam.leagueId} {slot1.mleTeam.name}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div
                        style={{
                          color: "rgba(255,255,255,0.4)",
                          fontSize: "0.95rem",
                          fontStyle: "italic",
                        }}
                      >
                        Empty
                      </div>
                    )}
                  </div>

                  {/* Team 1 Points */}
                  <div
                    style={{
                      color: slot1.mleTeam ? "#d4af37" : "rgba(255,255,255,0.3)",
                      fontSize: "1.1rem",
                      fontWeight: 600,
                      textAlign: "right",
                    }}
                  >
                    {slot1.mleTeam ? slot1.fantasyPoints.toFixed(1) : "-"}
                  </div>

                  {/* Position */}
                  <div
                    style={{
                      color: "rgba(255,255,255,0.5)",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      minWidth: "50px",
                      textAlign: "center",
                    }}
                  >
                    {slot1.position === "be" || slot1.position === "flx" ? slot1.position.toUpperCase() : slot1.position}
                  </div>

                  {/* Team 2 Points */}
                  <div
                    style={{
                      color: slot2.mleTeam ? "#d4af37" : "rgba(255,255,255,0.3)",
                      fontSize: "1.1rem",
                      fontWeight: 600,
                      textAlign: "left",
                    }}
                  >
                    {slot2.mleTeam ? slot2.fantasyPoints.toFixed(1) : "-"}
                  </div>

                  {/* Team 2 Player - Clickable if user owns team2 */}
                  <div
                    onClick={() => canEditTeam2 && handleTeamClick(idx, false)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      justifyContent: "flex-end",
                      cursor: canEditTeam2 && slot2.mleTeam ? "pointer" : "default",
                      padding: "0.5rem",
                      borderRadius: "6px",
                      background: isSelected && canEditTeam2
                        ? "rgba(242, 182, 50, 0.2)"
                        : "transparent",
                      borderRight: isSelected && canEditTeam2
                        ? "3px solid var(--accent)"
                        : "3px solid transparent",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      if (canEditTeam2 && !isSelected && slot2.mleTeam) {
                        e.currentTarget.style.background =
                          "rgba(242, 182, 50, 0.1)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (canEditTeam2 && !isSelected) {
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    {slot2.mleTeam ? (
                      <>
                        <div style={{ flex: 1, textAlign: "right" }}>
                          <div
                            onClick={(e) => {
                              if (!canEditTeam2) {
                                e.stopPropagation();
                                openTeamModal(
                                  slot2.mleTeam,
                                  selectedMatch
                                    ? {
                                        rosterName: selectedMatch.team2.teamName,
                                        managerName: selectedMatch.team2.managerName,
                                      }
                                    : undefined
                                );
                              }
                            }}
                            style={{
                              color: "#ffffff",
                              fontSize: "0.95rem",
                              fontWeight: 500,
                              cursor: canEditTeam2 ? "default" : "pointer",
                              transition: "color 0.2s",
                            }}
                            onMouseEnter={(e) => {
                              if (!canEditTeam2) {
                                e.currentTarget.style.color = "var(--accent)";
                              }
                            }}
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.color = "#ffffff")
                            }
                          >
                            {slot2.mleTeam.leagueId} {slot2.mleTeam.name}
                          </div>
                        </div>
                        <Image
                          src={slot2.mleTeam.logoPath}
                          alt={slot2.mleTeam.name}
                          width={30}
                          height={30}
                          style={{ borderRadius: "4px" }}
                        />
                      </>
                    ) : (
                      <div
                        style={{
                          color: "rgba(255,255,255,0.4)",
                          fontSize: "0.95rem",
                          fontStyle: "italic",
                        }}
                      >
                        Empty
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  // Scoreboard View
  return (
    <>
      {/* Team Stats Modal */}
      <TeamModal
        team={
          showModal && selectedTeam
            ? {
                ...selectedTeam,
                status: "rostered",
                rosteredBy: selectedTeamRosteredBy,
              }
            : null
        }
        onClose={() => setShowModal(false)}
      />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          justifyContent: "space-between",
          alignItems: "center",
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
          Scoreboard
        </h1>

        {/* Week Navigation */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "1rem",
          }}
        >
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
      </div>

      {loading ? (
        <div style={{ padding: "4rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>
            Loading matchups...
          </p>
        </div>
      ) : error ? (
        <div style={{ padding: "4rem", textAlign: "center" }}>
          <p style={{ color: "#ef4444", fontSize: "1.1rem" }}>{error}</p>
        </div>
      ) : matchups.length === 0 ? (
        <div style={{ padding: "4rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>
            No matchups scheduled for Week {currentWeek}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {matchups.map((matchup) => {
            const team1TopPerformers = getTopPerformers(matchup.team1.roster);
            const team2TopPerformers = getTopPerformers(matchup.team2.roster);

            // Check if current user is in this matchup
            const currentUserId = session?.user?.id;
            const isUserTeam1 = currentUserId === matchup.team1.managerId;
            const isUserTeam2 = currentUserId === matchup.team2.managerId;

            return (
              <section
                key={matchup.id}
                className="matchup-detail-grid"
                style={{
                  background:
                    "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                  borderRadius: "12px",
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.1)",
                  alignItems: "center",
                  padding: "1.5rem",
                }}
              >
                {/* Left Side - Teams and Scores */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "1rem",
                    minWidth: "250px",
                  }}
                >
                  {/* Team 1 */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <h2
                        style={{
                          fontSize: "1.2rem",
                          fontWeight: 700,
                          color: getTeamColor(
                            matchup.team1.score,
                            matchup.team2.score,
                            true
                          ),
                          marginBottom: "0.25rem",
                          cursor: isUserTeam1 ? "default" : "pointer",
                          transition: "color 0.2s",
                        }}
                        onClick={!isUserTeam1 ? () =>
                          handleManagerClick(matchup.team1.id) : undefined
                        }
                        onMouseEnter={!isUserTeam1 ? (e) =>
                          (e.currentTarget.style.color = "var(--accent)") : undefined
                        }
                        onMouseLeave={!isUserTeam1 ? (e) =>
                          (e.currentTarget.style.color = getTeamColor(
                            matchup.team1.score,
                            matchup.team2.score,
                            true
                          )) : undefined
                        }
                      >
                        {matchup.team1.teamName}
                        {isUserTeam1 && (
                          <span
                            style={{
                              fontSize: "0.7rem",
                              color: "var(--accent)",
                              marginLeft: "0.5rem",
                              fontWeight: 500,
                            }}
                          >
                            (You)
                          </span>
                        )}
                      </h2>
                      <p
                        style={{
                          color: "rgba(255,255,255,0.6)",
                          fontSize: "0.8rem",
                          margin: 0,
                        }}
                      >
                        <span
                          onClick={!isUserTeam1 ? () =>
                            handleManagerClick(matchup.team1.id) : undefined
                          }
                          onMouseEnter={!isUserTeam1 ? (e) =>
                            (e.currentTarget.style.color = "var(--accent)") : undefined
                          }
                          onMouseLeave={!isUserTeam1 ? (e) =>
                            (e.currentTarget.style.color =
                              "rgba(255,255,255,0.6)") : undefined
                          }
                          style={{
                            cursor: isUserTeam1 ? "default" : "pointer",
                            color: "rgba(255,255,255,0.6)",
                            transition: "color 0.2s",
                          }}
                        >
                          {matchup.team1.managerName}
                        </span>{" "}
                        {matchup.team1.record} {matchup.team1.standing}
                      </p>
                    </div>
                    <div
                      style={{
                        fontSize: "clamp(1.6rem, 8vw, 2.5rem)",
                        fontWeight: 700,
                        color: getTeamColor(
                          matchup.team1.score,
                          matchup.team2.score,
                          true
                        ),
                        marginLeft: "2rem",
                      }}
                    >
                      {matchup.team1.score.toFixed(1)}
                    </div>
                  </div>
                  {/* Team 1 Top Performers */}
                  <div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.7)",
                        fontSize: "0.75rem",
                        marginBottom: "0.5rem",
                        fontWeight: 600,
                      }}
                    >
                      Top performers
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
                      {team1TopPerformers.length > 0 ? (
                        team1TopPerformers.map((slot, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                              flex: 1,
                            }}
                          >
                            {slot.mleTeam && (
                              <>
                                <Image
                                  src={slot.mleTeam.logoPath}
                                  alt={slot.mleTeam.name}
                                  width={20}
                                  height={20}
                                  style={{ borderRadius: "4px" }}
                                />
                                <span
                                  onClick={() =>
                                    openTeamModal(slot.mleTeam, {
                                      rosterName: matchup.team1.teamName,
                                      managerName: matchup.team1.managerName,
                                    })
                                  }
                                  style={{
                                    color: "#ffffff",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                    transition: "color 0.2s",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.color =
                                      "var(--accent)")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.color = "#ffffff")
                                  }
                                >
                                  {slot.mleTeam.leagueId} {slot.mleTeam.name}
                                </span>
                                <span
                                  style={{
                                    color: "rgba(255,255,255,0.5)",
                                    fontSize: "0.7rem",
                                  }}
                                >
                                  {slot.position.toUpperCase()}
                                </span>
                                <span
                                  style={{
                                    color:
                                      slot.mleTeam.leagueId in LEAGUE_COLORS
                                        ? LEAGUE_COLORS[
                                            slot.mleTeam
                                              .leagueId as keyof typeof LEAGUE_COLORS
                                          ]
                                        : "#4da6ff",
                                    fontSize: "0.9rem",
                                    fontWeight: 600,
                                  }}
                                >
                                  {slot.fantasyPoints.toFixed(1)}
                                </span>
                              </>
                            )}
                          </div>
                        ))
                      ) : (
                        <div
                          style={{
                            color: "rgba(255,255,255,0.4)",
                            fontSize: "0.85rem",
                            fontStyle: "italic",
                          }}
                        >
                          No scores yet
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Team 2 */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <h2
                        style={{
                          fontSize: "1.2rem",
                          fontWeight: 700,
                          color: getTeamColor(
                            matchup.team1.score,
                            matchup.team2.score,
                            false
                          ),
                          marginBottom: "0.25rem",
                          cursor: isUserTeam2 ? "default" : "pointer",
                          transition: "color 0.2s",
                        }}
                        onClick={!isUserTeam2 ? () =>
                          handleManagerClick(matchup.team2.id) : undefined
                        }
                        onMouseEnter={!isUserTeam2 ? (e) =>
                          (e.currentTarget.style.color = "var(--accent)") : undefined
                        }
                        onMouseLeave={!isUserTeam2 ? (e) =>
                          (e.currentTarget.style.color = getTeamColor(
                            matchup.team1.score,
                            matchup.team2.score,
                            false
                          )) : undefined
                        }
                      >
                        {matchup.team2.teamName}
                        {isUserTeam2 && (
                          <span
                            style={{
                              fontSize: "0.7rem",
                              color: "var(--accent)",
                              marginLeft: "0.5rem",
                              fontWeight: 500,
                            }}
                          >
                            (You)
                          </span>
                        )}
                      </h2>
                      <p
                        style={{
                          color: "rgba(255,255,255,0.6)",
                          fontSize: "0.8rem",
                          margin: 0,
                        }}
                      >
                        <span
                          onClick={!isUserTeam2 ? () =>
                            handleManagerClick(matchup.team2.id) : undefined
                          }
                          onMouseEnter={!isUserTeam2 ? (e) =>
                            (e.currentTarget.style.color = "var(--accent)") : undefined
                          }
                          onMouseLeave={!isUserTeam2 ? (e) =>
                            (e.currentTarget.style.color =
                              "rgba(255,255,255,0.6)") : undefined
                          }
                          style={{
                            cursor: isUserTeam2 ? "default" : "pointer",
                            color: "rgba(255,255,255,0.6)",
                            transition: "color 0.2s",
                          }}
                        >
                          {matchup.team2.managerName}
                        </span>{" "}
                        {matchup.team2.record} {matchup.team2.standing}
                      </p>
                    </div>
                    <div
                      style={{
                        fontSize: "clamp(1.6rem, 8vw, 2.5rem)",
                        fontWeight: 700,
                        color: getTeamColor(
                          matchup.team1.score,
                          matchup.team2.score,
                          false
                        ),
                        marginLeft: "2rem",
                      }}
                    >
                      {matchup.team2.score.toFixed(1)}
                    </div>
                  </div>
                  {/* Team 2 Top Performers */}
                  <div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.7)",
                        fontSize: "0.75rem",
                        marginBottom: "0.5rem",
                        fontWeight: 600,
                      }}
                    >
                      Top performers
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
                      {team2TopPerformers.length > 0 ? (
                        team2TopPerformers.map((slot, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                              flex: 1,
                            }}
                          >
                            {slot.mleTeam && (
                              <>
                                <Image
                                  src={slot.mleTeam.logoPath}
                                  alt={slot.mleTeam.name}
                                  width={20}
                                  height={20}
                                  style={{ borderRadius: "4px" }}
                                />
                                <span
                                  onClick={() =>
                                    openTeamModal(slot.mleTeam, {
                                      rosterName: matchup.team2.teamName,
                                      managerName: matchup.team2.managerName,
                                    })
                                  }
                                  style={{
                                    color: "#ffffff",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                    transition: "color 0.2s",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.color =
                                      "var(--accent)")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.color = "#ffffff")
                                  }
                                >
                                  {slot.mleTeam.leagueId} {slot.mleTeam.name}
                                </span>
                                <span
                                  style={{
                                    color: "rgba(255,255,255,0.5)",
                                    fontSize: "0.7rem",
                                  }}
                                >
                                  {slot.position.toUpperCase()}
                                </span>
                                <span
                                  style={{
                                    color:
                                      slot.mleTeam.leagueId in LEAGUE_COLORS
                                        ? LEAGUE_COLORS[
                                            slot.mleTeam
                                              .leagueId as keyof typeof LEAGUE_COLORS
                                          ]
                                        : "#4da6ff",
                                    fontSize: "0.9rem",
                                    fontWeight: 600,
                                  }}
                                >
                                  {slot.fantasyPoints.toFixed(1)}
                                </span>
                              </>
                            )}
                          </div>
                        ))
                      ) : (
                        <div
                          style={{
                            color: "rgba(255,255,255,0.4)",
                            fontSize: "0.85rem",
                            fontStyle: "italic",
                          }}
                        >
                          No scores yet
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Matchup Button */}
                <div>
                  <button
                    onClick={() => setSelectedMatchup(matchup.id)}
                    style={{
                      background: "rgba(255,255,255,0.15)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      color: "#ffffff",
                      padding: "0.75rem 2rem",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "1rem",
                      fontWeight: 600,
                      transition: "all 0.2s ease",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.25)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.15)";
                    }}
                  >
                    Matchup
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
