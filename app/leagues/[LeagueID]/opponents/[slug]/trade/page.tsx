"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAlert } from "@/components/AlertProvider";
import HeaderTooltip from "@/components/HeaderTooltip";
import TeamModal from "@/components/TeamModal";

interface RosterTeam {
  id: string;
  slot: string;
  name: string;
  fpts: number;
  record: string;
  rk: number;
  logo: string;
  mleTeamId: string;
}

interface TradeRosterSlotTeam {
  id: string;
  name: string;
  leagueId: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
  // Not actually returned by the roster API (which only nests these under
  // per-mode `stats["2s"|"3s"]`) — always falls back to 0/"0-0" below.
  fpts?: number;
  record?: string;
}

interface TradeRosterSlot {
  id: string;
  position: string;
  mleTeam: TradeRosterSlotTeam;
}

interface RosterData {
  fantasyTeam: {
    id: string;
    displayName: string;
    ownerDisplayName: string;
  };
  rosterSlots: TradeRosterSlot[];
  league: {
    rosterConfig: {
      "2s": number;
      "3s": number;
      flx: number;
      be: number;
    };
  };
}

export default function TradePage() {
  const showAlert = useAlert();
  const params = useParams();
  const router = useRouter();
  const leagueId = params.LeagueID as string;
  const opponentTeamId = params.slug as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myRoster, setMyRoster] = useState<RosterData | null>(null);
  const [opponentRoster, setOpponentRoster] = useState<RosterData | null>(null);
  const [selectedMyTeams, setSelectedMyTeams] = useState<number[]>([]);
  const [selectedOpponentTeams, setSelectedOpponentTeams] = useState<number[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showDropModal, setShowDropModal] = useState(false);
  const [selectedDropTeamIndices, setSelectedDropTeamIndices] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [teamModalData, setTeamModalData] = useState<{
    id: string;
    name: string;
    leagueId: string;
    logoPath: string;
    primaryColor: string;
    secondaryColor: string;
    status: string;
    rosteredBy: { rosterName: string; managerName: string; fantasyTeamId: string };
  } | null>(null);

  const openTeamModal = (slot: TradeRosterSlot, side: "mine" | "opponent") => {
    if (!slot?.mleTeam) return;
    const roster = side === "mine" ? myRoster : opponentRoster;
    if (!roster) return;
    setTeamModalData({
      id: slot.mleTeam.id,
      name: slot.mleTeam.name,
      leagueId: slot.mleTeam.leagueId,
      logoPath: slot.mleTeam.logoPath,
      primaryColor: slot.mleTeam.primaryColor,
      secondaryColor: slot.mleTeam.secondaryColor,
      status: "rostered",
      rosteredBy: {
        rosterName: roster.fantasyTeam.displayName,
        managerName: roster.fantasyTeam.ownerDisplayName,
        fantasyTeamId: roster.fantasyTeam.id,
      },
    });
  };

  // Fetch roster data
  useEffect(() => {
    const fetchRosters = async () => {
      try {
        setLoading(true);

        // First, get the current user's team ID and the league's actual
        // current week — a trade has to be built from what's ACTUALLY on
        // each roster right now, not the roster route's own week-1 default
        // (which would show the draft-day roster, letting a manager try to
        // offer a team they already dropped/traded away, or miss one they
        // picked up since).
        const userResponse = await fetch(`/api/leagues/${leagueId}/user`);
        if (!userResponse.ok) throw new Error("Failed to fetch user team");
        const userData = await userResponse.json();
        const myTeamId = userData.fantasyTeam.id;
        const currentWeek = userData.league.currentWeek;

        // Fetch my roster
        const myRosterResponse = await fetch(`/api/leagues/${leagueId}/rosters/${myTeamId}?week=${currentWeek}`);
        if (!myRosterResponse.ok) throw new Error("Failed to fetch your roster");
        const myRosterData = await myRosterResponse.json();

        // Fetch opponent roster
        const opponentRosterResponse = await fetch(`/api/leagues/${leagueId}/rosters/${opponentTeamId}?week=${currentWeek}`);
        if (!opponentRosterResponse.ok) throw new Error("Failed to fetch opponent roster");
        const opponentRosterData = await opponentRosterResponse.json();

        setMyRoster(myRosterData);
        setOpponentRoster(opponentRosterData);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load rosters");
      } finally {
        setLoading(false);
      }
    };

    if (leagueId && opponentTeamId) {
      fetchRosters();
    }
  }, [leagueId, opponentTeamId]);

  // A drop is only needed if the roster would actually OVERFLOW its real
  // capacity after the trade — not just whenever more teams are coming in
  // than going out. `rosterSlots` only ever contains FILLED slots (a
  // genuinely empty slot has no RosterSlot row at all — see lib/rosterSlotAssignment.ts),
  // so its length is "teams currently rostered," which can already be below
  // capacity. E.g. 2 empty slots, giving 1 for 2: current count is already
  // 2 under capacity, so the post-trade count still fits with room to
  // spare — no drop required, even though incoming (2) > outgoing (1).
  const myRosterConfig = myRoster?.league.rosterConfig;
  const myCapacity = myRosterConfig
    ? myRosterConfig["2s"] + myRosterConfig["3s"] + myRosterConfig.flx + myRosterConfig.be
    : 0;
  const myCountAfterTrade = (myRoster?.rosterSlots.length ?? 0) - selectedMyTeams.length + selectedOpponentTeams.length;
  const neededDropCount = Math.max(0, myCountAfterTrade - myCapacity);
  const needsToDrop = neededDropCount > 0;

  const toggleDropTeam = (index: number) => {
    setSelectedDropTeamIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const toggleMyTeam = (index: number) => {
    setSelectedMyTeams(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const toggleOpponentTeam = (index: number) => {
    setSelectedOpponentTeams(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const handleProposeTrade = async () => {
    if (!myRoster || !opponentRoster) return;

    setSubmitting(true);

    try {
      // Build arrays of MLE team IDs (accessing mleTeam.id from the roster slot)
      const proposerGives = selectedMyTeams.map(idx => myRoster.rosterSlots[idx].mleTeam.id);
      const receiverGives = selectedOpponentTeams.map(idx => opponentRoster.rosterSlots[idx].mleTeam.id);
      // Teams picked in the "make room" modal ride along as part of this
      // same proposal — they aren't dropped now, only once the trade
      // itself actually processes (see lib/tradeExecution.ts).
      const proposerDrops = selectedDropTeamIndices.map(idx => myRoster.rosterSlots[idx].mleTeam.id);

      const response = await fetch(`/api/leagues/${leagueId}/trades/propose`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          proposerTeamId: myRoster.fantasyTeam.id,
          receiverTeamId: opponentRoster.fantasyTeam.id,
          proposerGives,
          receiverGives,
          proposerDrops,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to propose trade");
      }

      // Check if this is a counter offer and reject the original trade
      const counterTradeId = sessionStorage.getItem("counterTradeId");
      const counterTradeLeagueId = sessionStorage.getItem("counterTradeLeagueId");

      if (counterTradeId && counterTradeLeagueId) {
        try {
          await fetch(`/api/leagues/${counterTradeLeagueId}/trades/${counterTradeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reject" }),
          });

          // Clear the counter trade data from session storage
          sessionStorage.removeItem("counterTradeId");
          sessionStorage.removeItem("counterTradeLeagueId");
          sessionStorage.removeItem("counterTradeTeamId");
        } catch (error) {
          console.error("Error rejecting original trade:", error);
        }
      }

      // Success! Redirect to My Roster page
      showAlert(counterTradeId ? "Counter offer proposed and original trade rejected!" : "Trade proposed successfully!", "success");
      router.push(`/leagues/${leagueId}/my-roster/${myRoster.fantasyTeam.id}`);
    } catch (err) {
      showAlert(err instanceof Error ? err.message : "Failed to propose trade", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>Loading...</div>
      </div>
    );
  }

  if (error || !myRoster || !opponentRoster) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#ef4444", fontSize: "1.1rem" }}>
          Error: {error || "Failed to load rosters"}
        </div>
      </div>
    );
  }

  // Transform roster slots for display
  const getSlotDisplay = (position: string) => {
    // Handle both old format (twos/threes/flex/bench) and new format (2s/3s/FLX/BE)
    if (position === "twos" || position === "2s") return "2s";
    if (position === "threes" || position === "3s") return "3s";
    if (position === "flex" || position === "FLX") return "FLX";
    if (position === "bench" || position === "BE") return "BE";
    return position.toUpperCase();
  };

  const myTeams: RosterTeam[] = myRoster.rosterSlots.map(slot => ({
    id: slot.id,
    slot: getSlotDisplay(slot.position),
    name: `${slot.mleTeam.leagueId} ${slot.mleTeam.name}`,
    fpts: slot.mleTeam.fpts || 0,
    record: slot.mleTeam.record || "0-0",
    rk: 0,
    logo: slot.mleTeam.logoPath,
    mleTeamId: slot.mleTeam.id,
  }));

  const opponentTeams: RosterTeam[] = opponentRoster.rosterSlots.map(slot => ({
    id: slot.id,
    slot: getSlotDisplay(slot.position),
    name: `${slot.mleTeam.leagueId} ${slot.mleTeam.name}`,
    fpts: slot.mleTeam.fpts || 0,
    record: slot.mleTeam.record || "0-0",
    rk: 0,
    logo: slot.mleTeam.logoPath,
    mleTeamId: slot.mleTeam.id,
  }));

  return (
    <>
      <TeamModal
        team={teamModalData}
        fantasyLeagueId={leagueId}
        currentUserFantasyTeamId={myRoster.fantasyTeam.id}
        onClose={() => setTeamModalData(null)}
      />

      {/* Confirmation Modal - "Are you sure?" */}
      {showConfirmModal && (
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
          onClick={() => setShowConfirmModal(false)}
        >
          <div
            className="modal-box"
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
            <h2 style={{ fontSize: "clamp(1.2rem, 5vw, 1.5rem)", fontWeight: 700, color: "var(--text-main)", marginBottom: "1.5rem", textAlign: "center" }}>
              Confirm Trade Proposal
            </h2>

            <p style={{ fontSize: "1rem", color: "var(--text-muted)", textAlign: "center", marginBottom: "2rem" }}>
              Are you sure you want to propose this trade?
              <br />
              <strong>You&apos;re sending {selectedMyTeams.length} team(s) for {selectedOpponentTeams.length} team(s)</strong>
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "center" }}>
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={submitting}
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "#ffffff",
                  fontWeight: 600,
                  padding: "0.75rem 2rem",
                  borderRadius: "8px",
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                No, Go Back
              </button>
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  if (needsToDrop) {
                    setShowDropModal(true);
                  } else {
                    handleProposeTrade();
                  }
                }}
                disabled={submitting}
                style={{
                  background: "linear-gradient(135deg, #d4af37 0%, #f2b632 100%)",
                  color: "#1a1a2e",
                  fontWeight: 700,
                  padding: "0.75rem 2rem",
                  borderRadius: "8px",
                  border: "none",
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                  boxShadow: "0 4px 12px rgba(242, 182, 50, 0.4)",
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                {submitting ? "Submitting..." : "Yes, Propose Trade"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drop Team Modal - appears if non-equal trade */}
      {showDropModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 95,
          }}
          onClick={() => {
            setShowDropModal(false);
            setSelectedDropTeamIndices([]);
          }}
        >
          <div
            className="modal-box"
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
                setShowDropModal(false);
                setSelectedDropTeamIndices([]);
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
              onClick={() => {
                if (selectedDropTeamIndices.length === neededDropCount) {
                  setShowDropModal(false);
                  handleProposeTrade();
                } else {
                  showAlert(
                    `Please select ${neededDropCount} team${neededDropCount === 1 ? "" : "s"} to drop`,
                    "warning"
                  );
                }
              }}
              disabled={submitting}
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
                cursor: submitting ? "not-allowed" : "pointer",
                fontSize: "1rem",
                boxShadow: "0 4px 12px rgba(242, 182, 50, 0.4)",
                zIndex: 10,
                opacity: submitting ? 0.5 : 1,
              }}
            >
              {submitting ? "Submitting..." : "Confirm"}
            </button>

            {/* Header - Team Info */}
            <div style={{ padding: "3.5rem 2rem 1.5rem", borderBottom: "1px solid rgba(255, 255, 255, 0.1)" }}>
              <div style={{ fontSize: "clamp(1.1rem, 5vw, 1.5rem)", fontWeight: 700, color: "var(--text-main)" }}>
                {myRoster.fantasyTeam.displayName}
              </div>
              <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                {myRoster.fantasyTeam.ownerDisplayName}
              </div>
              <div style={{ fontSize: "0.9rem", color: "var(--accent)", marginTop: "1rem", fontWeight: 600 }}>
                Select {neededDropCount} team{neededDropCount === 1 ? "" : "s"} to drop ({selectedDropTeamIndices.length}/{neededDropCount} selected)
              </div>
            </div>

            {/* Roster Table with Checkboxes */}
            <div style={{ padding: "1.5rem 2rem" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid rgba(255, 255, 255, 0.2)" }}>
                      <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Team</th>
                      <th style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}><HeaderTooltip label="Fpts" full="Fantasy Points" /></th>
                      <th style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>Record</th>
                      <th style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {myTeams.map((team, index) => {
                      // A team already selected to give away in the trade
                      // itself can't also be dropped — it's already leaving.
                      const alreadyGiven = selectedMyTeams.includes(index);
                      const selected = selectedDropTeamIndices.includes(index);
                      return (
                        <tr
                          key={index}
                          style={{
                            borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                            backgroundColor: selected ? "rgba(242, 182, 50, 0.1)" : "transparent",
                            opacity: alreadyGiven ? 0.4 : 1,
                          }}
                        >
                          <td style={{ padding: "0.75rem 0.5rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <Image
                                src={team.logo}
                                alt={team.name}
                                width={24}
                                height={24}
                                style={{ borderRadius: "4px" }}
                              />
                              <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-main)" }}>
                                {team.name}
                              </span>
                              {alreadyGiven && (
                                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                  (already in this trade)
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontWeight: 600, fontSize: "0.9rem" }}>
                            {team.fpts.toFixed(1)}
                          </td>
                          <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                            {team.record}
                          </td>
                          <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                            <button
                              onClick={() => !alreadyGiven && toggleDropTeam(index)}
                              disabled={alreadyGiven}
                              style={{
                                width: "24px",
                                height: "24px",
                                border: "2px solid var(--accent)",
                                borderRadius: "4px",
                                background: selected ? "var(--accent)" : "transparent",
                                cursor: alreadyGiven ? "not-allowed" : "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: selected ? "#1a1a2e" : "transparent",
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
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: "2rem" }}>
        <Link
          href={`/leagues/${leagueId}/opponents`}
          style={{
            display: "inline-block",
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "#ffffff",
            padding: "0.5rem 1rem",
            borderRadius: "6px",
            textDecoration: "none",
            fontSize: "0.9rem",
            marginBottom: "1rem"
          }}
        >
          ← Back to Opponents
        </Link>
        <h1 className="page-heading" style={{ color: "#d4af37", fontSize: "clamp(1.5rem, 6vw, 2.5rem)", margin: 0 }}>Trade</h1>
      </div>

      <section style={{
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        borderRadius: "12px",
        padding: "2rem",
        border: "1px solid rgba(255,255,255,0.1)"
      }}>
        {/* Team Headers */}
        <div className="trade-builder-grid" style={{
          alignItems: "start",
          marginBottom: "2rem",
          paddingBottom: "2rem",
          borderBottom: "1px solid rgba(255,255,255,0.2)"
        }}>
          {/* My Team */}
          <div>
            <h2 style={{
              fontSize: "clamp(1.1rem, 5vw, 1.5rem)",
              fontWeight: 700,
              color: "#ffffff",
              marginBottom: "0.25rem"
            }}>
              {myRoster.fantasyTeam.displayName}
            </h2>
            <p style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "0.9rem",
              margin: "0 0 0.5rem 0"
            }}>
              {myRoster.fantasyTeam.ownerDisplayName}
            </p>
          </div>

          {/* Propose Trade Button */}
          <button
            className="trade-propose-btn"
            style={{
              background: selectedMyTeams.length === 0 || selectedOpponentTeams.length === 0
                ? "rgba(255,255,255,0.2)"
                : "#d4af37",
              border: "none",
              color: selectedMyTeams.length === 0 || selectedOpponentTeams.length === 0
                ? "rgba(255,255,255,0.5)"
                : "#1a1a2e",
              padding: "0.75rem 2rem",
              borderRadius: "8px",
              cursor: selectedMyTeams.length === 0 || selectedOpponentTeams.length === 0
                ? "not-allowed"
                : "pointer",
              fontSize: "1rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
              marginTop: "1rem"
            }}
            onClick={() => {
              if (selectedMyTeams.length > 0 && selectedOpponentTeams.length > 0) {
                setShowConfirmModal(true);
              }
            }}
            disabled={selectedMyTeams.length === 0 || selectedOpponentTeams.length === 0}
          >
            Propose Trade
          </button>

          {/* Opponent Team */}
          <div className="trade-opponent-header">
            <h2 style={{
              fontSize: "clamp(1.1rem, 5vw, 1.5rem)",
              fontWeight: 700,
              color: "#ffffff",
              marginBottom: "0.25rem"
            }}>
              {opponentRoster.fantasyTeam.displayName}
            </h2>
            <p style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "0.9rem",
              margin: "0 0 0.5rem 0"
            }}>
              {opponentRoster.fantasyTeam.ownerDisplayName}
            </p>
          </div>
        </div>

        {/* Trade Grid: one unified row per roster slot (my team | position |
            their team), so position/my-team/their-team correspondence is
            never lost when this collapses to a single column on mobile. */}
        <div>
          {/* Column captions - desktop only, hidden on mobile since each
              slot row below labels itself. */}
          <div className="trade-slot-header">
            <div className="trade-team-cell" style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>
              <div></div>
              <div>Team</div>
              <div style={{ textAlign: "right" }}><HeaderTooltip label="Fpts" full="Fantasy Points" /></div>
              <div style={{ textAlign: "center" }}>Record</div>
              <div></div>
            </div>
            <div />
            <div className="trade-team-cell trade-team-cell--mirror" style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>
              <div></div>
              <div>Team</div>
              <div style={{ textAlign: "right" }}><HeaderTooltip label="Fpts" full="Fantasy Points" /></div>
              <div style={{ textAlign: "center" }}>Record</div>
              <div></div>
            </div>
          </div>

          {/* Iterate over the LONGER of the two rosters — they aren't
              guaranteed to have the same number of filled slots (e.g. one
              side dropped a team without a replacement yet), so pairing by
              array index can run past the end of the shorter one. */}
          {Array.from({ length: Math.max(myTeams.length, opponentTeams.length) }, (_, idx) => {
            const team = myTeams[idx];
            const oppTeam = opponentTeams[idx];
            return (
              <div
                key={team?.id ?? oppTeam?.id ?? idx}
                className="trade-slot-row"
                style={{
                  borderBottom: team?.slot === "FLX" ? "2px solid rgba(255,255,255,0.15)" : "1px solid rgba(255,255,255,0.05)",
                  paddingBottom: "0.75rem",
                  marginBottom: "0.75rem"
                }}
              >
                {/* My team for this slot */}
                <div className="trade-team-cell">
                  {team ? (
                    <>
                      <Image src={team.logo} alt={team.name} width={24} height={24} style={{ borderRadius: "4px" }} />
                      <div
                        onClick={() => openTeamModal(myRoster.rosterSlots[idx], "mine")}
                        style={{ fontSize: "0.9rem", fontWeight: 600, color: "#ffffff", cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#ffffff")}
                      >
                        {team.name}
                      </div>
                      <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.8)", textAlign: "right" }}>{team.fpts.toFixed(1)}</div>
                      <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", textAlign: "center" }}>{team.record}</div>
                      <input
                        type="checkbox"
                        checked={selectedMyTeams.includes(idx)}
                        onChange={() => toggleMyTeam(idx)}
                        style={{
                          width: "20px",
                          height: "20px",
                          cursor: "pointer",
                          accentColor: "#d4af37"
                        }}
                      />
                    </>
                  ) : (
                    <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }}>—</div>
                  )}
                </div>

                {/* Middle grid column intentionally left blank — the row no
                    longer surfaces the roster-slot identifier (2s/3s/FLX/BE). */}
                <div />

                {/* Opponent's team for this slot */}
                <div className="trade-team-cell trade-team-cell--mirror">
                  {oppTeam ? (
                    <>
                      <Image src={oppTeam.logo} alt={oppTeam.name} width={24} height={24} style={{ borderRadius: "4px" }} />
                      <div
                        onClick={() => openTeamModal(opponentRoster.rosterSlots[idx], "opponent")}
                        style={{ fontSize: "0.9rem", fontWeight: 600, color: "#ffffff", cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#ffffff")}
                      >
                        {oppTeam.name}
                      </div>
                      <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.8)", textAlign: "right" }}>{oppTeam.fpts.toFixed(1)}</div>
                      <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", textAlign: "center" }}>{oppTeam.record}</div>
                      <input
                        type="checkbox"
                        checked={selectedOpponentTeams.includes(idx)}
                        onChange={() => toggleOpponentTeam(idx)}
                        style={{
                          width: "20px",
                          height: "20px",
                          cursor: "pointer",
                          accentColor: "#d4af37"
                        }}
                      />
                    </>
                  ) : (
                    <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }}>—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
