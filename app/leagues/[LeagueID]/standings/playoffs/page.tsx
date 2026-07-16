"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { getPlayoffBracketShape } from "@/lib/playoffBracketShape";

const CARD_WIDTH = "260px";
const GOLD = "#f2b632";

interface TeamDTO {
  id: string;
  teamName: string;
  managerName: string;
  rank: number | null;
}

interface RealMatchupDTO {
  id: string;
  week: number;
  homeTeam: { id: string; teamName: string; managerName: string };
  awayTeam: { id: string; teamName: string; managerName: string };
  homeScore: number | null;
  awayScore: number | null;
}

interface RealRoundDTO {
  week: number;
  roundNumber: number;
  moneyByes: TeamDTO[];
  moneyMatchups: RealMatchupDTO[];
  consolationMatchups: RealMatchupDTO[];
}

interface PlayoffsResponse {
  maxTeams: number;
  regularSeasonWeeks: number;
  error: string | null;
  realRounds: RealRoundDTO[];
  projectedRound1: {
    moneyByes: TeamDTO[];
    moneyPairs: [TeamDTO, TeamDTO][];
    consolationPairs: [TeamDTO, TeamDTO][];
  } | null;
}

type Slot =
  | {
      kind: "match";
      id: string;
      week: number | null;
      label?: string;
      homeName: string;
      homeManager: string;
      homeScore: number | null;
      awayName: string;
      awayManager: string;
      awayScore: number | null;
      projected: boolean;
    }
  | { kind: "bye"; id: string; label?: string; name: string; manager: string; rank: number | null; projected: boolean }
  | { kind: "tbd"; id: string; label?: string };

interface Theme {
  accent: string;
  cardFrom: string;
  cardTo: string;
  borderIdle: string;
  borderActive: string;
  glow: string;
  muted: string;
  winnerBg: string;
  headerBg: string;
  headerBorder: string;
}

const GOLD_THEME: Theme = {
  accent: GOLD,
  cardFrom: "#0d1526",
  cardTo: "#182036",
  borderIdle: "rgba(242,182,50,0.2)",
  borderActive: "rgba(242,182,50,0.55)",
  glow: "0 0 18px rgba(242,182,50,0.16)",
  muted: "rgba(242,182,50,0.55)",
  winnerBg: "rgba(242,182,50,0.12)",
  headerBg: "linear-gradient(90deg, rgba(242,182,50,0.18), rgba(242,182,50,0.05))",
  headerBorder: "rgba(242,182,50,0.4)",
};

const GRAY_THEME: Theme = {
  accent: "#e5e7eb",
  cardFrom: "#1e2139",
  cardTo: "#252844",
  borderIdle: "rgba(255,255,255,0.15)",
  borderActive: "rgba(255,255,255,0.35)",
  glow: "none",
  muted: "rgba(255,255,255,0.5)",
  winnerBg: "rgba(255,255,255,0.07)",
  headerBg: "rgba(255,255,255,0.08)",
  headerBorder: "rgba(255,255,255,0.2)",
};

function RoundHeader({ label, theme }: { label: string; theme: Theme }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "0.5rem 0.75rem",
        marginBottom: "1.25rem",
        borderRadius: "6px",
        background: theme.headerBg,
        border: `1px solid ${theme.headerBorder}`,
        color: theme.accent,
        fontWeight: 700,
        fontSize: "0.8rem",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  );
}

function SlotLabel({ label, theme }: { label: string; theme: Theme }) {
  return (
    <div
      style={{
        textAlign: "center",
        marginBottom: "0.4rem",
        fontSize: "0.7rem",
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: theme.muted,
      }}
    >
      {label}
    </div>
  );
}

function TeamRow({
  name,
  manager,
  score,
  won,
  played,
  theme,
  onClick,
}: {
  name: string;
  manager: string;
  score: number | null;
  won: boolean;
  played: boolean;
  theme: Theme;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.65rem 0.9rem",
        background: won ? theme.winnerBg : "transparent",
        opacity: played && !won ? 0.5 : 1,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          onClick={onClick}
          style={{
            fontSize: "0.95rem",
            fontWeight: won ? 700 : 600,
            color: won ? theme.accent : "#f5f6f7",
            cursor: onClick ? "pointer" : "default",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: "0.75rem",
            color: theme.muted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {manager}
        </div>
      </div>
      {score !== null && (
        <div style={{ fontSize: "1.3rem", fontWeight: 800, color: won ? theme.accent : "rgba(255,255,255,0.65)", flexShrink: 0, marginLeft: "0.5rem" }}>
          {score.toFixed(1)}
        </div>
      )}
    </div>
  );
}

function SlotCard({
  slot,
  theme,
  onManagerClick,
  onMatchClick,
}: {
  slot: Slot;
  theme: Theme;
  onManagerClick: (manager: string) => void;
  onMatchClick: (week: number, matchupId: string) => void;
}) {
  return (
    <div>
      {slot.label && <SlotLabel label={slot.label} theme={theme} />}
      <SlotBody slot={slot} theme={theme} onManagerClick={onManagerClick} onMatchClick={onMatchClick} />
    </div>
  );
}

function SlotBody({
  slot,
  theme,
  onManagerClick,
  onMatchClick,
}: {
  slot: Slot;
  theme: Theme;
  onManagerClick: (manager: string) => void;
  onMatchClick: (week: number, matchupId: string) => void;
}) {
  if (slot.kind === "tbd") {
    return (
      <div
        style={{
          borderRadius: "10px",
          border: `1px dashed ${theme.borderIdle}`,
          padding: "1.4rem 0.9rem",
          textAlign: "center",
          color: theme.muted,
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
        }}
      >
        TBD
      </div>
    );
  }

  if (slot.kind === "bye") {
    return (
      <div
        style={{
          background: `linear-gradient(160deg, ${theme.cardFrom} 0%, ${theme.cardTo} 100%)`,
          borderRadius: "10px",
          border: `1px ${slot.projected ? "dashed" : "solid"} ${theme.borderActive}`,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0.9rem" }}>
          <div style={{ minWidth: 0 }}>
            <div
              onClick={() => onManagerClick(slot.manager)}
              style={{ fontSize: "0.95rem", fontWeight: 700, color: theme.accent, cursor: "pointer" }}
            >
              {slot.name}
            </div>
            <div style={{ fontSize: "0.75rem", color: theme.muted }}>{slot.manager}</div>
          </div>
          {slot.rank !== null && (
            <div
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                color: theme.accent,
                border: `1px solid ${theme.borderActive}`,
                borderRadius: "4px",
                padding: "0.15rem 0.45rem",
                flexShrink: 0,
                marginLeft: "0.5rem",
              }}
            >
              #{slot.rank}
            </div>
          )}
        </div>
        <div
          style={{
            fontSize: "0.65rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: theme.accent,
            textAlign: "center",
            padding: "0.35rem 0",
            borderTop: `1px solid ${theme.borderIdle}`,
          }}
        >
          {slot.projected ? "PROJECTED BYE" : "ROUND 1 BYE"}
        </div>
      </div>
    );
  }

  const played = slot.homeScore !== null && slot.awayScore !== null;
  const homeWon = played && slot.homeScore! > slot.awayScore!;
  const awayWon = played && slot.awayScore! > slot.homeScore!;
  const isRealMatch = !slot.projected && slot.week !== null;

  return (
    <div
      onClick={isRealMatch ? () => onMatchClick(slot.week!, slot.id) : undefined}
      style={{
        background: `linear-gradient(160deg, ${theme.cardFrom} 0%, ${theme.cardTo} 100%)`,
        borderRadius: "10px",
        border: `1px ${slot.projected ? "dashed" : "solid"} ${played ? theme.borderActive : theme.borderIdle}`,
        boxShadow: played ? theme.glow : "none",
        overflow: "hidden",
        cursor: isRealMatch ? "pointer" : "default",
      }}
    >
      <TeamRow
        name={slot.homeName}
        manager={slot.homeManager}
        score={slot.homeScore}
        won={homeWon}
        played={played}
        theme={theme}
        onClick={
          isRealMatch
            ? undefined
            : (e: React.MouseEvent) => {
                e.stopPropagation();
                onManagerClick(slot.homeManager);
              }
        }
      />
      <div style={{ height: "1px", background: `linear-gradient(90deg, transparent, ${theme.borderIdle}, transparent)` }} />
      <TeamRow
        name={slot.awayName}
        manager={slot.awayManager}
        score={slot.awayScore}
        won={awayWon}
        played={played}
        theme={theme}
        onClick={
          isRealMatch
            ? undefined
            : (e: React.MouseEvent) => {
                e.stopPropagation();
                onManagerClick(slot.awayManager);
              }
        }
      />
      <div
        style={{
          fontSize: "0.65rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: theme.accent,
          opacity: played ? 0.65 : slot.projected ? 0.55 : 0.65,
          textAlign: "center",
          padding: "0.35rem 0",
          borderTop: `1px solid ${theme.borderIdle}`,
        }}
      >
        {slot.projected ? "PROJECTED" : played ? "VIEW MATCHUP →" : "UPCOMING — VIEW MATCHUP →"}
      </div>
    </div>
  );
}

function buildRoundSlots(
  roundNumber: number,
  shapeMoney: { matches: number; byes: number; labels?: string[] },
  shapeConsolation: { matches: number; labels?: string[] },
  real: RealRoundDTO | undefined,
  projected: PlayoffsResponse["projectedRound1"]
): { moneySlots: Slot[]; consolationSlots: Slot[] } {
  let moneySlots: Slot[];
  let consolationSlots: Slot[];

  if (real) {
    moneySlots = [
      ...real.moneyByes.map((t): Slot => ({ kind: "bye", id: `bye-${t.id}`, name: t.teamName, manager: t.managerName, rank: t.rank, projected: false })),
      ...real.moneyMatchups.map(
        (m, i): Slot => ({
          kind: "match",
          id: m.id,
          week: m.week,
          label: shapeMoney.labels?.[i],
          homeName: m.homeTeam.teamName,
          homeManager: m.homeTeam.managerName,
          homeScore: m.homeScore,
          awayName: m.awayTeam.teamName,
          awayManager: m.awayTeam.managerName,
          awayScore: m.awayScore,
          projected: false,
        })
      ),
    ];
    consolationSlots = real.consolationMatchups.map(
      (m, i): Slot => ({
        kind: "match",
        id: m.id,
        week: m.week,
        label: shapeConsolation.labels?.[i],
        homeName: m.homeTeam.teamName,
        homeManager: m.homeTeam.managerName,
        homeScore: m.homeScore,
        awayName: m.awayTeam.teamName,
        awayManager: m.awayTeam.managerName,
        awayScore: m.awayScore,
        projected: false,
      })
    );
  } else if (roundNumber === 1 && projected) {
    moneySlots = [
      ...projected.moneyByes.map((t): Slot => ({ kind: "bye", id: `pbye-${t.id}`, name: t.teamName, manager: t.managerName, rank: t.rank, projected: true })),
      ...projected.moneyPairs.map(
        ([a, b], i): Slot => ({
          kind: "match",
          id: `pmoney-${i}`,
          week: null,
          homeName: a.teamName,
          homeManager: a.managerName,
          homeScore: null,
          awayName: b.teamName,
          awayManager: b.managerName,
          awayScore: null,
          projected: true,
        })
      ),
    ];
    consolationSlots = projected.consolationPairs.map(
      ([a, b], i): Slot => ({
        kind: "match",
        id: `pconsolation-${i}`,
        week: null,
        homeName: a.teamName,
        homeManager: a.managerName,
        homeScore: null,
        awayName: b.teamName,
        awayManager: b.managerName,
        awayScore: null,
        projected: true,
      })
    );
  } else {
    moneySlots = [
      ...Array.from({ length: shapeMoney.byes }, (_, i): Slot => ({ kind: "tbd", id: `tbd-mbye-${roundNumber}-${i}` })),
      ...Array.from({ length: shapeMoney.matches }, (_, i): Slot => ({ kind: "tbd", id: `tbd-money-${roundNumber}-${i}`, label: shapeMoney.labels?.[i] })),
    ];
    consolationSlots = Array.from(
      { length: shapeConsolation.matches },
      (_, i): Slot => ({ kind: "tbd", id: `tbd-cons-${roundNumber}-${i}`, label: shapeConsolation.labels?.[i] })
    );
  }

  return { moneySlots, consolationSlots };
}

export default function PlayoffsPage() {
  const params = useParams();
  const router = useRouter();
  const leagueId = params.LeagueID as string;

  const [data, setData] = useState<PlayoffsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/leagues/${leagueId}/playoffs`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load playoffs");
        setData(json);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load playoffs");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [leagueId]);

  const handleManagerClick = (manager: string) => {
    router.push(`/leagues/${leagueId}/opponents?manager=${encodeURIComponent(manager)}`);
  };

  const handleMatchClick = (week: number, matchupId: string) => {
    router.push(`/leagues/${leagueId}/scoreboard?week=${week}&matchup=${matchupId}`);
  };

  if (loading) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>Loading playoffs bracket...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#ef4444", fontSize: "1.1rem" }}>Error: {error || "Could not load playoffs"}</div>
      </div>
    );
  }

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
      <button
        onClick={() => router.push(`/leagues/${leagueId}/standings`)}
        style={{
          backgroundColor: "rgba(255,255,255,0.1)",
          color: "var(--text-main)",
          padding: "0.5rem 1rem",
          borderRadius: "0.5rem",
          fontWeight: 600,
          fontSize: "0.9rem",
          border: "1px solid rgba(255,255,255,0.2)",
          cursor: "pointer",
          transition: "all 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)";
        }}
      >
        ← Back to Standings
      </button>
      <h1 style={{ fontSize: "2.5rem", fontWeight: 700, color: GOLD, margin: 0, textShadow: "0 0 24px rgba(242,182,50,0.25)" }}>
        Playoffs
      </h1>
    </div>
  );

  if (data.error) {
    return (
      <div style={{ minHeight: "100vh", padding: "2rem 1rem" }}>
        {header}
        <p style={{ color: "var(--text-muted)" }}>{data.error}</p>
      </div>
    );
  }

  const shape = getPlayoffBracketShape(data.maxTeams);
  const realRoundByNumber = new Map(data.realRounds.map((r) => [r.roundNumber, r]));

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "2rem 1rem",
        background: "radial-gradient(ellipse at top, rgba(242,182,50,0.06), transparent 60%)",
      }}
    >
      {header}
      <p style={{ color: "var(--text-muted)", marginBottom: "2rem", fontSize: "0.85rem" }}>
        Click any matchup box to see the full lineups and live scoring on the Scoreboard.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "3rem" }}>
        {/* Championship Bracket */}
        <div>
          <h2
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              color: GOLD,
              marginBottom: "1.25rem",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
            }}
          >
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: GOLD, boxShadow: "0 0 8px rgba(242,182,50,0.7)" }} />
            Championship Bracket
          </h2>
          <div style={{ overflowX: "auto", paddingBottom: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "2rem", minWidth: "min-content" }}>
              {shape.map((round, idx) => {
                const real = realRoundByNumber.get(round.roundNumber);
                const { moneySlots } = buildRoundSlots(
                  round.roundNumber,
                  { matches: round.moneyMatches, byes: round.moneyByes, labels: round.moneyMatchLabels },
                  { matches: round.consolationMatches, labels: round.consolationMatchLabels },
                  real,
                  data.projectedRound1
                );
                const gap = Math.min(24 * Math.pow(2, idx), 160);

                return (
                  <div key={round.roundNumber} style={{ display: "flex", flexDirection: "column", flexShrink: 0, width: CARD_WIDTH }}>
                    <RoundHeader label={`Round ${round.roundNumber}`} theme={GOLD_THEME} />
                    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: `${gap}px` }}>
                      {moneySlots.map((slot) => (
                        <SlotCard key={slot.id} slot={slot} theme={GOLD_THEME} onManagerClick={handleManagerClick} onMatchClick={handleMatchClick} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Consolation Bracket */}
        <div>
          <h2
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              color: "var(--text-muted)",
              marginBottom: "1.25rem",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
            }}
          >
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.4)" }} />
            Consolation Bracket
          </h2>
          <div style={{ overflowX: "auto", paddingBottom: "0.5rem" }}>
            <div style={{ display: "flex", gap: "1.5rem", minWidth: "min-content" }}>
              {shape.map((round) => {
                const real = realRoundByNumber.get(round.roundNumber);
                const { consolationSlots } = buildRoundSlots(
                  round.roundNumber,
                  { matches: round.moneyMatches, byes: round.moneyByes, labels: round.moneyMatchLabels },
                  { matches: round.consolationMatches, labels: round.consolationMatchLabels },
                  real,
                  data.projectedRound1
                );

                return (
                  <div key={round.roundNumber} style={{ display: "flex", flexDirection: "column", flexShrink: 0, width: CARD_WIDTH }}>
                    <RoundHeader label={`Round ${round.roundNumber}`} theme={GRAY_THEME} />
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                      {consolationSlots.map((slot) => (
                        <SlotCard key={slot.id} slot={slot} theme={GRAY_THEME} onManagerClick={handleManagerClick} onMatchClick={handleMatchClick} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
