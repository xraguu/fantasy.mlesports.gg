"use client";

import { useState, useEffect } from "react";

interface DatabaseStatus {
  status: string;
  size: string;
  tables: Record<string, number>;
  totalRecords: number;
}

export default function DatabaseToolsPage() {
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/database/status")
      .then((res) => res.json())
      .then((data) => setDbStatus(data))
      .catch((err) => console.error("Failed to load database status:", err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {/* Database Status */}
      <div className="card" style={{ padding: "2rem", marginBottom: "2rem" }}>
        <h2
          style={{
            fontSize: "clamp(1.1rem, 4.5vw, 1.5rem)",
            fontWeight: 700,
            marginBottom: "1.5rem",
            color: "var(--accent)",
          }}
        >
          Database Status
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "1.5rem",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--text-muted)",
                marginBottom: "0.5rem",
              }}
            >
              Connection Status
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div
                style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  background:
                    dbStatus?.status === "connected" ? "#22c55e" : "#ef4444",
                }}
              />
              <span
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  color: "var(--text-main)",
                }}
              >
                {loading ? "Checking..." : dbStatus?.status === "connected" ? "Connected" : "Error"}
              </span>
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--text-muted)",
                marginBottom: "0.5rem",
              }}
            >
              Database Size
            </div>
            <div
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--accent)",
              }}
            >
              {loading ? "..." : dbStatus?.size ?? "N/A"}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--text-muted)",
                marginBottom: "0.5rem",
              }}
            >
              Total Records
            </div>
            <div
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--accent)",
              }}
            >
              {loading ? "..." : dbStatus?.totalRecords ?? "N/A"}
            </div>
          </div>
        </div>

        {/* Table Counts */}
        <div style={{ marginTop: "2rem" }}>
          <h3
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              marginBottom: "1rem",
              color: "var(--text-main)",
            }}
          >
            Records by Table
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "1rem",
            }}
          >
            {loading ? (
              <div style={{ color: "var(--text-muted)" }}>Loading...</div>
            ) : (
              Object.entries(dbStatus?.tables ?? {}).map(([table, count]) => (
                <div
                  key={table}
                  style={{
                    padding: "1rem",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-muted)",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {table}
                  </div>
                  <div
                    style={{
                      fontSize: "clamp(1.1rem, 4.5vw, 1.5rem)",
                      fontWeight: 700,
                      color: "var(--accent)",
                    }}
                  >
                    {count}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Backups note */}
      <div
        className="card"
        style={{
          padding: "1.5rem 2rem",
          background: "rgba(59, 130, 246, 0.08)",
          border: "1px solid rgba(59, 130, 246, 0.25)",
        }}
      >
        <p style={{ fontSize: "0.9rem", color: "var(--text-main)", lineHeight: 1.6 }}>
          Backups, restores, and database maintenance are managed at the hosting/infra
          level (DigitalOcean managed Postgres), not from this panel. There's no
          app-level backup/restore, optimize, cache, or data-reset tooling here — those
          controls previously shown on this page were non-functional placeholders and
          have been removed.
        </p>
      </div>
    </div>
  );
}
