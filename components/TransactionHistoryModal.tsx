"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

interface TeamRef {
  id: string;
  name: string;
  leagueId: string;
  logoPath: string;
}

interface TransactionItem {
  id: string;
  type: "trade" | "waiver" | "pickup" | "drop";
  teamName?: string;
  username?: string;
  addTeam?: TeamRef | null;
  dropTeam?: TeamRef | null;
  faabBid?: number | null;
  proposerTeam?: string;
  proposerManager?: string;
  receiverTeam?: string;
  receiverManager?: string;
  proposerGivesTeams?: TeamRef[];
  receiverGivesTeams?: TeamRef[];
  proposerDropsTeams?: TeamRef[];
  status: string;
  timestamp: string;
}

interface TransactionHistoryModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  leagueId: string;
  teamId: string;
  managerName: string;
  mode: "completed" | "pending";
}

/**
 * Lists a manager's completed transaction history or currently-pending
 * actions (waiver claims still awaiting processing, trades still awaiting a
 * response or in their veto window). "Completed" reuses the league-wide
 * transactions endpoint filtered client-side by manager name (the same
 * convention the My Roster Transactions tab already uses — that endpoint
 * has no team id on non-trade rows to filter by more precisely); "pending"
 * uses a dedicated team-scoped endpoint since there's no equivalent
 * league-wide pending list elsewhere in the app.
 */
export default function TransactionHistoryModal({
  open,
  onClose,
  title,
  leagueId,
  teamId,
  managerName,
  mode,
}: TransactionHistoryModalProps) {
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const fetchTransactions = async () => {
      setLoading(true);
      setError(null);
      try {
        if (mode === "pending") {
          const res = await fetch(`/api/leagues/${leagueId}/rosters/${teamId}/pending-transactions`);
          if (!res.ok) throw new Error("Failed to fetch pending transactions");
          const data = await res.json();
          setTransactions(data.transactions ?? []);
        } else {
          const res = await fetch(`/api/leagues/${leagueId}/transactions`);
          if (!res.ok) throw new Error("Failed to fetch transactions");
          const data = await res.json();
          const all: TransactionItem[] = data.transactions ?? [];
          setTransactions(
            all.filter((t) =>
              t.type === "trade"
                ? t.proposerManager === managerName || t.receiverManager === managerName
                : t.username === managerName
            )
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load transactions");
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, [open, mode, leagueId, teamId, managerName]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 90,
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(700px, 100%)",
          maxHeight: "80vh",
          background: "linear-gradient(135deg, #1a2332 0%, #0f1419 100%)",
          border: "2px solid rgba(242, 182, 50, 0.3)",
          borderRadius: "16px",
          boxShadow: "0 25px 50px rgba(0, 0, 0, 0.8)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
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
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1rem 1.5rem", overflowY: "auto" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
              Loading...
            </div>
          ) : error ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "#ef4444" }}>{error}</div>
          ) : transactions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
              {mode === "pending" ? "No pending transactions" : "No transactions yet"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {transactions.map((t) => (
                <div
                  key={t.id}
                  style={{
                    padding: "1rem",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase" }}>
                      {t.type === "trade" ? "Trade" : t.type === "waiver" ? "Waiver Claim" : t.type === "drop" ? "Drop" : "Pickup"}
                    </span>
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color:
                            t.status === "Successful" || t.status === "Accepted"
                              ? "#22c55e"
                              : t.status === "Pending" || t.status.startsWith("Awaiting")
                              ? "#f2b632"
                              : "#ef4444",
                        }}
                      >
                        {t.status}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {new Date(t.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {t.type === "trade" ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.85rem" }}>
                      <div style={{ flex: "1 1 200px" }}>
                        <div style={{ color: "var(--text-muted)", marginBottom: "0.35rem" }}>
                          {t.proposerTeam} received
                        </div>
                        {(t.receiverGivesTeams ?? []).map((team) => (
                          <div key={`r-${team.id}`} style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.25rem" }}>
                            <Image src={team.logoPath} alt={team.name} width={22} height={22} style={{ borderRadius: "4px" }} />
                            <span style={{ color: "var(--text-main)" }}>{team.leagueId} {team.name}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ flex: "1 1 200px" }}>
                        <div style={{ color: "var(--text-muted)", marginBottom: "0.35rem" }}>
                          {t.receiverTeam} received
                        </div>
                        {(t.proposerGivesTeams ?? []).map((team) => (
                          <div key={`p-${team.id}`} style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.25rem" }}>
                            <Image src={team.logoPath} alt={team.name} width={22} height={22} style={{ borderRadius: "4px" }} />
                            <span style={{ color: "var(--text-main)" }}>{team.leagueId} {team.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem", fontSize: "0.85rem" }}>
                      {t.addTeam && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ color: "#22c55e", fontWeight: 700 }}>+</span>
                          <Image src={t.addTeam.logoPath} alt={t.addTeam.name} width={24} height={24} style={{ borderRadius: "4px" }} />
                          <span style={{ color: "var(--text-main)" }}>{t.addTeam.leagueId} {t.addTeam.name}</span>
                        </div>
                      )}
                      {t.dropTeam && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ color: "#ef4444", fontWeight: 700 }}>−</span>
                          <Image src={t.dropTeam.logoPath} alt={t.dropTeam.name} width={24} height={24} style={{ borderRadius: "4px" }} />
                          <span style={{ color: "var(--text-main)" }}>{t.dropTeam.leagueId} {t.dropTeam.name}</span>
                        </div>
                      )}
                      {t.faabBid != null && (
                        <span style={{ color: "var(--text-muted)" }}>(${t.faabBid} bid)</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
