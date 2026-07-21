"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useAlert } from "@/components/AlertProvider";
import HeaderTooltip from "@/components/HeaderTooltip";

// Transaction.type is stored distinctly ("trade" / "waiver" / "pickup" /
// "drop") — this just maps each to its display label/color instead of
// collapsing every non-trade type into "Waiver".
function transactionTypeDisplay(type: string): { label: string; bg: string; color: string } {
  switch (type) {
    case "trade":
      return { label: "Trade", bg: "rgba(245, 158, 11, 0.2)", color: "#f59e0b" };
    case "waiver":
      return { label: "Waiver", bg: "rgba(59, 130, 246, 0.2)", color: "#3b82f6" };
    case "drop":
      return { label: "Drop", bg: "rgba(239, 68, 68, 0.2)", color: "#ef4444" };
    default:
      return { label: "Pick Up", bg: "rgba(34, 197, 94, 0.2)", color: "#22c55e" };
  }
}

const HISTORY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "pickup", label: "Pick Ups" },
  { value: "drop", label: "Drops" },
  { value: "trade", label: "Trades" },
  { value: "waiver", label: "Waivers" },
];

// "denied" (a waiver claim that lost to a competing claim) and "vetoed" (a
// trade an admin blocked) both bucket under "cancelled" here — the filter
// only distinguishes "this actually took effect" from "this didn't."
const statusBucket = (status: string) => (status === "approved" ? "approved" : "cancelled");

export default function TransactionsPage() {
  const showAlert = useAlert();
  const [claims, setClaims] = useState<any[]>([]);
  const [pendingTrades, setPendingTrades] = useState<any[]>([]);
  const [transactionHistory, setTransactionHistory] = useState<any[]>([]);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>([]);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<"waivers" | "trades" | "history">(
    "waivers"
  );
  const [historyTypeFilter, setHistoryTypeFilter] = useState<string[]>(
    HISTORY_TYPE_OPTIONS.map((o) => o.value)
  );
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string[]>(["approved", "cancelled"]);

  const toggleHistoryTypeFilter = (value: string) => {
    setHistoryTypeFilter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const toggleHistoryStatusFilter = (value: string) => {
    setHistoryStatusFilter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  // Fetch data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/admin/transactions");

        if (!response.ok) {
          throw new Error("Failed to fetch transactions");
        }

        const data = await response.json();
        setLeagues(data.leagues || []);
        setClaims(data.pendingWaivers || []);
        setPendingTrades(data.pendingTrades || []);
        setTransactionHistory(data.transactionHistory || []);
        setSelectedLeagues((data.leagues || []).map((l: any) => l.id));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Filter handling
  const toggleLeagueFilter = (leagueId: string) => {
    setSelectedLeagues((prev) =>
      prev.includes(leagueId)
        ? prev.filter((id) => id !== leagueId)
        : [...prev, leagueId]
    );
  };

  const selectAllLeagues = () => {
    setSelectedLeagues(leagues.map((l) => l.id));
  };

  const deselectAllLeagues = () => {
    setSelectedLeagues([]);
  };

  // Filtered data based on selected leagues
  const filteredClaims = claims.filter((c) =>
    selectedLeagues.includes(c.fantasyLeague)
  );
  const filteredTrades = pendingTrades.filter((t) =>
    selectedLeagues.includes(t.fantasyLeague)
  );
  const filteredHistory = transactionHistory.filter(
    (t) =>
      selectedLeagues.includes(t.fantasyLeague) &&
      historyTypeFilter.includes(t.type) &&
      historyStatusFilter.includes(statusBucket(t.status))
  );

  // Waiver processing functions
  const processAllWaivers = async () => {
    try {
      const claimIds = filteredClaims.map(c => c.id);

      const response = await fetch("/api/admin/waivers/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ claimIds }),
      });

      if (!response.ok) {
        throw new Error("Failed to process waivers");
      }

      const result = await response.json();

      // Refresh data
      const dataResponse = await fetch("/api/admin/transactions");
      const data = await dataResponse.json();
      setClaims(data.pendingWaivers || []);
      setTransactionHistory(data.transactionHistory || []);

      setShowConfirmModal(false);
      showAlert(`Successfully processed ${result.processed} waiver claims! (${result.approved} approved, ${result.denied} denied, ${result.cancelled ?? 0} cancelled — locked team)`, "success");
    } catch (error) {
      console.error("Error processing waivers:", error);
      showAlert("Failed to process waivers. Please try again.", "error");
    }
  };

  // Waiver claims are resolved automatically (priority/FAAB bid, run on the
  // league's scheduled waiver day) — there's no admin "approve" or "deny"
  // judgment call to make. This just forces that same automatic resolution
  // to run right now for one specific claim instead of waiting for the
  // schedule, e.g. to unblock a manager. If the claimed team already got
  // taken by a higher-priority claim, processing naturally resolves it as
  // lost — there's no separate "deny" action distinct from this.
  const processClaimNow = async (id: string) => {
    try {
      const response = await fetch("/api/admin/waivers/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ claimIds: [id] }),
      });

      if (!response.ok) {
        throw new Error("Failed to process waiver claim");
      }

      // Refresh data
      const dataResponse = await fetch("/api/admin/transactions");
      const data = await dataResponse.json();
      setClaims(data.pendingWaivers || []);
      setTransactionHistory(data.transactionHistory || []);

      showAlert("Waiver claim processed!", "success");
    } catch (error) {
      console.error("Error processing waiver claim:", error);
      showAlert("Failed to process waiver claim. Please try again.", "error");
    }
  };

  // Trade processing functions
  const vetoTrade = async (id: string) => {
    try {
      const response = await fetch("/api/admin/trades/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tradeId: id,
          reason: "Vetoed by admin"
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        showAlert(data.error || "Failed to veto trade", "error");
      } else {
        showAlert("Trade vetoed!", "success");
      }
    } catch (error: any) {
      console.error("Error vetoing trade:", error);
      showAlert("Failed to veto trade. Please try again.", "error");
    } finally {
      // Whether vetoed, rejected as too late, or auto-processed in the
      // meantime, the list may have changed — refresh either way.
      const dataResponse = await fetch("/api/admin/transactions");
      const refreshed = await dataResponse.json();
      setPendingTrades(refreshed.pendingTrades || []);
      setTransactionHistory(refreshed.transactionHistory || []);
    }
  };

  // Executes a trade right away instead of waiting out the rest of its
  // 12-hour veto window — for when an admin is confident it won't be vetoed.
  const processTradeNow = async (id: string) => {
    if (!confirm("Process this trade now instead of waiting out the rest of the veto window?")) {
      return;
    }
    try {
      const response = await fetch("/api/admin/trades/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tradeId: id,
          action: "process",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        showAlert(data.error || "Failed to process trade", "error");
      } else {
        showAlert("Trade processed!", "success");
      }
    } catch (error: any) {
      console.error("Error processing trade:", error);
      showAlert("Failed to process trade. Please try again.", "error");
    } finally {
      const dataResponse = await fetch("/api/admin/transactions");
      const refreshed = await dataResponse.json();
      setPendingTrades(refreshed.pendingTrades || []);
      setTransactionHistory(refreshed.transactionHistory || []);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>Loading transactions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#ef4444", fontSize: "1.1rem" }}>
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Confirmation Modal */}
      {showConfirmModal && (
        <>
          <div
            className="modal-backdrop"
            onClick={() => setShowConfirmModal(false)}
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
                  marginBottom: "1rem",
                  color: "var(--accent)",
                }}
              >
                Process All Waivers
              </h2>
              <p
                style={{
                  fontSize: "1rem",
                  color: "var(--text-muted)",
                  marginBottom: "2rem",
                  lineHeight: 1.6,
                }}
              >
                Are you sure you want to process all {filteredClaims.length}{" "}
                pending waiver claims for the selected leagues? This action
                cannot be undone.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setShowConfirmModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={processAllWaivers}
                >
                  Process All
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Filter Bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          alignItems: "center",
          marginBottom: "1.5rem",
          padding: "1rem",
          background: "rgba(255,255,255,0.05)",
          borderRadius: "8px",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <div style={{ flex: 1, minWidth: "200px", position: "relative" }}>
          <button
            className="btn btn-ghost"
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            style={{
              width: "100%",
              justifyContent: "space-between",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span>Fantasy Leagues ({selectedLeagues.length} selected)</span>
            <span style={{ fontSize: "0.75rem" }}>▼</span>
          </button>

          {showFilterDropdown && (
            <>
              <div
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 998,
                }}
                onClick={() => setShowFilterDropdown(false)}
              />
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 0.5rem)",
                  left: 0,
                  right: 0,
                  background: "rgba(15, 23, 42, 0.98)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "8px",
                  padding: "1rem",
                  zIndex: 999,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    marginBottom: "1rem",
                  }}
                >
                  <button
                    className="btn btn-ghost"
                    onClick={selectAllLeagues}
                    style={{ flex: 1, fontSize: "0.85rem", padding: "0.4rem" }}
                  >
                    Select All
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={deselectAllLeagues}
                    style={{ flex: 1, fontSize: "0.85rem", padding: "0.4rem" }}
                  >
                    Deselect All
                  </button>
                </div>
                {leagues.map((league) => (
                  <label
                    key={league.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.5rem",
                      cursor: "pointer",
                      borderRadius: "4px",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(255,255,255,0.05)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selectedLeagues.includes(league.id)}
                      onChange={() => toggleLeagueFilter(league.id)}
                      style={{
                        width: "16px",
                        height: "16px",
                        cursor: "pointer",
                      }}
                    />
                    <span style={{ fontSize: "0.95rem" }}>{league.name}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {activeTab === "waivers" && (
          <button
            className="btn btn-primary"
            style={{ padding: "0.75rem 2rem", fontSize: "1.05rem" }}
            onClick={() => setShowConfirmModal(true)}
            disabled={filteredClaims.length === 0}
          >
            Process All Waivers
          </button>
        )}
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "1.5rem",
          borderBottom: "2px solid rgba(255,255,255,0.1)",
        }}
      >
        <button
          onClick={() => setActiveTab("waivers")}
          style={{
            padding: "0.75rem 1.5rem",
            background: "transparent",
            border: "none",
            borderBottom:
              activeTab === "waivers"
                ? "2px solid var(--accent)"
                : "2px solid transparent",
            color:
              activeTab === "waivers" ? "var(--accent)" : "var(--text-muted)",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: "1rem",
            marginBottom: "-2px",
          }}
        >
          Pending Waivers ({filteredClaims.length})
        </button>
        <button
          onClick={() => setActiveTab("trades")}
          style={{
            padding: "0.75rem 1.5rem",
            background: "transparent",
            border: "none",
            borderBottom:
              activeTab === "trades"
                ? "2px solid var(--accent)"
                : "2px solid transparent",
            color:
              activeTab === "trades" ? "var(--accent)" : "var(--text-muted)",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: "1rem",
            marginBottom: "-2px",
          }}
        >
          Pending Trades ({filteredTrades.length})
        </button>
        <button
          onClick={() => setActiveTab("history")}
          style={{
            padding: "0.75rem 1.5rem",
            background: "transparent",
            border: "none",
            borderBottom:
              activeTab === "history"
                ? "2px solid var(--accent)"
                : "2px solid transparent",
            color:
              activeTab === "history" ? "var(--accent)" : "var(--text-muted)",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: "1rem",
            marginBottom: "-2px",
          }}
        >
          Transaction History ({filteredHistory.length})
        </button>
      </div>

      {/* Pending Waivers Tab */}
      {activeTab === "waivers" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          {filteredClaims.length === 0 ? (
            <div
              style={{
                padding: "3rem 2rem",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              <p style={{ fontSize: "1.1rem" }}>
                No pending waiver claims for selected leagues
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      width: "60px",
                    }}
                  >
                    #
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    League
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Manager
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Add Team
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Drop Team
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
                    <HeaderTooltip label="FAAB Bid" full="Free Agent Acquisition Budget Bid" />
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Submitted
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
                {filteredClaims.map((claim) => (
                  <tr
                    key={claim.id}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                  >
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "center",
                        fontWeight: 700,
                        fontSize: "1.1rem",
                        color: "var(--accent)",
                      }}
                    >
                      {claim.priority}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        fontSize: "0.85rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      {claim.fantasyLeagueName}
                    </td>
                    <td style={{ padding: "0.75rem 0.5rem" }}>
                      <div style={{ fontWeight: 600 }}>{claim.manager}</div>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        {claim.teamName}
                      </div>
                    </td>
                    <td style={{ padding: "0.75rem 0.5rem" }}>
                      {claim.addTeam ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <Image
                            src={claim.addTeam.logoPath}
                            alt={claim.addTeam.name}
                            width={24}
                            height={24}
                            style={{ borderRadius: "4px" }}
                          />
                          <span style={{ fontWeight: 600 }}>
                            {claim.addTeam.leagueId} {claim.addTeam.name}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "0.75rem 0.5rem" }}>
                      {claim.dropTeam ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <Image
                            src={claim.dropTeam.logoPath}
                            alt={claim.dropTeam.name}
                            width={24}
                            height={24}
                            style={{ borderRadius: "4px" }}
                          />
                          <span style={{ fontWeight: 600 }}>
                            {claim.dropTeam.leagueId} {claim.dropTeam.name}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "center",
                        fontWeight: 600,
                        color: claim.faabBid
                          ? "var(--accent)"
                          : "var(--text-muted)",
                      }}
                    >
                      {claim.faabBid ? `$${claim.faabBid}` : "-"}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        fontSize: "0.85rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      {new Date(claim.submitted).toLocaleString()}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "right",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: "0.5rem",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          className="btn btn-primary"
                          style={{
                            padding: "0.4rem 1rem",
                            fontSize: "0.85rem",
                          }}
                          onClick={() => processClaimNow(claim.id)}
                          title="Run this claim's normal automatic resolution now instead of waiting for the scheduled waiver day"
                        >
                          Process Now
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {/* Pending Trades Tab */}
      {activeTab === "trades" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          {filteredTrades.length === 0 ? (
            <div
              style={{
                padding: "3rem 2rem",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              <p style={{ fontSize: "1.1rem" }}>
                No pending trades for selected leagues
              </p>
            </div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              {filteredTrades.map((trade) => (
                <div
                  key={trade.id}
                  style={{
                    padding: "1.5rem",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "0.75rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: "0.25rem",
                        }}
                      >
                        <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                          {trade.fantasyLeagueName}
                        </span>
                        <span
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "4px",
                            background:
                              trade.status === "awaiting_veto"
                                ? "rgba(245, 158, 11, 0.2)"
                                : "rgba(255,255,255,0.1)",
                            color: trade.status === "awaiting_veto" ? "#f59e0b" : "var(--text-muted)",
                          }}
                        >
                          {trade.status === "awaiting_veto" ? "Awaiting Veto" : "Awaiting Manager Response"}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "1.1rem",
                          fontWeight: 600,
                          color: "var(--text-main)",
                        }}
                      >
                        {trade.proposer} ⇄ {trade.receiver}
                      </div>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--text-muted)",
                          marginTop: "0.25rem",
                        }}
                      >
                        Submitted: {new Date(trade.submitted).toLocaleString()}
                        {trade.status === "awaiting_veto" && trade.vetoDeadline && (
                          <>
                            {" "}
                            • Auto-processes at{" "}
                            {new Date(trade.vetoDeadline).toLocaleString()} unless vetoed
                          </>
                        )}
                      </div>
                    </div>
                    {trade.status === "awaiting_veto" && (
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button
                          className="btn btn-ghost"
                          style={{
                            padding: "0.5rem 1.25rem",
                            fontSize: "0.9rem",
                            background:
                              "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                          }}
                          onClick={() => processTradeNow(trade.id)}
                          title="Execute this trade now instead of waiting out the rest of the veto window"
                        >
                          Process Now
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{
                            padding: "0.5rem 1.25rem",
                            fontSize: "0.9rem",
                            background:
                              "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                          }}
                          onClick={() => vetoTrade(trade.id)}
                        >
                          Veto
                        </button>
                      </div>
                    )}
                  </div>

                  <div
                    className="matchup-hero-grid"
                    style={{
                      gap: "1.5rem",
                      alignItems: "center",
                    }}
                  >
                    {/* Proposer Gives */}
                    <div>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: "var(--text-muted)",
                          marginBottom: "0.75rem",
                          textTransform: "uppercase",
                        }}
                      >
                        {trade.proposerTeam} Gives
                      </div>
                      {trade.proposerGivesTeams.map((team: any, idx: number) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            marginBottom: "0.5rem",
                          }}
                        >
                          <Image
                            src={team.logoPath}
                            alt={team.name}
                            width={32}
                            height={32}
                            style={{ borderRadius: "4px" }}
                          />
                          <span style={{ fontWeight: 600 }}>
                            {team.leagueId} {team.name}
                          </span>
                        </div>
                      ))}

                      {(trade.proposerDropsTeams ?? []).length > 0 && (
                        <>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: "rgba(255,255,255,0.5)",
                              marginTop: "0.75rem",
                              marginBottom: "0.5rem",
                            }}
                          >
                            Dropping (to make room):
                          </div>
                          {trade.proposerDropsTeams.map((team: any, idx: number) => (
                            <div
                              key={`drop-${idx}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                marginBottom: "0.5rem",
                              }}
                            >
                              <span style={{ fontSize: "1rem", color: "#ef4444", fontWeight: 700 }}>−</span>
                              <Image
                                src={team.logoPath}
                                alt={team.name}
                                width={28}
                                height={28}
                                style={{ borderRadius: "4px", opacity: 0.7 }}
                              />
                              <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
                                {team.leagueId} {team.name}
                              </span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>

                    {/* Arrow */}
                    <div style={{ fontSize: "2rem", color: "var(--accent)" }}>
                      ⇄
                    </div>

                    {/* Receiver Gives */}
                    <div>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: "var(--text-muted)",
                          marginBottom: "0.75rem",
                          textTransform: "uppercase",
                        }}
                      >
                        {trade.receiverTeam} Gives
                      </div>
                      {trade.receiverGivesTeams.map((team: any, idx: number) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            marginBottom: "0.5rem",
                          }}
                        >
                          <Image
                            src={team.logoPath}
                            alt={team.name}
                            width={32}
                            height={32}
                            style={{ borderRadius: "4px" }}
                          />
                          <span style={{ fontWeight: 600 }}>
                            {team.leagueId} {team.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transaction History Tab */}
      {activeTab === "history" && (
        <section style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          borderRadius: "12px",
          padding: "2rem",
          border: "1px solid rgba(255,255,255,0.1)"
        }}>
          {/* Type + Status filters */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "1.5rem",
              marginBottom: "1.5rem",
              paddingBottom: "1.5rem",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div>
              <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Type
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {HISTORY_TYPE_OPTIONS.map((opt) => {
                  const active = historyTypeFilter.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleHistoryTypeFilter(opt.value)}
                      style={{
                        padding: "0.4rem 0.9rem",
                        borderRadius: "999px",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: active ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.2)",
                        background: active ? "rgba(242, 182, 50, 0.2)" : "rgba(255,255,255,0.05)",
                        color: active ? "var(--accent)" : "rgba(255,255,255,0.6)",
                        transition: "all 0.2s",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Status
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {[
                  { value: "approved", label: "Approved" },
                  { value: "cancelled", label: "Cancelled" },
                ].map((opt) => {
                  const active = historyStatusFilter.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleHistoryStatusFilter(opt.value)}
                      style={{
                        padding: "0.4rem 0.9rem",
                        borderRadius: "999px",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: active ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.2)",
                        background: active ? "rgba(242, 182, 50, 0.2)" : "rgba(255,255,255,0.05)",
                        color: active ? "var(--accent)" : "rgba(255,255,255,0.6)",
                        transition: "all 0.2s",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {transactionHistory.filter((t) => selectedLeagues.includes(t.fantasyLeague)).length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "rgba(255,255,255,0.5)" }}>
              No transaction history for selected leagues
            </div>
          ) : filteredHistory.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "rgba(255,255,255,0.5)" }}>
              No transactions match the selected filters
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {filteredHistory.map((transaction) => (
                <div
                  key={transaction.id}
                  style={{
                    background: "rgba(15, 23, 42, 0.6)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px",
                    padding: "1.25rem 1.5rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          padding: "0.2rem 0.6rem",
                          borderRadius: "4px",
                          background: transactionTypeDisplay(transaction.type).bg,
                          color: transactionTypeDisplay(transaction.type).color,
                        }}
                      >
                        {transactionTypeDisplay(transaction.type).label}
                      </span>
                      {transaction.type === "trade" ? (
                        <>
                          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "white" }}>
                            {transaction.proposerTeam}
                          </span>
                          <span style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.5)" }}>
                            {transaction.proposer}
                          </span>
                          <span style={{ fontSize: "1.1rem", color: "#f59e0b" }}>⇄</span>
                          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "white" }}>
                            {transaction.receiverTeam}
                          </span>
                          <span style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.5)" }}>
                            {transaction.receiver}
                          </span>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "white" }}>
                            {transaction.teamName}
                          </span>
                          <span style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.5)" }}>
                            {transaction.manager}
                          </span>
                        </>
                      )}
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          padding: "0.15rem 0.5rem",
                          borderRadius: "4px",
                          background:
                            transaction.status === "approved"
                              ? "rgba(34, 197, 94, 0.15)"
                              : ["denied", "vetoed", "cancelled"].includes(transaction.status)
                              ? "rgba(239, 68, 68, 0.15)"
                              : "rgba(255,255,255,0.1)",
                          color:
                            transaction.status === "approved"
                              ? "#22c55e"
                              : ["denied", "vetoed", "cancelled"].includes(transaction.status)
                              ? "#ef4444"
                              : "var(--text-muted)",
                        }}
                      >
                        {transaction.status}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)" }}>
                      {transaction.processed
                        ? new Date(transaction.processed).toLocaleString()
                        : ""}
                    </div>
                  </div>

                  {transaction.type === "trade" ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "rgba(255,255,255,0.5)",
                            textTransform: "uppercase",
                            marginBottom: "0.4rem",
                          }}
                        >
                          {transaction.proposerTeam} received
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                          {(transaction.receiverGivesTeams || []).map((team: any) => (
                            <div key={`prop-recv-${team.id}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontSize: "0.9rem", color: "#22c55e", fontWeight: 700 }}>+</span>
                              <Image src={team.logoPath} alt={team.name} width={28} height={28} style={{ borderRadius: "4px" }} />
                              <span style={{ fontSize: "0.9rem", color: "white" }}>
                                {team.leagueId} {team.name}
                              </span>
                            </div>
                          ))}
                        </div>
                        {(transaction.proposerDropsTeams ?? []).length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem" }}>
                            {transaction.proposerDropsTeams.map((team: any) => (
                              <div key={`prop-drop-${team.id}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <span style={{ fontSize: "0.7rem", color: "#ef4444", fontWeight: 700, textTransform: "uppercase" }}>
                                  Dropped
                                </span>
                                <Image src={team.logoPath} alt={team.name} width={28} height={28} style={{ borderRadius: "4px", opacity: 0.7 }} />
                                <span style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)" }}>
                                  {team.leagueId} {team.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: "1.5rem", color: "#f59e0b" }}>⇄</div>
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "rgba(255,255,255,0.5)",
                            textTransform: "uppercase",
                            marginBottom: "0.4rem",
                          }}
                        >
                          {transaction.receiverTeam} received
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                          {(transaction.proposerGivesTeams || []).map((team: any) => (
                            <div key={`recv-recv-${team.id}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontSize: "0.9rem", color: "#22c55e", fontWeight: 700 }}>+</span>
                              <Image src={team.logoPath} alt={team.name} width={28} height={28} style={{ borderRadius: "4px" }} />
                              <span style={{ fontSize: "0.9rem", color: "white" }}>
                                {team.leagueId} {team.name}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      {transaction.addTeam && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ fontSize: "1.25rem", color: "#22c55e", fontWeight: 700 }}>+</span>
                          <Image
                            src={transaction.addTeam.logoPath}
                            alt={transaction.addTeam.name}
                            width={32}
                            height={32}
                            style={{ borderRadius: "6px" }}
                          />
                          <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "white" }}>
                            {transaction.addTeam.leagueId} {transaction.addTeam.name}
                          </span>
                        </div>
                      )}
                      {transaction.dropTeam && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ fontSize: "1.25rem", color: "#ef4444", fontWeight: 700 }}>−</span>
                          <Image
                            src={transaction.dropTeam.logoPath}
                            alt={transaction.dropTeam.name}
                            width={32}
                            height={32}
                            style={{ borderRadius: "6px" }}
                          />
                          <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "white" }}>
                            {transaction.dropTeam.leagueId} {transaction.dropTeam.name}
                          </span>
                        </div>
                      )}
                      {!transaction.addTeam && !transaction.dropTeam && (
                        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.9rem" }}>
                          No team details available
                        </span>
                      )}
                    </div>
                  )}

                  {transaction.reason && (
                    <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", fontStyle: "italic" }}>
                      {transaction.reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
