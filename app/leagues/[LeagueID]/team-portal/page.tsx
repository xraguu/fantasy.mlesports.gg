"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import TeamModal from "@/components/TeamModal";
import { useAlert } from "@/components/AlertProvider";

interface MLETeam {
  id: string;
  name: string;
  leagueId: string;
  slug: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
}

interface TeamWithStats extends MLETeam {
  rank: number;
  fpts: number;
  avg: number;
  last: number;
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demos: number;
  record: string;
  status: "free-agent" | "waiver" | "rostered";
  rosteredBy?: { rosterName: string; managerName: string };
}

type SortColumn = "rank" | "fpts" | "avg" | "last" | "goals" | "shots" | "saves" | "assists" | "demos";
type SortDirection = "asc" | "desc";

interface RosterData {
  fantasyTeam: {
    id: string;
    displayName: string;
    shortCode: string;
    ownerDisplayName: string;
    waiverPriority: number | null;
    faabRemaining: number | null;
  };
  league: {
    currentWeek: number;
    waiverSystem: string;
    rosterConfig: {
      "2s": number;
      "3s": number;
      flx: number;
      be: number;
    };
  };
  rosterSlots: Array<{
    id: string;
    position: string;
    slotIndex: number;
    fantasyPoints: number | null;
    isLocked: boolean;
    mleTeam: {
      id: string;
      name: string;
      leagueId: string;
      logoPath: string;
    } | null;
  }>;
  record?: {
    wins: number;
    losses: number;
  };
  rank?: number;
}

// SortIcon component defined outside to avoid recreation during render
const SortIcon = ({ column, sortColumn, sortDirection }: { column: SortColumn; sortColumn: SortColumn; sortDirection: SortDirection }) => {
  if (sortColumn !== column) return null;
  return (
    <span style={{ marginLeft: "0.25rem" }}>
      {sortDirection === "asc" ? "▲" : "▼"}
    </span>
  );
};

export default function TeamPortalPage() {
  const showAlert = useAlert();
  const params = useParams();
  const { data: session } = useSession();
  const leagueId = params?.LeagueID as string;

  const [sortColumn, setSortColumn] = useState<SortColumn>("fpts");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedTeam, setSelectedTeam] = useState<TeamWithStats | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [selectedWaiverTeam, setSelectedWaiverTeam] = useState<TeamWithStats | null>(null);
  const [selectedDropTeam, setSelectedDropTeam] = useState<string | null>(null);
  const [submittingWaiver, setSubmittingWaiver] = useState(false);
  const [faabBidInput, setFaabBidInput] = useState("");
  const [showFAConfirmModal, setShowFAConfirmModal] = useState(false);
  const [selectedFATeam, setSelectedFATeam] = useState<TeamWithStats | null>(null);
  const [leagueFilter, setLeagueFilter] = useState<"All" | "Foundation" | "Academy" | "Champion" | "Master" | "Premier">("All");
  const [modeFilter, setModeFilter] = useState<"2s" | "3s">("3s");
  const [leagueFilterOpen, setLeagueFilterOpen] = useState(false);
  const [availabilityFilter, setAvailabilityFilter] = useState<{rostered: boolean; freeAgent: boolean; waivers: boolean}>({
    rostered: false,
    freeAgent: true,
    waivers: true
  });
  const [availabilityFilterOpen, setAvailabilityFilterOpen] = useState(false);

  // Real roster data
  const [rosterData, setRosterData] = useState<RosterData | null>(null);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const draftIncomplete = draftStatus !== null && draftStatus !== "completed";

  // MLE teams data
  const [mleTeams, setMleTeams] = useState<TeamWithStats[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);

  // The waiver/drop modal serves two different flows: an instant free-agent
  // swap (must respect locks, always needs a specific slot to replace) vs a
  // genuine waiver claim on a "waiver"-status team (can target a locked
  // slot — only checked at process time — and can skip picking a drop
  // target entirely if there's an empty slot to land in).
  const isFreeAgentPickup = selectedWaiverTeam?.status === "free-agent";
  const waiverModalRosterConfig = rosterData?.league.rosterConfig;
  const waiverModalTotalSlots = waiverModalRosterConfig
    ? waiverModalRosterConfig["2s"] + waiverModalRosterConfig["3s"] + waiverModalRosterConfig.flx + waiverModalRosterConfig.be
    : 0;
  const waiverModalFilledSlots = rosterData?.rosterSlots.filter((s) => s.mleTeam !== null).length ?? 0;
  const waiverModalHasEmptySlot = waiverModalRosterConfig
    ? waiverModalFilledSlots < waiverModalTotalSlots
    : false;
  // FAAB bidding only applies to real (contested) waiver claims — an
  // instant free-agent pickup never competes with anyone, so no bid needed.
  const isFaabClaim = !isFreeAgentPickup && rosterData?.league.waiverSystem === "faab";

  useEffect(() => {
    setFaabBidInput("");
  }, [selectedWaiverTeam?.id]);

  // Fetch user's team ID for this league
  useEffect(() => {
    const fetchMyTeam = async () => {
      if (!session?.user?.id || !leagueId) return;

      try {
        const response = await fetch(`/api/leagues/${leagueId}`);
        if (response.ok) {
          const data = await response.json();
          const myTeam = data.league?.fantasyTeams?.find(
            (team: any) => team.ownerUserId === session.user.id
          );
          if (myTeam) {
            setMyTeamId(myTeam.id);
          }
          setDraftStatus(data.league?.draftStatus ?? null);
        }
      } catch (error) {
        console.error("Error fetching user's team:", error);
      }
    };

    fetchMyTeam();
  }, [session?.user?.id, leagueId]);

  // Fetch roster data when we have myTeamId
  useEffect(() => {
    const fetchRoster = async () => {
      if (!myTeamId || !leagueId) {
        setLoadingRoster(false);
        return;
      }

      try {
        const response = await fetch(`/api/leagues/${leagueId}/rosters/${myTeamId}`);
        if (response.ok) {
          const data = await response.json();
          setRosterData(data);
        }
      } catch (error) {
        console.error("Error fetching roster:", error);
      } finally {
        setLoadingRoster(false);
      }
    };

    fetchRoster();
  }, [myTeamId, leagueId]);

  // Fetch all MLE teams and check roster status
  useEffect(() => {
    const fetchTeams = async () => {
      if (!session?.user?.id || !leagueId) {
        setLoadingTeams(false);
        return;
      }

      try {
        // Fetch all MLE teams with real stats for the selected gamemode
        const teamsResponse = await fetch(`/api/mle-teams?mode=${modeFilter}`);
        if (!teamsResponse.ok) {
          throw new Error("Failed to fetch teams");
        }
        const teamsData = await teamsResponse.json();

        // Fetch league data to get all fantasy teams and their rosters
        const leagueResponse = await fetch(`/api/leagues/${leagueId}`);
        const leagueData = leagueResponse.ok ? await leagueResponse.json() : null;

        // Build a map of rostered team IDs -> who rosters them
        const rosteredByMap = new Map<string, { rosterName: string; managerName: string }>();
        if (leagueData?.league?.fantasyTeams) {
          for (const fantasyTeam of leagueData.league.fantasyTeams) {
            try {
              const rosterResponse = await fetch(`/api/leagues/${leagueId}/rosters/${fantasyTeam.id}`);
              if (rosterResponse.ok) {
                const rosterData = await rosterResponse.json();
                rosterData.rosterSlots.forEach((slot: any) => {
                  if (slot.mleTeam) {
                    rosteredByMap.set(slot.mleTeam.id, {
                      rosterName: fantasyTeam.displayName,
                      managerName: fantasyTeam.owner?.displayName ?? "Unknown",
                    });
                  }
                });
              }
            } catch (err) {
              console.error(`Error fetching roster for team ${fantasyTeam.id}:`, err);
            }
          }
        }

        // Fetch pending waiver claims + post-drop waiver clearance windows to
        // determine waiver status (a team can show as "waiver" either because
        // someone has a pending claim to add it, or because it was just
        // dropped and hasn't cleared back to free agency yet).
        const waiverResponse = await fetch(`/api/leagues/${leagueId}/waivers`);
        const waiverTeamIds = new Set<string>();
        if (waiverResponse.ok) {
          const waiverData = await waiverResponse.json();
          if (waiverData.waiverClaims) {
            waiverData.waiverClaims.forEach((claim: any) => {
              if (claim.status === "pending") {
                waiverTeamIds.add(claim.addTeamId);
              }
            });
          }
          if (waiverData.waiverPeriodTeamIds) {
            waiverData.waiverPeriodTeamIds.forEach((id: string) => waiverTeamIds.add(id));
          }
        }

        // Transform teams with status based on roster check and waiver claims
        // (fpts/avg/last/goals/shots/saves/assists/demos/record already come
        // from the API, computed for the selected gamemode)
        const teamsWithStats: TeamWithStats[] = teamsData.teams.map((team: Omit<TeamWithStats, "rank" | "status" | "rosteredBy">, index: number) => ({
          ...team,
          rank: index + 1,
          status: rosteredByMap.has(team.id)
            ? "rostered" as const
            : waiverTeamIds.has(team.id)
            ? "waiver" as const
            : "free-agent" as const,
          rosteredBy: rosteredByMap.get(team.id),
        }));
        setMleTeams(teamsWithStats);
      } catch (error) {
        console.error("Error fetching MLE teams:", error);
      } finally {
        setLoadingTeams(false);
      }
    };

    fetchTeams();
  }, [session?.user?.id, leagueId, modeFilter]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // New column, default to descending
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const sortedData = useMemo(() => {
    // First filter the data
    let filteredData = [...mleTeams];

    // Filter by league
    if (leagueFilter !== "All") {
      const leagueMap = {
        "Foundation": "FL",
        "Academy": "AL",
        "Champion": "CL",
        "Master": "ML",
        "Premier": "PL"
      };
      filteredData = filteredData.filter(team => team.leagueId === leagueMap[leagueFilter]);
    }

    // Filter by availability
    filteredData = filteredData.filter(team => {
      const isRostered = team.status === "rostered";
      const isFreeAgent = team.status === "free-agent";
      const isWaiver = team.status === "waiver";

      if (isRostered && availabilityFilter.rostered) return true;
      if (isFreeAgent && availabilityFilter.freeAgent) return true;
      if (isWaiver && availabilityFilter.waivers) return true;
      return false;
    });

    // Then sort the filtered data
    return filteredData.sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];

      if (sortDirection === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  }, [sortColumn, sortDirection, leagueFilter, availabilityFilter, mleTeams]);

  return (
    <>
      {/* Team Stats Modal */}
      <TeamModal
        team={showModal && selectedTeam ? selectedTeam : null}
        onClose={() => setShowModal(false)}
      />

      {/* FA Confirmation Modal */}
      {showFAConfirmModal && selectedFATeam && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 90,
          }}
          onClick={() => setShowFAConfirmModal(false)}
        >
          <div
            style={{
              width: "min(500px, 90vw)",
              background: "linear-gradient(135deg, #1a2332 0%, #0f1419 100%)",
              border: "2px solid rgba(242, 182, 50, 0.3)",
              borderRadius: "16px",
              padding: "2rem",
              boxShadow: "0 25px 50px rgba(0, 0, 0, 0.8)",
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Title */}
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1.5rem", textAlign: "center" }}>
              Confirm Free Agent Pickup
            </h2>

            {/* Team Display */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "1rem",
                marginBottom: "1.5rem",
                padding: "1.5rem",
                background: "rgba(255, 255, 255, 0.05)",
                borderRadius: "12px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <Image
                src={selectedFATeam.logoPath}
                alt={selectedFATeam.name}
                width={80}
                height={80}
                style={{ borderRadius: "8px" }}
              />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "0.25rem" }}>
                  {selectedFATeam.leagueId} {selectedFATeam.name}
                </div>
                <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
                  Free Agent
                </div>
              </div>
            </div>

            {/* Confirmation Text */}
            <p style={{ fontSize: "1rem", color: "var(--text-muted)", textAlign: "center", marginBottom: "2rem" }}>
              Are you sure you want to add this free agent to your roster?
            </p>

            {/* Buttons */}
            <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
              <button
                onClick={() => {
                  setShowFAConfirmModal(false);
                  setSelectedFATeam(null);
                }}
                className="btn btn-ghost"
                style={{ fontSize: "1rem", padding: "0.75rem 2rem" }}
              >
                No, Go Back
              </button>
              <button
                onClick={async () => {
                  setShowFAConfirmModal(false);

                  // Check if roster has empty slots
                  if (rosterData && selectedFATeam) {
                    const config = rosterData.league.rosterConfig;
                    const totalSlots = config["2s"] + config["3s"] + config.flx + config.be;
                    const filledSlots = rosterData.rosterSlots.filter(slot => slot.mleTeam !== null).length;

                    if (filledSlots < totalSlots) {
                      // Has empty slots - add directly
                      try {
                        // Find first empty slot
                        const allSlots = [];

                        // Generate all possible slots based on config
                        for (let i = 0; i < config["2s"]; i++) {
                          allSlots.push({ position: "2s", slotIndex: i });
                        }
                        for (let i = 0; i < config["3s"]; i++) {
                          allSlots.push({ position: "3s", slotIndex: i });
                        }
                        for (let i = 0; i < config.flx; i++) {
                          allSlots.push({ position: "flx", slotIndex: i });
                        }
                        for (let i = 0; i < config.be; i++) {
                          allSlots.push({ position: "be", slotIndex: i });
                        }

                        // Find first empty slot
                        const emptySlot = allSlots.find(slot => {
                          return !rosterData.rosterSlots.some(
                            rs => rs.position === slot.position && rs.slotIndex === slot.slotIndex
                          );
                        });

                        if (!emptySlot) {
                          showAlert("No empty slots found", "warning");
                          return;
                        }

                        // Make API call to add team
                        const response = await fetch(`/api/leagues/${leagueId}/rosters/${myTeamId}`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            week: rosterData.league.currentWeek,
                            position: emptySlot.position,
                            slotIndex: emptySlot.slotIndex,
                            mleTeamId: selectedFATeam.id,
                          }),
                        });

                        if (response.ok) {
                          showAlert(`${selectedFATeam.name} successfully added to your roster!`, "success");
                          // Refetch roster to update UI
                          const rosterResponse = await fetch(`/api/leagues/${leagueId}/rosters/${myTeamId}`);
                          if (rosterResponse.ok) {
                            const updatedRoster = await rosterResponse.json();
                            setRosterData(updatedRoster);
                          }
                        } else {
                          const error = await response.json();
                          showAlert(`Failed to add team: ${error.error || "Unknown error"}`, "error");
                        }
                      } catch (error) {
                        console.error("Error adding team:", error);
                        showAlert("Failed to add team. Please try again.", "error");
                      }
                      setSelectedFATeam(null);
                    } else {
                      // Roster full - show drop modal
                      setSelectedWaiverTeam(selectedFATeam);
                      setShowWaiverModal(true);
                      setSelectedFATeam(null);
                    }
                  } else {
                    // No roster data, show drop modal
                    setSelectedWaiverTeam(selectedFATeam);
                    setShowWaiverModal(true);
                    setSelectedFATeam(null);
                  }
                }}
                style={{
                  background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                  color: "white",
                  fontWeight: 700,
                  padding: "0.75rem 2rem",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "1rem",
                  boxShadow: "0 4px 12px rgba(34, 197, 94, 0.3)",
                }}
              >
                Yes, Add Team
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waiver Claim Modal */}
      {showWaiverModal && selectedWaiverTeam && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 80,
          }}
          onClick={() => setShowWaiverModal(false)}
        >
          <div
            style={{
              width: "min(900px, 92vw)",
              background: "linear-gradient(135deg, #1a2332 0%, #0f1419 100%)",
              border: "2px solid rgba(242, 182, 50, 0.3)",
              borderRadius: "16px",
              padding: "0",
              boxShadow: "0 25px 50px rgba(0, 0, 0, 0.8)",
              position: "relative",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => {
                setShowWaiverModal(false);
                setSelectedWaiverTeam(null);
                setSelectedDropTeam(null);
              }}
              style={{
                position: "absolute",
                top: "1rem",
                left: "1rem",
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

            {/* Confirm button */}
            <button
              onClick={async () => {
                if (!myTeamId || !rosterData) {
                  showAlert("Could not determine your team", "error");
                  return;
                }

                // Instant swaps always need a specific slot to replace;
                // waiver claims only need one if there's no empty slot to
                // land in.
                if (!selectedDropTeam && (isFreeAgentPickup || !waiverModalHasEmptySlot)) {
                  showAlert("Please select a team to drop", "warning");
                  return;
                }

                let faabBid: number | undefined;
                if (isFaabClaim) {
                  faabBid = Number(faabBidInput);
                  if (faabBidInput.trim() === "" || !Number.isFinite(faabBid) || faabBid < 0 || !Number.isInteger(faabBid)) {
                    showAlert("Please enter a valid whole-dollar bid", "warning");
                    return;
                  }
                  if (faabBid > (rosterData.fantasyTeam.faabRemaining ?? 0)) {
                    showAlert(`Bid exceeds your remaining budget ($${rosterData.fantasyTeam.faabRemaining ?? 0})`, "warning");
                    return;
                  }
                }

                setSubmittingWaiver(true);
                try {
                  const response = isFreeAgentPickup
                    ? await fetch(`/api/leagues/${leagueId}/rosters/${myTeamId}/swap`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          week: rosterData.league.currentWeek,
                          dropMleTeamId: selectedDropTeam,
                          addMleTeamId: selectedWaiverTeam.id,
                        }),
                      })
                    : await fetch(`/api/leagues/${leagueId}/waivers`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          fantasyTeamId: myTeamId,
                          addTeamId: selectedWaiverTeam.id,
                          dropTeamId: selectedDropTeam || undefined,
                          faabBid,
                        }),
                      });
                  const data = await response.json();

                  if (!response.ok) {
                    // Locked-slot rejections land here with a clear reason
                    // from the API (see lib/rosterLocks.ts) — surface it
                    // as-is rather than a generic failure message.
                    showAlert(data.error || "Failed to submit", "error");
                    return;
                  }

                  showAlert(
                    isFreeAgentPickup
                      ? `${selectedWaiverTeam.leagueId} ${selectedWaiverTeam.name} added to your roster!`
                      : `Waiver claim submitted for ${selectedWaiverTeam.leagueId} ${selectedWaiverTeam.name}.`,
                    "success"
                  );
                  setShowWaiverModal(false);
                  setSelectedWaiverTeam(null);
                  setSelectedDropTeam(null);

                  if (isFreeAgentPickup) {
                    const rosterResponse = await fetch(`/api/leagues/${leagueId}/rosters/${myTeamId}`);
                    if (rosterResponse.ok) setRosterData(await rosterResponse.json());
                  }
                } catch (error) {
                  console.error("Error submitting:", error);
                  showAlert("Failed. Please try again.", "error");
                } finally {
                  setSubmittingWaiver(false);
                }
              }}
              disabled={submittingWaiver}
              style={{
                position: "absolute",
                top: "1rem",
                right: "1rem",
                background: "linear-gradient(135deg, var(--accent) 0%, #d4a832 100%)",
                color: "#1a1a2e",
                fontWeight: 700,
                padding: "0.65rem 2rem",
                borderRadius: "8px",
                border: "none",
                cursor: submittingWaiver ? "not-allowed" : "pointer",
                opacity: submittingWaiver ? 0.6 : 1,
                fontSize: "1rem",
                boxShadow: "0 4px 12px rgba(242, 182, 50, 0.4)",
                zIndex: 10,
              }}
            >
              {submittingWaiver ? "Submitting..." : "Confirm"}
            </button>

            {/* Header - Team Info */}
            <div style={{ padding: "3.5rem 2rem 1.5rem", borderBottom: "1px solid rgba(255, 255, 255, 0.1)" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>
                {rosterData?.fantasyTeam.displayName || "Your Team"}
              </div>
              <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                {rosterData?.fantasyTeam.ownerDisplayName || session?.user?.name || "Manager"}
              </div>
              {rosterData?.record && (
                <div style={{ fontSize: "0.95rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {rosterData.record.wins} - {rosterData.record.losses} {rosterData.rank && `• ${rosterData.rank}th`}
                </div>
              )}
              {rosterData && !isFreeAgentPickup && (
                <div style={{ fontSize: "0.9rem", color: "var(--accent)", fontWeight: 600, marginTop: "0.5rem" }}>
                  {rosterData.league.waiverSystem === "faab"
                    ? `Your FAAB Budget: $${rosterData.fantasyTeam.faabRemaining ?? 0} remaining`
                    : `Your Waiver Priority: #${rosterData.fantasyTeam.waiverPriority ?? "-"}`}
                </div>
              )}
            </div>

            {/* Selected Waiver Team */}
            <div
              style={{
                padding: "2rem",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "center",
                gap: "1rem",
                borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <Image
                src={selectedWaiverTeam.logoPath}
                alt={selectedWaiverTeam.name}
                width={80}
                height={80}
                style={{ borderRadius: "8px" }}
              />
              <div style={{ fontSize: "clamp(1.3rem, 5vw, 2rem)", fontWeight: 700, color: "var(--text-main)" }}>
                {selectedWaiverTeam.leagueId} {selectedWaiverTeam.name}
              </div>
            </div>

            {/* FAAB Bid Input */}
            {isFaabClaim && (
              <div style={{ padding: "1.5rem 2rem 0", display: "flex", alignItems: "center", gap: "1rem" }}>
                <label style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-main)" }}>
                  Your Bid ($):
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={faabBidInput}
                  onChange={(e) => setFaabBidInput(e.target.value)}
                  placeholder="0"
                  style={{
                    width: "120px",
                    padding: "0.5rem 0.75rem",
                    background: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "6px",
                    color: "var(--text-main)",
                    fontSize: "0.95rem",
                  }}
                />
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  ${rosterData?.fantasyTeam.faabRemaining ?? 0} remaining — highest bid wins, ties broken by priority
                </span>
              </div>
            )}

            {/* Roster Table with Checkboxes */}
            <div style={{ padding: "1.5rem 2rem" }}>
              {loadingRoster ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                  Loading roster...
                </div>
              ) : !rosterData ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                  No roster found
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  {!isFreeAgentPickup && (
                    <div
                      style={{
                        padding: "0.75rem 1rem",
                        marginBottom: "1rem",
                        borderRadius: "6px",
                        background: "rgba(59, 130, 246, 0.1)",
                        color: "var(--text-main)",
                        fontSize: "0.85rem",
                      }}
                    >
                      This team is on waivers, so this becomes a pending claim instead of an
                      instant add — you can pick a team to drop now (even a locked one; that's
                      only checked once the claim actually processes), or leave it blank if you
                      have an empty slot.
                    </div>
                  )}
                  {isFreeAgentPickup &&
                    rosterData.rosterSlots.filter((s) => s.mleTeam !== null).length > 0 &&
                    rosterData.rosterSlots
                      .filter((s) => s.mleTeam !== null)
                      .every((s) => s.isLocked) && (
                      <div
                        style={{
                          padding: "0.75rem 1rem",
                          marginBottom: "1rem",
                          borderRadius: "6px",
                          background: "rgba(239, 68, 68, 0.1)",
                          color: "#ef4444",
                          fontSize: "0.85rem",
                        }}
                      >
                        Every team on your roster is currently locked — you can't drop any of
                        them to make room for this free agent until at least one unlocks.
                      </div>
                    )}
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid rgba(255, 255, 255, 0.2)" }}>
                        <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Slot</th>
                        <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Team</th>
                        <th style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Score</th>
                        <th style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rosterData.rosterSlots
                        .filter(slot => slot.mleTeam !== null)
                        .map((slot) => {
                          const mleTeamId = slot.mleTeam!.id;
                          const isSelected = selectedDropTeam === mleTeamId;
                          // Locks only block an instant free-agent swap —
                          // a waiver claim can target a locked slot (it's
                          // only re-checked once the claim processes).
                          const rowBlockedByLock = isFreeAgentPickup && slot.isLocked;
                          return (
                          <tr
                            key={slot.id}
                            style={{
                              borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                              backgroundColor: rowBlockedByLock
                                ? "rgba(239, 68, 68, 0.06)"
                                : isSelected
                                ? "rgba(242, 182, 50, 0.1)"
                                : "transparent",
                              opacity: rowBlockedByLock ? 0.6 : 1,
                            }}
                          >
                            <td style={{ padding: "0.75rem 0.5rem", fontSize: "0.9rem", color: "var(--accent)", fontWeight: 700 }}>
                              {slot.position.toUpperCase()}
                            </td>
                            <td style={{ padding: "0.75rem 0.5rem" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <Image
                                  src={slot.mleTeam!.logoPath}
                                  alt={slot.mleTeam!.name}
                                  width={24}
                                  height={24}
                                  style={{ borderRadius: "4px" }}
                                />
                                <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-main)" }}>
                                  {slot.mleTeam!.leagueId} {slot.mleTeam!.name}
                                </span>
                                {slot.isLocked && (
                                  <span style={{ fontSize: "0.75rem", color: isFreeAgentPickup ? "#ef4444" : "var(--text-muted)" }} title="Locked">
                                    🔒{" "}
                                    {isFreeAgentPickup
                                      ? "Locked — can't drop this team for a free agent pickup right now"
                                      : "Locked — OK to select for a waiver claim, just won't process until it unlocks"}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontWeight: 600, fontSize: "0.9rem", color: "var(--accent)" }}>
                              {slot.fantasyPoints?.toFixed(1) || "-"}
                            </td>
                            <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                              <button
                                onClick={() =>
                                  !rowBlockedByLock &&
                                  setSelectedDropTeam(isSelected ? null : mleTeamId)
                                }
                                disabled={rowBlockedByLock}
                                style={{
                                  width: "24px",
                                  height: "24px",
                                  border: `2px solid ${rowBlockedByLock ? "rgba(239, 68, 68, 0.4)" : "var(--accent)"}`,
                                  borderRadius: "4px",
                                  background: isSelected ? "var(--accent)" : "transparent",
                                  cursor: rowBlockedByLock ? "not-allowed" : "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: isSelected ? "#1a1a2e" : "transparent",
                                  fontWeight: 700,
                                  fontSize: "1rem",
                                }}
                              >
                                ✓
                              </button>
                            </td>
                          </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 className="page-heading" style={{ fontSize: "clamp(1.5rem, 6vw, 2.5rem)", color: "var(--accent)", fontWeight: 700, margin: 0 }}>
          Teams
        </h1>
      </div>

      {draftIncomplete && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "0.85rem 1.25rem",
            borderRadius: "8px",
            background: "rgba(242, 182, 50, 0.1)",
            border: "1px solid rgba(242, 182, 50, 0.35)",
            color: "var(--accent)",
            fontSize: "0.9rem",
            fontWeight: 600,
          }}
        >
          Adding and dropping teams is disabled until the draft is complete.
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
        {/* Availability Filter */}
        <div style={{ position: "relative", width: "200px", maxWidth: "100%" }}>
          <button
            onClick={() => setAvailabilityFilterOpen(!availabilityFilterOpen)}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "var(--text-main)",
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.9rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>Availability</span>
            <span>{availabilityFilterOpen ? "▲" : "▼"}</span>
          </button>

          {availabilityFilterOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                marginTop: "0.5rem",
                background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                borderRadius: "6px",
                padding: "0.75rem",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                zIndex: 1000,
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem",
                  cursor: "pointer",
                  transition: "background 0.2s ease",
                  borderRadius: "4px",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <input
                  type="checkbox"
                  checked={availabilityFilter.rostered}
                  onChange={(e) => setAvailabilityFilter({...availabilityFilter, rostered: e.target.checked})}
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>Rostered</span>
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem",
                  cursor: "pointer",
                  transition: "background 0.2s ease",
                  borderRadius: "4px",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <input
                  type="checkbox"
                  checked={availabilityFilter.freeAgent}
                  onChange={(e) => setAvailabilityFilter({...availabilityFilter, freeAgent: e.target.checked})}
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>Free Agent</span>
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem",
                  cursor: "pointer",
                  transition: "background 0.2s ease",
                  borderRadius: "4px",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <input
                  type="checkbox"
                  checked={availabilityFilter.waivers}
                  onChange={(e) => setAvailabilityFilter({...availabilityFilter, waivers: e.target.checked})}
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>Waivers</span>
              </label>
            </div>
          )}
        </div>

        {/* League Filter */}
        <div style={{ position: "relative", width: "200px", maxWidth: "100%" }}>
          <button
            onClick={() => setLeagueFilterOpen(!leagueFilterOpen)}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "var(--text-main)",
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.9rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>League: {leagueFilter}</span>
            <span>{leagueFilterOpen ? "▲" : "▼"}</span>
          </button>

          {leagueFilterOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                marginTop: "0.5rem",
                background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                borderRadius: "6px",
                padding: "0.5rem 0",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                zIndex: 1000,
              }}
            >
              {(["All", "Foundation", "Academy", "Champion", "Master", "Premier"] as const).map((league) => (
                <button
                  key={league}
                  onClick={() => {
                    setLeagueFilter(league);
                    setLeagueFilterOpen(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "0.5rem 1rem",
                    background: league === leagueFilter ? "rgba(255,255,255,0.1)" : "transparent",
                    border: "none",
                    color: "var(--text-main)",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "background 0.2s ease",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                  }}
                  onMouseLeave={(e) => {
                    if (league !== leagueFilter) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  {league}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2s/3s Switch */}
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
            onClick={() => setModeFilter("2s")}
            style={{
              padding: "0.4rem 1rem",
              borderRadius: "4px",
              fontSize: "0.9rem",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              backgroundColor:
                modeFilter === "2s" ? "var(--accent)" : "transparent",
              color: modeFilter === "2s" ? "#1a1a2e" : "var(--text-main)",
              transition: "all 0.2s ease",
            }}
          >
            2s
          </button>
          <button
            onClick={() => setModeFilter("3s")}
            style={{
              padding: "0.4rem 1rem",
              borderRadius: "4px",
              fontSize: "0.9rem",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              backgroundColor:
                modeFilter === "3s" ? "var(--accent)" : "transparent",
              color: modeFilter === "3s" ? "#1a1a2e" : "var(--text-main)",
              transition: "all 0.2s ease",
            }}
          >
            3s
          </button>
        </div>
      </div>

      {/* Teams Table */}
      <section className="card">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                <th
                  onClick={() => handleSort("rank")}
                  style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600, cursor: "pointer", userSelect: "none" }}
                >
                  Rank<SortIcon column="rank" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Team</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Action</th>
                <th
                  onClick={() => handleSort("fpts")}
                  style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600, cursor: "pointer", userSelect: "none" }}
                >
                  Fpts<SortIcon column="fpts" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th
                  onClick={() => handleSort("avg")}
                  style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600, cursor: "pointer", userSelect: "none" }}
                >
                  Avg<SortIcon column="avg" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th
                  onClick={() => handleSort("last")}
                  style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600, cursor: "pointer", userSelect: "none" }}
                >
                  Last<SortIcon column="last" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th
                  onClick={() => handleSort("goals")}
                  style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600, cursor: "pointer", userSelect: "none" }}
                >
                  Goals<SortIcon column="goals" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th
                  onClick={() => handleSort("shots")}
                  style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600, cursor: "pointer", userSelect: "none" }}
                >
                  Shots<SortIcon column="shots" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th
                  onClick={() => handleSort("saves")}
                  style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600, cursor: "pointer", userSelect: "none" }}
                >
                  Saves<SortIcon column="saves" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th
                  onClick={() => handleSort("assists")}
                  style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600, cursor: "pointer", userSelect: "none" }}
                >
                  Assists<SortIcon column="assists" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th
                  onClick={() => handleSort("demos")}
                  style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600, cursor: "pointer", userSelect: "none" }}
                >
                  Demos<SortIcon column="demos" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Record</th>
              </tr>
            </thead>
            <tbody>
              {sortedData.map((team, index) => (
                <tr
                  key={team.id}
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.05)"
                  }}
                >
                  <td style={{ padding: "0.75rem 1rem", fontWeight: 700, fontSize: "0.9rem", color: "var(--accent)" }}>
                    {index + 1}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <Image
                        src={team.logoPath}
                        alt={`${team.name} logo`}
                        width={32}
                        height={32}
                        style={{ borderRadius: "4px" }}
                      />
                      <div>
                        <div
                          onClick={() => {
                            setSelectedTeam(team);
                            setShowModal(true);
                          }}
                          style={{
                            fontWeight: 600,
                            fontSize: "0.95rem",
                            cursor: "pointer",
                            color: "var(--text-main)",
                            transition: "color 0.2s"
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent)"}
                          onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-main)"}
                        >
                          {team.leagueId} {team.name}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "left" }}>
                    {draftIncomplete && team.status !== "rostered" ? (
                      <div
                        title="Adding and dropping teams is disabled until the draft is complete"
                        style={{
                          border: "1px solid var(--text-muted)",
                          borderRadius: "6px",
                          padding: "0.4rem 0.9rem",
                          fontSize: "0.85rem",
                          color: "var(--text-muted)",
                          fontWeight: 600,
                          display: "inline-block",
                          cursor: "not-allowed",
                        }}
                      >
                        Draft in progress
                      </div>
                    ) : team.status === "free-agent" ? (
                      <button
                        className="btn btn-warning"
                        style={{
                          fontSize: "0.85rem",
                          padding: "0.4rem 0.9rem"
                        }}
                        onClick={() => {
                          setSelectedFATeam(team);
                          setShowFAConfirmModal(true);
                        }}
                      >
                        + Add
                      </button>
                    ) : team.status === "waiver" ? (
                      <button
                        className="btn btn-ghost"
                        style={{
                          fontSize: "0.85rem",
                          padding: "0.4rem 0.9rem"
                        }}
                        onClick={() => {
                          setSelectedWaiverTeam(team);
                          setShowWaiverModal(true);
                        }}
                      >
                        Claim
                      </button>
                    ) : (
                      <div
                        style={{
                          border: "1px solid var(--text-muted)",
                          borderRadius: "6px",
                          padding: "0.4rem 0.9rem",
                          fontSize: "0.85rem",
                          color: "var(--text-muted)",
                          fontWeight: 600,
                          display: "inline-block"
                        }}
                      >
                        Rostered
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600, fontSize: "0.95rem" }}>
                    {team.fpts}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    {team.avg}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    {team.last}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.9rem" }}>
                    {team.goals}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.9rem" }}>
                    {team.shots}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.9rem" }}>
                    {team.saves}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.9rem" }}>
                    {team.assists}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontSize: "0.9rem" }}>
                    {team.demos}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                    {team.record}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
