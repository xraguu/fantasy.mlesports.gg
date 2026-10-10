"use client";

import { useState, useEffect, useCallback } from "react";

interface RecentNotification {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  body: string;
  status: string;
  error: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
  user: { displayName: string };
}

interface NotificationsData {
  botConfigured: boolean;
  last7Days: Record<string, number>;
  recent: RecentNotification[];
}

const STATUS_COLORS: Record<string, string> = {
  sent: "#22c55e",
  pending: "#f59e0b",
  sending: "#f59e0b",
  failed: "#ef4444",
  expired: "#9ca3af",
};

const STATUS_LABELS: Record<string, string> = {
  sent: "Sent",
  pending: "Waiting",
  sending: "Sending",
  failed: "Failed",
  expired: "Expired",
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Discord-style **bold** shown as plain text in the log
const plain = (text: string) => text.replace(/\*\*/g, "");

export default function AdminNotificationsPage() {
  const [data, setData] = useState<NotificationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/notifications");
      if (response.ok) setData(await response.json());
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sendTest = async () => {
    setSendingTest(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/admin/notifications", { method: "POST" });
      const body = await response.json();
      setTestResult({ ok: response.ok, message: body.message ?? body.error ?? "Unknown result" });
      load();
    } catch {
      setTestResult({ ok: false, message: "Couldn't reach the server" });
    } finally {
      setSendingTest(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
        {loading ? "Loading notifications..." : "Couldn't load notifications."}
      </div>
    );
  }

  const count = (status: string) => data.last7Days[status] ?? 0;

  return (
    <div>
      <div className="card" style={{ padding: "clamp(1rem, 4vw, 2rem)", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "clamp(1.1rem, 4.5vw, 1.4rem)", fontWeight: 700, marginBottom: "1.25rem", color: "var(--accent)" }}>
          Discord Bot
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
          <div style={{ padding: "1rem", background: "rgba(255,255,255,0.05)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>Bot</div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: data.botConfigured ? "#22c55e" : "#f59e0b" }}>
              {data.botConfigured ? "Set up" : "Not set up"}
            </div>
          </div>
          {(["sent", "failed", "pending", "expired"] as const).map((status) => (
            <div
              key={status}
              style={{ padding: "1rem", background: "rgba(255,255,255,0.05)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>
                {STATUS_LABELS[status]} (7 days)
              </div>
              <div style={{ fontSize: "1.2rem", fontWeight: 700, color: STATUS_COLORS[status] }}>{count(status)}</div>
            </div>
          ))}
        </div>

        {!data.botConfigured && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.5 }}>
            Messages are being saved but not sent: add <code>DISCORD_BOT_TOKEN</code> to the server&apos;s env file and
            restart the site. Until then, saved messages expire instead of all arriving at once later.
          </p>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
          <button className="btn btn-primary" onClick={sendTest} disabled={sendingTest || !data.botConfigured}>
            {sendingTest ? "Sending..." : "Send Me a Test DM"}
          </button>
          {testResult && (
            <span style={{ fontSize: "0.9rem", fontWeight: 600, color: testResult.ok ? "#22c55e" : "#ef4444" }}>
              {testResult.message}
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: "clamp(1rem, 4vw, 2rem)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "clamp(1.1rem, 4.5vw, 1.4rem)", fontWeight: 700, color: "var(--accent)", margin: 0 }}>
            Recent Messages
          </h2>
          <button className="btn btn-ghost" onClick={load} style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}>
            Refresh
          </button>
        </div>

        {data.recent.length === 0 ? (
          <div style={{ color: "var(--text-muted)", padding: "1.5rem 0" }}>No messages yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {data.recent.map((n) => (
              <div
                key={n.id}
                style={{
                  padding: "0.75rem 0.9rem",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.25rem 1rem" }}>
                  <div style={{ fontWeight: 600, color: "var(--text-main)" }}>
                    {n.title}
                    <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: "0.85rem" }}>
                      {" "}
                      → {n.user.displayName}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {formatTime(n.sentAt ?? n.createdAt)} ·{" "}
                    <span style={{ fontWeight: 700, color: STATUS_COLORS[n.status] ?? "var(--text-muted)" }}>
                      {STATUS_LABELS[n.status] ?? n.status}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{n.typeLabel}</div>
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-main)",
                    marginTop: "0.35rem",
                    whiteSpace: "pre-line",
                    opacity: 0.85,
                  }}
                >
                  {plain(n.body)}
                </div>
                {n.error && (
                  <div style={{ fontSize: "0.8rem", color: "#f87171", marginTop: "0.35rem" }}>
                    {n.status === "pending" ? `Retrying (attempt ${n.attempts}): ` : ""}
                    {n.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
