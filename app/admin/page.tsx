"use client";

import { useEffect, useState } from "react";

interface DashboardStats {
  totalLeagues: number;
  activeManagers: number;
  currentWeek: number | null;
  pendingTransactions: number;
}

interface ActivityEntry {
  id: string;
  admin: string;
  action: string;
  description: string;
  createdAt: string;
}

function timeAgo(dateString: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(dateString: string): string {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/dashboard").then((res) => res.json()),
      fetch("/api/admin/activity").then((res) => res.json()),
    ])
      .then(([dashboardData, activityData]) => {
        setStats(dashboardData);
        setActivity(activityData.activity || []);
      })
      .catch((err) => console.error("Failed to load dashboard data:", err))
      .finally(() => setLoading(false));
  }, []);

  const statBoxes = [
    { label: "Total Leagues", value: stats?.totalLeagues },
    { label: "Active Managers", value: stats?.activeManagers },
    { label: "Current Week", value: stats?.currentWeek ?? "N/A" },
    { label: "Pending Transactions", value: stats?.pendingTransactions },
  ];

  return (
    <div>
      {/* Quick Stats Overview */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "1.5rem",
          marginBottom: "2rem",
        }}
      >
        {statBoxes.map((box) => (
          <div className="card" key={box.label} style={{ padding: "1.5rem" }}>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--text-muted)",
                marginBottom: "0.5rem",
              }}
            >
              {box.label}
            </div>
            <div
              style={{
                fontSize: "clamp(1.4rem, 6vw, 2rem)",
                fontWeight: 700,
                color: "var(--accent)",
              }}
            >
              {loading ? "..." : box.value ?? "N/A"}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="card" style={{ padding: "1.5rem", marginTop: "2rem" }}>
        <h2
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            marginBottom: "1rem",
            color: "var(--text-main)",
          }}
        >
          Recent Admin Activity
        </h2>
        <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          {loading ? (
            <p>Loading...</p>
          ) : activity.length === 0 ? (
            <p>No admin activity recorded yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {activity.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    position: "relative",
                    paddingBottom: "0.75rem",
                    paddingRight: "9rem",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div>
                    <span style={{ color: "var(--text-main)", fontWeight: 600 }}>
                      {entry.admin}
                    </span>{" "}
                    {entry.description}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      whiteSpace: "nowrap",
                      textAlign: "right",
                    }}
                  >
                    <div style={{ fontSize: "0.8rem" }}>{timeAgo(entry.createdAt)}</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      {formatTimestamp(entry.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
