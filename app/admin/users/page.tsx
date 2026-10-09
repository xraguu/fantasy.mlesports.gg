"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { useAlert } from "@/components/AlertProvider";
import HeaderTooltip from "@/components/HeaderTooltip";

interface UserLeague {
  id: string;
  name: string;
}

interface User {
  id: string;
  discordId: string;
  displayName: string;
  avatarUrl: string | null;
  role: "admin" | "user";
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  leagues: UserLeague[]; // active (non-archived) leagues only
}

type SortColumn = "name" | "joined" | "leagues";
interface SortState {
  column: SortColumn;
  direction: "asc" | "desc";
}

// Direction a column starts in when first clicked: names A–Z, newest
// members first, most leagues first
const DEFAULT_DIRECTION: Record<SortColumn, SortState["direction"]> = {
  name: "asc",
  joined: "desc",
  leagues: "desc",
};

function SortHeader({
  column,
  label,
  align = "left",
  sort,
  onSort,
}: {
  column: SortColumn;
  label: string;
  align?: "left" | "center";
  sort: SortState;
  onSort: (column: SortColumn) => void;
}) {
  const active = sort.column === column;
  return (
    <th
      onClick={() => onSort(column)}
      style={{
        padding: "0.75rem 0.5rem",
        textAlign: align,
        fontSize: "0.85rem",
        color: active ? "var(--accent)" : "var(--text-muted)",
        fontWeight: 600,
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {active && (
        <span style={{ fontSize: "0.75rem", marginLeft: "0.25rem" }}>
          {sort.direction === "asc" ? "▲" : "▼"}
        </span>
      )}
    </th>
  );
}

export default function ManageUsersPage() {
  const showAlert = useAlert();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterLeague, setFilterLeague] = useState("all");
  const [sort, setSort] = useState<SortState>({ column: "joined", direction: "desc" });
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/users");
      if (!response.ok) throw new Error("Failed to fetch users");
      const data = await response.json();
      setUsers(data);
    } catch (error) {
      console.error("Error fetching users:", error);
      showAlert("Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  // Fetch users from API
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.discordId.includes(searchTerm);
    const matchesRole = filterRole === "all" || user.role === filterRole;
    const matchesLeague =
      filterLeague === "all" || user.leagues.some((league) => league.id === filterLeague);
    return matchesSearch && matchesRole && matchesLeague;
  });

  const handleSort = (column: SortColumn) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: DEFAULT_DIRECTION[column] },
    );
  };

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    let result: number;
    if (sort.column === "name") {
      result = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
    } else if (sort.column === "joined") {
      result = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    } else {
      // Ties on league count fall back to name, A–Z either way
      result =
        a.leagues.length - b.leagues.length ||
        (sort.direction === "asc" ? 1 : -1) *
          a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
    }
    return sort.direction === "asc" ? result : -result;
  });

  // Every league at least one user is in, for the league filter
  const leagueOptions = [
    ...new Map(
      users.flatMap((user) => user.leagues).map((league) => [league.id, league]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const updateUserStatus = async (userId: string, status: "active" | "suspended") => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) throw new Error("Failed to update status");

      // Update local state
      setUsers((prev) =>
        prev.map((user) => (user.id === userId ? { ...user, status } : user))
      );
      showAlert(`User ${status === "suspended" ? "suspended" : "activated"} successfully!`, "success");
    } catch (error) {
      console.error("Error updating user status:", error);
      showAlert("Failed to update user status", "error");
    }
  };

  const updateUserRole = async (userId: string, role: "admin" | "user") => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });

      if (!response.ok) throw new Error("Failed to update role");

      // Update local state
      setUsers((prev) =>
        prev.map((user) => (user.id === userId ? { ...user, role } : user))
      );

      // Update selected user if it's the one being modified
      if (selectedUser?.id === userId) {
        setSelectedUser({ ...selectedUser, role });
      }

      showAlert(`User role updated to ${role} successfully!`, "success");
    } catch (error) {
      console.error("Error updating user role:", error);
      showAlert("Failed to update user role", "error");
    }
  };

  const roleStats = {
    total: users.length,
    admins: users.filter((u) => u.role === "admin").length,
    users: users.filter((u) => u.role === "user").length,
    suspended: users.filter((u) => u.status === "suspended").length,
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "400px",
        }}
      >
        <div style={{ fontSize: "1.2rem", color: "var(--text-muted)" }}>
          Loading users...
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <>
          <div
            className="modal-backdrop"
            onClick={() => setShowEditModal(false)}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.7)",
              zIndex: 999,
            }}
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
                  marginBottom: "1.5rem",
                  color: "var(--accent)",
                }}
              >
                View User: {selectedUser.displayName}
              </h2>
              <div style={{ marginBottom: "1.5rem" }}>
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Discord ID: {selectedUser.discordId}
                </div>
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Member Since: {formatDate(selectedUser.createdAt)}
                </div>
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Status: {selectedUser.status}
                </div>

                {/* Role Selection */}
                <div style={{ marginTop: "1rem" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      marginBottom: "0.5rem",
                      fontWeight: 600,
                    }}
                  >
                    Role
                  </label>
                  <select
                    value={selectedUser.role}
                    onChange={(e) => {
                      const newRole = e.target.value as "admin" | "user";
                      if (confirm(`Are you sure you want to change this user's role to ${newRole}?`)) {
                        updateUserRole(selectedUser.id, newRole);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "0.75rem 1rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "6px",
                      color: "var(--text-main)",
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setShowEditModal(false)}
                >
                  Close
                </button>
                {selectedUser.status === "active" ? (
                  <button
                    className="btn btn-warning"
                    style={{ flex: 1, background: "#f59e0b" }}
                    onClick={() => {
                      updateUserStatus(selectedUser.id, "suspended");
                      setShowEditModal(false);
                    }}
                  >
                    Suspend User
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => {
                      updateUserStatus(selectedUser.id, "active");
                      setShowEditModal(false);
                    }}
                  >
                    Activate User
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Stats Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
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
            Total Users
          </div>
          <div
            style={{
              fontSize: "clamp(1.4rem, 6vw, 2rem)",
              fontWeight: 700,
              color: "var(--accent)",
            }}
          >
            {roleStats.total}
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
            Admins
          </div>
          <div
            style={{
              fontSize: "clamp(1.4rem, 6vw, 2rem)",
              fontWeight: 700,
              color: "#ef4444",
            }}
          >
            {roleStats.admins}
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
            Regular Users
          </div>
          <div
            style={{
              fontSize: "clamp(1.4rem, 6vw, 2rem)",
              fontWeight: 700,
              color: "#22c55e",
            }}
          >
            {roleStats.users}
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
            Suspended
          </div>
          <div
            style={{
              fontSize: "clamp(1.4rem, 6vw, 2rem)",
              fontWeight: 700,
              color: "#9ca3af",
            }}
          >
            {roleStats.suspended}
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
          gap: "1rem",
        }}
      >
        <input
          type="text"
          placeholder="Search by name or Discord ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1,
            minWidth: "200px",
            padding: "0.75rem 1rem",
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "6px",
            color: "var(--text-main)",
            fontSize: "0.95rem",
          }}
        />
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
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
          <option value="all">All Roles</option>
          <option value="admin">Admins</option>
          <option value="user">Users</option>
        </select>
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
          {leagueOptions.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))}
        </select>
      </div>

      {/* Users Table */}
      <div className="card" style={{ padding: "1.5rem" }}>
        {filteredUsers.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "3rem",
              color: "var(--text-muted)",
            }}
          >
            No users found
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                <SortHeader column="name" label="Display Name" sort={sort} onSort={handleSort} />
                <th
                  style={{
                    padding: "0.75rem 0.5rem",
                    textAlign: "left",
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    fontWeight: 600,
                  }}
                >
                  Discord ID
                </th>
                <SortHeader column="leagues" label="Leagues" align="center" sort={sort} onSort={handleSort} />
                <th
                  style={{
                    padding: "0.75rem 0.5rem",
                    textAlign: "center",
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    fontWeight: 600,
                  }}
                >
                  Role
                </th>
                <SortHeader column="joined" label="Joined" sort={sort} onSort={handleSort} />
                <th
                  style={{
                    padding: "0.75rem 0.5rem",
                    textAlign: "center",
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    fontWeight: 600,
                  }}
                >
                  Status
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
              {sortedUsers.map((user) => (
                <tr
                  key={user.id}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <td style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      {user.avatarUrl && (
                        <Image
                          src={user.avatarUrl}
                          alt={user.displayName}
                          width={32}
                          height={32}
                          style={{
                            borderRadius: "50%",
                          }}
                        />
                      )}
                      {user.displayName}
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      color: "var(--text-muted)",
                      fontSize: "0.85rem",
                    }}
                  >
                    {user.discordId}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "center",
                      fontWeight: 600,
                    }}
                  >
                    {user.leagues.length > 0 ? (
                      <HeaderTooltip
                        label={String(user.leagues.length)}
                        full={user.leagues.map((league) => league.name)}
                      />
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>0</span>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                    <span
                      style={{
                        padding: "0.4rem 1rem",
                        borderRadius: "20px",
                        fontWeight: 600,
                        fontSize: "0.8rem",
                        background:
                          user.role === "admin"
                            ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
                            : "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                        color: "white",
                      }}
                    >
                      {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    {formatDate(user.createdAt)}
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                    <span
                      style={{
                        padding: "0.4rem 1rem",
                        borderRadius: "20px",
                        fontWeight: 600,
                        fontSize: "0.8rem",
                        background:
                          user.status === "active"
                            ? "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
                            : "linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)",
                        color: "white",
                      }}
                    >
                      {user.status ? user.status.charAt(0).toUpperCase() + user.status.slice(1) : "Unknown"}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "right",
                    }}
                  >
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "0.4rem 1rem", fontSize: "0.85rem" }}
                      onClick={() => {
                        setSelectedUser(user);
                        setShowEditModal(true);
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
