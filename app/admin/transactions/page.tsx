"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { TEAMS } from "@/lib/teams";
import { useAlert } from "@/components/AlertProvider";

interface PendingWaiver {
  id: string;
  priority: number;
  manager: string;
  teamName: string;
  fantasyLeague: string;
  fantasyLeagueName: string;
  addTeamId: string | null;
  dropTeamId: string | null;
  faabBid: number;
  status: string;
  submitted: string;
}

interface PendingTrade {
  id: string;
  fantasyLeague: string;
  fantasyLeagueName: string;
  proposer: string;
  proposerTeam: string;
  receiver: string;
  receiverTeam: string;
  proposerGives: string[];
  receiverGives: string[];
  status: string;
  submitted: string;
}

interface TransactionHistory {
  id: string;
  type: string;
  fantasyLeague: string;
  fantasyLeagueName: string;
  manager: string;
  teamName: string;
  addTeamId: string | null;
  dropTeamId: string | null;
  status: string;
  processed: string;
  reason: string | null;
}

export default function AdminTransactionsPage() {
  const showAlert = useAlert();
  const [selectedTab, setSelectedTab] = useState<"waivers" | "trades" | "history">("waivers");
  const [filterLeague, setFilterLeague] = useState("all");
  const [pendingWaivers, setPendingWaivers] = useState<PendingWaiver[]>([]);
  const [pendingTrades, setPendingTrades] = useState<PendingTrade[]>([]);
  const [transactionHistory, setTransactionHistory] = useState<TransactionHistory[]>([]);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (filterLeague !== "all") {
          params.append("leagueId", filterLeague);
        }

        const response = await fetch(`/api/admin/transactions?${params}`);
        if (!response.ok) throw new Error("Failed to fetch transactions");

        const data = await response.json();
        setPendingWaivers(data.pendingWaivers || []);
        setPendingTrades(data.pendingTrades || []);
        setTransactionHistory(data.transactionHistory || []);
        setLeagues(data.leagues || []);
      } catch (error) {
        console.error("Error fetching transactions:", error);
        showAlert("Failed to fetch transactions", "error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filterLeague]);

  const getTeamByMLEId = (mleTeamId: string) => {
    if (!mleTeamId) return null;
    return TEAMS.find((t) => t.id.toLowerCase() === mleTeamId.toLowerCase());
  };

  const renderPendingWaivers = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {pendingWaivers.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem",
            color: "rgba(255,255,255,0.5)",
          }}
        >
          No pending waivers
        </div>
      ) : (
        pendingWaivers.map((waiver) => (
          <div
            key={waiver.id}
            style={{
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: "8px",
              padding: "1.25rem 1.5rem",
              display: "grid",
              gridTemplateColumns: "60px 1fr 2fr 150px 100px",
              alignItems: "center",
              gap: "1.5rem",
            }}
          >
            {/* Priority */}
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "rgba(255,255,255,0.5)",
                  marginBottom: "0.25rem",
                }}
              >
                Priority
              </div>
              <div
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: "var(--accent)",
                }}
              >
                {waiver.priority}
              </div>
            </div>

            {/* Team Info */}
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "white" }}>
                {waiver.teamName}
              </div>
              <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)" }}>
                {waiver.manager}
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "rgba(255,255,255,0.4)",
                  marginTop: "0.25rem",
                }}
              >
                {waiver.fantasyLeagueName}
              </div>
            </div>

            {/* Transaction Details */}
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              {waiver.addTeamId && (() => {
                const teamAdded = getTeamByMLEId(waiver.addTeamId);
                return teamAdded ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div
                      style={{
                        fontSize: "1.25rem",
                        color: "#22c55e",
                        fontWeight: 700,
                      }}
                    >
                      +
                    </div>
                    <Image
                      src={teamAdded.logoPath}
                      alt={teamAdded.name}
                      width={36}
                      height={36}
                      style={{ borderRadius: "6px" }}
                    />
                    <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "white" }}>
                      {teamAdded.leagueId} {teamAdded.name}
                    </div>
                  </div>
                ) : null;
              })()}

              {waiver.addTeamId && waiver.dropTeamId && (
                <div style={{ fontSize: "1.25rem", color: "rgba(255,255,255,0.3)" }}>→</div>
              )}

              {waiver.dropTeamId && (() => {
                const teamDropped = getTeamByMLEId(waiver.dropTeamId);
                return teamDropped ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ fontSize: "1.25rem", color: "#ef4444", fontWeight: 700 }}>
                      −
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.5)",
                      }}
                    >
                      {teamDropped.leagueId} {teamDropped.name}
                    </div>
                  </div>
                ) : null;
              })()}
            </div>

            {/* FAAB Bid */}
            <div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "rgba(255,255,255,0.5)",
                  marginBottom: "0.25rem",
                }}
              >
                FAAB Bid
              </div>
              <div
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  color: "#fbbf24",
                }}
              >
                ${waiver.faabBid}
              </div>
            </div>

            {/* Submitted Date */}
            <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)" }}>
              {new Date(waiver.submitted).toLocaleDateString()}
            </div>
          </div>
        ))
      )}
    </div>
  );

  const renderPendingTrades = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {pendingTrades.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem",
            color: "rgba(255,255,255,0.5)",
          }}
        >
          No pending trades
        </div>
      ) : (
        pendingTrades.map((trade) => (
          <div
            key={trade.id}
            style={{
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: "8px",
              padding: "1.5rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "1rem",
              }}
            >
              <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)" }}>
                {trade.fantasyLeagueName}
              </div>
              <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)" }}>
                {new Date(trade.submitted).toLocaleDateString()}
              </div>
            </div>

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
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "white", marginBottom: "0.5rem" }}>
                  {trade.proposerTeam}
                </div>
                <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", marginBottom: "0.75rem" }}>
                  {trade.proposer}
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "rgba(255,255,255,0.5)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Giving:
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {trade.proposerGives.map((teamId, idx) => {
                    const team = getTeamByMLEId(teamId);
                    return team ? (
                      <div
                        key={idx}
                        style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
                      >
                        <Image
                          src={team.logoPath}
                          alt={team.name}
                          width={28}
                          height={28}
                          style={{ borderRadius: "4px" }}
                        />
                        <span style={{ fontSize: "0.9rem", color: "white" }}>
                          {team.leagueId} {team.name}
                        </span>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>

              {/* Arrow */}
              <div style={{ fontSize: "2rem", color: "#f59e0b" }}>⇄</div>

              {/* Receiver Side */}
              <div>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "white", marginBottom: "0.5rem" }}>
                  {trade.receiverTeam}
                </div>
                <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", marginBottom: "0.75rem" }}>
                  {trade.receiver}
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "rgba(255,255,255,0.5)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Giving:
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {trade.receiverGives.map((teamId, idx) => {
                    const team = getTeamByMLEId(teamId);
                    return team ? (
                      <div
                        key={idx}
                        style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
                      >
                        <Image
                          src={team.logoPath}
                          alt={team.name}
                          width={28}
                          height={28}
                          style={{ borderRadius: "4px" }}
                        />
                        <span style={{ fontSize: "0.9rem", color: "white" }}>
                          {team.leagueId} {team.name}
                        </span>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const renderTransactionHistory = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {transactionHistory.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem",
            color: "rgba(255,255,255,0.5)",
          }}
        >
          No transaction history
        </div>
      ) : (
        transactionHistory.map((transaction) => (
          <div
            key={transaction.id}
            style={{
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: "8px",
              padding: "1.25rem 1.5rem",
              display: "grid",
              gridTemplateColumns: "120px 1fr 2fr 150px",
              alignItems: "center",
              gap: "1.5rem",
            }}
          >
            {/* Type */}
            <div>
              <div
                style={{
                  display: "inline-block",
                  padding: "0.35rem 0.75rem",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  background:
                    transaction.type === "waiver"
                      ? "rgba(251, 191, 36, 0.2)"
                      : transaction.type === "trade"
                      ? "rgba(139, 92, 246, 0.2)"
                      : "rgba(59, 130, 246, 0.2)",
                  color:
                    transaction.type === "waiver"
                      ? "#fbbf24"
                      : transaction.type === "trade"
                      ? "#a78bfa"
                      : "#60a5fa",
                }}
              >
                {transaction.type}
              </div>
            </div>

            {/* Team Info */}
            <div>
              <div style={{ fontSize: "1rem", fontWeight: 600, color: "white" }}>
                {transaction.teamName}
              </div>
              <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)" }}>
                {transaction.manager}
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "rgba(255,255,255,0.4)",
                  marginTop: "0.25rem",
                }}
              >
                {transaction.fantasyLeagueName}
              </div>
            </div>

            {/* Transaction Details */}
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              {transaction.addTeamId && (() => {
                const teamAdded = getTeamByMLEId(transaction.addTeamId);
                return teamAdded ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div
                      style={{
                        fontSize: "1.1rem",
                        color: "#22c55e",
                        fontWeight: 700,
                      }}
                    >
                      +
                    </div>
                    <Image
                      src={teamAdded.logoPath}
                      alt={teamAdded.name}
                      width={32}
                      height={32}
                      style={{ borderRadius: "4px" }}
                    />
                    <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "white" }}>
                      {teamAdded.leagueId} {teamAdded.name}
                    </div>
                  </div>
                ) : null;
              })()}

              {transaction.addTeamId && transaction.dropTeamId && (
                <div style={{ fontSize: "1.1rem", color: "rgba(255,255,255,0.3)" }}>→</div>
              )}

              {transaction.dropTeamId && (() => {
                const teamDropped = getTeamByMLEId(transaction.dropTeamId);
                return teamDropped ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ fontSize: "1.1rem", color: "#ef4444", fontWeight: 700 }}>
                      −
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "rgba(255,255,255,0.5)",
                      }}
                    >
                      {teamDropped.leagueId} {teamDropped.name}
                    </div>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Processed Date */}
            <div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "rgba(255,255,255,0.5)",
                  marginBottom: "0.25rem",
                }}
              >
                Processed
              </div>
              <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>
                {new Date(transaction.processed).toLocaleDateString()}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div>
      {/* Page Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <h1
          style={{
            fontSize: "2.5rem",
            color: "var(--accent)",
            fontWeight: 700,
            margin: 0,
          }}
        >
          Transactions
        </h1>

        {/* League Filter */}
        <select
          value={filterLeague}
          onChange={(e) => setFilterLeague(e.target.value)}
          style={{
            padding: "0.75rem 1rem",
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "6px",
            color: "var(--text-main)",
            fontSize: "0.95rem",
            fontWeight: 600,
          }}
        >
          <option value="all">All Leagues</option>
          {leagues.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))}
        </select>
      </div>

      {/* Stats Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
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
            Pending Waivers
          </div>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: "#fbbf24",
            }}
          >
            {pendingWaivers.length}
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
            Pending Trades
          </div>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: "#a78bfa",
            }}
          >
            {pendingTrades.length}
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
            Recent Transactions
          </div>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: "#60a5fa",
            }}
          >
            {transactionHistory.length}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1.5rem",
          borderBottom: "2px solid rgba(255,255,255,0.1)",
        }}
      >
        {[
          { id: "waivers", label: "Pending Waivers" },
          { id: "trades", label: "Pending Trades" },
          { id: "history", label: "Transaction History" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSelectedTab(tab.id as any)}
            style={{
              padding: "0.75rem 1.5rem",
              background: selectedTab === tab.id ? "rgba(242, 182, 50, 0.2)" : "transparent",
              border: "none",
              borderBottom:
                selectedTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
              color: selectedTab === tab.id ? "var(--accent)" : "rgba(255,255,255,0.6)",
              fontWeight: 600,
              fontSize: "0.95rem",
              cursor: "pointer",
              transition: "all 0.2s",
              marginBottom: "-2px",
            }}
            onMouseEnter={(e) => {
              if (selectedTab !== tab.id) {
                e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              }
            }}
            onMouseLeave={(e) => {
              if (selectedTab !== tab.id) {
                e.currentTarget.style.background = "transparent";
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <section
        className="card"
        style={{
          padding: "1.5rem",
          minHeight: "300px",
        }}
      >
        {loading ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: "3rem",
              color: "rgba(255,255,255,0.5)",
            }}
          >
            Loading...
          </div>
        ) : (
          <>
            {selectedTab === "waivers" && renderPendingWaivers()}
            {selectedTab === "trades" && renderPendingTrades()}
            {selectedTab === "history" && renderTransactionHistory()}
          </>
        )}
      </section>
    </div>
  );
}
