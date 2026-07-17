"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

export default function LeagueNavbar() {
  const pathname = usePathname();
  const params = useParams();
  const leagueId = params?.LeagueID as string;
  const { data: session } = useSession();
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<string>("not_started");
  const [currentWeek, setCurrentWeek] = useState(1);
  const [seasonStarted, setSeasonStarted] = useState(false);

  // Fetch the user's fantasy team ID and league data. Client-side navigation
  // within this league (e.g. the draft room redirecting to My Roster the
  // moment a draft finishes) doesn't remount this navbar, so a one-shot
  // fetch would leave the Draft button showing stale after that transition
  // — poll while the draft hasn't wrapped up yet, so it self-corrects to
  // the Week pill within a few seconds instead of needing a full reload.
  useEffect(() => {
    if (!session?.user?.id || !leagueId) return;

    const fetchMyTeam = async () => {
      try {
        const response = await fetch(`/api/leagues/${leagueId}`);
        if (response.ok) {
          const data = await response.json();
          // Find the user's team from all fantasy teams in the league
          const myTeam = data.league?.fantasyTeams?.find(
            (team: any) => team.ownerUserId === session.user.id
          );
          if (myTeam) {
            setMyTeamId(myTeam.id);
          }
          // Track draft status and current week
          if (data.league) {
            setDraftStatus(data.league.draftStatus || "not_started");
            setCurrentWeek(data.league.currentWeek || 1);
            setSeasonStarted(!!data.league.seasonStarted);
          }
        }
      } catch (error) {
        console.error("Error fetching user's team:", error);
      }
    };

    fetchMyTeam();

    if (draftStatus === "completed") return;
    const interval = setInterval(fetchMyTeam, 10000);
    return () => clearInterval(interval);
  }, [session?.user?.id, leagueId, draftStatus]);

  const links = [
    {
      href: myTeamId ? `/leagues/${leagueId}/my-roster/${myTeamId}` : `/leagues/${leagueId}`,
      label: "My Roster"
    },
    { href: `/leagues/${leagueId}/team-portal`, label: "MLE Teams" },
    { href: `/leagues/${leagueId}/scoreboard`, label: "Scoreboard" },
    { href: `/leagues/${leagueId}/standings`, label: "Standings" },
    { href: `/leagues/${leagueId}/opponents`, label: "Opponents" },
  ];

  const isActive = (href: string) => pathname === href;

  return (
    <header className="navbar">
      <div className="nav-inner flex items-center justify-between px-4 py-2">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/mle_fantasy_logo.png"
            alt="MLE Fantasy Logo"
            width={50}
            height={50}
            priority
            style={{ cursor: "pointer" }}
          />
        </Link>

        {/* Right: links */}
        <nav className="nav-links flex items-center gap-4">
          {/* Draft Button - stays reachable even after the draft finishes,
              right up until the season itself actually starts (real
              calendar week 1) — a completed draft and a started season are
              different things, and managers may still want to review the
              draft room in between. */}
          {(draftStatus !== "completed" || !seasonStarted) && (
            <Link
              href={`/leagues/${leagueId}/draft`}
              style={{
                background: "linear-gradient(135deg, #d4af37 0%, #f2b632 100%)",
                color: "#ffffff",
                padding: "0.5rem 1.5rem",
                borderRadius: "20px",
                fontWeight: 700,
                fontSize: "0.9rem",
                textDecoration: "none",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                boxShadow: "0 4px 10px rgba(212, 175, 55, 0.3)",
                transition: "all 0.2s ease",
                border: "none",
                cursor: "pointer"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 6px 15px rgba(212, 175, 55, 0.4)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 4px 10px rgba(212, 175, 55, 0.3)";
              }}
            >
              Draft
            </Link>
          )}

          {/* Current Week Pill - only show once the season has actually started */}
          {draftStatus === "completed" && seasonStarted && (
            <span className="card-pill" style={{ fontWeight: 700, fontSize: "0.85rem" }}>
              Week {currentWeek}
            </span>
          )}

          {links.map((link) => {
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-link ${
                  isActive(link.href) ? "nav-link-active" : ""
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
