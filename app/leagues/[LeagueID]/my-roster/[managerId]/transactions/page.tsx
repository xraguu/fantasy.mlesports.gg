"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { TEAMS } from "@/lib/teams";

interface Transaction {
  id: string;
  type: "trade" | "waiver" | "pickup" | "drop";
  // Team info
  teamName?: string;
  username?: string;
  // Trade fields
  fromTeam?: string;
  fromManager?: string;
  toTeam?: string;
  toManager?: string;
  givingTeams?: string[];
  receivingTeams?: string[];
  // Waiver/FA fields
  addTeamId?: string;
  dropTeamId?: string;
  faabBid?: number;
  status: string;
  timestamp: string;
}

export default function TransactionsPage() {
  const params = useParams();
  const leagueId = params.LeagueID as string;
  const teamId = params.managerId as string;

  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<string[]>(["Waiver", "Trade", "Pick Up/Drop"]);
  const [managerFilterOpen, setManagerFilterOpen] = useState(false);
  const [selectedManagers, setSelectedManagers] = useState<string[]>([]);
  const [allManagers, setAllManagers] = useState<string[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // Fetch transactions
        const transactionsResponse = await fetch(
          `/api/leagues/${leagueId}/transactions`
        );
        if (!transactionsResponse.ok) {
          throw new Error("Failed to fetch transactions");
        }
        const transactionsData = await transactionsResponse.json();
        setTransactions(transactionsData.transactions || []);

        // Fetch all managers from standings
        const standingsResponse = await fetch(
          `/api/leagues/${leagueId}/standings`
        );
        if (!standingsResponse.ok) {
          throw new Error("Failed to fetch managers");
        }
        const standingsData = await standingsResponse.json();
        const managers = standingsData.standings.map((s: any) => s.manager);
        setAllManagers(managers);
        setSelectedManagers(managers); // Default to all managers selected

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    if (leagueId) {
      fetchData();
    }
  }, [leagueId]);

  const getTeamByMLEId = (mleTeamId: string) => {
    if (!mleTeamId) return null;
    // Handle case-insensitive lookup (database might have "plSpartans" while TEAMS has "PLSpartans")
    return TEAMS.find(t => t.id.toLowerCase() === mleTeamId.toLowerCase());
  };

  const toggleFilter = (filter: string) => {
    setSelectedFilters((prev) =>
      prev.includes(filter)
        ? prev.filter((f) => f !== filter)
        : [...prev, filter]
    );
  };

  const toggleManagerFilter = (manager: string) => {
    setSelectedManagers((prev) =>
      prev.includes(manager)
        ? prev.filter((m) => m !== manager)
        : [...prev, manager]
    );
  };

  const filteredTransactions = transactions.filter((transaction) => {
    // Filter by transaction type (if any filters selected, only show those types)
    if (selectedFilters.length > 0) {
      const typeMatch =
        (selectedFilters.includes("Trade") && transaction.type === "trade") ||
        (selectedFilters.includes("Waiver") && transaction.type === "waiver") ||
        (selectedFilters.includes("Pick Up/Drop") && (transaction.type === "pickup" || transaction.type === "drop"));

      if (!typeMatch) return false;
    }

    // Filter by manager (if any managers selected, only show transactions involving those managers)
    if (selectedManagers.length > 0) {
      const isInvolved =
        (transaction.username && selectedManagers.includes(transaction.username)) ||
        (transaction.fromManager && selectedManagers.includes(transaction.fromManager)) ||
        (transaction.toManager && selectedManagers.includes(transaction.toManager));

      if (!isInvolved) return false;
    }

    return true;
  });

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
    <>
      {/* Page Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "clamp(1.5rem, 6vw, 2.5rem)", color: "#f59e0b", fontWeight: 700, margin: 0 }}>
          Transactions
        </h1>
      </div>

      <section style={{
        background: "radial-gradient(circle at top left, #1d3258, #020617)",
        borderRadius: "12px",
        padding: "2rem",
        border: "1px solid rgba(255,255,255,0.1)"
      }}>
        {/* Filters */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
          {/* Transaction Type Filter */}
          <div style={{ position: "relative", width: "200px", maxWidth: "100%" }}>
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "white",
                padding: "0.6rem 1.2rem",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "0.95rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
              }}
            >
              <span>Type ({selectedFilters.length}) ▼</span>
            </button>

            {filterOpen && (
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
                  onClick={() => setFilterOpen(false)}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    marginTop: "0.5rem",
                    background: "#1e293b",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    border: "1px solid rgba(255,255,255,0.2)",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                    zIndex: 999,
                    minWidth: "200px",
                  }}
                >
                  {["Waiver", "Trade", "Pick Up/Drop"].map((filter) => (
                    <label
                      key={filter}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        padding: "0.6rem 0.5rem",
                        cursor: "pointer",
                        borderRadius: "6px",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "rgba(255,255,255,0.05)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selectedFilters.includes(filter)}
                        onChange={() => toggleFilter(filter)}
                        style={{
                          width: "16px",
                          height: "16px",
                          cursor: "pointer",
                          accentColor: "#f59e0b",
                        }}
                      />
                      <span style={{ color: "white", fontWeight: 600, fontSize: "0.9rem" }}>
                        {filter}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Manager Filter */}
          <div style={{ position: "relative", width: "220px", maxWidth: "100%" }}>
            <button
              onClick={() => setManagerFilterOpen(!managerFilterOpen)}
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "white",
                padding: "0.6rem 1.2rem",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "0.95rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
              }}
            >
              <span>Manager ({selectedManagers.length}) ▼</span>
            </button>

            {managerFilterOpen && (
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
                  onClick={() => setManagerFilterOpen(false)}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    marginTop: "0.5rem",
                    background: "#1e293b",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    border: "1px solid rgba(255,255,255,0.2)",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                    zIndex: 999,
                    minWidth: "220px",
                    maxHeight: "300px",
                    overflowY: "auto",
                  }}
                >
                  {allManagers.map((manager) => (
                    <label
                      key={manager}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        padding: "0.6rem 0.5rem",
                        cursor: "pointer",
                        borderRadius: "6px",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "rgba(255,255,255,0.05)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selectedManagers.includes(manager)}
                        onChange={() => toggleManagerFilter(manager)}
                        style={{
                          width: "16px",
                          height: "16px",
                          cursor: "pointer",
                          accentColor: "#f59e0b",
                        }}
                      />
                      <span style={{ color: "white", fontWeight: 600, fontSize: "0.9rem" }}>
                        {manager}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Transactions List */}
        {filteredTransactions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "rgba(255,255,255,0.5)" }}>
            No transactions yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {filteredTransactions.map((transaction) => (
              <div
                key={transaction.id}
                style={{
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "0",
                  padding: "1.25rem 1.5rem",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "1rem",
                }}
              >
                {transaction.type === "trade" ? (
                  // TRADE TRANSACTION
                  <>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "white" }}>
                        {transaction.fromTeam}
                      </div>
                      <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.5)" }}>
                        {transaction.fromManager}
                      </div>
                    </div>

                    <div style={{ fontSize: "2rem", color: "#f59e0b" }}>
                      →
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "white" }}>
                        {transaction.toTeam}
                      </div>
                      <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.5)" }}>
                        {transaction.toManager}
                      </div>
                    </div>

                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      minWidth: "150px"
                    }}>
                      <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem" }}>
                        Date processed
                      </div>
                      <div style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>
                        {new Date(transaction.timestamp).toLocaleString()}
                      </div>
                    </div>

                    <button
                      style={{
                        background: "rgba(255,255,255,0.2)",
                        border: "none",
                        color: "white",
                        padding: "0.6rem 1.5rem",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "0.95rem",
                        fontWeight: 600,
                      }}
                    >
                      View
                    </button>
                  </>
                ) : transaction.type === "waiver" ? (
                  // WAIVER CLAIM TRANSACTION
                  <>
                    <div style={{ flex: "0 0 200px" }}>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "white" }}>
                        {transaction.teamName}
                      </div>
                      <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.5)" }}>
                        {transaction.username}
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", flex: 1 }}>
                      {transaction.addTeamId && (() => {
                        const teamAdded = getTeamByMLEId(transaction.addTeamId);
                        return teamAdded ? (
                          <>
                            <Image
                              src={teamAdded.logoPath}
                              alt={teamAdded.name}
                              width={40}
                              height={40}
                              style={{ borderRadius: "6px" }}
                            />
                            <div style={{ fontSize: "1rem", fontWeight: 600, color: "white" }}>
                              {teamAdded.leagueId} {teamAdded.name}
                            </div>
                          </>
                        ) : null;
                      })()}

                      {transaction.addTeamId && transaction.dropTeamId && (
                        <div style={{ fontSize: "1.5rem", color: "rgba(255,255,255,0.3)", marginLeft: "0.5rem", marginRight: "0.5rem" }}>
                          →
                        </div>
                      )}

                      {transaction.dropTeamId && (() => {
                        const teamDropped = getTeamByMLEId(transaction.dropTeamId);
                        return teamDropped ? (
                          <div style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.5)" }}>
                            {teamDropped.leagueId} {teamDropped.name}
                          </div>
                        ) : null;
                      })()}
                    </div>

                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      minWidth: "150px"
                    }}>
                      <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem" }}>
                        Date processed
                      </div>
                      <div style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>
                        {new Date(transaction.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </>
                ) : (
                  // PICKUP OR DROP TRANSACTION
                  <>
                    <div style={{ flex: "0 0 200px" }}>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "white" }}>
                        {transaction.teamName}
                      </div>
                      <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.5)" }}>
                        {transaction.username}
                      </div>
                    </div>

                    <div style={{ flex: 1 }}>
                      {transaction.addTeamId && (() => {
                        const teamAdded = getTeamByMLEId(transaction.addTeamId);
                        return teamAdded ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <div style={{ fontSize: "1.5rem", color: "#22c55e", fontWeight: 700 }}>
                              +
                            </div>
                            <Image
                              src={teamAdded.logoPath}
                              alt={teamAdded.name}
                              width={40}
                              height={40}
                              style={{ borderRadius: "6px" }}
                            />
                            <div style={{ fontSize: "1rem", fontWeight: 600, color: "white" }}>
                              {teamAdded.leagueId} {teamAdded.name}
                            </div>
                          </div>
                        ) : null;
                      })()}

                      {transaction.dropTeamId && (() => {
                        const teamDropped = getTeamByMLEId(transaction.dropTeamId);
                        return teamDropped ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <div style={{ fontSize: "1.5rem", color: "#ef4444", fontWeight: 700 }}>
                              −
                            </div>
                            <Image
                              src={teamDropped.logoPath}
                              alt={teamDropped.name}
                              width={40}
                              height={40}
                              style={{ borderRadius: "6px" }}
                            />
                            <div style={{ fontSize: "1rem", fontWeight: 600, color: "white" }}>
                              {teamDropped.leagueId} {teamDropped.name}
                            </div>
                          </div>
                        ) : null;
                      })()}
                    </div>

                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      minWidth: "150px"
                    }}>
                      <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem" }}>
                        Date processed
                      </div>
                      <div style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>
                        {new Date(transaction.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
