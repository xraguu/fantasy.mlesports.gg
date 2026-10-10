"use client";

import { useState, useEffect } from "react";

interface NotificationSetting {
  type: string;
  label: string;
  description: string;
  adminOnly: boolean;
  enabled: boolean;
}

/**
 * Lets a user turn each kind of Discord DM on or off. Everything starts on;
 * each toggle saves right away. Pass `user` to manage someone else's
 * instead (the bell on the admin Manage Users page).
 */
export default function NotificationSettingsModal({
  onClose,
  user,
}: {
  onClose: () => void;
  user?: { id: string; displayName: string };
}) {
  const endpoint = user ? `/api/admin/users/${user.id}/notifications` : "/api/user/notifications";
  const [settings, setSettings] = useState<NotificationSetting[]>([]);
  const [deliveryProblem, setDeliveryProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingType, setSavingType] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error("Failed to load notification settings");
        const data = await response.json();
        setSettings(data.settings || []);
        setDeliveryProblem(data.deliveryProblem ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load notification settings");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [endpoint]);

  const toggle = async (setting: NotificationSetting) => {
    const enabled = !setting.enabled;
    setSavingType(setting.type);
    setSettings((prev) => prev.map((s) => (s.type === setting.type ? { ...s, enabled } : s)));
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: setting.type, enabled }),
      });
      if (!response.ok) throw new Error("Failed to save");
      setError(null);
    } catch {
      // Put it back the way it was
      setSettings((prev) => prev.map((s) => (s.type === setting.type ? { ...s, enabled: !enabled } : s)));
      setError("Couldn't save that change — try again");
    } finally {
      setSavingType(null);
    }
  };

  const renderGroup = (title: string, items: NotificationSetting[]) =>
    items.length > 0 && (
      <div style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
          {title}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {items.map((setting) => (
            <label
              key={setting.type}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                padding: "0.75rem 0.9rem",
                borderRadius: "8px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: savingType === setting.type ? "wait" : "pointer",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--text-main)", fontSize: "0.95rem" }}>{setting.label}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>{setting.description}</div>
              </div>
              <input
                type="checkbox"
                role="switch"
                aria-label={setting.label}
                checked={setting.enabled}
                disabled={savingType === setting.type}
                onChange={() => toggle(setting)}
                style={{ width: "1.2rem", height: "1.2rem", accentColor: "var(--accent)", flexShrink: 0, cursor: "inherit" }}
              />
            </label>
          ))}
        </div>
      </div>
    );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1500,
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-box modal-box-tight-padding"
        style={{
          maxWidth: "560px",
          maxHeight: "85vh",
          overflowY: "auto",
          borderRadius: "12px",
          padding: "2rem",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
        }}
      >
        <div className="modal-box-header" style={{ justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
          <h2 style={{ fontSize: "clamp(1.2rem, 5vw, 1.6rem)", fontWeight: 700, color: "var(--accent)", margin: 0 }}>
            {user ? `Notifications for ${user.displayName}` : "Notifications"}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.1)",
              border: "none",
              color: "#ffffff",
              fontSize: "1.3rem",
              cursor: "pointer",
              padding: "0.2rem 0.55rem",
              lineHeight: 1,
              borderRadius: "4px",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1.25rem", lineHeight: 1.5 }}>
          {user
            ? "Turn this user's Discord DMs on or off. They can still change these themselves from the home page."
            : "The MLE Fantasy bot DMs you on Discord. To get them, you need to be in the MLE Discord server and allow direct messages from its members."}
        </p>

        {deliveryProblem && (
          <div
            style={{
              padding: "0.75rem 1rem",
              marginBottom: "1.25rem",
              borderRadius: "8px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#f87171",
              fontSize: "0.85rem",
              lineHeight: 1.5,
            }}
          >
            {user ? "Their" : "Your"} last notification couldn&apos;t be delivered: {deliveryProblem}
          </div>
        )}

        {loading ? (
          <div style={{ color: "var(--text-muted)" }}>Loading...</div>
        ) : (
          <>
            {error && <div style={{ color: "#ef4444", marginBottom: "1rem", fontSize: "0.9rem" }}>{error}</div>}
            {renderGroup("Leagues & Drafts", settings.filter((s) => !s.adminOnly))}
            {renderGroup("Admin", settings.filter((s) => s.adminOnly))}
          </>
        )}
      </div>
    </div>
  );
}
