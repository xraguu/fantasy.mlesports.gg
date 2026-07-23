"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [sidebarPathname, setSidebarPathname] = useState(pathname);

  const isLoading = status === "loading";
  const isAdmin = session?.user?.role === "admin";

  // Collapse the mobile nav drawer on every navigation. Reset during render
  // (not in an effect) to avoid an extra commit-then-rerender cascade.
  if (pathname !== sidebarPathname) {
    setSidebarPathname(pathname);
    setSidebarCollapsed(true);
  }

  // Show loading state while checking session
  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "3rem",
              marginBottom: "1rem",
              animation: "spin 1s linear infinite",
            }}
          >
            ⚙️
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>
            Loading...
          </p>
        </div>
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // If user is not an admin, show access denied message
  if (!isAdmin) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
        }}
      >
        <div
          className="card"
          style={{
            maxWidth: "500px",
            textAlign: "center",
            padding: "3rem 2rem",
          }}
        >
          <h1
            style={{
              fontSize: "clamp(1.4rem, 6vw, 2rem)",
              fontWeight: 700,
              color: "var(--accent)",
              marginBottom: "1rem",
            }}
          >
            Access Denied
          </h1>
          <p
            style={{
              fontSize: "1.1rem",
              color: "var(--text-muted)",
              marginBottom: "2rem",
              lineHeight: 1.6,
            }}
          >
            You do not have permission to access the admin control panel.
            <br />
            This area is restricted to authorized administrators only.
          </p>
          <Link
            href="/"
            className="btn btn-primary"
            style={{
              display: "inline-block",
              padding: "0.75rem 2rem",
              fontSize: "1rem",
            }}
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // Admin users see the admin panel
  const adminNavItems = [
    { label: "Dashboard", path: "/admin" },
    { label: "Manage Users", path: "/admin/users" },
    { label: "Manage Leagues", path: "/admin/leagues" },
    { label: "Lock Lineups", path: "/admin/lock-lineups" },
    { label: "Transactions", path: "/admin/waivers" },
    { label: "Settings", path: "/admin/settings" },
    { label: "Manual Stats", path: "/admin/stats" },
    { label: "League Archive", path: "/admin/leagues/archive" },
    { label: "Database Info", path: "/admin/database" },
  ];

  return (
    <div className="admin-shell">
      {/* Sidebar Navigation */}
      <nav className={`admin-sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
        {/* Logo/Title */}
        <div style={{ padding: "0 1.5rem", marginBottom: "0.5rem" }}>
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              color: "var(--accent)",
              marginBottom: "0.25rem",
            }}
          >
            Admin Panel
          </h2>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            MLE Fantasy
          </p>
        </div>

        {/* Mobile collapse toggle */}
        <button
          type="button"
          className="admin-sidebar-toggle"
          aria-expanded={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        >
          <span>
            {adminNavItems.find((item) => item.path === pathname)?.label ||
              "Menu"}
          </span>
          <span>{sidebarCollapsed ? "▾" : "▴"}</span>
        </button>

        {/* Navigation Links */}
        <div className="admin-sidebar-links" style={{ marginTop: "1.5rem" }}>
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
        >
          {adminNavItems.map((item) => {
            const isActive = pathname === item.path;
            return (
              <Link
                key={item.path}
                href={item.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.75rem 1.5rem",
                  fontSize: "0.95rem",
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "var(--accent)" : "var(--text-main)",
                  background: isActive
                    ? "rgba(242, 182, 50, 0.1)"
                    : "transparent",
                  borderLeft: isActive
                    ? "3px solid var(--accent)"
                    : "3px solid transparent",
                  transition: "all 0.2s ease",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Back to Home Link */}
        <div
          style={{
            padding: "2rem 1.5rem 0 1.5rem",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            marginTop: "2rem",
          }}
        >
          <Link
            href="/"
            className="btn btn-ghost"
            style={{
              width: "100%",
              padding: "0.75rem 1rem",
              fontSize: "0.9rem",
              display: "block",
              textAlign: "center",
            }}
          >
            ← Back to Home
          </Link>
        </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="admin-main">
        {/* Page Header */}
        <div style={{ marginBottom: "2rem" }}>
          <h1
            style={{
              fontSize: "clamp(1.4rem, 6vw, 2rem)",
              fontWeight: 700,
              color: "var(--text-main)",
              marginBottom: "0.25rem",
            }}
          >
            {adminNavItems.find((item) => item.path === pathname)?.label ||
              "Admin Control Panel"}
          </h1>
        </div>

        {/* Page Content */}
        <div style={{ maxWidth: "1400px" }}>{children}</div>
      </div>
    </div>
  );
}
