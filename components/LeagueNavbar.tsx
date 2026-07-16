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

  // Fetch the user's fantasy team ID and league data
  useEffect(() => {
    const fetchMyTeam = async () => {
      if (!session?.user?.id || !leagueId) return;

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
          }
        }
      } catch (error) {
        console.error("Error fetching user's team:", error);
      }
    };

    fetchMyTeam();
  }, [session?.user?.id, leagueId]);

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
          {/* Draft Button - shown while a draft hasn't wrapped up yet */}
          {(draftStatus === "not_started" || draftStatus === "in_progress" || draftStatus === "paused") && (
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

          {/* Current Week Pill - Only show after the draft has wrapped up */}
          {draftStatus === "completed" && (
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
