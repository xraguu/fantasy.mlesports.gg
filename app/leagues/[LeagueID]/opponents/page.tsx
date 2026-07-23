"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import TeamModal from "@/components/TeamModal";
import HeaderTooltip from "@/components/HeaderTooltip";
import TransactionHistoryModal from "@/components/TransactionHistoryModal";
import { isAdminViewingLeague } from "@/lib/adminLeagueView";

// Helper function to get fantasy rank color
const getFantasyRankColor = (rank: number): string => {
  if (rank >= 1 && rank <= 12) return "#ef4444"; // red
  if (rank >= 13 && rank <= 24) return "#9ca3af"; // gray
  if (rank >= 25 && rank <= 32) return "#22c55e"; // green
  return "#9ca3af"; // default gray
};

interface WithinLeagueStanding {
  rank: number;
  totalTeams: number;
}

interface OpponentTeamInfo {
  id: string;
  name: string;
  leagueId: string;
  slug: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
}

interface OpponentRoster {
  slot: string;
  id: string;
  name: string;
  leagueId: string;
  slug: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
  score: number;
  opponent: string;
  opponentTeam: OpponentTeamInfo | null;
  opponentStanding: WithinLeagueStanding | null;
  oprk: number;
  fprk: number;
  fpts: number;
  avg: number;
  last: number;
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demos: number;
  teamRecord: string;
  opponentGameRecord: string;
  opponentFantasyRank: number;
}

// Color tier for how tough an opponent is, from the viewer's perspective —
// inverted from a normal standings color (lib/teamSeasonStats.ts's
// getStandingsColor, duplicated here since that file imports Prisma and
// can't be used from a client component): a well-ranked, dangerous opponent
// reads as bad news (red), a poorly-ranked, easy one reads as good news
// (green).
function getOpponentStandingsColor(rank: number, totalTeams: number): string {
  const percentile = rank / totalTeams;
  if (percentile <= 1 / 3) return "#ef4444";
  if (percentile <= 2 / 3) return "#9ca3af";
  return "#22c55e";
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

interface OpponentData {
  id: string;
  name: string;
  teamName: string;
  record: string;
  place: string;
  totalPoints: number;
  avgPoints: number;
  currentWeek: number;
  waiverPriority: number | null;
  faabRemaining: number | null;
  completedTransactionCount: number;
  pendingTransactionCount: number;
  lastMatchup?: {
    id: string;
    week: number;
    myTeam: string;
    myScore: number;
    opponent: string;
    opponentScore: number;
  };
  currentMatchup?: {
    id: string;
    week: number;
    myTeam: string;
    myScore: number;
    opponent: string;
    opponentScore: number;
  };
  teams: OpponentRoster[];
}

export default function OpponentsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const leagueId = params.LeagueID as string;
  const teamIdParam = searchParams.get("teamId");
  const managerParam = searchParams.get("manager");

  // An admin browsing this league via the admin panel's "View League" button
  // reaches this same page/route whenever they click into a specific team
  // from Scoreboard/Standings, or via the "Managers" nav link (a thin
  // re-export of this same route, see app/leagues/[LeagueID]/managers/page.tsx).
  // Detected the same way as LeagueNavbar and deliberately ONLY that way —
  // the explicit sessionStorage flag that button set — not inferred from
  // team ownership: an admin can genuinely also be a manager here (this
  // app's own test leagues are a real example), and visiting normally must
  // still show the real Opponents page with Propose Trade, not silently
  // switch to the read-only admin view just because they're an admin.
  const [isAdminViewing, setIsAdminViewing] = useState(false);
  useEffect(() => {
    if (!session?.user?.id || !leagueId) return;
    if (session.user.role !== "admin") return;
    setIsAdminViewing(isAdminViewingLeague(leagueId));
  }, [session?.user?.id, session?.user?.role, leagueId]);

  const [opponents, setOpponents] = useState<OpponentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(
    teamIdParam,
  );
  const [currentWeek, setCurrentWeek] = useState(1);
  // Whether the one-time "snap to the league's real current week" has
  // already happened — tracked separately from `currentWeek === 1`, which
  // used to stand in for "this is the initial load." That's wrong: it's
  // ALSO true every time the user manually navigates back to week 1 later,
  // so the snap kept re-firing and immediately bouncing them back to the
  // current week the moment they tried to look at week 1.
  const hasSnappedToCurrent = useRef(false);
  const [activeTab, setActiveTab] = useState<"lineup" | "stats">("lineup");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<{
    id: string;
    name: string;
    leagueId: string;
    slug: string;
    logoPath: string;
    primaryColor: string;
    secondaryColor: string;
    fpts?: number;
    avg?: number;
    last?: number;
    rank?: number;
    record?: string;
    status?: string;
    rosteredBy?: {
      rosterName: string;
      managerName: string;
      fantasyTeamId?: string;
    };
  } | null>(null);

  // Track game mode for stats tab (2s or 3s)
  const [gameMode, setGameMode] = useState<"2s" | "3s">("2s");

  // Track game modes for each slot
  const [slotModes, setSlotModes] = useState<string[]>([]);

  // League's waiver system (admin-view overview card shows waiver priority
  // or FAAB budget depending on it) and the transactions modal's open/mode
  // state (shared between the "N transactions" and "N pending" clickables).
  const [waiverSystem, setWaiverSystem] = useState<string | null>(null);
  const [transactionsModal, setTransactionsModal] = useState<
    "completed" | "pending" | null
  >(null);

  // Fetch opponents data
  useEffect(() => {
    const fetchOpponents = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/leagues/${leagueId}/opponents?week=${currentWeek}${isAdminViewing ? "&adminView=true" : ""}`,
        );

        if (!response.ok) {
          throw new Error("Failed to fetch opponents");
        }

        const data = await response.json();
        setOpponents(data.opponents || []);
        if (data.league?.waiverSystem)
          setWaiverSystem(data.league.waiverSystem);

        // Snap to the league's real current week on first load only — once
        // the user has navigated weeks manually, leave their choice alone.
        if (
          !hasSnappedToCurrent.current &&
          data.league?.currentWeek &&
          data.league.currentWeek !== 1
        ) {
          hasSnappedToCurrent.current = true;
          setCurrentWeek(data.league.currentWeek);
        }

        // Set selected manager based on URL parameters
        if (data.opponents && data.opponents.length > 0) {
          if (teamIdParam) {
            // If teamId param provided, use it
            setSelectedManagerId(teamIdParam);
          } else if (managerParam) {
            // If manager param provided, find opponent by manager name
            const opponent = data.opponents.find(
              (opp: OpponentData) =>
                opp.name === decodeURIComponent(managerParam),
            );
            if (opponent) {
              setSelectedManagerId(opponent.id);
            } else {
              // Fallback to first opponent if manager not found
              setSelectedManagerId(data.opponents[0].id);
            }
          } else if (!selectedManagerId) {
            // No params and no selection, default to first opponent
            setSelectedManagerId(data.opponents[0].id);
          }
        }

        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load opponents",
        );
      } finally {
        setLoading(false);
      }
    };

    if (leagueId) {
      fetchOpponents();
    }
  }, [
    leagueId,
    currentWeek,
    selectedManagerId,
    teamIdParam,
    managerParam,
    isAdminViewing,
  ]);

  // Derived values
  const selectedManager = opponents.find((m) => m.id === selectedManagerId);
  const roster = selectedManager || null;

  // Initialize slot modes when roster changes
  useEffect(() => {
    if (selectedManager && selectedManager.teams) {
      setSlotModes(selectedManager.teams.map(() => "2s"));
    }
  }, [selectedManager]);

  // Helper functions for week navigation (weeks 1-10)
  const getNextWeek = (week: number) => {
    if (week >= 10) return 10;
    return week + 1;
  };

  const getPrevWeek = (week: number) => {
    if (week <= 1) return 1;
    return week - 1;
  };

  // Stats tab sorting state
  const [statsSortColumn, setStatsSortColumn] = useState<
    | "fprk"
    | "fpts"
    | "avg"
    | "last"
    | "goals"
    | "shots"
    | "saves"
    | "assists"
    | "demos"
  >("fprk");
  const [statsSortDirection, setStatsSortDirection] = useState<"asc" | "desc">(
    "asc",
  );

  const handleStatsSort = (column: typeof statsSortColumn) => {
    if (statsSortColumn === column) {
      setStatsSortDirection(statsSortDirection === "asc" ? "desc" : "asc");
    } else {
      setStatsSortColumn(column);
      setStatsSortDirection("asc");
    }
  };

  // Sorted roster teams for stats tab (skip empty slots — only actual rostered teams)
  const sortedRosterTeams = useMemo(() => {
    if (!roster || !roster.teams) return [];
    return roster.teams
      .filter((team) => team.name)
      .sort((a, b) => {
        const aValue = a[statsSortColumn];
        const bValue = b[statsSortColumn];
        if (statsSortDirection === "asc") {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
  }, [statsSortColumn, statsSortDirection, roster]);

  const handleTeamClick = (rosterTeam: OpponentRoster) => {
    // This is only reachable from within the currently selected opponent's roster,
    // so the clicked team is by definition rostered by that opponent. All the
    // team's real identity/display data (id, logo, its own primary/secondary
    // colors) now comes straight from the API (app/api/leagues/[leagueId]/opponents/route.ts),
    // not the old static lib/teams.ts registry — that file's colors were the
    // MLE competition tier's branding color, not the individual team's.
    if (roster) {
      setSelectedTeam({
        id: rosterTeam.id,
        name: rosterTeam.name.split(" ").slice(1).join(" "),
        leagueId: rosterTeam.leagueId,
        slug: rosterTeam.slug,
        logoPath: rosterTeam.logoPath,
        primaryColor: rosterTeam.primaryColor,
        secondaryColor: rosterTeam.secondaryColor,
        status: "rostered",
        rosteredBy: {
          rosterName: roster.teamName,
          managerName: roster.name,
          fantasyTeamId: roster.id,
        },
      });
      setShowModal(true);
    }
  };

  // Loading and error states
  if (loading) {
    return (
      <div
        style={{
          minHeight: "50vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>
          Loading opponents...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          minHeight: "50vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ color: "#ef4444", fontSize: "1.1rem" }}>
          Error: {error}
        </div>
      </div>
    );
  }

  if (opponents.length === 0) {
    return (
      <div
        style={{
          minHeight: "50vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>
          No opponents found in this league
        </div>
      </div>
    );
  }

  if (!roster) {
    return (
      <div
        style={{
          minHeight: "50vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>
          Select an opponent to view their roster
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Team Modal */}
      <TeamModal
        team={showModal && selectedTeam ? selectedTeam : null}
        fantasyLeagueId={leagueId}
        onClose={() => setShowModal(false)}
      />

      {/* Transactions Modal (admin view only) */}
      {isAdminViewing && (
        <TransactionHistoryModal
          open={transactionsModal !== null}
          onClose={() => setTransactionsModal(null)}
          title={
            transactionsModal === "pending"
              ? "Pending Transactions"
              : "Transaction History"
          }
          leagueId={leagueId}
          teamId={roster.id}
          managerName={roster.name}
          mode={transactionsModal ?? "completed"}
        />
      )}

      {/* Page Header with Dropdown */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <h1
          className="page-heading"
          style={{
            fontSize: "clamp(1.5rem, 6vw, 2.5rem)",
            color: "var(--accent)",
            fontWeight: 700,
            margin: 0,
          }}
        >
          {isAdminViewing ? "Managers" : "Opponents"}
        </h1>

        {/* Manager Dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{
              background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#ffffff",
              padding: "0.75rem 1.5rem",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "1rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              minWidth: "200px",
              justifyContent: "space-between",
            }}
          >
            <span>{roster.name}</span>
            <span>{dropdownOpen ? "▲" : "▼"}</span>
          </button>

          {dropdownOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: "0.5rem",
                background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                borderRadius: "8px",
                padding: "0.5rem 0",
                minWidth: "220px",
                maxHeight: "400px",
                overflowY: "auto",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                zIndex: 1000,
              }}
            >
              {opponents.map((opponent) => (
                <button
                  key={opponent.id}
                  onClick={() => {
                    setSelectedManagerId(opponent.id);
                    setDropdownOpen(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "0.75rem 1rem",
                    background:
                      opponent.id === selectedManagerId
                        ? "rgba(255,255,255,0.1)"
                        : "transparent",
                    border: "none",
                    color: "#ffffff",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "background 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                  }}
                  onMouseLeave={(e) => {
                    if (opponent.id !== selectedManagerId) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                    {opponent.name}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    {opponent.teamName}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Team Overview Card */}
      <section
        className="card"
        style={{
          marginBottom: "1.5rem",
          padding: "1.5rem 2rem",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "1.25rem",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {/* Team Info */}
          <div>
            <h2
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "clamp(1.15rem, 4.5vw, 1.5rem)",
                fontWeight: 700,
                color: "var(--text-main)",
                marginBottom: "0.5rem",
                marginTop: 0,
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>{roster.teamName}</span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: "var(--accent)" }}>{roster.record}</span>
                <span
                  style={{ color: "var(--text-muted)", fontSize: "1.2rem" }}
                >
                  {roster.place}
                </span>
              </span>
            </h2>
            <div style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
              {roster.name}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.4rem 1.5rem",
                marginTop: "0.5rem",
                fontSize: "1rem",
              }}
            >
              <span
                style={{
                  whiteSpace: "nowrap",
                  fontWeight: 600,
                  color: "var(--text-main)",
                }}
              >
                {roster.totalPoints} Fantasy Points
              </span>
              <span
                style={{ whiteSpace: "nowrap", color: "var(--text-muted)" }}
              >
                {roster.avgPoints} Avg Fantasy Points
              </span>
            </div>
            {isAdminViewing && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.4rem 1.5rem",
                  marginTop: "0.5rem",
                  fontSize: "0.9rem",
                }}
              >
                <span
                  style={{ whiteSpace: "nowrap", color: "var(--text-muted)" }}
                >
                  {waiverSystem === "faab"
                    ? `$${roster.faabRemaining ?? 0} FAAB Remaining`
                    : `Waiver Priority: #${roster.waiverPriority ?? "—"}`}
                </span>
                <span
                  onClick={() => setTransactionsModal("completed")}
                  style={{
                    whiteSpace: "nowrap",
                    color: "var(--accent)",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {roster.completedTransactionCount} Transaction
                  {roster.completedTransactionCount === 1 ? "" : "s"}
                </span>
                <span
                  onClick={() => setTransactionsModal("pending")}
                  style={{
                    whiteSpace: "nowrap",
                    color: "var(--accent)",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {roster.pendingTransactionCount} Pending
                </span>
              </div>
            )}
          </div>

          {/* Matchup Info */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "1.5rem",
              alignItems: "center",
            }}
          >
            {/* Last Matchup */}
            {roster.lastMatchup && (
              <div
                onClick={() =>
                  router.push(
                    `/leagues/${leagueId}/scoreboard?week=${roster.lastMatchup!.week}&matchup=${roster.lastMatchup!.id}`,
                  )
                }
                style={{ textAlign: "center", cursor: "pointer" }}
              >
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "0.85rem",
                    fontStyle: "italic",
                    marginBottom: "0.5rem",
                  }}
                >
                  Last Matchup
                </div>
                <div style={{ fontSize: "0.95rem", marginBottom: "0.25rem" }}>
                  <span style={{ color: "var(--text-main)" }}>
                    {roster.lastMatchup.myTeam}
                  </span>{" "}
                  <span
                    style={{
                      color: "var(--accent)",
                      fontWeight: 700,
                      marginLeft: "0.5rem",
                    }}
                  >
                    {roster.lastMatchup.myScore}
                  </span>
                </div>
                <div style={{ fontSize: "0.95rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>
                    {roster.lastMatchup.opponent}
                  </span>{" "}
                  <span
                    style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}
                  >
                    {roster.lastMatchup.opponentScore}
                  </span>
                </div>
              </div>
            )}

            {roster.lastMatchup && roster.currentMatchup && (
              <div
                style={{
                  width: "1px",
                  height: "60px",
                  backgroundColor: "rgba(255,255,255,0.1)",
                }}
              ></div>
            )}

            {/* Current Matchup */}
            {roster.currentMatchup && (
              <div
                onClick={() =>
                  router.push(
                    `/leagues/${leagueId}/scoreboard?week=${roster.currentMatchup!.week}&matchup=${roster.currentMatchup!.id}`,
                  )
                }
                style={{ textAlign: "center", cursor: "pointer" }}
              >
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "0.85rem",
                    fontStyle: "italic",
                    marginBottom: "0.5rem",
                  }}
                >
                  Current Matchup
                </div>
                <div style={{ fontSize: "0.95rem", marginBottom: "0.25rem" }}>
                  <span style={{ color: "var(--text-main)" }}>
                    {roster.currentMatchup.myTeam}
                  </span>{" "}
                  <span
                    style={{
                      color: "var(--accent)",
                      fontWeight: 700,
                      marginLeft: "0.5rem",
                    }}
                  >
                    {roster.currentMatchup.myScore}
                  </span>
                </div>
                <div style={{ fontSize: "0.95rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>
                    {roster.currentMatchup.opponent}
                  </span>{" "}
                  <span
                    style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}
                  >
                    {roster.currentMatchup.opponentScore}
                  </span>
                </div>
              </div>
            )}

            {!roster.lastMatchup && !roster.currentMatchup && (
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: "0.9rem",
                  fontStyle: "italic",
                }}
              >
                No matchup data available
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={() => setActiveTab("lineup")}
            className={
              activeTab === "lineup" ? "btn btn-primary" : "btn btn-ghost"
            }
            style={{ fontSize: "1rem" }}
          >
            Lineup
          </button>
          <button
            onClick={() => setActiveTab("stats")}
            className={
              activeTab === "stats" ? "btn btn-primary" : "btn btn-ghost"
            }
            style={{ fontSize: "1rem" }}
          >
            Stats
          </button>
        </div>
        {!isAdminViewing && (
          <a
            href={`/leagues/${leagueId}/opponents/${selectedManagerId}/trade`}
            className="btn btn-primary"
            style={{ fontSize: "0.9rem" }}
          >
            Propose Trade
          </a>
        )}
      </div>

      {/* Lineup Tab */}
      {activeTab === "lineup" && (
        <section className="card">
          {/* Week Navigation */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
              padding: "1rem 1.5rem",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <button
                onClick={() => setCurrentWeek((prev) => getPrevWeek(prev))}
                disabled={currentWeek === 1}
                style={{
                  background: "transparent",
                  border: "none",
                  color:
                    currentWeek === 1
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.7)",
                  cursor: currentWeek === 1 ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                }}
              >
                {currentWeek === 1 ? "◄" : `◄ Week ${getPrevWeek(currentWeek)}`}
              </button>

              <span
                style={{
                  color: "#d4af37",
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  padding: "0 1rem",
                }}
              >
                Week {currentWeek}
              </span>

              <button
                onClick={() => setCurrentWeek((prev) => getNextWeek(prev))}
                disabled={currentWeek === 10}
                style={{
                  background: "transparent",
                  border: "none",
                  color:
                    currentWeek === 10
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.7)",
                  cursor: currentWeek === 10 ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                }}
              >
                {currentWeek === 10
                  ? "►"
                  : `Week ${getNextWeek(currentWeek)} ►`}
              </button>
            </div>
          </div>

          {/* Roster Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "0.75rem 0.5rem", width: "50px" }}></th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Slot
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
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
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Score
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    <HeaderTooltip
                      label="Opp"
                      full="Opponent / Game Record (MLE Rank)"
                    />
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    <HeaderTooltip
                      label="Oprk"
                      full="Opponent Fantasy Points Rank"
                    />
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    <HeaderTooltip label="Fprk" full="Fantasy Points Rank" />
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    <HeaderTooltip label="Fpts" full="TotalFantasy Points" />
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    <HeaderTooltip label="Avg" full="Average Fantasy Points" />
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    <HeaderTooltip
                      label="Last"
                      full="Last Week's Fantasy Points"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {roster.teams.map((team, index) => {
                  const isEmpty = !team.name;
                  const isBench = team.slot === "be";
                  const currentMode = slotModes[index] || "2s";

                  return (
                    <tr
                      key={index}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        backgroundColor: isBench
                          ? "rgba(255,255,255,0.02)"
                          : "transparent",
                        borderTop:
                          isBench && index === 5
                            ? "2px solid rgba(255,255,255,0.15)"
                            : "none",
                      }}
                    >
                      <td
                        style={{
                          padding: "0.75rem 0.5rem",
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            justifyContent: "center",
                          }}
                        >
                          {!isEmpty && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newModes = [...slotModes];
                                  newModes[index] =
                                    slotModes[index] === "2s" ? "3s" : "2s";
                                  setSlotModes(newModes);
                                }}
                                style={{
                                  background: "rgba(255,255,255,0.1)",
                                  border: "none",
                                  borderRadius: "4px",
                                  padding: "0.25rem 0.5rem",
                                  fontSize: "0.75rem",
                                  fontWeight: 600,
                                  color: "var(--accent)",
                                  cursor: "pointer",
                                  transition: "all 0.2s ease",
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.background =
                                    "rgba(242, 182, 50, 0.2)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.background =
                                    "rgba(255,255,255,0.1)")
                                }
                              >
                                ⇄
                              </button>
                              <span
                                style={{
                                  fontSize: "0.7rem",
                                  fontWeight: 600,
                                  color: "var(--accent)",
                                }}
                              >
                                {currentMode}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          fontWeight: 700,
                          fontSize: "0.9rem",
                          color: isBench
                            ? "var(--text-muted)"
                            : "var(--accent)",
                        }}
                      >
                        {team.slot === "flx" || team.slot === "be"
                          ? team.slot.toUpperCase()
                          : team.slot}
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        {isEmpty ? (
                          <span
                            style={{
                              color: "var(--text-muted)",
                              fontSize: "0.95rem",
                              fontStyle: "italic",
                            }}
                          >
                            Empty
                          </span>
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                            }}
                          >
                            {/* Team Logo */}
                            {team.logoPath && (
                              <Image
                                src={team.logoPath}
                                alt={team.name}
                                width={32}
                                height={32}
                                style={{ borderRadius: "4px" }}
                              />
                            )}
                            <div>
                              <div
                                onClick={() => handleTeamClick(team)}
                                style={{
                                  fontWeight: 600,
                                  fontSize: "1rem",
                                  cursor: "pointer",
                                  color: "var(--text-main)",
                                  transition: "color 0.2s",
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.color =
                                    "var(--accent)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.color =
                                    "var(--text-main)")
                                }
                              >
                                {team.name}
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontWeight: 700,
                          fontSize: "1rem",
                          color:
                            team.score > 0
                              ? "var(--accent)"
                              : "var(--text-muted)",
                        }}
                      >
                        {team.score > 0 ? team.score.toFixed(1) : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          fontSize: "0.9rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        {team.opponentTeam ? (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTeam({
                                ...team.opponentTeam!,
                                status: undefined,
                              });
                              setShowModal(true);
                            }}
                            style={{ cursor: "pointer" }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.textDecoration =
                                "underline")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.textDecoration = "none")
                            }
                          >
                            {team.opponent} {team.opponentGameRecord}
                            {team.opponentStanding && (
                              <>
                                {" "}
                                <span
                                  style={{
                                    color: getOpponentStandingsColor(
                                      team.opponentStanding.rank,
                                      team.opponentStanding.totalTeams,
                                    ),
                                    fontWeight: 600,
                                  }}
                                >
                                  ({ordinal(team.opponentStanding.rank)})
                                </span>
                              </>
                            )}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontSize: "0.9rem",
                        }}
                      >
                        {team.oprk || "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontSize: "0.9rem",
                          fontWeight: 600,
                        }}
                      >
                        {team.fprk || "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontWeight: 600,
                          fontSize: "0.95rem",
                        }}
                      >
                        {team.fpts ? team.fpts.toFixed(1) : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          color: "var(--text-muted)",
                          fontSize: "0.9rem",
                        }}
                      >
                        {team.avg ? team.avg.toFixed(1) : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          color: "var(--text-muted)",
                          fontSize: "0.9rem",
                        }}
                      >
                        {team.last ? team.last.toFixed(1) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Stats Tab */}
      {activeTab === "stats" && (
        <section className="card">
          {/* Week Navigation and 2s/3s Switch */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
              padding: "1rem 1.5rem",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <button
                onClick={() => setCurrentWeek((prev) => getPrevWeek(prev))}
                disabled={currentWeek === 1}
                style={{
                  background: "transparent",
                  border: "none",
                  color:
                    currentWeek === 1
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.7)",
                  cursor: currentWeek === 1 ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                }}
              >
                {currentWeek === 1 ? "◄" : `◄ Week ${getPrevWeek(currentWeek)}`}
              </button>

              <span
                style={{
                  color: "#d4af37",
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  padding: "0 1rem",
                }}
              >
                Week {currentWeek}
              </span>

              <button
                onClick={() => setCurrentWeek((prev) => getNextWeek(prev))}
                disabled={currentWeek === 10}
                style={{
                  background: "transparent",
                  border: "none",
                  color:
                    currentWeek === 10
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.7)",
                  cursor: currentWeek === 10 ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                }}
              >
                {currentWeek === 10
                  ? "►"
                  : `Week ${getNextWeek(currentWeek)} ►`}
              </button>
            </div>

            {/* 2s/3s Switch */}
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                backgroundColor: "rgba(255,255,255,0.05)",
                borderRadius: "6px",
                padding: "0.25rem",
              }}
            >
              <button
                onClick={() => setGameMode("2s")}
                style={{
                  padding: "0.4rem 1rem",
                  borderRadius: "4px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor:
                    gameMode === "2s" ? "var(--accent)" : "transparent",
                  color: gameMode === "2s" ? "#1a1a2e" : "var(--text-main)",
                  transition: "all 0.2s ease",
                }}
              >
                2s
              </button>
              <button
                onClick={() => setGameMode("3s")}
                style={{
                  padding: "0.4rem 1rem",
                  borderRadius: "4px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor:
                    gameMode === "3s" ? "var(--accent)" : "transparent",
                  color: gameMode === "3s" ? "#1a1a2e" : "var(--text-main)",
                  transition: "all 0.2s ease",
                }}
              >
                3s
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "0.75rem 0.5rem", width: "50px" }}></th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
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
                      padding: "0.75rem 1rem",
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
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Score
                  </th>
                  <th
                    onClick={() => handleStatsSort("fprk")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <HeaderTooltip label="Fprk" full="Fantasy Points Rank" />{" "}
                    {statsSortColumn === "fprk" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("fpts")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <HeaderTooltip label="Total" full="Total Fantasy Points" />{" "}
                    {statsSortColumn === "fpts" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("avg")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <HeaderTooltip label="Avg" full="Average Fantasy Points" />{" "}
                    {statsSortColumn === "avg" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("last")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <HeaderTooltip
                      label="Last"
                      full="Last Week's Fantasy Points"
                    />{" "}
                    {statsSortColumn === "last" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("goals")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Goals{" "}
                    {statsSortColumn === "goals" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("shots")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Shots{" "}
                    {statsSortColumn === "shots" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("saves")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Saves{" "}
                    {statsSortColumn === "saves" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("assists")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    Assists{" "}
                    {statsSortColumn === "assists" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    onClick={() => handleStatsSort("demos")}
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "right",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <HeaderTooltip label="Demos" full="Demolitions" />{" "}
                    {statsSortColumn === "demos" &&
                      (statsSortDirection === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    style={{
                      padding: "0.75rem 1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    Record
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRosterTeams.map((team, index) => {
                  const isEmpty = !team.name;

                  return (
                    <tr
                      key={index}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      <td
                        style={{
                          padding: "0.75rem 0.5rem",
                          textAlign: "center",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color: "var(--accent)",
                          }}
                        >
                          {gameMode}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          fontWeight: 700,
                          fontSize: "0.9rem",
                          color: "var(--accent)",
                        }}
                      >
                        {index + 1}
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        {isEmpty ? (
                          <span
                            style={{
                              color: "var(--text-muted)",
                              fontSize: "0.95rem",
                              fontStyle: "italic",
                            }}
                          >
                            Empty
                          </span>
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                            }}
                          >
                            {/* Team Logo (smaller for stats tab) */}
                            {team.logoPath && (
                              <Image
                                src={team.logoPath}
                                alt={team.name}
                                width={24}
                                height={24}
                                style={{ borderRadius: "4px" }}
                              />
                            )}
                            <div>
                              <div
                                onClick={() => handleTeamClick(team)}
                                style={{
                                  fontWeight: 600,
                                  fontSize: "0.95rem",
                                  cursor: "pointer",
                                  color: "var(--text-main)",
                                  transition: "color 0.2s",
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.color =
                                    "var(--accent)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.color =
                                    "var(--text-main)")
                                }
                              >
                                {team.name}
                              </div>
                              <div
                                style={{
                                  fontSize: "0.75rem",
                                  color: "var(--text-muted)",
                                  marginTop: "0.15rem",
                                }}
                              >
                                {team.opponent &&
                                team.opponentGameRecord &&
                                team.opponentFantasyRank ? (
                                  <>
                                    vs. {team.opponent}{" "}
                                    {team.opponentGameRecord}{" "}
                                    <span
                                      style={{
                                        color: getFantasyRankColor(
                                          team.opponentFantasyRank,
                                        ),
                                      }}
                                    >
                                      ({team.opponentFantasyRank}
                                      {team.opponentFantasyRank === 1
                                        ? "st"
                                        : team.opponentFantasyRank === 2
                                          ? "nd"
                                          : team.opponentFantasyRank === 3
                                            ? "rd"
                                            : "th"}
                                      )
                                    </span>
                                  </>
                                ) : (
                                  "vs. - -"
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontWeight: 700,
                          fontSize: "1rem",
                          color: "var(--accent)",
                        }}
                      >
                        {team.score > 0 ? team.score.toFixed(1) : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontSize: "0.9rem",
                          fontWeight: 600,
                        }}
                      >
                        {team.fprk || "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontWeight: 600,
                          fontSize: "0.95rem",
                        }}
                      >
                        {team.fpts ? team.fpts.toFixed(1) : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          color: "var(--text-muted)",
                          fontSize: "0.9rem",
                        }}
                      >
                        {team.avg ? team.avg.toFixed(1) : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          color: "var(--text-muted)",
                          fontSize: "0.9rem",
                        }}
                      >
                        {team.last ? team.last.toFixed(1) : "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                        }}
                      >
                        {team.goals || "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                        }}
                      >
                        {team.shots || "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                        }}
                      >
                        {team.saves || "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                        }}
                      >
                        {team.assists || "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "right",
                          fontSize: "0.9rem",
                        }}
                      >
                        {team.demos || "-"}
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          fontSize: "0.9rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        {team.teamRecord || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
