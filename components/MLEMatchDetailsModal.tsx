"use client";

import Image from "next/image";

interface TeamStats {
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  sprocketRating: number;
}

interface RoundData {
  roundNumber: number;
  homeScore: number;
  awayScore: number;
  homeStats: TeamStats;
  awayStats: TeamStats;
}

interface MatchTeam {
  id: string;
  name: string;
  leagueId: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface MLEMatchDetailsData {
  week: number;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  homePlayers: string[];
  awayPlayers: string[];
  rounds: RoundData[];
}

interface MLEMatchDetailsModalProps {
  matchData: {
    match: null;
    message?: string;
  } | MLEMatchDetailsData | null;
  onClose: () => void;
  isLoading: boolean;
}

const STAT_COLUMNS = ["G", "Sh", "Sv", "A", "DI", "DT", "SR"];

function StatHeaderRow({ align }: { align: "left" | "right" }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gap: "0.4rem",
        fontSize: "0.7rem",
        fontWeight: 600,
        color: "rgba(255,255,255,0.5)",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        textAlign: align === "left" ? "left" : "right",
      }}
    >
      {STAT_COLUMNS.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}

function StatValueRow({ stats, align }: { stats: TeamStats; align: "left" | "right" }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gap: "0.4rem",
        fontSize: "0.85rem",
        color: "rgba(255,255,255,0.9)",
        textAlign: align === "left" ? "left" : "right",
      }}
    >
      <span>{stats.goals}</span>
      <span>{stats.shots}</span>
      <span>{stats.saves}</span>
      <span>{stats.assists}</span>
      <span>{stats.demosInflicted}</span>
      <span>{stats.demosTaken}</span>
      <span>{stats.sprocketRating.toFixed(1)}</span>
    </div>
  );
}

function PlayerPills({ players }: { players: string[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", justifyContent: "center" }}>
      {players.map((name) => (
        <span
          key={name}
          style={{
            padding: "0.2rem 0.6rem",
            borderRadius: "999px",
            fontSize: "0.75rem",
            backgroundColor: "rgba(255,255,255,0.15)",
            color: "#ffffff",
          }}
        >
          {name}
        </span>
      ))}
    </div>
  );
}

export default function MLEMatchDetailsModal({
  matchData,
  onClose,
  isLoading,
}: MLEMatchDetailsModalProps) {
  if (!matchData && !isLoading) return null;

  const data = matchData && "rounds" in matchData ? matchData : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "1000px",
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          position: "relative",
          borderRadius: "12px",
          padding: "2rem",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1.5rem",
            paddingBottom: "1rem",
            borderBottom: "2px solid rgba(255,255,255,0.2)",
          }}
        >
          <h2 style={{ fontSize: "1.8rem", fontWeight: 700, color: "#ffffff", margin: 0 }}>
            {isLoading ? "Loading Match..." : data ? `Week ${data.week} Match` : "Match Details"}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.2)",
              border: "none",
              color: "#ffffff",
              fontSize: "1.5rem",
              cursor: "pointer",
              padding: "0.25rem 0.5rem",
              lineHeight: 1,
              borderRadius: "4px",
              backdropFilter: "blur(4px)",
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "rgba(255,255,255,0.7)" }}>
            Loading match details...
          </div>
        ) : !data ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "rgba(255,255,255,0.7)" }}>
            {matchData && "message" in matchData && matchData.message
              ? matchData.message
              : "No match found for this week"}
          </div>
        ) : (
          <>
            {/* Team headers + player lists */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                gap: "1.5rem",
                alignItems: "start",
                marginBottom: "2rem",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <Image src={data.homeTeam.logoPath} alt={data.homeTeam.name} width={36} height={36} style={{ borderRadius: "4px" }} />
                  <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#ffffff" }}>
                    {data.homeTeam.name}
                  </span>
                </div>
                <PlayerPills players={data.homePlayers} />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)", fontWeight: 700, fontSize: "1.2rem", paddingTop: "0.4rem" }}>
                vs
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <Image src={data.awayTeam.logoPath} alt={data.awayTeam.name} width={36} height={36} style={{ borderRadius: "4px" }} />
                  <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#ffffff" }}>
                    {data.awayTeam.name}
                  </span>
                </div>
                <PlayerPills players={data.awayPlayers} />
              </div>
            </div>

            {/* Rounds */}
            {data.rounds.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "rgba(255,255,255,0.7)" }}>
                No round-by-round data available for this match
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {/* Column headers */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto 1fr",
                    gap: "1rem",
                    alignItems: "center",
                    padding: "0 1rem",
                  }}
                >
                  <StatHeaderRow align="left" />
                  <div style={{ minWidth: "90px" }} />
                  <StatHeaderRow align="right" />
                </div>

                {data.rounds.map((round) => (
                  <div
                    key={round.roundNumber}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto 1fr",
                      gap: "1rem",
                      alignItems: "center",
                      padding: "1rem",
                      backgroundColor: "rgba(255,255,255,0.05)",
                      borderRadius: "8px",
                    }}
                  >
                    <StatValueRow stats={round.homeStats} align="left" />

                    <div style={{ textAlign: "center", minWidth: "90px" }}>
                      <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)", marginBottom: "0.15rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Game {round.roundNumber}
                      </div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "#ffffff" }}>
                        {round.homeScore} - {round.awayScore}
                      </div>
                    </div>

                    <StatValueRow stats={round.awayStats} align="right" />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
