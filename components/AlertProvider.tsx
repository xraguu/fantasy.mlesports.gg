"use client";

import { createContext, useCallback, useContext, useState, ReactNode } from "react";

export type AlertType = "success" | "error" | "warning" | "info";

interface AlertState {
  message: string;
  type: AlertType;
}

type ShowAlert = (message: string, type?: AlertType) => void;

const AlertContext = createContext<ShowAlert | null>(null);

/**
 * Replaces window.alert(...) with a themed, centered modal matching the
 * rest of the app instead of the browser's native top-of-page dialog.
 * Usage: const showAlert = useAlert(); showAlert("Failed to save", "error");
 */
export function useAlert(): ShowAlert {
  const ctx = useContext(AlertContext);
  if (!ctx) {
    // Shouldn't happen — AlertProvider wraps the whole app in layout.tsx —
    // but fall back to the native dialog rather than crash if it's ever
    // used outside the provider.
    return (message: string) => window.alert(message);
  }
  return ctx;
}

const TYPE_STYLES: Record<AlertType, { color: string; icon: string }> = {
  success: { color: "#22c55e", icon: "✓" },
  error: { color: "#ef4444", icon: "✕" },
  warning: { color: "#f59e0b", icon: "⚠" },
  info: { color: "var(--accent)", icon: "ℹ" },
};

export default function AlertProvider({ children }: { children: ReactNode }) {
  const [alert, setAlert] = useState<AlertState | null>(null);

  const showAlert = useCallback<ShowAlert>((message, type = "info") => {
    setAlert({ message, type });
  }, []);

  const close = () => setAlert(null);

  return (
    <AlertContext.Provider value={showAlert}>
      {children}
      {alert && (
        <div
          onClick={close}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 3000,
            padding: "1.5rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "420px",
              width: "100%",
              background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
              borderRadius: "12px",
              padding: "1.75rem",
              border: `2px solid ${TYPE_STYLES[alert.type].color}`,
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: `${TYPE_STYLES[alert.type].color}22`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 1rem",
                fontSize: "1.4rem",
                fontWeight: 700,
                color: TYPE_STYLES[alert.type].color,
              }}
            >
              {TYPE_STYLES[alert.type].icon}
            </div>
            <p
              style={{
                fontSize: "1rem",
                color: "var(--text-main)",
                lineHeight: 1.6,
                marginBottom: "1.5rem",
                whiteSpace: "pre-wrap",
              }}
            >
              {alert.message}
            </p>
            <button
              onClick={close}
              style={{
                padding: "0.6rem 2.5rem",
                background: TYPE_STYLES[alert.type].color,
                border: "none",
                borderRadius: "8px",
                color: "#1a1a2e",
                fontWeight: 700,
                fontSize: "0.95rem",
                cursor: "pointer",
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </AlertContext.Provider>
  );
}
