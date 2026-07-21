"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import TeamModal from "@/components/TeamModal";
import InfoGuideModal from "@/components/InfoGuideModal";
import ManagerOverviewModal from "@/components/ManagerOverviewModal";
import HeaderTooltip from "@/components/HeaderTooltip";

type SortKey =
  | "rank"
  | "name"
  | "score"
  | "fpts"
  | "last"
  | "avg"
  | "shots"
  | "goals"
  | "assists"
  | "saves"
  | "demos";
type SortDirection = "asc" | "desc";

// Sortable Header Component
function SortableHeader({
  column,
  label,
  full,
  align = "left",
  sortKey,
  sortDirection,
  onSort,
}: {
  column: SortKey;
  label: string;
  full?: string;
  align?: "left" | "right" | "center";
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (column: SortKey) => void;
}) {
  return (
    <th
      onClick={() => onSort(column)}
      style={{
        padding: "0.75rem 0.5rem",
        textAlign: align,
        fontSize: "0.85rem",
        color: sortKey === column ? "var(--accent)" : "var(--text-muted)",
        fontWeight: 600,
        cursor: "pointer",
        userSelect: "none",
        transition: "color 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
      onMouseLeave={(e) =>
        (e.currentTarget.style.color =
          sortKey === column ? "var(--accent)" : "var(--text-muted)")
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent:
            align === "right"
              ? "flex-end"
              : align === "center"
              ? "center"
              : "flex-start",
          gap: "0.25rem",
        }}
      >
        {full ? <HeaderTooltip label={label} full={full} /> : label}
        {sortKey === column && (
          <span style={{ fontSize: "0.75rem" }}>
            {sortDirection === "asc" ? "▲" : "▼"}
          </span>
        )}
      </div>
    </th>
  );
}

export default function HomePage() {
  const { data: session } = useSession();
  const [selectedTeam, setSelectedTeam] = useState<any | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [selectedManagerOverview, setSelectedManagerOverview] = useState<{ leagueId: string; fantasyTeamId: string } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isAdmin, setIsAdmin] = useState(false);
  const [topTeamsByMode, setTopTeamsByMode] = useState<{
    twoS: any[];
    threeS: any[];
    combined: any[];
  }>({ twoS: [], threeS: [], combined: [] });
  const [loading, setLoading] = useState(true);
  const [userLeagues, setUserLeagues] = useState<any[]>([]);
  const [loadingLeagues, setLoadingLeagues] = useState(true);
  const [globalLeaderboard, setGlobalLeaderboard] = useState<any[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);
  const [gameMode, setGameMode] = useState<"2s" | "3s" | "all">("all");
  const [managerStatsTab, setManagerStatsTab] = useState<"global" | "league">("global");
  const [standingsLeagueId, setStandingsLeagueId] = useState<string | null>(null);
  const [leagueStandings, setLeagueStandings] = useState<any[]>([]);
  const [loadingLeagueStandings, setLoadingLeagueStandings] = useState(false);

  // Fetch top teams from API (real 2s/3s/combined season leaderboards)
  useEffect(() => {
    const fetchTopTeams = async () => {
      try {
        const response = await fetch(`/api/teams/top`);
        if (response.ok) {
          const data = await response.json();
          setTopTeamsByMode({
            twoS: data.twoS ?? [],
            threeS: data.threeS ?? [],
            combined: data.combined ?? [],
          });
        } else {
          console.warn("Failed to fetch top teams");
          setTopTeamsByMode({ twoS: [], threeS: [], combined: [] });
        }
      } catch (error) {
        console.error("Error fetching top teams:", error);
        setTopTeamsByMode({ twoS: [], threeS: [], combined: [] });
      } finally {
        setLoading(false);
      }
    };

    fetchTopTeams();
  }, []);

  // Fetch global leaderboard from API
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const response = await fetch(`/api/leaderboard/global`);
        if (response.ok) {
          const data = await response.json();
          setGlobalLeaderboard(data.leaderboard || []);
        } else {
          console.warn("Failed to fetch global leaderboard");
          setGlobalLeaderboard([]);
        }
      } catch (error) {
        console.error("Error fetching global leaderboard:", error);
        setGlobalLeaderboard([]);
      } finally {
        setLoadingLeaderboard(false);
      }
    };

    fetchLeaderboard();
  }, []);

  // Default the per-league standings selector to the user's first league once loaded
  useEffect(() => {
    if (!standingsLeagueId && userLeagues.length > 0) {
      setStandingsLeagueId(userLeagues[0].id);
    }
  }, [userLeagues, standingsLeagueId]);

  // Fetch standings for the selected league when the "League Standings" tab is active
  useEffect(() => {
    const fetchLeagueStandings = async () => {
      if (managerStatsTab !== "league" || !standingsLeagueId) return;

      try {
        setLoadingLeagueStandings(true);
        const response = await fetch(`/api/leagues/${standingsLeagueId}/standings`);
        if (response.ok) {
          const data = await response.json();
          setLeagueStandings(data.standings || []);
        } else {
          console.warn("Failed to fetch league standings");
          setLeagueStandings([]);
        }
      } catch (error) {
        console.error("Error fetching league standings:", error);
        setLeagueStandings([]);
      } finally {
        setLoadingLeagueStandings(false);
      }
    };

    fetchLeagueStandings();
  }, [managerStatsTab, standingsLeagueId]);

  // Check if user is admin
  useEffect(() => {
    const checkAdmin = async () => {
      if (!session?.user?.id) return;

      try {
        const response = await fetch(`/api/user/role`);
        if (response.ok) {
          const data = await response.json();
          setIsAdmin(data.role === "admin");
        }
      } catch (error) {
        console.error("Failed to check admin status:", error);
      }
    };

    checkAdmin();
  }, [session]);

  // Fetch user's leagues from API
  useEffect(() => {
    const fetchUserLeagues = async () => {
      if (!session?.user?.id) {
        setLoadingLeagues(false);
        return;
      }

      try {
        const response = await fetch(`/api/leagues`);
        if (response.ok) {
          const data = await response.json();
          setUserLeagues(data.leagues || []);
        } else {
          console.warn("Failed to fetch user leagues");
          setUserLeagues([]);
        }
      } catch (error) {
        console.error("Error fetching user leagues:", error);
        setUserLeagues([]);
      } finally {
        setLoadingLeagues(false);
      }
    };

    fetchUserLeagues();
  }, [session?.user?.id]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  // Pick the real per-mode top-10 list matching the selected toggle
  const topTeams =
    gameMode === "2s"
      ? topTeamsByMode.twoS
      : gameMode === "3s"
      ? topTeamsByMode.threeS
      : topTeamsByMode.combined;

  const sortedTeams = [...topTeams].sort((a, b) => {
    let aValue: number | string = 0;
    let bValue: number | string = 0;

    switch (sortKey) {
      case "rank":
        aValue = a.rank ?? 0;
        bValue = b.rank ?? 0;
        break;
      case "name":
        aValue = a.name;
        bValue = b.name;
        break;
      case "score":
        aValue = a.score ?? 0;
        bValue = b.score ?? 0;
        break;
      case "fpts":
        aValue = a.fpts ?? 0;
        bValue = b.fpts ?? 0;
        break;
      case "last":
        aValue = a.last ?? 0;
        bValue = b.last ?? 0;
        break;
      case "avg":
        aValue = a.avg ?? 0;
        bValue = b.avg ?? 0;
        break;
      case "shots":
        aValue = a.shots ?? 0;
        bValue = b.shots ?? 0;
        break;
      case "goals":
        aValue = a.goals ?? 0;
        bValue = b.goals ?? 0;
        break;
      case "assists":
        aValue = a.assists ?? 0;
        bValue = b.assists ?? 0;
        break;
      case "saves":
        aValue = a.saves ?? 0;
        bValue = b.saves ?? 0;
        break;
      case "demos":
        aValue = a.demos ?? 0;
        bValue = b.demos ?? 0;
        break;
    }

    if (typeof aValue === "string" && typeof bValue === "string") {
      return sortDirection === "asc"
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    return sortDirection === "asc"
      ? (aValue as number) - (bValue as number)
      : (bValue as number) - (aValue as number);
  });

  return (
    <>
      {/* Team Stats Modal — this leaderboard is a global, cross-league MLE
          team ranking (GET /api/teams/top), not scoped to any one fantasy
          league, so there's no single well-defined "rostered by" answer for
          a team here (it can be rostered differently in every league the
          viewer belongs to). No rosteredBy is set; the modal simply omits
          that status pill in that case. */}
      <TeamModal
        team={showModal && selectedTeam ? selectedTeam : null}
        fantasyLeagueId={standingsLeagueId}
        onClose={() => setShowModal(false)}
      />

      {/* Info Guide Modal */}
      <InfoGuideModal open={showInfoModal} onClose={() => setShowInfoModal(false)} />

      {/* Manager Overview Modal - opened from either leaderboard */}
      {selectedManagerOverview && (
        <ManagerOverviewModal
          leagueId={selectedManagerOverview.leagueId}
          fantasyTeamId={selectedManagerOverview.fantasyTeamId}
          onClose={() => setSelectedManagerOverview(null)}
        />
      )}

      <main>
        {/* Utility row - Contact Mailbox (top-left) and Sign Out
            (top-right), pinned above the main header so they never get
            pushed around when the header wraps on narrow screens. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          {/* Help Section */}
          <a
            href="https://discordapp.com/channels/@me/1419789164240699513"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              textAlign: "center",
              padding: "0.5rem 1.25rem",
              backgroundColor: "rgba(42, 75, 130, 0.85)",
              borderRadius: "10px",
              border: "1px solid rgba(242, 182, 50, 0.3)",
              textDecoration: "none",
              display: "block",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(42, 75, 130, 0.95)";
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(42, 75, 130, 0.85)";
              e.currentTarget.style.borderColor = "rgba(242, 182, 50, 0.3)";
            }}
          >
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                marginBottom: "0.15rem",
              }}
            >
              Need Help?
            </div>
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--accent)",
              }}
            >
              Contact MLE Mailbox
            </div>
          </a>

          <button
            onClick={() => signOut()}
            style={{
              padding: "0.45rem 1.1rem",
              backgroundColor: "rgba(42, 75, 130, 0.85)",
              color: "var(--text-main)",
              border: "2px solid rgba(242, 182, 50, 0.5)",
              borderRadius: "10px",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                "rgba(42, 75, 130, 0.95)";
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor =
                "rgba(42, 75, 130, 0.85)";
              e.currentTarget.style.borderColor = "rgba(242, 182, 50, 0.5)";
            }}
          >
            Sign Out
          </button>
        </div>

        {/* Header Section */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
            marginBottom: "2rem",
            padding: "1.5rem 0",
            borderBottom: "2px solid rgba(242, 182, 50, 0.2)",
          }}
        >
          {/* Left: Logo and Title */}
          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            {isAdmin ? (
              <Link
                href="/admin"
                style={{
                  display: "block",
                  cursor: "pointer",
                  transition: "opacity 0.2s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                <Image
                  src="/mle-logo.png"
                  alt="MLE Logo"
                  width={80}
                  height={80}
                  style={{ display: "block" }}
                />
              </Link>
            ) : (
              <Image
                src="/mle-logo.png"
                alt="MLE Logo"
                width={80}
                height={80}
                style={{ display: "block" }}
              />
            )}
            <div>
              <h1
                style={{
                  fontSize: "clamp(1.5rem, 6vw, 2.5rem)",
                  fontWeight: 900,
                  marginBottom: "0.25rem",
                  background:
                    "linear-gradient(90deg, var(--mle-gold), #ffd700)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  letterSpacing: "0.02em",
                }}
              >
                MINOR LEAGUE ESPORTS
              </h1>
              <p
                style={{
                  fontSize: "clamp(1.2rem, 5vw, 2.0rem)",
                  fontFamily: "var(--font-zuume)",
                  color: "var(--text-muted)",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                RL Fantasy
              </p>
            </div>
          </div>
        </div>

        {/* Learn About How To Play - full-width bar */}
        <button
          onClick={() => setShowInfoModal(true)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.6rem",
            padding: "1rem 1.5rem",
            marginBottom: "1.5rem",
            backgroundColor: "rgba(42, 75, 130, 0.85)",
            color: "var(--accent)",
            border: "2px solid rgba(242, 182, 50, 0.5)",
            borderRadius: "12px",
            fontWeight: 700,
            fontSize: "1.05rem",
            cursor: "pointer",
            transition: "all 0.2s ease",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(42, 75, 130, 0.95)";
            e.currentTarget.style.borderColor = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(42, 75, 130, 0.85)";
            e.currentTarget.style.borderColor = "rgba(242, 182, 50, 0.5)";
          }}
        >
          Learn about how to play!
        </button>

        {/* Your Leagues Section - Horizontal Bar */}
        <section className="card" style={{ marginBottom: "1.5rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div className="card-header" style={{ marginBottom: 0, flexShrink: 0 }}>
              <h2 className="card-title">Your Leagues</h2>
            </div>

            {loadingLeagues ? (
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: "0.85rem",
                  margin: 0,
                }}
              >
                Loading leagues...
              </p>
            ) : userLeagues.length === 0 ? (
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: "0.85rem",
                  margin: 0,
                }}
              >
                No leagues yet
              </p>
            ) : (
              <div
                className="scroll-x"
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  flexWrap: "nowrap",
                  flex: 1,
                  minWidth: 0,
                  paddingBottom: "0.25rem",
                }}
              >
                {userLeagues.map((league) => {
                  const userTeam = league.fantasyTeams?.[0];
                  const href = userTeam
                    ? `/leagues/${league.id}/my-roster/${userTeam.id}`
                    : `/leagues/${league.id}`;

                  return (
                    <Link
                      key={league.id}
                      href={href}
                      className="btn btn-ghost"
                      style={{
                        textDecoration: "none",
                        padding: "0.75rem 1.25rem",
                        fontSize: "0.95rem",
                        fontWeight: 600,
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {league.name}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Global Leaderboard / Per-League Standings Section */}
        <section className="card">
          <div
            className="card-header"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}
          >
            <div>
              <h2 className="card-title">Manager Stats</h2>
              <span className="card-subtitle">
                {managerStatsTab === "global"
                  ? "Top 10 performers across all leagues"
                  : "Full standings for the selected league"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => setManagerStatsTab("global")}
                  className={managerStatsTab === "global" ? "btn btn-primary" : "btn btn-ghost"}
                  style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}
                >
                  Global
                </button>
                <button
                  onClick={() => setManagerStatsTab("league")}
                  className={managerStatsTab === "league" ? "btn btn-primary" : "btn btn-ghost"}
                  style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}
                >
                  By League
                </button>
              </div>
              {managerStatsTab === "league" && userLeagues.length > 0 && (
                <select
                  value={standingsLeagueId ?? ""}
                  onChange={(e) => setStandingsLeagueId(e.target.value)}
                  style={{
                    padding: "0.5rem 0.75rem",
                    background: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "6px",
                    color: "var(--text-main)",
                    fontSize: "0.85rem",
                  }}
                >
                  {userLeagues.map((league) => (
                    <option key={league.id} value={league.id}>
                      {league.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {managerStatsTab === "global" ? (
          <div style={{ marginTop: "1rem", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Rank
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Manager
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Team
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    League
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    <HeaderTooltip label="W-L" full="Win-Loss Record" />
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Win %
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
                    <HeaderTooltip label="Total Pts" full="Total Points" />
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
                    <HeaderTooltip label="Avg" full="Average Fantasy Points" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {loadingLeaderboard ? (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: "2rem",
                        textAlign: "center",
                        color: "var(--text-muted)",
                      }}
                    >
                      Loading leaderboard...
                    </td>
                  </tr>
                ) : globalLeaderboard.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: "2rem",
                        textAlign: "center",
                        color: "var(--text-muted)",
                      }}
                    >
                      No leaderboard data available yet
                    </td>
                  </tr>
                ) : (
                  globalLeaderboard.map((player) => (
                  <tr
                    key={player.rank}
                    onClick={() =>
                      setSelectedManagerOverview({ leagueId: player.leagueId, fantasyTeamId: player.fantasyTeamId })
                    }
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      backgroundColor: player.isYou
                        ? "rgba(242, 182, 50, 0.08)"
                        : "transparent",
                      borderLeft: player.isYou
                        ? "3px solid var(--accent)"
                        : "3px solid transparent",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = player.isYou
                        ? "rgba(242, 182, 50, 0.14)"
                        : "rgba(255,255,255,0.04)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = player.isYou
                        ? "rgba(242, 182, 50, 0.08)"
                        : "transparent";
                    }}
                  >
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        fontWeight: 700,
                        fontSize: "1rem",
                        color: player.rank <= 3 ? "var(--accent)" : "inherit",
                      }}
                    >
                      {player.rank}
                    </td>
                    <td style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>
                      {player.manager}
                      {player.isYou && (
                        <span
                          style={{
                            marginLeft: "0.5rem",
                            fontSize: "0.75rem",
                            color: "var(--accent)",
                          }}
                        >
                          (You)
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        color: "var(--text-muted)",
                        fontSize: "0.9rem",
                      }}
                    >
                      {player.team}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        color: "var(--text-muted)",
                        fontSize: "0.85rem",
                      }}
                    >
                      {player.league}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "center",
                        fontWeight: 500,
                      }}
                    >
                      <span style={{ color: "#22c55e" }}>{player.wins}</span>-
                      <span style={{ color: "#ef4444" }}>{player.losses}</span>
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "center",
                        fontWeight: 600,
                      }}
                    >
                      {player.winRate.toFixed(0)}%
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "right",
                        fontWeight: 700,
                        color: "var(--accent)",
                      }}
                    >
                      {player.totalPoints.toFixed(1)}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "right",
                        color: "var(--text-muted)",
                      }}
                    >
                      {player.avgPoints.toFixed(1)}
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          ) : (
          <div style={{ marginTop: "1rem", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    Rank
                  </th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    Manager
                  </th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "left", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    Team
                  </th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    <HeaderTooltip label="W-L" full="Win-Loss Record" />
                  </th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    Win %
                  </th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    Streak
                  </th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    <HeaderTooltip label="Total Pts" full="Total Points" />
                  </th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    <HeaderTooltip label="Avg" full="Average Fantasy Points" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {!standingsLeagueId ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                      Join a league to see its standings here.
                    </td>
                  </tr>
                ) : loadingLeagueStandings ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                      Loading standings...
                    </td>
                  </tr>
                ) : leagueStandings.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                      No standings available yet
                    </td>
                  </tr>
                ) : (
                  leagueStandings.map((team) => {
                    const totalGames = team.wins + team.losses;
                    const winRate = totalGames > 0 ? (team.wins / totalGames) * 100 : 0;
                    return (
                      <tr
                        key={team.fantasyTeamId}
                        onClick={() =>
                          standingsLeagueId &&
                          setSelectedManagerOverview({ leagueId: standingsLeagueId, fantasyTeamId: team.fantasyTeamId })
                        }
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          backgroundColor: team.isYou ? "rgba(242, 182, 50, 0.08)" : "transparent",
                          borderLeft: team.isYou ? "3px solid var(--accent)" : "3px solid transparent",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = team.isYou
                            ? "rgba(242, 182, 50, 0.14)"
                            : "rgba(255,255,255,0.04)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = team.isYou
                            ? "rgba(242, 182, 50, 0.08)"
                            : "transparent";
                        }}
                      >
                        <td style={{ padding: "0.75rem 0.5rem", fontWeight: 700, fontSize: "1rem", color: team.rank <= 3 ? "var(--accent)" : "inherit" }}>
                          {team.rank}
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>
                          {team.manager}
                          {team.isYou && (
                            <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--accent)" }}>
                              (You)
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                          {team.team}
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontWeight: 500 }}>
                          <span style={{ color: "#22c55e" }}>{team.wins}</span>-
                          <span style={{ color: "#ef4444" }}>{team.losses}</span>
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontWeight: 600 }}>
                          {winRate.toFixed(0)}%
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 0.5rem",
                            textAlign: "center",
                            fontWeight: 600,
                            color: team.streak?.startsWith("W") ? "#22c55e" : team.streak?.startsWith("L") ? "#ef4444" : "var(--text-muted)",
                          }}
                        >
                          {team.streak}
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", textAlign: "right", fontWeight: 700, color: "var(--accent)" }}>
                          {team.points.toFixed(1)}
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", textAlign: "right", color: "var(--text-muted)" }}>
                          {team.avgPoints.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          )}
        </section>

        {/* Team Stats Section */}
        <section className="card" style={{ marginTop: "1.5rem" }}>
          <div className="card-header" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 className="card-title">Team Stats</h2>
              <span className="card-subtitle">Top 10 performing MLE teams</span>
            </div>

            {/* 2s/3s Switch */}
            <div style={{ display: "flex", gap: "0.5rem", background: "rgba(255,255,255,0.1)", padding: "0.4rem", borderRadius: "8px" }}>
              <button
                onClick={() => setGameMode("all")}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "6px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: gameMode === "all" ? "var(--accent)" : "transparent",
                  color: gameMode === "all" ? "#1a1a2e" : "var(--text-main)",
                  transition: "all 0.2s ease",
                }}
              >
                Both
              </button>
              <button
                onClick={() => setGameMode("2s")}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "6px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: gameMode === "2s" ? "var(--accent)" : "transparent",
                  color: gameMode === "2s" ? "#1a1a2e" : "var(--text-main)",
                  transition: "all 0.2s ease",
                }}
              >
                2s
              </button>
              <button
                onClick={() => setGameMode("3s")}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "6px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: gameMode === "3s" ? "var(--accent)" : "transparent",
                  color: gameMode === "3s" ? "#1a1a2e" : "var(--text-main)",
                  transition: "all 0.2s ease",
                }}
              >
                3s
              </button>
            </div>
          </div>

          <div style={{ marginTop: "1rem", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <SortableHeader
                    column="rank"
                    label="Rank"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="name"
                    label="Team"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="score"
                    label="Score"
                    align="right"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="fpts"
                    label="Fpts"
                    full="Fantasy Points"
                    align="right"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="last"
                    label="Last"
                    full="Last Week's Fantasy Points"
                    align="right"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="avg"
                    label="Avg"
                    full="Average Fantasy Points"
                    align="right"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="shots"
                    label="Shots"
                    align="right"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="goals"
                    label="Goals"
                    align="right"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="assists"
                    label="Assists"
                    align="right"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="saves"
                    label="Saves"
                    align="right"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="demos"
                    label="Demos"
                    full="Demolitions"
                    align="right"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={12} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                      Loading team stats...
                    </td>
                  </tr>
                ) : sortedTeams.length === 0 ? (
                  <tr>
                    <td colSpan={12} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                      No team stats available yet
                    </td>
                  </tr>
                ) : (
                sortedTeams.map((team) => (
                  <tr
                    key={team.rank}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        fontWeight: 700,
                        fontSize: "1rem",
                        color: team.rank <= 3 ? "var(--accent)" : "inherit",
                      }}
                    >
                      {team.rank}
                    </td>
                    <td style={{ padding: "0.75rem 0.5rem" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <Image
                          src={team.logoPath}
                          alt={`${team.name} logo`}
                          width={24}
                          height={24}
                          style={{ borderRadius: "4px" }}
                        />
                        <span
                          onClick={() => {
                            setSelectedTeam(team);
                            setShowModal(true);
                          }}
                          style={{
                            fontWeight: 600,
                            fontSize: "0.95rem",
                            cursor: "pointer",
                            color: "var(--text-main)",
                            transition: "color 0.2s",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.color = "var(--accent)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.color = "var(--text-main)")
                          }
                        >
                          {team.leagueId} {team.name}
                        </span>
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "right",
                        fontWeight: 700,
                        color: "var(--accent)",
                      }}
                    >
                      {team.score}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "right",
                        fontWeight: 600,
                      }}
                    >
                      {team.fpts}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "right",
                        color: "var(--text-muted)",
                      }}
                    >
                      {team.last}
                    </td>
                    <td
                      style={{
                        padding: "0.75rem 0.5rem",
                        textAlign: "right",
                        color: "var(--text-muted)",
                      }}
                    >
                      {team.avg}
                    </td>
                    <td
                      style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}
                    >
                      {team.shots}
                    </td>
                    <td
                      style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}
                    >
                      {team.goals}
                    </td>
                    <td
                      style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}
                    >
                      {team.assists}
                    </td>
                    <td
                      style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}
                    >
                      {team.saves}
                    </td>
                    <td
                      style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}
                    >
                      {team.demos}
                    </td>
                  </tr>
                ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
