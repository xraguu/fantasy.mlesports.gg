"use client";

import { useState, useEffect } from "react";
import { useAlert } from "@/components/AlertProvider";

interface FantasyLeague {
  id: string;
  name: string;
  season: number;
  maxTeams: number;
  draftType: string;
  waiverSystem: string;
  _count: {
    fantasyTeams: number;
    draftPicks: number;
    matchups: number;
  };
  fantasyTeams: {
    owner: {
      displayName: string;
      discordId: string;
    };
  }[];
}

export default function LeagueArchivePage() {
  const showAlert = useAlert();
  const [searchTerm, setSearchTerm] = useState("");
  const [leagues, setLeagues] = useState<FantasyLeague[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/leagues")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch leagues");
        return res.json();
      })
      .then((data) => setLeagues(data.leagues || []))
      .catch((error) => {
        console.error("Error fetching leagues:", error);
        showAlert("Failed to load leagues", "error");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentSeason = leagues.reduce(
    (max, l) => Math.max(max, l.season),
    -Infinity
  );

  const archivedLeagues = leagues
    .filter((l) => l.season < currentSeason)
    .filter(
      (league) =>
        league.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        league.id.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => b.season - a.season || a.name.localeCompare(b.name));

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
          Loading leagues...
        </div>
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        Leagues from past seasons. These no longer appear in managers&apos; &quot;My Leagues&quot;
        on the home page, but remain fully viewable here for historical reference.
      </p>

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
        <input
          type="text"
          placeholder="Search archived leagues..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: "0.75rem 1rem",
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "6px",
            color: "var(--text-main)",
            fontSize: "0.95rem",
            width: "300px",
            maxWidth: "100%",
          }}
        />
      </div>

      <div className="card" style={{ padding: "1.5rem" }}>
        <h2
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            marginBottom: "1.5rem",
            color: "var(--text-main)",
          }}
        >
          Archived Leagues
        </h2>
        <div style={{ overflowX: "auto" }}>
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
                League Name
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
                Season
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
                Teams
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
            {archivedLeagues.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: "3rem",
                    textAlign: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  {searchTerm
                    ? "No archived leagues found matching your search"
                    : "No past-season leagues yet — leagues appear here once a newer season's league exists."}
                </td>
              </tr>
            ) : (
              archivedLeagues.map((league) => (
                <tr
                  key={league.id}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <td style={{ padding: "0.75rem 0.5rem" }}>
                    <div>
                      <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                        {league.name}
                      </span>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                          marginTop: "0.25rem",
                        }}
                      >
                        {league.draftType === "snake" ? "Snake" : "Linear"} Draft •{" "}
                        {league.waiverSystem === "faab"
                          ? "FAAB"
                          : league.waiverSystem === "rolling"
                          ? "Rolling"
                          : "Fixed"}{" "}
                        Waivers
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                    <span
                      style={{
                        padding: "0.4rem 1rem",
                        borderRadius: "20px",
                        fontWeight: 600,
                        fontSize: "0.8rem",
                        background: "rgba(255,255,255,0.1)",
                        color: "var(--text-main)",
                      }}
                    >
                      {league.season}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.5rem",
                      textAlign: "center",
                      fontWeight: 600,
                    }}
                  >
                    {league._count.fantasyTeams}/{league.maxTeams}
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
                      onClick={() =>
                        (window.location.href = `/admin/leagues/${league.id}`)
                      }
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
